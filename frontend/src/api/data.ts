/**
 * Travelog MVP1 — Data API module
 *
 * Destructive maintenance operations on catalogued data, plus
 * backup export/import for the entire database.
 */

import { apiRequest, apiDownload } from "./client";

/**
 * Irreversibly delete all catalogued data (photos, scans, errors,
 * localities, geocoding cache, presences, trips, history, settings).
 * The photo root configuration is preserved. Fails with 409 while a
 * scan is running.
 */
export function deleteAllData(): Promise<void> {
  return apiRequest<void>("/data", { method: "DELETE" });
}

/**
 * Download a JSON backup of every table. The file is pretty-printed
 * (indented) for readability and named with a local timestamp.
 */
export function exportData(): Promise<void> {
  return apiDownload("/data/export", "travelog-backup.json");
}

/**
 * Restore the entire database from a JSON backup file.
 * The operation is atomic: any failure rolls back and leaves the
 * existing data untouched. The local photo root is preserved.
 * Fails with 409 while a scan is running.
 */
export async function importData(file: File): Promise<{ totalRows: number; counts: Record<string, number> }> {
  const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
  const response = await fetch(`${BASE_URL}/data/import`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });

  if (!response.ok) {
    let errorBody = {
      code: "INTERNAL_ERROR",
      message: `Richiesta fallita con stato HTTP ${response.status}`,
      details: {},
    };
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // Response body was not JSON; keep the generic error body
    }
    const error = new Error(errorBody.message) as Error & { status: number; code: string };
    error.status = response.status;
    error.code = errorBody.code;
    throw error;
  }

  return (await response.json()) as { totalRows: number; counts: Record<string, number> };
}
