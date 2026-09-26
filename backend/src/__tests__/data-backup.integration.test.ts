/**
 * Travelog MVP1 — Data backup integration tests
 *
 * Real PostgreSQL test database (travelog_test): full JSON backup export,
 * atomic restore, table coverage and coexistence with the scan advisory
 * lock. The import/export endpoints are exercised through the real Express
 * app, so the OpenAPI contract and routing are covered too.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { pool } from "../db/client.js";
import { TABLES } from "../db/tables.js";
import { SCAN_LOCK_ID } from "../config/locks.js";

const server = createApp();

interface BackupDocumentLike {
  format: string;
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

async function cleanup(): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** Seed one row in every table (all 14 covered) with known ids. */
async function seedFixture(): Promise<void> {
  const locality = await pool.query(
    `INSERT INTO localities (locality_hash, country_code, name, admin_level, county, region, country)
     VALUES ('backup-test-hash', 'IT', 'Erice', 8, 'Trapani', 'Sicily', 'Italy') RETURNING id`,
  );
  const localityId = locality.rows[0].id as number;

  await pool.query(
    `INSERT INTO photos (file_path, file_name, file_type, size, mtime, date_time_original, original_latitude, original_longitude)
     VALUES ('backup-test/IMG_1.jpg', 'IMG_1.jpg', '.jpg', 1234, 1700000000, '2025-08-15 10:00:00', 38.03, 12.58)`,
  );
  await pool.query(
    `INSERT INTO geocoding_cache (original_latitude, original_longitude, locality_hash, locality_id, country_code, name, admin_level, geo_applied)
     VALUES (38.03, 12.58, 'backup-test-hash', $1, 'IT', 'Erice', 8, true)`,
    [localityId],
  );
  await pool.query(
    `INSERT INTO presences (photo_date, locality_id, photo_count) VALUES ('2025-08-15', $1, 3)`,
    [localityId],
  );
  await pool.query(`INSERT INTO settings (id, min_consecutive_days_with_photos, days_without_photos_threshold, photo_root)
                    VALUES (1, 5, 4, '/mnt/backup-machine/photos')`);

  const scan = await pool.query(
    `INSERT INTO scans (folder, started_at, status, files_analyzed, files_total, new_photos, existing_photos, excluded_photos, errors)
     VALUES ('backup-test', now(), 'completed_with_errors', 2, 2, 1, 0, 0, 1) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO scan_errors (scan_id, file_path, error_code, message)
     VALUES ($1, 'backup-test/IMG_2.jpg', 'EXIF_READ_FAILED', 'exiftool exited with code 1')`,
    [scan.rows[0].id],
  );

  const trip = await pool.query(
    `INSERT INTO trips (name, start_date, end_date, auto_generated, created_manually, status)
     VALUES ('Backup Trip', '2025-08-15', '2025-08-17', true, false, 'active') RETURNING id`,
  );
  const tripId = trip.rows[0].id as number;

  const day = await pool.query(
    `INSERT INTO manual_trip_days (trip_id, day_date) VALUES ($1, '2025-08-16') RETURNING id`,
    [tripId],
  );
  await pool.query(`INSERT INTO manual_trip_day_localities (day_id, locality_id) VALUES ($1, $2)`, [
    day.rows[0].id,
    localityId,
  ]);
  await pool.query(
    `INSERT INTO trip_day_exclusions (trip_id, day_date, locality_key)
     VALUES ($1, '2025-08-15', 'erice|trapani|sicily')`,
    [tripId],
  );
  await pool.query(
    `INSERT INTO trip_history (trip_id, operation, original_trip_ids, result_trip_ids)
     VALUES ($1, 'split', '[]'::jsonb, '[]'::jsonb)`,
    [tripId],
  );
  await pool.query(`INSERT INTO exclusion_zones (locality_id, scope) VALUES ($1, 'county')`, [
    localityId,
  ]);
  await pool.query(
    `INSERT INTO trips_overview_map_cache (id, payload) VALUES (1, '{"bounds":{},"markers":[]}'::jsonb)`,
  );
}

