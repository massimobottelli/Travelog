/**
 * Travelog MVP — ICS (iCalendar, RFC 5545) export helpers
 *
 * Pure functions building a VCALENDAR document for a single trip,
 * suitable for import into any calendar application (Google Calendar,
 * Apple Calendar, Outlook, …).
 *
 * The event is an all-day event (VALUE=DATE) spanning the trip interval.
 * DTEND is exclusive per RFC 5545 §3.6.1: a trip ending on 2025-08-24
 * produces DTEND=20250825 so the calendar shows the event through the
 * 24th.
 *
 * The LOCATION property carries the name of the locality with the most
 * photos in the trip; the DESCRIPTION carries the full hierarchy plus
 * the "Creato da Travelog" signature. When no locality is available
 * (manual trip without photos), LOCATION is omitted and DESCRIPTION
 * contains only the signature.
 */

export interface IcsLocality {
  name: string;
  county: string | null;
  region: string | null;
  country: string | null;
}

export interface IcsTrip {
  id: number;
  name: string;
  /** Naive ISO date, YYYY-MM-DD. */
  startDate: string;
  /** Naive ISO date, YYYY-MM-DD. */
  endDate: string;
}

/**
 * Escape a text value per RFC 5545 §3.3.11: backslash, semicolon, comma
 * and newlines are escaped. The result is safe for use in TEXT property
 * values (SUMMARY, LOCATION, DESCRIPTION, …).
 */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

/**
 * Format a naive ISO date (YYYY-MM-DD) as an ICS DATE value (YYYYMMDD).
 */
export function formatIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/**
 * Add one day to a naive ISO date (YYYY-MM-DD) and return the result in
 * the same format. Used for the exclusive DTEND of all-day events.
 */
export function addOneDay(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  // Build a UTC date to avoid timezone shifts.
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Locality hierarchy in a single string: the non-empty levels joined by
 * ", " (e.g. "Erice, Trapani, Sicily, Italy"). Missing levels are omitted.
 */
export function formatLocalityHierarchy(loc: IcsLocality): string {
  return [loc.name, loc.county, loc.region, loc.country]
    .map((level) => level?.trim())
    .filter((level): level is string => Boolean(level))
    .join(", ");
}

/**
 * Format the current UTC timestamp as an ICS DTSTAMP value
 * (YYYYMMDDTHHMMSSZ).
 */
export function formatIcsDtStamp(now: Date): string {
  const y = String(now.getUTCFullYear()).padStart(4, "0");
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

/**
 * Build the full VCALENDAR document for a trip.
 *
 * @param trip Trip data (id, name, start/end dates).
 * @param locality The locality with the most photos in the trip, or null
 *   when no locality is available (manual trip without photos).
 * @param now The current timestamp, used for DTSTAMP. Injected for
 *   testability.
 */
export function buildTripIcs(trip: IcsTrip, locality: IcsLocality | null, now: Date): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Travelog//MVP1//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:trip-${trip.id}@travelog`,
    `DTSTAMP:${formatIcsDtStamp(now)}`,
    `DTSTART;VALUE=DATE:${formatIcsDate(trip.startDate)}`,
    `DTEND;VALUE=DATE:${formatIcsDate(addOneDay(trip.endDate))}`,
    `SUMMARY:${escapeIcsText(trip.name)}`,
  ];

  if (locality) {
    lines.push(`LOCATION:${escapeIcsText(locality.name)}`);
  }

  // DESCRIPTION: hierarchy (when available) + signature.
  const descriptionParts: string[] = [];
  if (locality) {
    descriptionParts.push(formatLocalityHierarchy(locality));
  }
  descriptionParts.push("Creato da Travelog");
  lines.push(`DESCRIPTION:${escapeIcsText(descriptionParts.join("\n"))}`);

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // RFC 5545 §3.1: lines are terminated by CRLF.
  return lines.join("\r\n") + "\r\n";
}
