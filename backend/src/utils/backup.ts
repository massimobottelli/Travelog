/**
 * Travelog MVP1 — Backup document helpers
 *
 * The backup is a logical JSON snapshot of every Travelog table
 * ({ format, version, exportedAt, tables }). The schema itself is not part
 * of the file: it is reproduced by the versioned database migrations, so
 * only the data is exported/restored.
 *
 * These helpers are pure (no I/O) so the document contract and the file
 * name are unit-testable without a database.
 */

import { TABLES, type TableName } from "../db/tables.js";
import { ValidationError } from "../models/errors.js";

export const BACKUP_FORMAT = "travelog-backup";
export const BACKUP_VERSION = 1;

export interface BackupDocument {
  format: string;
  version: number;
  /** Naive local time of the export (YYYY-MM-DDTHH:mm:ss). */
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

/** `travelog-backup-20260926-144712.json` (local time, file-name safe). */
export function buildBackupFilename(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `travelog-backup-${date}-${time}.json`;
}

/** Naive local timestamp (no timezone conversion), e.g. 2026-09-26T14:47:12. */
export function formatExportTimestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${date}T${time}`;
}

/**
 * Validate a raw backup text and normalize it: every known table is
 * present (as an empty array when absent) and unknown tables are dropped.
 * Throws ValidationError (400) with a user-facing message.
 */
export function parseBackupDocument(text: string): BackupDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ValidationError("Il file selezionato non è un backup JSON valido.");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("Il file selezionato non è un backup di Travelog valido.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new ValidationError("Il file selezionato non è un backup di Travelog valido.");
  }
  if (candidate.version !== BACKUP_VERSION) {
    throw new ValidationError(
      `Versione del backup non supportata (attesa ${BACKUP_VERSION}).`,
    );
  }

  const rawTables = candidate.tables;
  if (typeof rawTables !== "object" || rawTables === null || Array.isArray(rawTables)) {
    throw new ValidationError("Il backup non contiene i dati delle tabelle.");
  }

  const source = rawTables as Record<string, unknown>;
  const tables = {} as Record<TableName, unknown[]>;
  for (const table of TABLES) {
    const rows = source[table];
    if (rows === undefined) {
      tables[table] = [];
      continue;
    }
    if (!Array.isArray(rows) || rows.some((row) => typeof row !== "object" || row === null)) {
      throw new ValidationError(`La tabella "${table}" del backup non è valida.`);
    }
    tables[table] = rows;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : "",
    tables,
  };
}
