/**
 * Travelog MVP1 — Settings page
 *
 * Global thresholds (functional requirement §19) and explicit
 * recalculation (functional requirement §12): saving settings never
 * modifies existing trips; recalculation is an explicit user action.
 */

import { useEffect, useState, useRef, type FormEvent } from "react";
import { getSettings, updateSettings } from "../api/settings";
import { getConfig, updateConfig } from "../api/config";
import { deleteAllData, exportData, importData } from "../api/data";
import ExclusionZonesPanel from "../components/ExclusionZonesPanel";
import type { Settings, RuntimeConfig } from "../api/client";
import Loading from "../components/Loading";
import ErrorAlert from "../components/ErrorAlert";
import { errorToMessage } from "../utils/error";
import { useAutoDismiss } from "../hooks/useAutoDismiss";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [minimumConsecutiveDaysWithPhotos, setMinimumConsecutiveDaysWithPhotos] = useState("2");
  const [consecutiveDaysWithoutPhotosBeforeClosing, setConsecutiveDaysWithoutPhotosBeforeClosing] =
    useState("3");

  const [photoRoot, setPhotoRoot] = useState<RuntimeConfig | null>(null);
  const [photoRootInput, setPhotoRootInput] = useState("");
  const [photoRootLoading, setPhotoRootLoading] = useState(true);
  const [savingPhotoRoot, setSavingPhotoRoot] = useState(false);
  const [photoRootError, setPhotoRootError] = useState<string | null>(null);
  const [photoRootMessage, setPhotoRootMessage] = useState<string | null>(null);

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useAutoDismiss(photoRootMessage, () => setPhotoRootMessage(null));
  useAutoDismiss(saveMessage, () => setSaveMessage(null));
  useAutoDismiss(resetMessage, () => setResetMessage(null));
  useAutoDismiss(importMessage, () => setImportMessage(null));

  useEffect(() => {
    let active = true;
    getSettings()
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setMinimumConsecutiveDaysWithPhotos(String(result.minimumConsecutiveDaysWithPhotos));
        setConsecutiveDaysWithoutPhotosBeforeClosing(
          String(result.consecutiveDaysWithoutPhotosBeforeClosing),
        );
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(errorToMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getConfig()
      .then((result) => {
        if (!active) return;
        setPhotoRoot(result);
        setPhotoRootInput(result.photoRoot ?? "");
        setPhotoRootLoading(false);
      })
      .catch((err: unknown) => {
        if (active) {
          setPhotoRootError(errorToMessage(err));
          setPhotoRootLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSavePhotoRoot = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSavingPhotoRoot(true);
    setPhotoRootError(null);
    setPhotoRootMessage(null);
    try {
      const updated = await updateConfig({ photoRoot: photoRootInput.trim() });
      setPhotoRoot(updated);
      setPhotoRootMessage(
        updated.photoRoot
          ? "Percorso foto salvato: verrà usato dalle prossime scansioni."
          : "Percorso foto rimosso.",
      );
    } catch (err: unknown) {
      setPhotoRootError(errorToMessage(err));
    } finally {
      setSavingPhotoRoot(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const updated = await updateSettings({
        minimumConsecutiveDaysWithPhotos: Number(minimumConsecutiveDaysWithPhotos),
        consecutiveDaysWithoutPhotosBeforeClosing: Number(
          consecutiveDaysWithoutPhotosBeforeClosing,
        ),
      });
      setSettings(updated);
      setSaveMessage("Impostazioni salvate. Le modifiche non influiscono sui viaggi esistenti.");
    } catch (err: unknown) {
      setSaveError(errorToMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleResetDatabase = async (): Promise<void> => {
    setResetting(true);
    setResetError(null);
    setResetMessage(null);
    try {
      await deleteAllData();
      setConfirmingReset(false);
      setResetMessage(
        "Tutti i dati sono stati eliminati: foto, scansioni, località, viaggi e impostazioni sono stati azzerati.",
      );
    } catch (err: unknown) {
      setResetError(errorToMessage(err));
    } finally {
      setResetting(false);
    }
  };

  const handleExportDatabase = async (): Promise<void> => {
    setExporting(true);
    setExportError(null);
    try {
      await exportData();
    } catch (err: unknown) {
      setExportError(errorToMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const handleImportDatabase = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);
    setImportMessage(null);
    try {
      const result = await importData(file);
      setImportMessage(
        `Database ripristinato: ${result.totalRows} righe importate. Ricarica la pagina per vedere i dati aggiornati.`,
      );
      // Reset the file input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      setImportError(errorToMessage(err));
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setImporting(false);
    }
  };

  if (loadError) {
    return <ErrorAlert message={`Impossibile caricare le impostazioni: ${loadError}`} />;
  }

  if (settings === null) {
    return <Loading />;
  }

  return (
    <div className="page">
      <section className="panel page-header-card">
        <div className="page-header-row">
          <h1 className="page-title">Impostazioni</h1>
        </div>
      </section>

      <section className="panel">
        <h2>Percorso foto</h2>
        {photoRootLoading ? (
          <Loading label="Caricamento configurazione…" />
        ) : (
          <form onSubmit={handleSavePhotoRoot} className="settings-form">
            <div className="field">
              <label htmlFor="photo-root">Percorso dell'archivio fotografico</label>
              <div className="inline-input-row">
                <input
                  id="photo-root"
                  type="text"
                  value={photoRootInput}
                  onChange={(e) => setPhotoRootInput(e.target.value)}
                  placeholder="es. /mnt/travelog/photos"
                />
                <button type="submit" disabled={savingPhotoRoot}>
                  {savingPhotoRoot ? "Salvataggio…" : "Salva percorso"}
                </button>
              </div>
              <p className="hint">
                Directory che contiene tutte le foto. Le cartelle da scansionare vengono indicate
                relative a questo percorso.
              </p>
            </div>
          </form>
        )}
        {photoRoot !== null && (
          <p className="hint">
            Valore corrente:{" "}
            <code className="mono">{photoRoot.photoRoot ?? "(non configurato)"}</code>
          </p>
        )}
        {photoRootMessage && <p className="alert alert-success">{photoRootMessage}</p>}
        {photoRootError && <ErrorAlert message={photoRootError} />}
      </section>

      <section className="panel">
        <h2>Inizio e Fine Viaggio</h2>
        <form onSubmit={handleSave} className="settings-form">
          <div className="field-row">
            <div className="field">
              <label htmlFor="min-photos">
                <strong>Inizio Viaggio</strong>
                <br />
                Giorni consecutivi con foto
              </label>
              <input
                id="min-photos"
                type="number"
                min={1}
                value={minimumConsecutiveDaysWithPhotos}
                onChange={(e) => setMinimumConsecutiveDaysWithPhotos(e.target.value)}
                required
              />
              <p className="hint">
                Numero minimo di giorni consecutivi con foto fuori dalle zone di esclusione per
                definire un viaggio (a prescindere dalla località). Un giorno isolato non è un
                viaggio.
              </p>
            </div>
            <div className="field">
              <label htmlFor="days-without-photos">
                <strong>Fine Viaggio</strong>
                <br />
                Giorni consecutivi senza foto
              </label>
              <input
                id="days-without-photos"
                type="number"
                min={0}
                value={consecutiveDaysWithoutPhotosBeforeClosing}
                onChange={(e) => setConsecutiveDaysWithoutPhotosBeforeClosing(e.target.value)}
                required
              />
              <p className="hint">
                Numero di giorni consecutivi senza foto dopo i quali un viaggio viene considerato
                concluso. Il viaggio si chiude all'ultimo giorno con foto.
              </p>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Salvataggio…" : "Salva impostazioni"}
            </button>
          </div>
        </form>
        {saveMessage && <p className="alert alert-success">{saveMessage}</p>}
        {saveError && <ErrorAlert message={saveError} />}
      </section>

      <ExclusionZonesPanel />

      <section className="panel">
        <h2>Database</h2>
        <p className="hint">
          Esporta, importa o cancella i dati del database. Il percorso foto configurato non viene
          modificato dalle operazioni di import/export.
        </p>

        <div className="database-cards">
          {/* Export Card */}
          <div className="database-card">
            <div className="database-card-header">
              <div className="database-card-icon database-card-icon--export">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div>
                <h3>Esporta Database</h3>
                <p className="database-card-subtitle">Scarica backup JSON</p>
              </div>
            </div>
            <p className="database-card-description">
              Esporta tutti i dati in un file JSON per backup o migrazione.
            </p>
            <button
              type="button"
              className="database-card-button database-card-button--export"
              onClick={handleExportDatabase}
              disabled={exporting}
            >
              {exporting ? "Esportazione…" : "Esporta"}
            </button>
          </div>

          {/* Import Card */}
          <div className="database-card">
            <div className="database-card-header">
              <div className="database-card-icon database-card-icon--import">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <h3>Importa Database</h3>
                <p className="database-card-subtitle">Ripristina da backup</p>
              </div>
            </div>
            <p className="database-card-description">
              Carica un file JSON di backup. Sovrascrive tutti i dati esistenti.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportDatabase}
              disabled={importing}
              style={{ display: "none" }}
              aria-label="Seleziona file di backup"
            />
            <button
              type="button"
              className="database-card-button database-card-button--import"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? "Importazione…" : "Importa"}
            </button>
          </div>

          {/* Delete Card */}
          <div className="database-card database-card--danger">
            <div className="database-card-header">
              <div className="database-card-icon database-card-icon--delete">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <div>
                <h3>Cancella Database</h3>
                <p className="database-card-subtitle">Svuota tutti i dati</p>
              </div>
            </div>
            <p className="database-card-description">
              Cancella tutti i dati: foto, scansioni, località, viaggi e impostazioni.
            </p>
            {!confirmingReset ? (
              <button
                type="button"
                className="database-card-button database-card-button--delete"
                onClick={() => setConfirmingReset(true)}
              >
                Cancella
              </button>
            ) : (
              <div className="confirm-box" role="alertdialog" aria-label="Conferma cancellazione">
                <p>
                  Sei sicuro? Tutti i dati catalogati verranno eliminati in modo irreversibile.
                </p>
                <div className="confirm-actions">
                  <button
                    type="button"
                    className="danger"
                    onClick={handleResetDatabase}
                    disabled={resetting}
                  >
                    {resetting ? "Cancellazione…" : "Sì, cancella tutto"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setConfirmingReset(false)}
                    disabled={resetting}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {exportError && <ErrorAlert message={exportError} />}
        {importMessage && <p className="alert alert-success">{importMessage}</p>}
        {importError && <ErrorAlert message={importError} />}
        {resetMessage && <p className="alert alert-success">{resetMessage}</p>}
        {resetError && <ErrorAlert message={resetError} />}
      </section>
    </div>
  );
}
