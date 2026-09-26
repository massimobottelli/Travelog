/**
 * Travelog MVP1 — Trips Service
 *
 * Manual trip consultation and modification (list, detail §16,
 * rename §13.1, date change §13.2). Split/merge live in the dedicated
 * trip-operations service (explicit use cases, design §7.2/§47).
 */

import tripsRepository, {
  type TripDto,
  type TripDayDto,
} from "../repositories/trips.repository.js";
import { pool as dbPool } from "../db/client.js";
import type { PoolClient } from "pg";
import { NotFoundError, ConflictError, ValidationError } from "../models/errors.js";
import { addDays } from "../domain/trip-rules.js";
import { buildTripsCsv } from "../utils/trips-export.js";
import { buildTripIcs, type IcsLocality } from "../utils/ics.js";
import logger from "../config/logger.js";

export interface TripQueryOptions {
  status?: "active" | "archived";
  search?: string;
  sort: "startDateDesc" | "startDateAsc";
  page: number;
  pageSize: number;
}

export interface CreateTripInput {
  name?: string;
  startDate?: string;
  endDate?: string;
  /** Manual days (manual trip creation): when present, the trip interval is derived from them. */
  days?: ManualDayInput[];
}

export interface ManualDayInput {
  date: string;
  /** Optional: a day can be added to the trip before assigning its localities. */
  localityIds?: number[];
}

export interface TripDetailDto extends TripDto {
  days: TripDayDto[];
}

function assertValidDateRange(startDate: string, endDate: string): void {
  if (!startDate || !endDate) {
    throw new ValidationError("Date del viaggio non valide", { fields: ["startDate", "endDate"] });
  }
  if (startDate > endDate) {
    throw new ValidationError("La data inizio non può essere successiva alla data fine", {
      fields: ["startDate", "endDate"],
    });
  }
}

/**
 * Detail grouping key of a locality card (§6.3/§7.2) — same format as
 * `getTripDays` in the repository and `getLocalityKeys` in the DB:
 * lower(name)|county|region. Used by the day-exclusion feature.
 */
function localityGroupKey(name: string, county: string | null, region: string | null): string {
  return `${name.toLowerCase()}|${county ?? ""}|${region ?? ""}`;
}

/**
 * Fill gaps of 1–2 consecutive days without photos with "Nessuna foto"
 * entries (requirements §16). Larger gaps are not listed.
 */
function withNoPhotoDays(
  days: TripDayDto[],
  tripStart: string,
  tripEnd: string,
  excludedDays: Set<string> = new Set(),
): TripDayDto[] {
  const result: TripDayDto[] = [];
  const fillGap = (fromExclusive: string, toInclusive: string) => {
    if (toInclusive > tripEnd) toInclusive = tripEnd;
    const missing: string[] = [];
    let cursor = addDays(fromExclusive, 1);
    while (cursor <= toInclusive) {
      missing.push(cursor);
      cursor = addDays(cursor, 1);
    }
    // §16: only gaps of 1 or 2 days are listed. Days explicitly excluded
    // by the user ("cancella giorno") are not re-proposed as gaps.
    if (missing.length > 0 && missing.length <= 2) {
      for (const date of missing) {
        if (!excludedDays.has(date)) {
          result.push({ date, noPhotos: true, localities: [], manual: false });
        }
      }
    }
  };

  let previous = addDays(tripStart, -1); // sentinel: nothing before the trip start
  for (const day of days) {
    fillGap(previous, addDays(day.date, -1));
    result.push(day);
    previous = day.date;
  }
  fillGap(previous, tripEnd);
  return result;
}

/**
 * Validate and normalize the manual days of a trip: date format, no
 * duplicate dates (entries with the same date are merged), no duplicate
 * (date, locality) pairs. A day may have zero localities (it is added
 * to the trip before assigning them). Returns the days sorted by date
 * with deduplicated locality ids.
 */
