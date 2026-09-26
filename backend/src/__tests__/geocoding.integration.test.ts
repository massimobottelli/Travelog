/**
 * Travelog MVP1 — Geocoding Integration Tests (Phase 4 — Geoapify)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { pool as pgPool } from "../db/client.js";
import geocodingRepo from "../repositories/geocoding.repository.js";
import geocodingService from "../services/geocoding.service.js";

describe("Geocoding Repository", () => {
  beforeEach(async () => {
    await pgPool.query("DELETE FROM geocoding_cache");
    await pgPool.query(`DELETE FROM localities WHERE region = 'Test Region X'`);
  });

  it("should insert and retrieve locality by hash", async () => {
    const result = await geocodingRepo.upsertLocality({
      localityHash: "45.46:9.18",
      countryCode: "IT",
      name: "Milano Test",
      adminLevel: 4,
      region: "Test Region X",
    });

    expect(result).toBeDefined();
    expect(result.id > 0).toBe(true);
    expect(result.countryCode).toBe("IT");
    expect(result.name).toBe("Milano Test");

    // Retrieve same locality
    const found = await geocodingRepo.getLocalityByHash("45.46:9.18");
    expect(found).not.toBeNull();
    if (found) {
      expect(found.id).toBe(result.id);
      expect(found.region).toBe("Test Region X");
    }

    // Cleanup
    await pgPool.query(`DELETE FROM localities WHERE region = 'Test Region X'`);
  });

  it("should upsert return existing row on duplicate hash", async () => {
    const first = await geocodingRepo.upsertLocality({
      localityHash: "45.00:9.00",
      countryCode: "IT",
      name: "Original Name",
      adminLevel: 4,
    });

    const second = await geocodingRepo.upsertLocality({
      localityHash: "45.00:9.00",
      countryCode: "FR",
      name: "Updated Name",
      adminLevel: 6,
    });

    // Same ID returned for conflict resolution
    expect(second.id).toBe(first.id);

    // Cleanup
    await pgPool.query(`DELETE FROM localities WHERE locality_hash = '45.00:9.00'`);
  });

  it("should cache geocode result by original coordinates", async () => {
    const { rows: inserted } = await pgPool.query(
      `INSERT INTO localities (locality_hash, country_code, name, admin_level)
       VALUES ('45.46:9.18', 'IT', 'Cache City', 4) RETURNING id`,
    );
    const localityId = Number(inserted[0].id);

    try {
      await geocodingRepo.upsertGeocodeCache({
        latitude: 45.4642,
        longitude: 9.1897,
        localityHash: "45.46:9.18",
        localityId,
        countryCode: "IT",
        name: "Cache City",
        adminLevel: 4,
      });

      const cached = await geocodingRepo.getGeocodeCacheEntry(45.4642, 9.1897);
      expect(cached).not.toBeNull();
      if (cached) {
        expect(cached.localityId).toBe(localityId);
        expect(cached.countryCode).toBe("IT");
      }
    } finally {
      await pgPool.query(`DELETE FROM geocoding_cache WHERE locality_id = $1`, [localityId]);
    }
  });

  it("should search localities by name substring", async () => {
    await geocodingRepo.upsertLocality({
      localityHash: "45.00:9.00",
      countryCode: "IT",
      name: "Lissone",
      adminLevel: 4,
      region: "Test Region X",
    });

    await geocodingRepo.upsertLocality({
      localityHash: "45.01:9.01",
      countryCode: "IT",
      name: "Monza",
      adminLevel: 4,
      region: "Test Region X",
    });

    try {
      const results = await geocodingRepo.searchLocalities("Lis", 10);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Lissone");
    } finally {
      await pgPool.query(`DELETE FROM localities WHERE region = 'Test Region X'`);
    }
  });
});

describe("GeocodingService normalized-hash cache", () => {
  const HASH = "45.56:9.17";

  beforeEach(async () => {
    await pgPool.query("DELETE FROM geocoding_cache");
    await pgPool.query(`DELETE FROM localities WHERE locality_hash = $1`, [HASH]);
  });

  it("resolves nearby coordinates to the same locality without a second geocoder call", async () => {
    const locality = await geocodingRepo.upsertLocality({
      localityHash: HASH,
      countryCode: "IT",
      name: "Milano Centro",
      adminLevel: 4,
      region: "Lombardia",
    });

    // Two distinct GPS points that normalize into the same ~1 km bucket.
    const first = await geocodingService.reverseGeocode(45.5621, 9.1742);
    const second = await geocodingService.reverseGeocode(45.5634, 9.1749);

    expect(first.localityId).toBe(locality.id);
    expect(second.localityId).toBe(locality.id);
    expect(first.name).toBe("Milano Centro");
    expect(second.name).toBe("Milano Centro");

    // The hash hit short-circuits before writing the per-coordinate cache.
    const { rows } = await pgPool.query("SELECT count(*)::int AS n FROM geocoding_cache");
    expect(rows[0].n).toBe(0);
  });
});
