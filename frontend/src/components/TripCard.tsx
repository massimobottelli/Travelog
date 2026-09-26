/**
 * Travelog — Trip card (new UI, phase 3)
 *
 * The accordion travel card described in the UI spec §2.1:
 * - title (trip name) and chevron (expand/collapse);
 * - subtitle with the date range and computed duration, preceded by a
 *   calendar icon (e.g. "3 Lug - 31 Lug 2026 · 29 gg");
 * - geographic tags from `Trip.regions` (counties/regions visited);
 * - per-trip gear context menu (Rinomina / Modifica date / Modifica viaggio /
 *   Dividi / Elimina), delegated to the parent so it reuses the existing
 *   dialogs. The "Modifica viaggio" entry appears only on active trips and
 *   enables the inline day/locality editing of the expanded body (§51).
 *
 * The expanded body is provided by the parent through `children`: the
 * timeline extraction from `TripDetailPanel` arrives in a later phase.
 */

import type { ReactNode } from "react";
import type { Trip } from "../api/client";
import { formatTripPeriodShort, tripDurationDays } from "../utils/format";
import { CalendarIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from "./icons";
import TripContextMenu from "./TripContextMenu";

export interface TripCardProps {
  trip: Trip;
  /** Accordion open state. */
  expanded: boolean;
  /** Toggle the accordion (also selects the trip in the dashboard). */
  onToggle: () => void;
  /** True when this is the selected trip (the map is focused on it). */
  active?: boolean;
  onRename: () => void;
  onEditDates: () => void;
  /**
   * Enables the inline day/locality editing (§51): when provided, the
   * context menu shows the "Modifica viaggio" entry.
   */
  onEditDays?: () => void;
  onSplit: () => void;
  /**
   * Downloads the trip as an ICS calendar event. When provided, the
   * "Aggiungi al Calendario" entry appears in the context menu before
   * "Elimina viaggio".
   */
  onExportCalendar?: () => void;
  onDelete: () => void;
  /** Merge-selection mode: shows a checkbox to include the trip. */
  mergeMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  /**
   * Opens the standalone, shareable trip detail page (`/trips/:id`) in a
   * new tab. When provided, an external-link button appears next to the
   * context menu.
   */
  onOpenDetail?: (trip: Trip) => void;
  /** Expanded body (the timeline), provided by the parent. */
  children?: ReactNode;
}

export default function TripCard({
  trip,
  expanded,
  onToggle,
  active = false,
  onRename,
  onEditDates,
  onEditDays,
  onSplit,
  onExportCalendar,
  onDelete,
  mergeMode = false,
  selected = false,
  onToggleSelected,
  onOpenDetail,
  children,
}: TripCardProps) {
  const title = trip.name || "(senza nome)";
  const regions = trip.regions ?? [];

  return (
    <article className={`trip-card${active ? " trip-card--active" : ""}`} data-trip-id={trip.id}>
      <div className="trip-card-summary">
        {mergeMode && onToggleSelected && (
          <input
            type="checkbox"
            className="trip-card-select"
            aria-label={`Seleziona ${title}`}
            checked={selected}
            onChange={onToggleSelected}
            onClick={(event) => event.stopPropagation()}
          />
        )}

        <button
          type="button"
          className="trip-card-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="trip-card-main">
            <span className="trip-card-title">
              {title}
              {/* Provenance badges preserved from the previous trip list:
                  created manually by the user, or archived. */}
              {trip.createdManually && <span className="badge badge-manual">MANUALE</span>}
              {trip.status === "archived" && (
                <span className="badge badge-archived">Archiviato</span>
              )}
            </span>
            <span className="trip-card-subtitle">
              <CalendarIcon size={14} />
              <span>
                {formatTripPeriodShort(trip.startDate, trip.endDate)} ·{" "}
                {tripDurationDays(trip.startDate, trip.endDate)} gg
              </span>
            </span>
            {regions.length > 0 && (
              <span className="trip-card-tags">
                {regions.map((region) => (
                  <span key={region} className="trip-card-tag">
                    {region}
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="trip-card-chevron" aria-hidden="true">
            {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
          </span>
        </button>

        {onOpenDetail && (
          <button
            type="button"
            className="icon-button trip-card-open"
            aria-label={`Apri la scheda dettaglio di ${title} in una nuova pagina`}
            title="Apri scheda dettaglio (link condivisibile)"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetail(trip);
            }}
          >
            <ExternalLinkIcon size={16} />
          </button>
        )}

        <TripContextMenu
          label={`Azioni per ${title}`}
          onRename={onRename}
          onEditDates={onEditDates}
          onEditDays={onEditDays}
          onSplit={onSplit}
          onExportCalendar={onExportCalendar}
          onDelete={onDelete}
        />
      </div>

      {expanded && <div className="trip-card-body">{children}</div>}
    </article>
  );
}