export function normalizeManualDays(
  days: ManualDayInput[],
): Array<{ dayDate: string; localityIds: number[] }> {
  if (!Array.isArray(days) || days.length === 0) {
    throw new ValidationError("Il viaggio deve contenere almeno un giorno", { fields: ["days"] });
  }
  const byDate = new Map<string, number[]>();
  for (const day of days) {
    if (!day || typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      throw new ValidationError("Data del giorno non valida", { fields: ["days"] });
    }
    const parsed = new Date(`${day.date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day.date) {
      throw new ValidationError("Data del giorno non valida", { fields: ["days"] });
    }
    const localityIds = day.localityIds ?? [];
    if (!Array.isArray(localityIds)) {
      throw new ValidationError("Elenco località non valido", { fields: ["days"] });
    }
    if (!byDate.has(day.date)) byDate.set(day.date, []);
    for (const id of localityIds) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationError("Identificativo località non valido", { fields: ["days"] });
      }
      // Duplicate (date, locality) pairs are silently deduplicated: the
      // day/locality link table is protected by its primary key anyway.
      if (!byDate.get(day.date)!.includes(id)) byDate.get(day.date)!.push(id);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dayDate, ids]) => ({ dayDate, localityIds: ids }));
}

class TripsService {
  async listTrips(options: TripQueryOptions) {
    // Contract: by default only active trips are returned.
    const status = options.status ?? "active";
    return tripsRepository.listTrips({ ...options, status });
  }

  /**
   * Trip detail (§16): trip data plus the chronology of days with the
   * visited localities and photo counts; days without photos (gaps of
   * 1–2 days) are listed with the "no photos" flag. Manual days (manual
   * trip creation) are merged with the days derived from presences.
   */
  async getTrip(id: number): Promise<TripDetailDto> {
    const trip = await tripsRepository.getTrip(id);
    if (!trip) throw new NotFoundError("Trip", id);
    return this.buildDetail(trip);
  }

  /**
   * Merges the days derived from photo presences with the manual days
   * of the trip (ordered by date; manual localities carry
   * photoCount 0 and manual: true). Persisted day exclusions ("delete
   * day / delete locality" on auto-generated trips) hide the excluded
   * presence days and locality cards.
   */
  private async buildDetail(trip: TripDto): Promise<TripDetailDto> {
    const [presenceDays, manualDays, exclusions] = await Promise.all([
      tripsRepository.getTripDays(trip.startDate, trip.endDate),
      tripsRepository.getManualDays(trip.id),
      tripsRepository.getDayExclusions(trip.id),
    ]);
    const dayExcluded = new Set(
      exclusions.filter((e) => e.localityKey === null).map((e) => e.dayDate),
    );
    const localityExcluded = new Set(
      exclusions.filter((e) => e.localityKey !== null).map((e) => `${e.dayDate}|${e.localityKey}`),
    );
    // Excluded days disappear entirely; days whose locality cards are all
    // individually excluded disappear too (equivalent to a day deletion).
    const visiblePresenceDays = presenceDays
      .filter((d) => !dayExcluded.has(d.date))
      .map((d) => ({
        ...d,
        localities: d.localities.filter(
          (l) => !localityExcluded.has(`${d.date}|${localityGroupKey(l.name, l.county, l.region)}`),
        ),
      }))
      .filter((d) => d.localities.length > 0);
    const merged = new Map<string, TripDayDto>();
    for (const day of visiblePresenceDays) merged.set(day.date, day);
    for (const day of manualDays) {
      const existing = merged.get(day.date);
      if (existing) {
        existing.localities = [...existing.localities, ...day.localities];
      } else {
        merged.set(day.date, day);
      }
    }
    const days = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      ...trip,
      days: withNoPhotoDays(days, trip.startDate, trip.endDate, dayExcluded),
    };
  }

  /**
   * CSV export of the active trips (user-requested feature): one row per
   * trip × day × locality, with the trip columns (Anno, Mese, Data
   * inizio/fine, Nome, Durata) repeated on every row and the locality
   * hierarchy in a single comma-joined column. Days without photos
   * (gaps of 1–2 days) are exported with the "Nessuna foto" note.
   */
  async exportTripsCsv(): Promise<string> {
    const { items } = await tripsRepository.listTrips({
      status: "active",
      sort: "startDateDesc",
      page: 1,
      // No upper cap here (the 100 cap is a controller concern): the
      // export must cover every active trip in a single pass.
      pageSize: 1_000_000,
    });

    const exportTrips: TripDetailDto[] = [];
    for (const trip of items) {
      exportTrips.push(await this.buildDetail(trip));
    }
    return buildTripsCsv(exportTrips);
  }

  async createTrip(input: CreateTripInput): Promise<TripDto> {
    let startDate = input.startDate;
    let endDate = input.endDate;
    let manualDays: Array<{ dayDate: string; localityIds: number[] }> = [];
    if (input.days && input.days.length > 0) {
      manualDays = normalizeManualDays(input.days);
      // The trip interval is derived from the manual days.
      startDate = manualDays[0].dayDate;
      endDate = manualDays[manualDays.length - 1].dayDate;
    }
    if (!startDate || !endDate) {
      throw new ValidationError("Date del viaggio non valide", {
        fields: ["startDate", "endDate"],
      });
    }
    assertValidDateRange(startDate, endDate);
    const overlaps = await tripsRepository.findOverlappingTrips(startDate, endDate);
    if (overlaps.length > 0) {
      throw new ConflictError("Il nuovo viaggio si sovrappone a un viaggio attivo", "TRIP_OVERLAP");
    }
    if (manualDays.length > 0) {
      await this.assertLocalitiesExist(
        [...new Set(manualDays.flatMap((d) => d.localityIds))].filter((id) => id > 0),
      );
    }

    // Atomic: trip + manual days (technical design §64).
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const trip = await tripsRepository.insertTrip(
        {
          name: input.name?.trim() || "",
          startDate,
          endDate,
          autoGenerated: false,
          // Manual creation provenance (POST /trips only).
          createdManually: true,
        },
        client,
      );
      if (manualDays.length > 0) {
        await tripsRepository.insertManualDays(trip.id, manualDays, client);
      }
      await client.query("COMMIT");
      logger.info({ tripId: trip.id }, "trip.created_manual");
      return trip;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Day replacement for an AUTO-generated trip: the request is the
   * authoritative desired state of the visible days.
   *
   * - Every photo-derived (day, locality) missing from the request is
   *   persisted as an exclusion (whole day → localityKey null);
   *   re-adding a previously excluded locality on that date removes the
   *   exclusion (explicit, reversible user operation).
   * - Requested localities that are NOT photo-derived on that date are
   *   stored as manual day rows (the "Aggiungi località" flow).
   */
  private async replaceAutoTripDays(
    trip: TripDto,
    rows: Array<{ dayDate: string; localityIds: number[] }>,
  ): Promise<TripDetailDto> {
    for (const r of rows) {
      if (r.dayDate < trip.startDate || r.dayDate > trip.endDate) {
        throw new ValidationError(
          "I giorni devono essere compresi nell'intervallo del viaggio (modificabile dalle impostazioni del viaggio)",
          { fields: ["days"] },
        );
      }
    }
    const allIds = [...new Set(rows.flatMap((d) => d.localityIds))].filter((id) => id > 0);
    await this.assertLocalitiesExist(allIds);
    const keys = await tripsRepository.getLocalityKeys(allIds);
    const presenceDays = await tripsRepository.getTripDays(trip.startDate, trip.endDate);

    // Desired exclusions: photo-derived (day, key) pairs missing from the
    // request; a requested day that disappears entirely is excluded as a
    // whole day (localityKey null).
    const exclusions: Array<{ dayDate: string; localityKey: string | null }> = [];
    const requestedDates = new Set(rows.map((r) => r.dayDate));
    for (const day of presenceDays) {
      if (!requestedDates.has(day.date)) {
        exclusions.push({ dayDate: day.date, localityKey: null });
        continue;
      }
      const requestedKeys = new Set(
        (rows.find((r) => r.dayDate === day.date)?.localityIds ?? [])
          .map((id) => keys.get(id))
          .filter((k): k is string => k !== undefined),
      );
      for (const loc of day.localities) {
        const key = localityGroupKey(loc.name, loc.county, loc.region);
        if (!requestedKeys.has(key)) {
          exclusions.push({ dayDate: day.date, localityKey: key });
        }
      }
    }

    // Manual rows: requested localities that are NOT photo-derived on
    // that date (previously added manual localities that the user kept
    // are re-inserted here — the manual table is fully replaced).
    const presenceKeysByDate = new Map(
      presenceDays.map((d) => [
        d.date,
        new Set(d.localities.map((l) => localityGroupKey(l.name, l.county, l.region))),
      ]),
    );
    const manualRows = rows.map((r) => ({
      dayDate: r.dayDate,
      localityIds: r.localityIds.filter((id) => {
        const key = keys.get(id);
        return key === undefined || !presenceKeysByDate.get(r.dayDate)?.has(key);
      }),
    }));

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await tripsRepository.replaceDayExclusions(trip.id, exclusions, client);
      await tripsRepository.deleteManualDays(trip.id, client);
      await tripsRepository.insertManualDays(trip.id, manualRows, client);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    logger.info(
      { tripId: trip.id, exclusions: exclusions.length, manualDays: manualRows.length },
      "trip.days_adjusted",
    );
    return this.getTrip(trip.id);
  }

  /**
   * Replace the days of an active trip (add/remove days after creation).
   * Atomic (§64).
   *
   * - Manual trips (createdManually): full replacement of the manual day
   *   rows; the trip interval follows the remaining days, subject to the
   *   overlap validation (§13.2/§21.17).
   * - Auto-generated trips: photo-derived days live in presences, so
   *   deletions are persisted as explicit, reversible day exclusions
   *   (surviving re-scans and recalculation, §11) and additions as
   *   manual day rows; the interval does not change (§13.2).
   */
  async replaceTripDays(tripId: number, days: ManualDayInput[]): Promise<TripDetailDto> {
    const trip = await tripsRepository.getTrip(tripId);
    if (!trip) throw new NotFoundError("Trip", tripId);
    if (trip.status !== "active") {
      throw new ConflictError(
        "Il viaggio è archiviato e non può essere modificato",
        "TRIP_NOT_ACTIVE",
      );
    }

    const rows = normalizeManualDays(days);

    if (!trip.createdManually) {
      return this.replaceAutoTripDays(trip, rows);
    }

    await this.assertLocalitiesExist(
      [...new Set(rows.flatMap((d) => d.localityIds))].filter((id) => id > 0),
    );

    // The interval follows the manual days exactly (min/max of the
    // remaining days), so removing the last day shortens the trip and
    // the deleted day does not reappear as a "Nessuna foto" gap.
    const startDate = rows[0].dayDate;
    const endDate = rows[rows.length - 1].dayDate;
    if (startDate !== trip.startDate || endDate !== trip.endDate) {
      const overlaps = await tripsRepository.findOverlappingTrips(startDate, endDate, tripId);
      if (overlaps.length > 0) {
        throw new ConflictError(
          "L'estensione delle date sovrapporrebbe il viaggio a un altro viaggio attivo",
          "TRIP_OVERLAP",
        );
      }
    }

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      if (startDate !== trip.startDate || endDate !== trip.endDate) {
        await client.query(
          `UPDATE trips SET start_date = $2::date, end_date = $3::date, updated_at = now()
           WHERE id = $1::int`,
          [tripId, startDate, endDate],
        );
      }
      await tripsRepository.deleteManualDays(tripId, client);
      await tripsRepository.insertManualDays(tripId, rows, client);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    logger.info({ tripId, days: rows.length }, "trip.days_replaced");
    return this.getTrip(tripId);
  }

  private async assertLocalitiesExist(localityIds: number[]): Promise<void> {
    const result = await dbPool.query<{ id: number }>(
      `SELECT id FROM localities WHERE id = ANY($1::int[])`,
      [localityIds],
    );
    const found = new Set(result.rows.map((r) => Number(r.id)));
    const missing = localityIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new ValidationError("Una o più località indicate non esistono", { fields: ["days"] });
    }
  }

  async updateTrip(
    id: number,
    updates: Partial<{ name: string; startDate: string; endDate: string }>,
  ): Promise<TripDto> {
    const existing = await tripsRepository.getTrip(id);
    if (!existing) throw new NotFoundError("Trip", id);
    if (existing.status !== "active") {
      throw new ConflictError(
        "Il viaggio è archiviato e non può essere modificato",
        "TRIP_NOT_ACTIVE",
      );
    }

    const startDate = updates.startDate ?? existing.startDate;
    const endDate = updates.endDate ?? existing.endDate;
    assertValidDateRange(startDate, endDate);

    // §13.2 / §21.17: active trips must never overlap temporally.
    const overlaps = await tripsRepository.findOverlappingTrips(startDate, endDate, id);
    if (overlaps.length > 0) {
      throw new ConflictError(
        "La modifica sovrapporrebbe il viaggio a un altro viaggio attivo",
        "TRIP_OVERLAP",
      );
    }

    const updated = await tripsRepository.updateTrip(id, {
      name: updates.name?.trim(),
      startDate: updates.startDate,
      endDate: updates.endDate,
    });
    if (!updated) throw new NotFoundError("Trip", id);
    // Invariant: manual days always live inside the trip interval. If the
    // user shortened the trip, manual days outside the new interval are
    // removed with the same explicit operation.
    if (updates.startDate !== undefined || updates.endDate !== undefined) {
      await tripsRepository.deleteManualDaysOutsideRange(id, updated.startDate, updated.endDate);
    }
    return updated;
  }

  /**
   * Generate an ICS (iCalendar, RFC 5545) document for a single trip.
   * The event is an all-day event spanning the trip interval; the
   * LOCATION is the locality with the most photos in the trip, the
   * DESCRIPTION carries the full hierarchy plus the "Creato da Travelog"
   * signature. Returns the ICS string and the sanitized trip name
   * (for the Content-Disposition filename).
   */
  async exportTripIcs(id: number): Promise<{ ics: string; tripName: string }> {
    const trip = await tripsRepository.getTrip(id);
    if (!trip) throw new NotFoundError("Trip", id);

    const topLocality = await tripsRepository.getTopLocalityForTrip(
      trip.id,
      trip.startDate,
      trip.endDate,
    );

    const locality: IcsLocality | null = topLocality
      ? {
          name: topLocality.name,
          county: topLocality.county,
          region: topLocality.region,
          country: topLocality.country,
        }
      : null;

    const ics = buildTripIcs(
      { id: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate },
      locality,
      new Date(),
    );

    return { ics, tripName: trip.name };
  }
}

export default new TripsService();
