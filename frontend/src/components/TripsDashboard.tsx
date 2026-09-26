/**
 * Travelog — Trips dashboard (new UI §2/§3)
 *
 * Two-column layout ("I Miei Viaggi" + full-height map):
 * - left (~420px, internal scroll): the accordion trip cards;
 * - right (flex-grow): the full-height interactive Leaflet map.
 *
 * The search field and the global action menu live in the application top
 * bar (UI §1.1), rendered by the page through `TopBarSlot`; the page owns
 * the server-side search state and re-queries `listTrips`.
 *
 * Selection is controlled by the parent: clicking a card reports the trip
 * id through `onSelectTrip`; the parent loads `getTrip` + `getTripMap` and
 * passes the new `mapData` back down. A new `mapData` makes TripMap fit the
 * bounds of the selected trip (fly-to/zoom fit, §4).
 *
 * The expanded card body shows the day/locality timeline (`TripTimeline`),
 * synchronized with the map: hovering or clicking a locality opens the
 * matching pin popup, and clicking a pin highlights its timeline row
 * (UI §3.1).
 *
 * On active trips the expanded body offers the "Modifica viaggio" entry
 * (§51) in the trip context menu: it enables the inline day/locality
 * editing (same commands as the detail page), persisted through the
 * `onReplaceDays` callback of the page.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Trip, TripDayInput, TripDetail, TripMapData, TripsOverviewMap } from "../api/client";
import TripCard from "./TripCard";
import TripMap from "./TripMap";
import HeatMap from "./HeatMap";
import { useIsMobile } from "../hooks/useIsMobile";
import TripTimeline from "./TripTimeline";
import Loading from "./Loading";
import ErrorAlert from "./ErrorAlert";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";

export interface TripsDashboardProps {
  trips: Trip[];
  loading: boolean;
  error: string | null;
  /** Currently selected trip (the expanded card and the focused map). */
  selectedTripId: number | null;
  onSelectTrip: (tripId: number) => void;
  /**
   * Day/locality detail of the selected trip (`getTrip`); it feeds the
   * timeline shown inside the expanded card.
   */
  detail?: TripDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  /** Map data of the selected trip (`getTripMap`); drives the fly-to fit. */
  mapData: TripMapData | null;
  /**
   * Panoramic overview of all active trips (`getTripsOverviewMap`), shown
   * as a photo-density heatmap while no trip has been selected yet. One
   * point per unique locality, intensity proportional to the photo count.
   * The aggregation is a persistent cached snapshot (migration 0017): the
   * explicit recalculation lives in the header action menu ("Ricalcola
   * heatmap") and its result replaces this data in place.
   */
  overviewMapData?: TripsOverviewMap | null;
  onRename: (trip: Trip) => void;
  onEditDates: (trip: Trip) => void;
  onSplit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  /**
   * Downloads the trip as an ICS calendar event. When provided, the
   * "Aggiungi al Calendario" entry appears in the context menu.
   */
  onExportCalendar?: (trip: Trip) => void;
  /**
   * When provided, every active trip exposes the inline day/locality
   * editing through the "Modifica viaggio" context-menu entry (§51): the
   * callback persists the full day list of the trip and refreshes the
   * detail (§47bis).
   */
  onReplaceDays?: (tripId: number, days: TripDayInput[]) => Promise<void>;
  /** Merge-selection mode: the cards show a selection checkbox. */
  mergeMode?: boolean;
  selectedIds?: number[];
  onToggleSelected?: (tripId: number) => void;
  /** Opens the shareable trip detail page (`/trips/:id`) in a new tab. */
  onOpenTripDetail?: (trip: Trip) => void;
  /** Extra content pinned under the trip list (e.g. pagination). */
  sidebarFooter?: ReactNode;
}

