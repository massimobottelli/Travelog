/**
 * Travelog MVP1 — App shell tests
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "./App";
import * as tripDetailPage from "./pages/TripDetailPage";
import { navigate } from "./hooks/useRoute";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockAllEndpoints(): void {
  fetchMock.mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/stats")) {
      return Promise.resolve(jsonResponse({ years: [] }));
    }
    if (url.includes("/api/settings")) {
      return Promise.resolve(
        jsonResponse({
          minimumConsecutiveDaysWithPhotos: 2,
          consecutiveDaysWithoutPhotosBeforeClosing: 3,
        }),
      );
    }
    if (url.includes("/api/config")) {
      return Promise.resolve(jsonResponse({ photoRoot: null }));
    }
    if (url.includes("/api/scans?page=")) {
      return Promise.resolve(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }));
    }
    if (url.includes("/api/data")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.includes("/api/photos")) {
      return Promise.resolve(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }));
    }
    if (url.includes("/api/exclusion-zones")) {
      return Promise.resolve(jsonResponse({ items: [] }));
    }
    if (url.includes("/api/trips/map")) {
      return Promise.resolve(
        jsonResponse({
          bounds: { minLat: 37, minLon: 6, maxLat: 47.1, maxLon: 19 },
          markers: [],
          countyColors: {},
        }),
      );
    }
    if (url.includes("/api/trips")) {
      return Promise.resolve(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }));
    }
    if (url.includes("/api/operations")) {
      return Promise.resolve(jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }));
    }
    if (url.includes("/api/localities/autocomplete")) {
      return Promise.resolve(jsonResponse({ items: [] }));
    }
    return Promise.resolve(jsonResponse({}, 200));
  });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("App", () => {
  it("opens statistics from Azioni and returns to trips", async () => {
    mockAllEndpoints();
    const originalPath = window.location.pathname;
    window.history.replaceState({}, "", "/trips");
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Azioni" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Statistiche" }));
      await screen.findByText(/Nessun viaggio attivo/);
      expect(window.location.pathname).toBe("/stats");
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/stats"))).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Torna ai viaggi" }));
      await screen.findByRole("heading", { name: "I Miei Viaggi" });
      expect(window.location.pathname).toBe("/trips");
    } finally {
      window.history.replaceState({}, "", originalPath);
    }
  });

  it.each(["/settings", "/trips/2"])(
    "resets a rendering failure when navigating to %s",
    async (target) => {
      mockAllEndpoints();
      const originalPath = window.location.pathname;
      const page = vi.spyOn(tripDetailPage, "default").mockImplementation(({ tripId }) => {
        if (tripId === 1) throw new Error("Detail render failed");
        return <h2>Trip {tripId}</h2>;
      });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      window.history.replaceState({}, "", "/trips/1");
      try {
        render(<App />);
        expect(screen.getByText("Si è verificato un errore")).not.toBeNull();
        if (target === "/settings") {
          fireEvent.click(screen.getByRole("button", { name: "Impostazioni" }));
          await screen.findByLabelText(/giorni consecutivi con foto/i);
        } else {
          act(() => navigate(target));
          expect(screen.getByRole("heading", { name: "Trip 2" })).not.toBeNull();
        }
        expect(screen.queryByText("Si è verificato un errore")).toBeNull();
        expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
      } finally {
        page.mockRestore();
        errorLog.mockRestore();
        window.history.replaceState({}, "", originalPath);
      }
    },
  );

  it("renders the white top bar with the brand, the page actions and the settings gear", async () => {
    mockAllEndpoints();

    const { container } = render(<App />);

    // The old navigation tabs are gone.
    expect(container.querySelectorAll(".nav-button")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Travelog" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Impostazioni" })).not.toBeNull();

    // Trips dashboard is the default page
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "I Miei Viaggi" })).not.toBeNull();
    });

    // The search field and the primary action are rendered inside the top
    // bar (§1.1), not in the page.
    const header = container.querySelector(".app-header")!;
    expect(header.contains(screen.getByLabelText("Cerca viaggi"))).toBe(true);
    expect(header.contains(screen.getByRole("button", { name: "Azioni" }))).toBe(true);
  });

  it("restores the running scan progress when returning to the scans page", async () => {
    // History contains a scan still running: opening the page must
    // resume its progress view and polling automatically.
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/scans?page=")) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 5,
                folder: "test",
                status: "running",
                startedAt: "2026-01-09T10:00:00Z",
                endedAt: null,
                filesAnalyzed: 3,
                filesTotal: 10,
                newPhotos: 2,
                existingPhotos: 0,
                excludedPhotos: 0,
                errors: 0,
                errorMessage: null,
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
          }),
        );
      }
      if (url.includes("/api/scans/5")) {
        return Promise.resolve(
          jsonResponse({
            id: 5,
            folder: "test",
            status: "running",
            startedAt: "2026-01-09T10:00:00Z",
            endedAt: null,
            filesAnalyzed: 5,
            filesTotal: 10,
            newPhotos: 4,
            existingPhotos: 0,
            excludedPhotos: 0,
            errors: 0,
            errorMessage: null,
          }),
        );
      }
      if (url.includes("/api/trips/map")) {
        return Promise.resolve(
          jsonResponse({
            bounds: { minLat: 37, minLon: 6, maxLat: 47.1, maxLon: 19 },
            markers: [],
            countyColors: {},
          }),
        );
      }
      return Promise.resolve(jsonResponse({}, 200));
    });

    render(<App />);

    // The default page is Trips: reach the Scans page from the global
    // action menu in the top bar.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Azioni" })).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Azioni" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Scansiona Foto" }));

    // The running scan's progress panel appears without any user click
    await waitFor(() => {
      expect(screen.getByText("Scansione test")).not.toBeNull();
    });
    // Total photos found to scan is displayed among the counters
    expect(screen.getByText("Totale da scansionare")).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByText("10")).not.toBeNull();
    });

    // Stopping the scan: after the cancel request the polling picks up
    // the "stopped" status and the panel shows the info message.
    let cancelled = false;
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/scans/5/cancel")) {
        cancelled = true;
        return Promise.resolve(jsonResponse({ id: 5, status: "running" }, 202));
      }
      if (url.includes("/api/scans/5")) {
        return Promise.resolve(
          jsonResponse({
            id: 5,
            folder: "test",
            status: cancelled ? "stopped" : "running",
            startedAt: "2026-01-09T10:00:00Z",
            endedAt: null,
            filesAnalyzed: 5,
            filesTotal: 10,
            newPhotos: 4,
            existingPhotos: 0,
            excludedPhotos: 0,
            errors: 0,
            errorMessage: null,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}, 200));
    });

    fireEvent.click(screen.getByRole("button", { name: "Ferma scansione" }));

    // The polling interval is 2s: allow enough time for the next poll
    await waitFor(
      () => {
        expect(screen.getByText("Fermata")).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(screen.getByText(/Scansione interrotta dall'utente/)).not.toBeNull();
    expect(screen.getByText(/Interrotta dall'utente a 5 di 10 file/)).not.toBeNull();
    // The stop button disappears once the scan is in a terminal state
    expect(screen.queryByRole("button", { name: "Ferma scansione" })).toBeNull();
  });

  it("does not show the photos page in the navigation (hidden feature)", async () => {
    mockAllEndpoints();

    render(<App />);

    expect(screen.queryByRole("button", { name: "Foto" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Foto catalogate" })).toBeNull();
  });

  it("shows the settings page with thresholds", async () => {
    mockAllEndpoints();

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Impostazioni" }));

    await waitFor(() => {
      const input = screen.getByLabelText(/giorni consecutivi con foto/i) as HTMLInputElement;
      expect(input.value).toBe("2");
    });
  });

  it("asks for explicit confirmation before clearing the database", async () => {
    mockAllEndpoints();

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Impostazioni" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancella" })).not.toBeNull();
    });

    // First click only shows the confirmation — no DELETE yet
    fireEvent.click(screen.getByRole("button", { name: "Cancella" }));
    expect(screen.getByRole("alertdialog")).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/data"))).toHaveLength(0);

    // Cancel returns to the initial state without deleting
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Confirming triggers the DELETE and shows the success message
    fireEvent.click(screen.getByRole("button", { name: "Cancella" }));
    fireEvent.click(screen.getByRole("button", { name: "Sì, cancella tutto" }));

    await waitFor(() => {
      expect(screen.getByText(/Tutti i dati sono stati eliminati/)).not.toBeNull();
    });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/data"))).toHaveLength(1);
  });
});
