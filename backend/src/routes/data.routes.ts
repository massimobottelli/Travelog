/**
 * Travelog MVP1 — Data Routes
 */

import { Router } from "express";
import dataController from "../controllers/data.controller.js";

const router = Router();

// DELETE /data — irreversibly delete all catalogued data
router.delete("/", dataController.deleteAllData);

// GET /data/export — download a JSON backup of every table
router.get("/export", dataController.exportData);

// POST /data/import — restore from a JSON backup file
router.post("/import", dataController.importData);

export default router;
