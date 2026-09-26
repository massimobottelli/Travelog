/**
 * Travelog — Trip context menu (new UI, phase 3)
 *
 * The per-trip gear dropdown described in the UI spec §2.1: it exposes the
 * punctual actions of a trip (Rinomina / Modifica date / Modifica viaggio /
 * Dividi viaggio / Elimina) and delegates them to the parent, which reuses
 * the existing dialogs (`TripDialog`) and the delete confirmation. The
 * "Modifica viaggio" entry appears only on active trips and enables the
 * inline day/locality editing of the expanded card (§51).
 *
 * The menu is self-contained: it owns its open/closed state and closes on
 * outside click or Escape.
 *
 * The dropdown is rendered through a React portal attached to `document.body`
 * (`position: fixed`, aligned with the trigger): the trip card clips its
 * own overflow (accordion), so an in-place dropdown would be cut off when
 * the card is collapsed.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarIcon, GearIcon, PencilIcon, ScissorsIcon, TrashIcon } from "./icons";

export interface TripContextMenuProps {
  onRename: () => void;
  onEditDates: () => void;
  /**
   * Enables the inline day/locality editing (§51): the "Modifica viaggio"
   * entry appears only when provided (active trips).
   */
  onEditDays?: () => void;
  onSplit: () => void;
  /**
   * Downloads the trip as an ICS calendar event (RFC 5545). When
   * provided, the "Aggiungi al Calendario" entry appears before
   * "Elimina viaggio".
   */
  onExportCalendar?: () => void;
  onDelete: () => void;
  /** Accessible label for the trigger button. */
  label?: string;
  disabled?: boolean;
}

export default function TripContextMenu({
  onRename,
  onEditDates,
  onEditDays,
  onSplit,
  onExportCalendar,
  onDelete,
  label,
  disabled = false,
}: TripContextMenuProps) {
  const [open, setOpen] = useState(false);
  /** Wrapper of the trigger: anchor for the outside-click detection. */
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  /** Fixed viewport position of the floating dropdown (null = not measured yet). */
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  /** Align the dropdown's right edge with the trigger (viewport coordinates). */
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const rect = trigger.getBoundingClientRect();
    const width = dropdown.offsetWidth;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setPosition({ top: rect.bottom + 6, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // Capture phase: scroll events of inner containers (the trip list) do
    // not bubble to `window`, but they are caught here while captured.
    function reposition() {
      updatePosition();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePosition]);

  /** Run an action and close the menu. */
  const select = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    // Stop click propagation so opening the menu never toggles the card.
    <div className="trip-context-menu" ref={rootRef} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-button trip-context-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? "Azioni viaggio"}
        title="Azioni viaggio"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <GearIcon size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="trip-context-dropdown trip-context-dropdown--floating"
            role="menu"
            style={position ?? { top: -9999, left: -9999 }}
          >
            {onEditDays && (
              <button
                type="button"
                role="menuitem"
                className="trip-context-item"
                onClick={select(onEditDays)}
              >
                <PencilIcon size={15} /> Modifica viaggio
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="trip-context-item"
              onClick={select(onRename)}
            >
              <PencilIcon size={15} /> Rinomina
            </button>
            <button
              type="button"
              role="menuitem"
              className="trip-context-item"
              onClick={select(onEditDates)}
            >
              <CalendarIcon size={15} /> Modifica date
            </button>
            <button
              type="button"
              role="menuitem"
              className="trip-context-item"
              onClick={select(onSplit)}
            >
              <ScissorsIcon size={15} /> Dividi viaggio
            </button>
            {onExportCalendar && (
              <button
                type="button"
                role="menuitem"
                className="trip-context-item"
                onClick={select(onExportCalendar)}
              >
                <CalendarIcon size={15} /> Aggiungi al Calendario
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="trip-context-item trip-context-item--danger"
              onClick={select(onDelete)}
            >
              <TrashIcon size={15} /> Elimina viaggio
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
