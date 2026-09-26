/**
 * Travelog MVP1 — Scans Service
 *
 * Orchestrates scan lifecycle including advisory locking,
 * background sequential processing of photos, transaction-per-photo,
 * and incremental idempotent scanning.
 */

import { eq, desc, and } from "drizzle-orm";
import { promises as fs } from "node:fs";
import { isInsideRoot, validateScanDirectory } from "../scans/path-guard.js";
import { pool as dbPool } from "../db/client.js";
import { scanStatusEnum } from "../db/schema.js";
import scansRepository from "../repositories/scans.repository.js";
import photosRepository from "../repositories/photos.repository.js";
import scanErrorsRepository, {
  type ScanErrorRecord,
} from "../repositories/scan-errors.repository.js";
import geocodingService from "../services/geocoding.service.js";
import type { ReverseGeocodeResult } from "../services/geocoding.service.js";
import tripCalculationService from "../services/trip-calculation.service.js";
import { upsertPresence } from "../repositories/presences.repository.js";
import { NotFoundError, ConflictError, ValidationError } from "../models/errors.js";
import { SCAN_LOCK_ID } from "../config/locks.js";
import logger from "../config/logger.js";
import configService from "./config.service.js";
import { enumerateSupportedFiles, type ScanEntry } from "../scans/photo-enumeration.js";
import { readExif } from "../scans/exiftool.js";

export interface ScanRecord {
  id: number;
  folder: string;
  status: string;
  filesAnalyzed: number | null;
  filesTotal: number | null;
  newPhotos: number | null;
  existingPhotos: number | null;
  excludedPhotos: number | null;
  errors: number | null;
  startedAt: Date;
  errorMessage?: string | null;
  endedAt?: Date | null;
}

export interface ScanListResult {
  items: ScanRecord[];
  page: number;
  pageSize: number;
  total: number;
}

class ScansService {
  private readonly lockID = SCAN_LOCK_ID;

  /**
   * In-process cancellation requests. A scan checks this flag between
   * photos and finalizes itself when it is set (single-process design,
   * technical design §31).
   */
  private readonly cancelledScans = new Set<number>();

  async startScan(folder: string): Promise<ScanRecord> {
    // An empty folder scans the whole configured photo root
    if (typeof folder !== "string") {
      throw new ValidationError("Cartella di scansione non valida", { fields: ["folder"] });
    }
    // Fail fast when the photo root is not configured yet (user must set
    // it from the Settings page) or does not exist.
    const { photoRoot: configuredRoot } = await configService.getRuntimeConfig();
    if (!configuredRoot) {
      throw new ValidationError(
        "Percorso foto non configurato: impostalo nella pagina Impostazioni",
        { fields: ["photoRoot"] },
      );
    }
    const targetDir = await validateScanDirectory(configuredRoot, folder);
    const realRoot = await fs.realpath(configuredRoot);
    const acquired = await scansRepository.tryAcquireLock(this.lockID);
    if (!acquired) {
      throw new ConflictError("Another scan is already running", "SCAN_ALREADY_RUNNING");
    }
    let scanRecord: ScanRecord;
    try {
      scanRecord = await scansRepository.createScan(folder);
    } catch (err) {
      await scansRepository.releaseLock(this.lockID).catch(() => undefined);
      throw err;
    }
    this.runScan(scanRecord.id, targetDir, realRoot).catch((err) => {
      logger.error({ err, scanId: scanRecord.id }, "scan.fatal");
    });
    return scanRecord;
  }

  /**
   * Request cancellation of a running scan. The scan stops after the
   * photo currently being processed and is finalized as failed with a
   * diagnostic message; photos already saved remain in the database.
   */
  async cancelScan(scanId: number): Promise<ScanRecord> {
    const scan = await scansRepository.getScan(scanId);
    if (!scan) throw new NotFoundError("Scan", scanId);
    if (scan.status !== "running" && scan.status !== "pending") {
      throw new ConflictError("La scansione non è in corso", "SCAN_NOT_RUNNING");
    }
    this.cancelledScans.add(scanId);
    return scan;
  }

