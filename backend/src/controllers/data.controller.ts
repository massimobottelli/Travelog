/**
 * Travelog MVP1 — Data Controller
 */

import type { Request, Response } from "express";
import dataResetService from "../services/data-reset.service.js";
import dataBackupService from "../services/data-backup.service.js";
import { readBodyWithLimit, MAX_IMPORT_BYTES } from "../utils/request-body.js";

class DataController {
  async deleteAllData(_req: Request, res: Response): Promise<void> {
    await dataResetService.resetAllData();
    res.status(204).send();
  }

  /**
   * GET /data/export — consistent read-only JSON snapshot of every table.
   * The document is pretty-printed (indented) for readability.
   */
  async exportData(_req: Request, res: Response): Promise<void> {
    const { filename, document } = await dataBackupService.exportAllData();
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(document, null, 2));
  }

  /**
   * POST /data/import — full restore of a backup document.
   * The body is read as raw text (application/octet-stream) so the JSON
   * is not pre-parsed by express.json(); validation happens in the service.
   * The upload size is capped (memory-DoS protection): an oversized body
   * is rejected with 400 VALIDATION_ERROR, a response already declared
   * by the OpenAPI contract of this operation.
   */
  async importData(req: Request, res: Response): Promise<void> {
    const buffer = await readBodyWithLimit(req, MAX_IMPORT_BYTES);

    const result = await dataBackupService.importAllData(buffer);
    res.status(200).json(result);
  }
}

export default new DataController();
