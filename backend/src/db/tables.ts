/**
 * Travelog MVP1 — Canonical table list
 *
 * Single source of truth for the maintenance operations that must touch
 * every table: destructive reset (DELETE /data), backup export and backup
 * import.
 *
 * The order is the dependency order required by the import inserts
 * (referenced tables first); TRUNCATE ignores it thanks to CASCADE.
 *
 * Kept explicit instead of dynamically discovered so every destructive
 * statement stays auditable: a schema change must update this list.
 */

export const TABLES = [
  "localities",
  "photos",
  "scans",
  "scan_errors",
  "geocoding_cache",
  "presences",
  "trips",
  "manual_trip_days",
  "manual_trip_day_localities",
  "trip_day_exclusions",
  "trip_history",
  "settings",
  "exclusion_zones",
  "trips_overview_map_cache",
] as const;

export type TableName = (typeof TABLES)[number];
