/**
 * Travelog MVP1 — Backup document helpers unit tests
 *
 * Pure functions only: file name, naive timestamp and validation of the
 * backup document produced/accepted by the Database commands.
 */

import { describe, it, expect } from "vitest";
import { TABLES } from "../db/tables.js";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackupFilename,
  formatExportTimestamp,
  parseBackupDocument,
} from "../utils/backup.js";

function validDocument(): Record<string, unknown> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: "2026-09-26T14:47:12",
    tables: {
      localities: [{ id: 1, name: "Erice" }],
      photos: [],
      settings: [{ id: 1, photo_root: "/mnt/photos" }],
    },
  };
}

describe("backup file name and timestamp", () => {
  it("builds a file-name safe local timestamp", () => {
    expect(buildBackupFilename(new Date(2026, 8, 26, 14, 47, 12))).toBe(
      "travelog-backup-20260926-144712.json",
    );
  });

  it("formats the export timestamp as naive local time", () => {
    expect(formatExportTimestamp(new Date(2026, 8, 26, 9, 5, 3))).toBe("2026-09-26T09:05:03");
  });
});

describe("parseBackupDocument", () => {
  it("accepts a valid document, filling missing tables with empty arrays", () => {
    const document = parseBackupDocument(JSON.stringify(validDocument()));

    expect(document.format).toBe(BACKUP_FORMAT);
    expect(document.version).toBe(BACKUP_VERSION);
    expect(document.exportedAt).toBe("2026-09-26T14:47:12");
    expect(document.tables.localities).toEqual([{ id: 1, name: "Erice" }]);
    expect(document.tables.settings).toEqual([{ id: 1, photo_root: "/mnt/photos" }]);
    for (const table of TABLES) {
      expect(Array.isArray(document.tables[table])).toBe(true);
    }
    // Tables absent from the file are normalized to empty arrays.
    expect(document.tables.photos).toEqual([]);
    expect(document.tables.trips).toEqual([]);
  });

  it("ignores unknown tables", () => {
    const raw = validDocument();
    (raw.tables as Record<string, unknown>).not_a_table = [{ id: 1 }];
    const document = parseBackupDocument(JSON.stringify(raw));
    expect(document.tables).not.toHaveProperty("not_a_table");
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseBackupDocument("<html>not a backup</html>")).toThrowError(
      /backup JSON valido/,
    );
  });

  it("rejects a JSON document that is not a Travelog backup", () => {
    expect(() => parseBackupDocument(JSON.stringify({ hello: "world" }))).toThrowError(
      /non è un backup di Travelog/,
    );
    expect(() => parseBackupDocument(JSON.stringify([1, 2, 3]))).toThrowError(
      /non è un backup di Travelog/,
    );
  });

  it("rejects an unsupported backup version", () => {
    const raw = validDocument();
    raw.version = BACKUP_VERSION + 1;
    expect(() => parseBackupDocument(JSON.stringify(raw))).toThrowError(/Versione del backup/);
  });

  it("rejects a document without tables", () => {
    const raw = validDocument();
    delete raw.tables;
    expect(() => parseBackupDocument(JSON.stringify(raw))).toThrowError(
      /non contiene i dati delle tabelle/,
    );
  });

  it("rejects a table that is not an array of objects", () => {
    const raw = validDocument();
    (raw.tables as Record<string, unknown>).localities = "oops";
    expect(() => parseBackupDocument(JSON.stringify(raw))).toThrowError(
      /tabella "localities"/,
    );

    const raw2 = validDocument();
    (raw2.tables as Record<string, unknown>).localities = [1, 2];
    expect(() => parseBackupDocument(JSON.stringify(raw2))).toThrowError(
      /tabella "localities"/,
    );
  });
});
