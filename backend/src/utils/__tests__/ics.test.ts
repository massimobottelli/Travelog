/**
 * Travelog — ICS export helpers (unit tests)
 *
 * Covers the pure functions of `utils/ics.ts`: escaping, date formatting,
 * addOneDay, hierarchy formatting and the full VCALENDAR document
 * generation.
 */

import { describe, expect, it } from "vitest";
import {
  escapeIcsText,
  formatIcsDate,
  addOneDay,
  formatLocalityHierarchy,
  formatIcsDtStamp,
  buildTripIcs,
  type IcsTrip,
  type IcsLocality,
} from "../ics.js";

describe("escapeIcsText (RFC 5545 §3.3.11)", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeIcsText("Sicilia")).toBe("Sicilia");
  });

  it("escapes backslash, semicolon, comma and newline", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("escapes each character independently", () => {
    expect(escapeIcsText(",,")).toBe("\\,\\,");
    expect(escapeIcsText(";;")).toBe("\\;\\;");
  });
});

describe("formatIcsDate", () => {
  it("converts YYYY-MM-DD to YYYYMMDD", () => {
    expect(formatIcsDate("2025-08-10")).toBe("20250810");
  });

  it("handles single-digit month and day", () => {
    expect(formatIcsDate("2026-01-03")).toBe("20260103");
  });
});

describe("addOneDay", () => {
  it("adds one day within the same month", () => {
    expect(addOneDay("2025-08-10")).toBe("2025-08-11");
  });

  it("rolls over to the next month", () => {
    expect(addOneDay("2025-08-31")).toBe("2025-09-01");
  });

  it("rolls over to the next year", () => {
    expect(addOneDay("2025-12-31")).toBe("2026-01-01");
  });

  it("handles leap years", () => {
    expect(addOneDay("2024-02-29")).toBe("2024-03-01");
    expect(addOneDay("2023-02-28")).toBe("2023-03-01");
  });
});

describe("formatLocalityHierarchy", () => {
  it("joins non-empty levels with comma+space", () => {
    const loc: IcsLocality = {
      name: "Erice",
      county: "Trapani",
      region: "Sicily",
      country: "Italy",
    };
    expect(formatLocalityHierarchy(loc)).toBe("Erice, Trapani, Sicily, Italy");
  });

  it("omits null levels", () => {
    const loc: IcsLocality = { name: "Erice", county: null, region: "Sicily", country: "Italy" };
    expect(formatLocalityHierarchy(loc)).toBe("Erice, Sicily, Italy");
  });

  it("returns just the name when all other levels are null", () => {
    const loc: IcsLocality = { name: "Erice", county: null, region: null, country: null };
    expect(formatLocalityHierarchy(loc)).toBe("Erice");
  });
});

describe("formatIcsDtStamp", () => {
  it("formats a Date as YYYYMMDDTHHMMSSZ", () => {
    const date = new Date(Date.UTC(2026, 8, 26, 14, 30, 45)); // Sep 26 2026 14:30:45
    expect(formatIcsDtStamp(date)).toBe("20260926T143045Z");
  });
});

describe("buildTripIcs", () => {
  const trip: IcsTrip = {
    id: 19,
    name: "Sicilia",
    startDate: "2025-08-10",
    endDate: "2025-08-24",
  };
  const locality: IcsLocality = {
    name: "Erice",
    county: "Trapani",
    region: "Sicily",
    country: "Italy",
  };
  const now = new Date(Date.UTC(2026, 0, 15, 10, 0, 0));

  it("produces a valid VCALENDAR with the trip as an all-day event", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Travelog//MVP1//IT");
  });

  it("uses VALUE=DATE for DTSTART and exclusive DTEND for DTEND", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("DTSTART;VALUE=DATE:20250810");
    // DTEND is exclusive: trip ends on 08-24 → DTEND = 08-25
    expect(ics).toContain("DTEND;VALUE=DATE:20250825");
  });

  it("includes the trip name as SUMMARY", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("SUMMARY:Sicilia");
  });

  it("includes the locality name as LOCATION", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("LOCATION:Erice");
  });

  it("includes the full hierarchy and 'Creato da Travelog' in DESCRIPTION", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("DESCRIPTION:Erice\\, Trapani\\, Sicily\\, Italy\\nCreato da Travelog");
  });

  it("omits LOCATION and uses only the signature when locality is null", () => {
    const ics = buildTripIcs(trip, null, now);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).toContain("DESCRIPTION:Creato da Travelog");
  });

  it("includes UID with the trip id", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("UID:trip-19@travelog");
  });

  it("includes DTSTAMP from the provided timestamp", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("DTSTAMP:20260115T100000Z");
  });

  it("escapes special characters in the trip name", () => {
    const specialTrip: IcsTrip = { ...trip, name: "Vacanza, mare; sole\\mare" };
    const ics = buildTripIcs(specialTrip, locality, now);
    expect(ics).toContain("SUMMARY:Vacanza\\, mare\\; sole\\\\mare");
  });

  it("uses CRLF line endings (RFC 5545 §3.1)", () => {
    const ics = buildTripIcs(trip, locality, now);
    expect(ics).toContain("\r\n");
    // No bare LF (every LF must be preceded by CR).
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
