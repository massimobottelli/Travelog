/**
 * Travelog MVP1 — Trips page ("I Miei Viaggi")
 *
 * Main view (functional requirements §15, §16) built on the new two-column
 * dashboard (new UI §1–§3): the sidebar lists the trips as accordion cards,
 * the right column shows the map of the selected trip.
 *
 * The page owns the data and the operations: list/search, detail and map
 * loading, the manual operations (§13: rename, dates, split, merge, delete)
 * and the global actions (scan, manual creation, CSV export, recalculation).
 * All domain rules live in the backend; the
 * presentational components (TripsDashboard, TripCard, TripTimeline,
 * GlobalActionMenu) contain no business logic.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  listTrips,
  getTrip,
  updateTrip,
  deleteTrip,
  exportTripsCsv,
  exportTripIcs,
  createTrip,
  replaceTripDays,
  getTripMap,
  getTripsOverviewMap,
  recalculateTripsOverviewMap,
} from "../api/trips";
import { splitTrip, mergeTrips } from "../api/operations";
import { recalculate, type RecalculateRequest } from "../api/settings";
import RecalculateModal from "../components/RecalculateModal";
import type { Trip, TripDayInput, TripDetail, TripMapData, TripsOverviewMap } from "../api/client";
import TripDialog, { type TripDialogState } from "../components/TripDialog";
import TripDaysModal, { type TripDaysPayload } from "../components/TripDaysModal";
import TripsDashboard from "../components/TripsDashboard";
import GlobalActionMenu from "../components/GlobalActionMenu";
import Modal from "../components/Modal";
import MergeDialog from "../components/MergeDialog";
import TopBarSlot from "../components/TopBarSlot";
import ErrorAlert from "../components/ErrorAlert";
import { SearchIcon } from "../components/icons";
import { errorToMessage } from "../utils/error";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import { useIsMobile } from "../hooks/useIsMobile";
import { navigate } from "../hooks/useRoute";

export default function TripsPage() {
  const isMobile = useIsMobile();

  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [search, setSearch] = useState("");
  // Debounced copy of `search`: the server list query runs against this
  // value, not against every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mapData, setMapData] = useState<TripMapData | null>(null);
  // Panoramic overview of all active trips (photo-density heatmap, shown
  // while no trip has been selected yet). It is a persistent cached
  // snapshot (migration 0017): served from the cache on every load, its
  // age is shown in the map toolbar and the refresh is explicit.
  const [overviewMap, setOverviewMap] = useState<TripsOverviewMap | null>(null);
  const [overviewRecalculating, setOverviewRecalculating] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  // Success notification of the explicit overview recalculation (shown in
  // the page messages area, auto-dismissed like the other notifications).
  const [overviewMessage, setOverviewMessage] = useState<string | null>(null);

  const [dialog, setDialog] = useState<TripDialogState | null>(null);
  const [operating, setOperating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Success notification of an operation run inside a dialog: it is shown at
  // the bottom of the dialog and the dialog closes on its timeout.
  const [dialogMessage, setDialogMessage] = useState<string | null>(null);

  // Manual trip creation (modal).
  const [daysModalOpen, setDaysModalOpen] = useState(false);
  const [daysSubmitting, setDaysSubmitting] = useState(false);
  const [daysModalError, setDaysModalError] = useState<string | null>(null);

  // Merge (§13.4): the selection happens on the cards in merge mode, the
  // confirmation (recap + optional name) in a centered dialog.
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  // The delete confirmation stores the trip name so the success message can
  // stay visible even after the list is reloaded without the deleted trip.
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  // Pagination: the backend page size is capped at 100; the controls are
  // shown only when the active trips exceed one page.
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [recalcModalOpen, setRecalcModalOpen] = useState(false);
  const [recalcModalError, setRecalcModalError] = useState<string | null>(null);
  const [recalcModalMessage, setRecalcModalMessage] = useState<string | null>(null);
  const [recalcRefreshPending, setRecalcRefreshPending] = useState(false);
  const closeRecalcModal = useCallback(() => {
    setRecalcModalOpen(false);
    setRecalcModalMessage(null);
  }, []);
  useAutoDismiss(recalcModalMessage, closeRecalcModal, 3000);

  const [recalculating, setRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useAutoDismiss(recalcMessage, () => setRecalcMessage(null));
  useAutoDismiss(overviewMessage, () => setOverviewMessage(null));

  // The dialog closes only after its success notification disappears: this
  // callback stays stable so re-renders (e.g. the list reload) do not restart
  // the auto-dismiss timer.
  const closeDialogAfterNotification = useCallback((): void => {
    setDialogMessage(null);
    setDialog(null);
    setConfirmDelete(null);
    setDaysModalOpen(false);
    // Merge mode and its selection only end with the (confirmed) merge.
    setMergeDialogOpen(false);
    setMergeMode(false);
    setSelectedIds([]);
    setMergeTitle("");
  }, []);
  useAutoDismiss(dialogMessage, closeDialogAfterNotification);

  const reloadSeq = useRef(0);
  const reload = useCallback(async (query: string, requestedPage: number) => {
    // Guard against out-of-order responses: a newer reload supersedes this
    // one, so a stale result must not overwrite fresher state.
    const seq = ++reloadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listTrips({
        status: "active",
        search: query || undefined,
        pageSize: PAGE_SIZE,
        page: requestedPage,
      });
      if (seq !== reloadSeq.current) return;
      setTrips(result.items);
      setTotalPages(Math.max(1, Math.ceil(result.total / PAGE_SIZE)));
      setSelectedIds((ids) => ids.filter((id) => result.items.some((t) => t.id === id)));
    } catch (err: unknown) {
      if (seq !== reloadSeq.current) return;
      setLoadError(errorToMessage(err));
    } finally {
      if (seq === reloadSeq.current) setLoading(false);
    }
  }, []);

  // Debounce the server search: a full list re-query on every keystroke is
  // wasteful (one request per character); wait for a typing pause instead.
  useEffect(() => {
    const SEARCH_DEBOUNCE_MS = 300;
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void reload(debouncedSearch, page);
  }, [reload, debouncedSearch, page]);

  // Best-effort refresh only: a 202 does not signal job completion.
  useEffect(() => {
    if (!recalcRefreshPending) return;
    const RECALCULATION_REFRESH_DELAY_MS = 2000;
    const timer = window.setTimeout(() => {
      setRecalcRefreshPending(false);
      void reload(debouncedSearch, page);
    }, RECALCULATION_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [recalcRefreshPending, reload, debouncedSearch, page]);

  // Panoramic overview of all active trips: loaded once at startup and
  // refreshed only after operations that change the set of trips. It is
  // independent of search/pagination (it always covers every active trip).
  const loadOverview = useCallback(async () => {
    try {
      setOverviewMap(await getTripsOverviewMap());
    } catch {
      // Soft-fail: the map panel falls back to the hint.
      setOverviewMap(null);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Explicit recalculation of the cached overview (migration 0017): the
  // fresh aggregation replaces the served snapshot in place and a success
  // notification confirms the completion. On failure the error is shown
  // in the page messages area and the cached heatmap is kept as-is.
  const handleRecalculateOverview = useCallback(async (): Promise<void> => {
    setOverviewRecalculating(true);
    setOverviewError(null);
    setOverviewMessage(null);
    try {
      setOverviewMap(await recalculateTripsOverviewMap());
      setOverviewMessage("Heatmap aggiornata.");
    } catch (err: unknown) {
      setOverviewError(errorToMessage(err));
    } finally {
      setOverviewRecalculating(false);
    }
  }, []);

  const handleSearchChange = (value: string): void => {
    setSearch(value);
    setPage(1); // a new search always starts from the first page
  };

  const goToPage = (target: number): void => {
    setPage(Math.min(Math.max(1, target), totalPages));
  };

  const detailSeq = useRef(0);
  const loadDetail = useCallback(async (tripId: number) => {
    // Guard against out-of-order responses when switching trips quickly.
    const seq = ++detailSeq.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detailData = await getTrip(tripId);
      if (seq !== detailSeq.current) return;
      setDetail(detailData);
      // The map is secondary: a failure loading it must not prevent the
      // trip detail from being shown.
      const mapDataLoaded = await getTripMap(tripId).catch(() => null);
      if (seq !== detailSeq.current) return;
      setMapData(mapDataLoaded);
    } catch (err: unknown) {
      if (seq !== detailSeq.current) return;
      setDetailError(errorToMessage(err));
      setDetail(null);
      setMapData(null);
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTripId !== null) void loadDetail(selectedTripId);
  }, [selectedTripId, loadDetail]);

  // Re-fetches the list and drops the current selection after an operation
  // that changed the trips. The success notification is owned by the caller.
  const refreshAfterOperation = useCallback(async () => {
    setSelectedTripId(null);
    setDetail(null);
    setMapData(null);
    await Promise.all([reload(debouncedSearch, page), loadOverview()]);
  }, [reload, debouncedSearch, page, loadOverview]);

  const handleDialogSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!dialog) return;
    setOperating(true);
    setActionError(null);
    try {
      const form = new FormData(event.currentTarget);
      let message: string;
      if (dialog.type === "rename") {
        await updateTrip(dialog.tripId, { name: String(form.get("name") ?? "").trim() });
        message = "Viaggio rinominato.";
      } else if (dialog.type === "dates") {
        await updateTrip(dialog.tripId, {
          startDate: String(form.get("startDate") ?? ""),
          endDate: String(form.get("endDate") ?? ""),
        });
        message = "Date del viaggio aggiornate.";
      } else {
        const name = String(form.get("name") ?? "").trim();
        await splitTrip(dialog.tripId, {
          splitDate: String(form.get("splitDate") ?? ""),
          name: name || undefined,
        });
        message = "Viaggio diviso: la data scelta appartiene al secondo viaggio.";
      }
      // Keep the dialog open and show the confirmation inside it; the dialog
      // is closed when the notification auto-dismisses.
      setDialogMessage(message);
      await refreshAfterOperation();
    } catch (err: unknown) {
      setActionError(errorToMessage(err));
    } finally {
      setOperating(false);
    }
  };

  const handleMerge = async (): Promise<void> => {
    if (selectedIds.length < 2) return;
    setOperating(true);
    setActionError(null);
    try {
      await mergeTrips({ tripIds: selectedIds, title: mergeTitle.trim() || undefined });
      // The confirmation stays in the dialog, which closes on its timeout
      // (then merge mode and the selection are dropped).
      setDialogMessage("Viaggi uniti: i viaggi originali restano nello storico.");
      await refreshAfterOperation();
    } catch (err: unknown) {
      setActionError(errorToMessage(err));
    } finally {
      setOperating(false);
    }
  };

  const toggleSelected = (id: number): void => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const toggleMergeMode = (): void => {
    setMergeDialogOpen(false);
    setDialogMessage(null);
    setMergeMode((value) => !value);
    setSelectedIds([]);
    setMergeTitle("");
  };

  const closeMergeDialog = (): void => {
    setDialogMessage(null);
    setMergeDialogOpen(false);
  };

  const handleDelete = async (tripId: number): Promise<void> => {
    setOperating(true);
    setActionError(null);
    try {
      await deleteTrip(tripId);
      // The success notification stays in the confirmation dialog (which
      // closes on its timeout), so the deleted trip name is kept aside.
      setDialogMessage(`Viaggio «${confirmDelete?.name || "(senza nome)"}» eliminato.`);
      await refreshAfterOperation();
    } catch (err: unknown) {
      setActionError(errorToMessage(err));
    } finally {
      setOperating(false);
    }
  };

  // Inline day/locality editing of the expanded card ("Modifica viaggio",
  // §51): persist the full day list, then refresh detail, map and list
  // together (the trip interval may have changed). On failure the error
  // propagates to the timeline, which shows it in place.
  const handleReplaceDays = async (tripId: number, days: TripDayInput[]): Promise<void> => {
    await replaceTripDays(tripId, { days });
    if (selectedTripId === tripId) {
      const [detailData, mapDataLoaded] = await Promise.all([getTrip(tripId), getTripMap(tripId)]);
      setDetail(detailData);
      setMapData(mapDataLoaded);
    }
    await Promise.all([reload(debouncedSearch, page), loadOverview()]);
  };

  const handleRecalculate = async (period?: RecalculateRequest): Promise<void> => {
    setRecalculating(true);
    setRecalcModalError(null);
    try {
      await recalculate(period);
      setRecalcModalMessage(
        "Richiesta accettata: il ricalcolo prosegue in background. La lista verrà riletta tra poco; se non è ancora aggiornata, ricarica la pagina più tardi.",
      );
      setRecalcRefreshPending(true);
    } catch (err: unknown) {
      setRecalcModalError(errorToMessage(err));
      setRecalcModalMessage(null);
    } finally {
      setRecalculating(false);
    }
  };

  const handleExportCsv = async (): Promise<void> => {
    setExporting(true);
    setRecalcError(null);
    try {
      await exportTripsCsv();
    } catch (err: unknown) {
      setRecalcError(errorToMessage(err));
    } finally {
      setExporting(false);
    }
  };

  /**
   * Download the ICS (iCalendar) export of a single trip. Errors are
   * surfaced through the same page-level error message used by the other
   * operations.
   */
  const handleExportCalendar = async (tripId: number): Promise<void> => {
    setActionError(null);
    try {
      await exportTripIcs(tripId);
    } catch (err: unknown) {
      setActionError(errorToMessage(err));
    }
  };

  // ── Manual trip creation (modal) ─────────────────────────────────
  const openDaysModal = (): void => {
    setDaysModalError(null);
    setDaysModalOpen(true);
  };

  const handleDaysSubmit = async (payload: TripDaysPayload): Promise<void> => {
    setDaysSubmitting(true);
    setDaysModalError(null);
    try {
      await createTrip({ name: payload.name || undefined, days: payload.days });
      setDialogMessage("Viaggio creato.");
      await Promise.all([reload(debouncedSearch, page), loadOverview()]);
    } catch (err: unknown) {
      setDaysModalError(errorToMessage(err));
    } finally {
      setDaysSubmitting(false);
    }
  };

  // Trips selected for the merge, in sidebar order (only loaded trips can be
  // selected, see reload()).
  const selectedTrips = (trips ?? []).filter((trip) => selectedIds.includes(trip.id));

  return (
    <div className="page trips-page">
      {/* Top bar content (new UI §1.1): the search field and the global
          action menu live in the application header, next to the brand. */}
      <TopBarSlot>
        <div className="search-box app-header-search">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Cerca…"
            aria-label="Cerca viaggi"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
          />
        </div>
        <GlobalActionMenu
          onScan={() => navigate("/scans")}
          onStats={() => navigate("/stats")}
          onCreateTrip={openDaysModal}
          onExport={handleExportCsv}
          onMerge={toggleMergeMode}
          onRecalculate={() => {
            setRecalcModalError(null);
            setRecalcModalMessage(null);
            setRecalcModalOpen(true);
          }}
          onRecalculateOverview={handleRecalculateOverview}
          exporting={exporting}
          recalculating={recalculating}
          recalculatingOverview={overviewRecalculating}
          mergeActive={mergeMode}
          mergeDisabled={(trips?.length ?? 0) < 2}
        />
      </TopBarSlot>
      {/* Manual trip creation: the modal opens right below the top of the
          view, before the dashboard. */}
      {recalcModalOpen && (
        <RecalculateModal
          submitting={recalculating}
          error={recalcModalError}
          message={recalcModalMessage}
          onSubmit={handleRecalculate}
          onCancel={closeRecalcModal}
        />
      )}
      {daysModalOpen && (
        <TripDaysModal
          submitting={daysSubmitting}
          error={daysModalError}
          message={dialogMessage}
          onSubmit={handleDaysSubmit}
          onCancel={() => {
            setDialogMessage(null);
            setDaysModalOpen(false);
          }}
        />
      )}

      {mergeMode && (
        <div className="merge-bar">
          <p className="hint">
            Seleziona due o più viaggi da unire: la conferma si apre in una finestra e gli originali
            restano nello storico.
          </p>
          <button
            type="button"
            onClick={() => {
              setDialogMessage(null);
              setActionError(null);
              setMergeDialogOpen(true);
            }}
            disabled={selectedIds.length < 2 || operating}
          >
            {`Unisci ${selectedIds.length} viaggi selezionati`}
          </button>
        </div>
      )}

      {(recalcMessage ||
        recalcError ||
        actionError ||
        overviewMessage ||
        overviewError ||
        overviewRecalculating) && (
        <div className="trips-messages">
          {recalcMessage && <p className="alert alert-success">{recalcMessage}</p>}
          {recalcError && <ErrorAlert message={recalcError} />}
          {actionError && <ErrorAlert message={actionError} />}
          {overviewRecalculating && (
            <p className="alert alert-warning" role="status">
              Ricalcolo Heatmap in corso...
            </p>
          )}
          {overviewMessage && <p className="alert alert-success">{overviewMessage}</p>}
          {overviewError && <ErrorAlert message={overviewError} />}
        </div>
      )}

      <TripsDashboard
        trips={trips ?? []}
        loading={loading}
        error={loadError}
        selectedTripId={selectedTripId}
        onSelectTrip={(id) =>
          isMobile
            ? // On the stacked mobile layout the accordion is not used:
              // tapping a card opens the shareable detail page in the
              // same tab.
              navigate(`/trips/${id}`)
            : setSelectedTripId((current) => (current === id ? null : id))
        }
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        mapData={mapData}
        overviewMapData={overviewMap}
        onRename={(trip) => {
          setDialogMessage(null);
          setDialog({ type: "rename", tripId: trip.id, currentName: trip.name });
        }}
        onEditDates={(trip) => {
          setDialogMessage(null);
          setDialog({
            type: "dates",
            tripId: trip.id,
            startDate: trip.startDate,
            endDate: trip.endDate,
          });
        }}
        onSplit={(trip) => {
          setDialogMessage(null);
          setDialog({
            type: "split",
            tripId: trip.id,
            startDate: trip.startDate,
            endDate: trip.endDate,
            proposedName: `${trip.name} (2)`,
          });
        }}
        onDelete={(trip) => {
          setDialogMessage(null);
          setConfirmDelete({ id: trip.id, name: trip.name });
        }}
        onExportCalendar={(trip) => {
          void handleExportCalendar(trip.id);
        }}
        onReplaceDays={handleReplaceDays}
        mergeMode={mergeMode}
        selectedIds={selectedIds}
        onToggleSelected={toggleSelected}
        onOpenTripDetail={(trip) => window.open(`/trips/${trip.id}`, "_blank")}
        sidebarFooter={
          totalPages > 1 && !loading ? (
            <nav className="pagination" aria-label="Paginazione viaggi">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                aria-label="Pagina precedente"
              >
                ‹ Precedente
              </button>
              <span className="hint">
                Pagina {page} di {totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                aria-label="Pagina successiva"
              >
                Successiva ›
              </button>
            </nav>
          ) : undefined
        }
      />

      {/* Trip operations dialog: rename, dates, split (§13.1–§13.3). */}
      {dialog !== null && (
        <TripDialog
          dialog={dialog}
          operating={operating}
          message={dialogMessage}
          onSubmit={handleDialogSubmit}
          onCancel={() => {
            setDialogMessage(null);
            setDialog(null);
          }}
        />
      )}

      {/* Destructive delete: explicit confirmation, history preserved. The
          success confirmation replaces the question until the auto-dismiss. */}
      {confirmDelete !== null && (
        <Modal label="Conferma eliminazione viaggio">
          {dialogMessage ? (
            <div className="panel" role="alertdialog" aria-label="Conferma eliminazione viaggio">
              <p className="alert alert-success dialog-message" role="status">
                {dialogMessage}
              </p>
            </div>
          ) : (
            <div
              className="confirm-box"
              role="alertdialog"
              aria-label="Conferma eliminazione viaggio"
            >
              <p>
                Eliminare definitivamente il viaggio{" "}
                <strong>«{confirmDelete.name || "(senza nome)"}»</strong>?
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => handleDelete(confirmDelete.id)}
                  disabled={operating}
                >
                  {operating ? "Eliminazione…" : "Sì, elimina viaggio"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDialogMessage(null);
                    setConfirmDelete(null);
                  }}
                  disabled={operating}
                >
                  Annulla
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Merge confirmation (§13.4): recap of the trips selected on the cards. */}
      {mergeDialogOpen && (
        <MergeDialog
          trips={selectedTrips}
          title={mergeTitle}
          onTitleChange={setMergeTitle}
          operating={operating}
          error={actionError}
          message={dialogMessage}
          onSubmit={handleMerge}
          onCancel={closeMergeDialog}
        />
      )}
    </div>
  );
}
