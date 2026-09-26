/**
 * Travelog MVP1 — Trips page tests (search debounce + stale-response guard)
 *
 * The page owns the server search state and re-queries `listTrips` on the
 * debounced search value; it also guards against out-of-order responses
 * when the search changes quickly. These tests mock the heavy children
 * (Leaflet dashboard, global action menu) and the API modules so only the
 * page's async data-flow is exercised.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import TripsPage from "../TripsPage";
import { listTrips, getTripsOverviewMap } from "../../api/trips";
import type { Trip, TripList, TripsOverviewMap } from "../../api/client";

vi.mock("../../api/trips", () => ({
  listTrips: vi.fn(),
  getTrip: vi.fn(),
  getTripMap: vi.fn(),
  getTripsOverviewMap: vi.fn(),
  recalculateTripsOverviewMap: vi.fn(),
  updateTrip: vi.fn(),
  deleteTrip: vi.fn(),
  exportTripsCsv: vi.fn(),
  exportTripIcs: vi.fn(),
  createTrip: vi.fn(),
  replaceTripDays: vi.fn(),
}));

vi.mock("../../api/operations", () => ({ splitTrip: vi.fn(), mergeTrips: vi.fn() }));
vi.mock("../../api/settings", () => ({ recalculate: vi.fn() }));

vi.mock("../../components/TripsDashboard", () => ({
  default: ({ trips }: { trips?: Trip[] }) => (
    <div data-testid="trips-dashboard">
      {(trips ?? []).map((trip) => (
        <span key={trip.id}>{trip.name}</span>
      ))}
    </div>
  ),
}));

vi.mock("../../components/TopBarSlot", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/GlobalActionMenu", () => ({ default: () => null }));

const listTripsMock = vi.mocked(listTrips);
const overviewMock = vi.mocked(getTripsOverviewMap);

const EMPTY_LIST: TripList = { items: [], page: 1, pageSize: 100, total: 0 };
const OVERVIEW: TripsOverviewMap = {
  bounds: { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 },
  markers: [],
  countyColors: {},
  computedAt: "2025-08-10T10:00:00",
};

function listResult(name: string, id: number): TripList {
  return { items: [{ id, name } as unknown as Trip], page: 1, pageSize: 100, total: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("TripsPage", () => {
  it("debounces the trip search to a single list request", async () => {
    vi.useFakeTimers();
    listTripsMock.mockResolvedValue(EMPTY_LIST);
    overviewMock.mockResolvedValue(OVERVIEW);

    render(<TripsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listTripsMock).toHaveBeenCalledTimes(1); // initial load

    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(listTripsMock).toHaveBeenCalledTimes(2); // one debounced re-query, not one per keystroke
    expect(listTripsMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: "abc" }));
  });

  it("ignores a stale list response when a newer request wins", async () => {
    vi.useFakeTimers();
    const stale = deferred<TripList>();
    overviewMock.mockResolvedValue(OVERVIEW);
    listTripsMock
      .mockResolvedValueOnce(EMPTY_LIST) // initial load
      .mockReturnValueOnce(stale.promise) // "a" request (resolves late)
      .mockResolvedValueOnce(listResult("Viaggio nuovo", 2)); // "b" request (current)

    render(<TripsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.change(input, { target: { value: "b" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The stale "a" response arrives after the current "b" response.
    await act(async () => {
      await stale.resolve(listResult("Viaggio vecchio", 1));
    });

    expect(screen.getByText("Viaggio nuovo")).not.toBeNull();
    expect(screen.queryByText("Viaggio vecchio")).toBeNull();
  });
});