export default function TripsDashboard({
  trips,
  loading,
  error,
  selectedTripId,
  onSelectTrip,
  detail,
  detailLoading,
  detailError,
  mapData,
  overviewMapData,
  onRename,
  onEditDates,
  onSplit,
  onDelete,
  onExportCalendar,
  onReplaceDays,
  mergeMode = false,
  selectedIds = [],
  onToggleSelected,
  onOpenTripDetail,
  sidebarFooter,
}: TripsDashboardProps) {
  // On the stacked mobile layout the overview heatmap is not rendered at
  // all: a hidden (display:none) Leaflet canvas has zero size and the
  // heat plugin's getImageData would throw at reset time.
  const isMobile = useIsMobile();
  /* Hover-only visual highlight (no popup, no fly-to — only marker enlarge). */
  const [highlightedLocalityId, setHighlightedLocalityId] = useState<number | null>(null);
  /**
   * Expanded card whose days are being edited inline, entered from the
   * "Modifica viaggio" voice of the trip context menu (§51).
   * Only one card at a time can be edited.
   */
  const [editingTripId, setEditingTripId] = useState<number | null>(null);
  /**
   * Years collapsed in the sidebar accordion. The set starts empty so every
   * year group is open at first render; years can be closed/reopened
   * independently (multiple closed at once is allowed).
   */
  const [closedYears, setClosedYears] = useState<Set<string>>(new Set());

  const toggleYear = (year: string) => {
    setClosedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  /**
   * Trips grouped by the year of their start date. The list arrives from
   * the backend already sorted in reverse chronological order, so groups
   * preserve that order (most recent year first) without re-sorting.
   */
  const yearGroups = useMemo(() => {
    const groups: { year: string; trips: Trip[] }[] = [];
    for (const trip of trips) {
      const year = (trip.startDate ?? "").slice(0, 4);
      const last = groups[groups.length - 1];
      if (last && last.year === year) {
        last.trips.push(trip);
      } else {
        groups.push({ year, trips: [trip] });
      }
    }
    return groups;
  }, [trips]);

  useEffect(() => {
    setHighlightedLocalityId(null);
    // Keep the editing state when the card was just expanded for it, drop it
    // when another trip becomes the selected one.
    setEditingTripId((current) => (current === selectedTripId ? current : null));
  }, [selectedTripId]);

  return (
    <div className="trips-dashboard">
      <aside className="trips-sidebar" aria-label="I Miei Viaggi">
        <div className="trips-sidebar-header">
          <h2 className="trips-sidebar-title">I Miei Viaggi</h2>
          <div className="trips-sidebar-actions">
            <button
              type="button"
              className="sidebar-action-button"
              aria-label="Espandi tutti gli anni"
              disabled={yearGroups.length === 0}
              onClick={() => setClosedYears(new Set())}
            >
              Espandi tutto
            </button>
            <button
              type="button"
              className="sidebar-action-button"
              aria-label="Comprimi tutti gli anni"
              disabled={yearGroups.length === 0}
              onClick={() => setClosedYears(new Set(yearGroups.map((group) => group.year)))}
            >
              Comprimi tutto
            </button>
          </div>
        </div>

        <div className="trips-sidebar-list">
          {loading && <Loading />}
          {!loading && error && <ErrorAlert message={error} />}
          {!loading && !error && trips.length === 0 && (
            <p className="hint">Nessun viaggio trovato.</p>
          )}

          {yearGroups.map(({ year, trips: yearTrips }) => {
            const open = !closedYears.has(year);
            return (
              <section key={year} className="trips-year-group" data-year={year}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  aria-expanded={open}
                  aria-label={`Viaggi ${year}`}
                  onClick={() => toggleYear(year)}
                >
                  <span>{year}</span>
                  <span className="flex items-center gap-1.5" aria-hidden="true">
                    <span className="text-white font-normal">
                      {yearTrips.length} {yearTrips.length === 1 ? "viaggio" : "viaggi"}
                    </span>
                    {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                  </span>
                </button>
                {open &&
                  yearTrips.map((trip) => {
                    const expanded = trip.id === selectedTripId;
                    // Inline day editing (§51): active trips only, exactly like the
                    // standalone detail page. It is entered from the "Modifica
                    // viaggio" entry of the trip context menu, which also expands
                    // the card when needed.
                    const editing = expanded && editingTripId === trip.id;
                    const editable = detail?.status === "active" && onReplaceDays !== undefined;
                    // The menu entry is per-trip and must not depend on the detail of
                    // the currently selected trip.
                    const canEditDays = trip.status === "active" && onReplaceDays !== undefined;
                    return (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        expanded={expanded}
                        active={expanded}
                        onToggle={() => onSelectTrip(trip.id)}
                        onRename={() => onRename(trip)}
                        onEditDates={() => onEditDates(trip)}
                        onEditDays={
                          canEditDays
                            ? () => {
                                if (!expanded) onSelectTrip(trip.id);
                                setEditingTripId(trip.id);
                              }
                            : undefined
                        }
                        onSplit={() => onSplit(trip)}
                        onDelete={() => onDelete(trip)}
                        onExportCalendar={
                          onExportCalendar ? () => onExportCalendar(trip) : undefined
                        }
                        mergeMode={mergeMode}
                        selected={selectedIds.includes(trip.id)}
                        onToggleSelected={
                          onToggleSelected ? () => onToggleSelected(trip.id) : undefined
                        }
                        onOpenDetail={onOpenTripDetail}
                      >
                        {detailLoading && <Loading />}
                        {detailError && <ErrorAlert message={detailError} />}
                        {!detailLoading && !detailError && detail && (
                          <TripTimeline
                            days={detail.days}
                            editing={editing}
                            onReplaceDays={
                              editable && onReplaceDays
                                ? (days: TripDayInput[]) => onReplaceDays(trip.id, days)
                                : undefined
                            }
                            onExitEditing={() => setEditingTripId(null)}
                            activeLocalityId={highlightedLocalityId}
                            onLocalityHover={setHighlightedLocalityId}
                          />
                        )}
                      </TripCard>
                    );
                  })}
              </section>
            );
          })}

          {sidebarFooter && <>{sidebarFooter}</>}
        </div>
      </aside>

      <section
        className={
          mapData
            ? "trips-map-panel"
            : // Overview (heatmap) / empty-hint panel: hidden on mobile,
              // where the stacked layout gives the card list full width.
              "trips-map-panel trips-map-panel--overview"
        }
        aria-label="Mappa viaggi"
      >
        {mapData ? (
          <TripMap
            data={mapData}
            fullHeight
            showTrack
            hoveredLocalityId={selectedTripId !== null ? highlightedLocalityId : null}
          />
        ) : !isMobile && overviewMapData ? (
          <HeatMap
            data={overviewMapData}
            fullHeight
            emptyMessage="Nessuna località da visualizzare sulla mappa."
          />
        ) : (
          <p className="hint trips-map-hint">
            {selectedTripId === null
              ? "Seleziona un viaggio per visualizzarlo sulla mappa."
              : "Nessuna mappa disponibile per questo viaggio."}
          </p>
        )}
      </section>
    </div>
  );
}