async function tableCount(table: string): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS total FROM ${table}`);
  return result.rows[0].total as number;
}


/** POST a backup file as the raw binary upload used by the frontend. */
function importBackup(payload: Buffer | string) {
  return request(server)
    .post("/api/data/import")
    .set("Content-Type", "application/octet-stream")
    .send(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("GET /api/data/export", () => {
  it("downloads a backup document covering every table", async () => {
    await seedFixture();

    const res = await request(server).get("/api/data/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="travelog-backup-\d{8}-\d{6}\.json"/,
    );

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    const document = JSON.parse(body.toString("utf8")) as BackupDocumentLike;

    expect(document.format).toBe("travelog-backup");
    expect(document.version).toBe(1);
    expect(document.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

    // Every canonical table is present, even when empty.
    for (const table of TABLES) {
      expect(Array.isArray(document.tables[table])).toBe(true);
    }
    for (const table of TABLES) {
      expect(document.tables[table]).toHaveLength(1);
    }

    // Values are exported with their identity and original content.
    expect(document.tables.photos[0]).toMatchObject({
      id: 1,
      file_path: "backup-test/IMG_1.jpg",
      original_latitude: 38.03,
    });
    expect(document.tables.presences[0]).toMatchObject({
      photo_date: "2025-08-15",
      photo_count: 3,
    });
  });

  it("exports an empty backup when no data is catalogued", async () => {
    const res = await request(server).get("/api/data/export");
    expect(res.status).toBe(200);

    const document = JSON.parse((res.body as Buffer).toString("utf8")) as BackupDocumentLike;
    for (const table of TABLES) {
      expect(document.tables[table]).toHaveLength(0);
    }
  });
});

describe("POST /api/data/import", () => {
  async function exportBuffer(): Promise<Buffer> {
    const res = await request(server).get("/api/data/export");
    expect(res.status).toBe(200);
    return res.body as Buffer;
  }

  it("restores every table after a full reset, preserving ids and sequences", async () => {
    await seedFixture();
    const backup = await exportBuffer();

    const reset = await request(server).delete("/api/data");
    expect(reset.status).toBe(204);

    // A distinct photo root is configured locally: the restore must keep it
    // while restoring the other settings from the backup.
    await pool.query(
      `INSERT INTO settings (id, photo_root) VALUES (1, '/mnt/local-machine/photos')`,
    );

    const restored = await importBackup(backup);

    expect(restored.status).toBe(200);
    expect(restored.body.totalRows).toBe(TABLES.length);
    for (const table of TABLES) {
      expect(restored.body.counts[table]).toBe(1);
      expect(await tableCount(table)).toBe(1);
    }

    // Identity is preserved end-to-end.
    const photo = await pool.query("SELECT id, file_path FROM photos");
    expect(photo.rows[0]).toMatchObject({ id: 1, file_path: "backup-test/IMG_1.jpg" });
    const history = await pool.query("SELECT original_trip_ids FROM trip_history");
    expect(history.rows[0].original_trip_ids).toEqual([]);

    // Thresholds come from the backup; the photo root stays the local one.
    const settings = await pool.query(
      "SELECT min_consecutive_days_with_photos, days_without_photos_threshold, photo_root FROM settings",
    );
    expect(settings.rows[0].min_consecutive_days_with_photos).toBe(5);
    expect(settings.rows[0].days_without_photos_threshold).toBe(4);
    expect(settings.rows[0].photo_root).toBe("/mnt/local-machine/photos");

    // Sequences are resynced: new rows do not collide with restored ids.
    const inserted = await pool.query(
      `INSERT INTO localities (locality_hash, country_code, name, admin_level)
       VALUES ('after-import', 'IT', 'Nuova', 8) RETURNING id`,
    );
    expect(inserted.rows[0].id).toBe(2);
  });

  it("rejects an invalid document without touching the existing data", async () => {
    await seedFixture();

    const invalidJson = await importBackup("not a backup at all");
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.code).toBe("VALIDATION_ERROR");

    const wrongFormat = await importBackup(
      JSON.stringify({ format: "other", version: 1, tables: {} }),
    );
    expect(wrongFormat.status).toBe(400);

    const wrongVersion = await importBackup(
      JSON.stringify({ format: "travelog-backup", version: 99, tables: {} }),
    );
    expect(wrongVersion.status).toBe(400);

    // Nothing was deleted by the rejected imports.
    expect(await tableCount("photos")).toBe(1);
    expect(await tableCount("trips")).toBe(1);
    expect(await tableCount("settings")).toBe(1);
  });

  it("rolls back the restore when a row violates the schema", async () => {
    await seedFixture();
    const document = JSON.parse((await exportBuffer()).toString("utf8")) as BackupDocumentLike;
    // metadata_status is an enum: this value cannot be inserted.
    document.tables.photos[0].metadata_status = "not-a-status";

    const res = await importBackup(JSON.stringify(document));

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    // The transaction rolled back: the previous data is still there.
    expect(await tableCount("photos")).toBe(1);
    expect(await tableCount("trips")).toBe(1);
  });

  it("rejects a request without a binary body", async () => {
    const res = await request(server)
      .post("/api/data/import")
      .send({ format: "travelog-backup", version: 1, tables: {} });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects the import while the scan advisory lock is held", async () => {
    await seedFixture();
    const backup = await exportBuffer();

    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query("SELECT pg_try_advisory_lock($1) AS locked", [
        SCAN_LOCK_ID,
      ]);
      expect(lock.rows[0].locked).toBe(true);

      const res = await importBackup(backup);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SCAN_ALREADY_RUNNING");
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [SCAN_LOCK_ID]);
      lockClient.release();
    }
  });

  it("can restore a backup twice (idempotent replace)", async () => {
    await seedFixture();
    const backup = await exportBuffer();

    const first = await importBackup(backup);
    expect(first.status).toBe(200);

    const second = await importBackup(backup);
    expect(second.status).toBe(200);
    expect(await tableCount("photos")).toBe(1);
    expect(await tableCount("trips")).toBe(1);
  });
});
