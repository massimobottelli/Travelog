/**
 * Travelog MVP1 — Data Backup Service
 *
 * Explicit, user-triggered maintenance operations behind the Settings →
 * Database commands:
 *
 * - export: consistent read-only JSON snapshot of every table
 *   (REPEATABLE READ, no writes, usable while the app is serving);
 * - import: full restore of a backup document in a SINGLE transaction:
 *   TRUNCATE + inserts + sequence resync, committed together. Any failure
 *   rolls back and leaves the existing data untouched.
 *
 * The schema is not part of the backup (it is reproduced by the versioned
 * migrations); only the data is exported and restored.
 *
 * Exclusivity with the scan lifecycle uses the same PostgreSQL advisory
 * lock as DELETE /data: an import is rejected while a scan is running and
 * prevents a scan from starting mid-restore.
 */

import type { PoolClient } from "pg";
import { pool } from "../db/client.js";
import { TABLES, type TableName } from "../db/tables.js";
import scansRepository from "../repositories/scans.repository.js";
import { SCAN_LOCK_ID } from "../config/locks.js";
import { ConflictError } from "../models/errors.js";
import logger from "../config/logger.js";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackupFilename,
  formatExportTimestamp,
  parseBackupDocument,
  type BackupDocument,
} from "../utils/backup.js";

export interface ExportResult {
  filename: string;
  document: BackupDocument;
}

export interface ImportResult {
  totalRows: number;
  counts: Record<string, number>;
}

class DataBackupService {
  /**
   * Read every table inside one read-only transaction so the backup is a
   * consistent snapshot. `TimeZone=UTC` makes `timestamp with time zone`
   * output deterministic and round-trip safe; `DateStyle=ISO` makes date
   * and timestamp literals unambiguous.
   */
  async exportAllData(): Promise<ExportResult> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL DateStyle = 'ISO, MDY'");
      await client.query("SET LOCAL TimeZone = 'UTC'");

      const tables = {} as Record<TableName, unknown[]>;
      for (const table of TABLES) {
        // Table names come from the hardcoded canonical list, never from
        // user input (technical design §67: no dynamic SQL injection surface).
        const result = await client.query(
          `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) AS rows
             FROM (SELECT * FROM ${table}) t`,
        );
        tables[table] = result.rows[0].rows as unknown[];
      }

      await client.query("COMMIT");

      const now = new Date();
      const document: BackupDocument = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: formatExportTimestamp(now),
        tables,
      };

      logger.info({ tables: TABLES.length }, "data.backup.exported");
      return { filename: buildBackupFilename(now), document };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error({ err }, "data.backup.export_failed");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Replace all catalogued data with the content of a backup document.
   *
   * The document is validated before the lock is taken, so an invalid file
   * never blocks scans. The restore itself is atomic; the locally
   * configured photo root is preserved (it is environment-specific and may
   * not exist on the machine the backup comes from).
   */
  async importAllData(buffer: Buffer): Promise<ImportResult> {
    const document = parseBackupDocument(buffer.toString("utf8"));

    const acquired = await scansRepository.tryAcquireLock(SCAN_LOCK_ID);
    if (!acquired) {
      throw new ConflictError("Another scan is already running", "SCAN_ALREADY_RUNNING");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Read the local photo root before the truncate: it is preserved
      // across the restore (same policy as DELETE /data).
      const current = await client.query("SELECT photo_root FROM settings ORDER BY id LIMIT 1");
      const localPhotoRoot: string = current.rows[0]?.photo_root ?? "";

      await client.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);

      const counts: Record<string, number> = {};
      for (const table of TABLES) {
        const rows = document.tables[table];
        if (rows.length > 0) {
          // json_populate_recordset maps the exported JSON rows onto the
          // table columns (same names, same order), so no column list has
          // to be maintained here.
          await client.query(
            `INSERT INTO ${table}
               SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`,
            [JSON.stringify(rows)],
          );
        }
        counts[table] = rows.length;
      }

      // The backup of the settings table carries the photo root of the
      // machine it was taken from: restore the local value instead.
      if (document.tables.settings.length > 0) {
        await client.query("UPDATE settings SET photo_root = $1", [localPhotoRoot]);
      } else {
        await client.query(
          `INSERT INTO settings (id, photo_root) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
          [localPhotoRoot],
        );
      }

      for (const table of TABLES) {
        await this.resyncSequence(client, table);
      }

      await client.query("COMMIT");

      const totalRows = Object.values(counts).reduce((sum, value) => sum + value, 0);
      logger.info({ totalRows, tables: TABLES.length }, "data.backup.imported");
      return { totalRows, counts };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error({ err }, "data.backup.import_failed");
      throw err;
    } finally {
      client.release();
      await scansRepository.releaseLock(SCAN_LOCK_ID).catch(() => undefined);
    }
  }

  /**
   * Set each table's id sequence to the restored maximum, so rows created
   * after the restore never collide with restored ids. Tables without a
   * serial `id` column (e.g. manual_trip_day_localities) are skipped: the
   * column is checked first because pg_get_serial_sequence() raises an
   * error when the relation has no such column.
   */
  private async resyncSequence(client: PoolClient, table: TableName): Promise<void> {
    const sequence = await client.query(
      `SELECT pg_get_serial_sequence($1, 'id') AS name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = 'id'`,
      [table],
    );
    const name = sequence.rows[0]?.name as string | null;
    if (!name) return;

    await client.query(
      `SELECT setval($1::regclass,
                      COALESCE((SELECT max(id) FROM ${table}), 1),
                      (SELECT count(*) > 0 FROM ${table}))`,
      [name],
    );
  }
}

export default new DataBackupService();