  private async runScan(scanId: number, targetDir: string, realRoot: string): Promise<void> {
    const cnt = { fa: 0, np: 0, ep: 0, xp: 0, er: 0 };
    try {
      const entries = await enumerateSupportedFiles(targetDir, realRoot);
      logger.info({ filesTotal: entries.length, targetDir, scanId }, "scan.enumerated");
      // The total is known right after enumeration (includes subfolders):
      // persist it so the frontend can render a proportional progress bar.
      await scansRepository
        .updateScan(scanId, { filesTotal: entries.length })
        .catch(() => undefined);
      let cancelled = this.cancelledScans.has(scanId);
      for (const entry of entries) {
        // Re-check on every iteration: the cancel request may arrive
        // while the loop is already running.
        if (cancelled || this.cancelledScans.has(scanId)) {
          cancelled = true;
          break;
        }
        cnt.fa++;
        try {
          // Recheck immediately before EXIF: enumeration and processing are separated in time.
          if (!isInsideRoot(realRoot, await fs.realpath(entry.absolutePath))) {
            logger.warn({ scanId, filePath: entry.absolutePath }, "scan.symlink.skipped");
            continue;
          }
          await this.processPhoto(entry, scanId, cnt);
        } catch (err) {
          cnt.er++;
          const msg = err instanceof Error ? err.message : "Unknown";
          logger.error({ scanId, file: entry.fileName, error: msg }, "scan.file.failed");
          await scanErrorsRepository
            .insertScanError({
              scanId,
              filePath: entry.absolutePath,
              errorCode: "FILE_PROCESSING_ERROR",
              message: msg,
            })
            .catch(() => {});
        } finally {
          await scansRepository
            .updateScan(scanId, {
              filesAnalyzed: cnt.fa,
              newPhotos: cnt.np,
              existingPhotos: cnt.ep,
              excludedPhotos: cnt.xp,
              errors: cnt.er,
            })
            .catch(() => {});
        }
      }
      if (cancelled) {
        logger.warn({ scanId, filesAnalyzed: cnt.fa }, "scan.cancelled");
        await scansRepository.updateScan(scanId, {
          status: "stopped",
          endedAt: new Date(),
        });
      } else {
        logger.info({ scanId, ...cnt }, "scan.completed");
        await this.finalizeSuccess(scanId, cnt);
        // Phase 5 (requirements §10.6): new photos may create new trips;
        // existing trips are never modified automatically (§11). A failure
        // here must not invalidate the completed scan.
        try {
          const result = await tripCalculationService.generateTrips();
          logger.info({ scanId, tripsCreated: result.tripsCreated }, "scan.trip.generation.done");
        } catch (err) {
          logger.error({ err, scanId }, "scan.trip.generation.failed");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fatal error";
      await this.finalizeWithError(scanId, msg);
    } finally {
      this.cancelledScans.delete(scanId);
      await scansRepository.releaseLock(this.lockID).catch(() => undefined);
    }
  }

  private async processPhoto(
    entry: ScanEntry,
    scanId: number,
    cnt: Record<string, number>,
  ): Promise<void> {
    const ex = await photosRepository.findPhotoByFingerprint(
      entry.absolutePath,
      entry.size,
      entry.mtime,
    );
    if (ex) {
      cnt.ep++;
      return;
    }
    const exif = await readExif(entry.absolutePath);
    if (!exif) {
      cnt.er++;
      cnt.xp++;
      await scanErrorsRepository
        .insertScanError({
          scanId,
          filePath: entry.absolutePath,
          errorCode: "EXIF_READ_ERROR",
          message: "Failed to read EXIF",
        })
        .catch(() => {});
      const saved = await this.saveExcluded(entry, "EXIF unreadable");
      if (!saved) {
        await scanErrorsRepository
          .insertScanError({
            scanId,
            filePath: entry.absolutePath,
            errorCode: "EXCLUSION_SAVE_ERROR",
            message: "Failed to persist excluded photo after EXIF read failure",
          })
          .catch(() => undefined);
      }
      return;
    }
    const input = photosRepository.buildPhotoInput(entry, exif);
    if (input.status === "valid") {
      // Run geocoding before saving so cache is populated for future lookups
      let geo: ReverseGeocodeResult | null = null;
      if (input.latitude !== null && input.longitude !== null) {
        try {
          geo = await geocodingService.reverseGeocode(input.latitude, input.longitude);
        } catch {
          /* geo fail does not block scan */
        }
      }
      await dbPool
        .connect()
        .then(async (cl) => {
          try {
            await cl.query("BEGIN");
            await photosRepository.upsertPhoto(input, cl);
            // Phase 5 (technical design §37): the derived presence
            // day + locality is persisted inside the same per-photo
            // transaction as the photo.
            if (geo !== null && geo.localityId !== null && input.dateTimeOriginal !== null) {
              await upsertPresence(cl, input.dateTimeOriginal, geo.localityId);
            }
            await cl.query("COMMIT");
            cnt.np++;
          } catch (e) {
            await cl.query("ROLLBACK").catch(() => undefined);
            throw e;
          } finally {
            // Always return the client to the pool, otherwise the pool
            // is exhausted after ~10 photos and the scan freezes.
            cl.release();
          }
        })
        .catch((err) => {
          cnt.er++;
          logger.error({ err, scanId, file: entry.fileName }, "scan.file.tx_failed");
        });
    } else {
      const saved = await this.saveExcluded(entry, input.exclusionReason ?? "Missing fields");
      if (!saved) {
        // Do not hide the failure (rules §23/§38): count it and persist a
        // diagnostic record so the scan errors view shows it.
        cnt.er++;
        await scanErrorsRepository
          .insertScanError({
            scanId,
            filePath: entry.absolutePath,
            errorCode: "EXCLUSION_SAVE_ERROR",
            message: `Failed to persist excluded photo: ${input.exclusionReason ?? "Missing fields"}`,
          })
          .catch(() => undefined);
      }
      cnt.xp++;
    }
  }

  /**
   * Persist an excluded photo in its own transaction.
   * Returns true on success; on failure the error is logged and reported
   * to the caller instead of being silently swallowed.
   */
  private async saveExcluded(entry: ScanEntry, reason: string): Promise<boolean> {
    try {
      await dbPool.connect().then(async (cl) => {
        try {
          await cl.query("BEGIN");
          await photosRepository.upsertExcludedPhoto(
            {
              absolutePath: entry.absolutePath,
              fileName: entry.fileName,
              fileType: entry.fileType,
              size: entry.size,
              mtime: entry.mtime,
            },
            reason,
          );
          await cl.query("COMMIT");
        } catch (e) {
          await cl.query("ROLLBACK").catch(() => undefined);
          throw e;
        } finally {
          cl.release();
        }
      });
      return true;
    } catch (err) {
      logger.error({ err, file: entry.absolutePath }, "scan.excluded.save_failed");
      return false;
    }
  }

  private async finalizeSuccess(sid: number, cnt: Record<string, number>): Promise<void> {
    await scansRepository.updateScan(sid, {
      status: cnt.er > 0 ? scanStatusEnum.enumValues[3] : scanStatusEnum.enumValues[2],
      filesAnalyzed: cnt.fa,
      newPhotos: cnt.np,
      existingPhotos: cnt.ep,
      excludedPhotos: cnt.xp,
      errors: cnt.er,
      endedAt: new Date(),
    });
  }

  private async finalizeWithError(sid: number, msg: string): Promise<void> {
    await scansRepository.updateScan(sid, {
      status: scanStatusEnum.enumValues[4],
      endedAt: new Date(),
      errorMessage: msg,
    });
  }

  async listScans(page: number, pageSize: number): Promise<ScanListResult> {
    const offset = (page - 1) * pageSize;
    const [rows, total] = await Promise.all([
      scansRepository.listScans(offset, pageSize),
      scansRepository.countScans(),
    ]);
    return { items: rows, page, pageSize, total };
  }

  async getScan(id: number): Promise<ScanRecord> {
    const scan = await scansRepository.getScan(id);
    if (!scan) throw new NotFoundError("Scan", id);
    return scan;
  }

  /**
   * List the per-file errors recorded for a scan.
   * The scan must exist, otherwise a 404 is raised.
   */
  async listScanErrors(scanId: number): Promise<ScanErrorRecord[]> {
    const scan = await scansRepository.getScan(scanId);
    if (!scan) throw new NotFoundError("Scan", scanId);
    return scanErrorsRepository.listScanErrors(scanId);
  }
}
export default new ScansService();
