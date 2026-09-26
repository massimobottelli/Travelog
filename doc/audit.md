# Travelog — Audit e piano di correzione

**Data:** 2026-09-17
**Origine:** audit di sicurezza/performance/qualità su backend (Node/Express/TS) e frontend (React/Vite/TS)
**Fonti:** `doc/functional-requirements-mvp1.md`, `doc/technical-design-mvp1.md`, `openapi/openapi.yaml`, codice e test esistenti.
**Decisione architetturale confermata dal proprietario (2026-09-17):** reverse geocoding con Geoapify, PostgreSQL **senza** PostGIS, nessun dataset offline. Le vecchie indicazioni "geocoding locale/PostGIS" sono superate (chiarimento già annotato in `.clinerules`, `clinerules` e in `doc/functional-requirements-mvp1.md` §6.4).

---

## 0. Stato di partenza (già completato e verificato)

La correzione seguente è **già applicata** nel working tree e non va rifatta:

- ✅ **Atomicità foto/presenza (fatto).** `backend/src/repositories/photos.repository.ts` (`upsertPhoto` ora riceve il `PoolClient` transazionale, conflitto gestito con `ON CONFLICT`), `backend/src/services/scans.service.ts` (passaggio del client), test `backend/src/__tests__/photo-transaction.integration.test.ts` (2 test su PostgreSQL reale, con verifica negativa eseguita).
- Verifica effettuata: suite backend **201/201** su `travelog_test` ricreato da zero, type check OK, Prettier OK, nessuna modifica frontend nel diff.

All'inizio dell'audit `backend/tsconfig.tsbuildinfo` era tracciato; il pattern `.tsbuildinfo` non lo ignorava. Corretto in igiene I4 con `*.tsbuildinfo` e rimozione dal tracking, conservando il file locale.

---

## 1. Regole di esecuzione (valgono per tutti i task)

1. Un task alla volta; ogni task termina con suite verde e diff rivisto.
2. Database di test: `travelog_test` (PostgreSQL reale, no Docker, no PostGIS). Mai operare su `travelog_dev`. Prima delle suite: `dropdb --if-exists --force travelog_test && createdb travelog_test` + `npm --prefix backend run db:migrate` con `DATABASE_URL=postgresql://localhost:5432/travelog_test`.
3. Comandi: `npm --prefix backend test` (vitest run, `fileParallelism: false`), `npm --prefix frontend test`, `npm run build` (root), Prettier (`npm run lint` / `format`), `tsc` per type checking.
4. Nessuna nuova dipendenza (P4 usa solo `ajv`/`ajv-formats` già presenti). Nessun cambio di `openapi/openapi.yaml` salvo decisione esplicita (vedi D1).
5. Logging: solo pino (`backend/src/config/logger.ts`), eventi stile `scan.*`, `geoapify.*`; mai segreti.
6. Ogni task aggiorna i test pertinenti (unit per dominio, integrazione per SQL/API) e, se cambia il comportamento documentato, il design tecnico.
7. Fine task: `git diff --check`, type check, suite backend + frontend verdi, nessun file non correlato toccato.

---

## P1 — Confinamento filesystem della scansione `PRIORITÀ: ALTA (sicurezza)`

**Esito P1 — 2026-09-17.** Implementati guard lessicale e controllo realpath, validazione pre-lock, root del job fissata all'avvio e filtro symlink nell'enumerazione e prima dell'elaborazione. Aggiunti 10 test guard/filesystem e 2 test API su PostgreSQL reale, con spy call-through su ExifTool: il link esterno non viene letto; la foto interna viene registrata (esclusa per GPS assente nella fixture). Migrazioni applicate al database dedicato esistente `travelog_test`, senza ricrearlo. Suite backend 213/213 e frontend 153/153; type check, build di entrambe le applicazioni, Prettier sui file TypeScript P1 e diff check riusciti. Nessun cambio OpenAPI o schema DB. Limite: controllo e apertura ExifTool non sono atomici contro modifiche concorrenti del filesystem; vedi design §16.

**Problema originale (risolto).**

- `backend/src/services/scans.service.ts`: `targetDir = path.join(photoRoot, folder)` senza verifica di contenimento consentiva risoluzioni fuori root. Precisazione: `path.join` non scarta la root davanti a un secondo argomento assoluto; gli assoluti sono comunque vietati dal contratto (design §16 e §67 security boundaries).
- `backend/src/scans/photo-enumeration.ts`: i symlink a file vengono seguiti (`fs.stat`) senza verificare che la destinazione resti nella root.
- Una `folder` inesistente produce una scansione "completata" con 0 file (fuorviante): nessun errore esplicito.

**File coinvolti.** nuovo `backend/src/scans/path-guard.ts` (funzione pura `resolveInsideRoot(photoRoot, folder): string`); `backend/src/services/scans.service.ts`; `backend/src/scans/photo-enumeration.ts`; test unit `backend/src/scans/__tests__/path-guard.test.ts` e integrazione in `backend/src/__tests__/hardening.integration.test.ts`.

**Passi.**

1. Implementare `resolveInsideRoot` con `path.resolve` + `path.relative`; rifiuta percorsi assoluti, `..` che escapano e risoluzioni fuori dalla root. Errore: `ValidationError` con `fields: ["folder"]` (nessun cambio di contratto API).
2. Applicare il guard in `startScan`/`runScan` prima dell'enumerazione; verificare esistenza+directory di `targetDir` (`fs.stat`) → errore di validazione se manca.
3. In `traverseDirectory`: per i file symlink risolvere il realpath e verificarne il contenimento nella root realpath-izzata; symlink in fuga → skip con `logger.warn({ filePath }, "scan.symlink.skipped")`.
4. Test unit: `../..`, percorso assoluto, root con `..` interni, path normalizzati; integrazione: `folder: "../fuori"` → 400 e nessun file importato; symlink esterno → saltato, scansione prosegue; foto interna → importata regolarmente.

**Accettazione.** Nessuna lettura EXIF fuori dalla root (dimostrata da test su filesystem reale); messaggi senza interni di sistema; suite verde.

**Policy D2 applicata.** Su richiesta di eseguire P1: saltare i symlink che escono dalla root e non seguire le directory symlinkate. Validazione prima dell'acquisizione del lock. Resta il limite sulle modifiche concorrenti del filesystem documentato nell'esito e nel design §16.

---

## P2 — Lifecycle delle scansioni `PRIORITÀ: MEDIA-ALTA (affidabilità)`

**Esito P2 — 2026-09-17.** Completato: recupero delle scansioni atteso prima di `listen`, con log e prosecuzione dell'avvio se il recupero fallisce; pulizia di `cancelledScans` nel `finally` del job; handler process-level con log per `unhandledRejection` e log fatal seguito da uscita con codice 1 per `uncaughtException`. Aggiornati i test in `backend/src/index.test.ts` (ordine avvio, fallimento recupero, handler senza emettere errori globali nel runner) e aggiunto `backend/src/__tests__/scan-lifecycle.integration.test.ts` (recupero running/pending, preservazione completed, cancellazione ed errori di enumerazione/finalizzazione, pulizia flag e rilascio lock verificato da una sessione PostgreSQL distinta). Database dedicato `travelog_test` ricreato e migrato: integrazione lifecycle 4/4; suite completa backend 219/219, frontend 153/153. Type check e build backend/frontend riusciti; Prettier sui file TypeScript P2 e `git diff --check` OK. Nessuna modifica a OpenAPI, schema DB o agli altri task.

**Problema originale (risolto).**

- `backend/src/index.ts`: `failStaleRunningScans()` è fire-and-forget prima di `listen` → breve finestra in cui lo storico mostra `running` di un processo morto.
- `backend/src/services/scans.service.ts`: `this.cancelledScans.delete(scanId)` non è garantito se `runScan` esce durante l'enumerazione (flag di cancellazione residuo).
- Nessun handler per `unhandledRejection` / `uncaughtException`.

**File coinvolti.** `backend/src/index.ts`, `backend/src/services/scans.service.ts`; test in `backend/src/__tests__/hardening.integration.test.ts` (o nuovo file lifecycle).

**Passi.**

1. `index.ts`: `await failStaleRunningScans()` (con log dell'errore e proseguimento dell'avvio in caso di fallimento DB) **prima** di `app.listen`.
2. `scans.service.ts`: `try/finally` attorno all'intero `runScan` con `cancelledScans.delete(scanId)` nel `finally`.
3. `index.ts`: handler `unhandledRejection` (log strutturato) e `uncaughtException` (log + `process.exit(1)`; il riavvio è di systemd, design §57).
4. Test integrazione: inserita manualmente una riga scan `running`, il recupero all'avvio la marca `failed` con messaggio diagnostico; il flag di cancellazione non residua dopo una scansione annullata.

**Accettazione.** Nessuna richiesta servita prima del tentativo di recupero; nessun flag residuo; rifiuti non gestiti loggati in formato pino.

**Rischi.** Basso. Indipendente da P1 (si può eseguire in qualunque ordine dopo P1).

---

## P3 — Robustezza React `PRIORITÀ: MEDIA`

**Esito P3 — 2026-09-17.** Completato: caricamento del dettaglio protetto da flag `active` con cleanup su cambio `tripId`/unmount, per dettaglio, mappa, errore e fine caricamento; reset di dettaglio, mappa e modalità modifica al cambio viaggio. ErrorBoundary con key derivata dalla rotta, incluso l'ID del viaggio, per ripristinare la pagina alla navigazione. Nessun catch duplicato in `handleReplaceDays`: `TripDetailPanel` delega a `TripTimeline.persistDays`, che già intercetta il rifiuto e mostra l'errore inline mantenendo il dettaglio. Aggiunti 8 test per risposte tardive, loading, reset editing, salvataggio rifiutato e recupero del boundary cambiando pagina/ID; prova negativa con cleanup e key disabilitati: 6 regressioni falliscono, poi correzioni ripristinate. Verifica finale: PostgreSQL `travelog_test` ricreato e migrato, backend 219/219, frontend 161/161; type check e build di entrambe le applicazioni, Prettier sui quattro file TS/TSX P3 e `git diff --check` OK. Nessuna nuova dipendenza, modifica backend, OpenAPI o schema DB; P4 e igiene non avviati.

**Problema originale (risolto/verificato).**

- `frontend/src/pages/TripDetailPage.tsx`: il caricamento non scarta le risposte del precedente `tripId` (cambio rapido viaggio → possibile render di dati obsoleti); `handleReplaceDays` propaga un eventuale rifiuto senza gestione esplicita.
- `frontend/src/App.tsx`: l'ErrorBoundary resta in stato di errore anche quando l'utente cambia pagina.

**File coinvolti.** `frontend/src/pages/TripDetailPage.tsx`, `frontend/src/App.tsx`; test `frontend/src/pages/__tests__/trip-detail-page.test.tsx`, `frontend/src/App.test.tsx`.

**Passi.**

1. `TripDetailPage`: effetto con flag `active` + cleanup su `[tripId]`, applicato a dettaglio, mappa, errore e `loading`; `setEditing(false)` al cambio viaggio; try/catch esplicito attorno a `handleReplaceDays` se `TripDetailPanel` non gestisce già il rifiuto (verificare in implementazione).
2. `App.tsx`: key dell'ErrorBoundary derivata dalla rotta (es. `detail-${tripId}` per il dettaglio, altrimenti nome rotta) → il fallback si resetta alla navigazione, senza clic su "Riprova".
3. Nessuna libreria nuova (solo React state, come da regole progetto).

**Accettazione.** Nessun render con dati di un altro viaggio (test con promessa lenta + switch rapido); boundary resettato al cambio pagina; intera suite frontend verde.

**Rischi.** Basso; esclusivamente frontend.

---

## P4 — Validazione completa delle richieste (AJV) `PRIORITÀ: MEDIA — FASE SEPARATA`

**Esito P4 — 2026-09-17.** Completato secondo `doc/ajv-validation-plan.md` §3: `createOpenApiValidator()` compila a startup gli schemi di `openapi.yaml` con AJV 2020-12 + `ajv-formats` (un contratto mancante o non compilabile impedisce l'avvio); route e mapping operazione derivate dai `paths` (letterali prima dei template), eliminate `ROUTE_OPS`/`REQUIRED_BODY_FIELDS`; validati body, query e path di tutte le operazioni documentate con `400 VALIDATION_ERROR` e `details.errors` (path JSON `/query/page`, `/body/splitDate`, `/path/tripId`). Verifica preventiva §3.2: tutte le chiamate frontend rispettano gli schemi; `TripDaysModal` ora omette `localityIds` per i giorni senza località. Correzioni contrattuali autorizzate dall'utente: `DELETE /exclusion-zones/{id}` e `MergeTripsRequest.title` (`type: [string, "null"]`), tipi OpenAPI rigenerati. Test: 9 unitari su app Express minima + 4 di integrazione sull'app reale; regressione `page=abc` riprodotta (200) prima dell'implementazione e verificata a 400 dopo. Backend 229/229 su `travelog_test`, frontend 161/161; type check, build, Prettier e `git diff --check` OK. Nessuna nuova dipendenza (AJV era già presente).

**Problema originale (risolto/verificato).** `backend/src/middleware/openapi.ts` verifica solo la presenza di alcuni campi body: tipi, formati, enum e parametri query/path non sono validati. Analisi e criteri già presenti in `doc/ajv-validation-plan.md` (da seguire così com'è).

**Passi (secondo il piano esistente §3).**

1. Compilare gli schemi di `openapi/openapi.yaml` con `ajv` (dipendenza già presente, oggi quasi inutilizzata) a startup/lazy; gestire i `$ref` interni.
2. Derivare la mappa route→operationId dallo spec; eliminare `ROUTE_OPS` e `REQUIRED_BODY_FIELDS`.
3. Errori `400 VALIDATION_ERROR` con path JSON in `details.errors`; nessun cambio a `openapi.yaml`.
4. Verifica preventiva (§3.2): ogni chiamata in `frontend/src/api/*.ts` deve passare la nuova validazione prima di abilitarla; allineare eventuali test con payload parziali.
5. Aggiornare `doc/technical-design-mvp1.md` (sezione validazione).

**Test.** Unit middleware + integrazione con payload oggi accettati ma invalidi (`page=abc`, `tripIds` non-array, `splitDate` malformato); checklist §4 del piano AJV come criteri di accettazione.

**Accettazione.** Tutti i criteri di `ajv-validation-plan.md` §4; suite backend e frontend verdi.

**Nota.** È l'intervento più esteso: da eseguire come fase dedicata, dopo P1–P3. **D3 (decisione): risolta** — eseguito in questa serie su richiesta esplicita dell'utente ("implementa P4").

---

## Igiene (opzionale, interventi piccoli)

**Esito I1–I5 — 2026-09-17.** Completati con conferma esplicita dell'utente per D1, D4 e D5. Rimosso il codice morto I1; warning ExifTool/Geoapify convertiti al logger Pino condiviso (senza URL, chiave API o errore grezzo Geoapify); eliminato `openapi/openapi.yaml.fixed`; artefatto `backend/tsconfig.tsbuildinfo` rimosso dal tracking e conservato localmente, con pattern corretto `*.tsbuildinfo`. I codici 404 sono ora `TRIP_NOT_FOUND`, `SCAN_NOT_FOUND`, `LOCALITY_NOT_FOUND`, `EXCLUSION_ZONE_NOT_FOUND`, tramite mapping tipizzato senza `as any`; messaggi e status HTTP invariati. Contratto documentato e tipi rigenerati. Aggiunti 5 test unitari errori, 3 logging e 3 integrazioni API; aggiornata l'asserzione dello scan. Verifica negativa: i quattro mapping fallivano prima della correzione. `travelog_test` ricreato e migrato; suite complete backend **240/240**, frontend **161/161**, build e type check backend/frontend riusciti. Nessuna nuova dipendenza o modifica dello schema DB. La modifica preesistente a `README.md` resta estranea al task.

**Interventi originali (completati; D1/D4/D5 risolte con conferma esplicita):**

- **I1 — Codice morto.** Rimuovere `EnumerationResult` (`backend/src/scans/photo-enumeration.ts`, nessun riferimento), `httpError`/`InternalError` (`backend/src/models/errors.ts`, inutilizzati), `createTestDb` (`backend/src/db/client.ts`, nessun riferimento).
- **I2 — Logging.** Sostituire i `console.warn` in `backend/src/scans/exiftool.ts` (timeout) e `backend/src/infrastructure/geocoder/geoapify-reverse-geocoder.ts` (HTTP error, request failed) con il logger pino condiviso (eventi: `exiftool.timeout`, `geoapify.http_error`, `geoapify.request_failed`).
- **I3 — File non referenziato.** `openapi/openapi.yaml.fixed` non è referenziato da codice/script/config: candidato all'eliminazione. **D4 (decisione):** confermare la cancellazione.
- **I4 — Artefatto di build tracciato.** `backend/tsconfig.tsbuildinfo` è tracciato in Git pur essendo in `.gitignore`: `git rm --cached backend/tsconfig.tsbuildinfo`. **D5 (decisione):** confermare.
- **I5 — Codici errore 404 (contrattuale).** Oggi `NotFoundError` produce codici minuscoli derivati (es. `trip_not_found`, con cast `as any` in `backend/src/models/errors.ts`), mentre l'esempio in `openapi.yaml` mostra `TRIP_NOT_FOUND`. Canonicalizzare = allineare spec + un test di integrazione (`api.integration.test.ts:221`). **È un cambio di contratto → D1 (decisione), richiede conferma esplicita.**

---

## Esecuzione

Ordine proposto: **P1 → P2 → P3** (modifiche contenute e indipendenti) → igiene I1–I2 → P4 (fase separata). Le decisioni D1–D5 si confermano al momento dell'avvio del task corrispondente.

Protocollo per ogni task:

1. leggere i file indicati e i requisiti a riferimento;
2. implementare i passi nell'ordine;
3. aggiungere/aggiornare i test elencati;
4. eseguire suite backend (PostgreSQL reale) + frontend + build + type check + Prettier + `git diff --check`;
5. rivedere il diff (nessuna modifica non correlata) e aggiornare la documentazione se il comportamento cambia;
6. segnare il task come completato in questo documento (data + esito verifiche).

---

## Registro avanzamento

| Task                                      | Stato                    | Note                                                                                                                                        |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomicità foto/presenza                   | ✅ Completato            | 201/201 test backend, verificato su `travelog_test` ricreato                                                                                |
| Chiarimento Geoapify/PostGIS su documenti | ✅ Completato            | `.clinerules`, `clinerules`, `doc/functional-requirements-mvp1.md` §6.4                                                                     |
| P1 Confinamento filesystem                | ✅ Completato 2026-09-17 | Policy D2 applicata su richiesta di eseguire P1; backend 213/213, frontend 153/153; type check e build OK                                   |
| P2 Lifecycle scansioni                    | ✅ Completato 2026-09-17 | PostgreSQL test ricreato e migrato; backend 219/219, frontend 153/153; type check, build e verifiche diff OK                                |
| P3 Robustezza React                       | ✅ Completato 2026-09-17 | Backend 219/219, frontend 161/161; regressioni verificate anche in negativo; type check, build, Prettier e diff check OK                    |
| P4 Validazione AJV                        | ✅ Completato 2026-09-17 | Backend 229/229, frontend 161/161; 13 test di validazione; correzioni contrattuali autorizzate; type check, build, Prettier e diff check OK |
| Igiene I1–I5                              | ✅ Completato 2026-09-17 | D1/D4/D5 confermate; PostgreSQL test ricreato e migrato; backend 240/240, frontend 161/161; build e type check OK                           |
| Audit 2026-09-26 (residui + perf/security) | ✅ Completato 2026-09-26 | D1 (cache geocoding per hash normalizzato) e D2 (cap import → 400) confermate dal proprietario; backend 306/306, frontend 174/174; build, type check e Prettier OK |

---

## Audit 2026-09-26 — residui e ottimizzazioni

Secondo audit su backend/frontend, su base verde del 17/09 (backend 300/300, frontend 171/172 con un test stantio pre-esistente). Decisioni confermate dal proprietario: **D1** = lookup geocoding per hash normalizzato; **D2** = cap dimensione su `/data/import` con risposta `400` (già nel contratto OpenAPI, nessun cambio di `openapi/openapi.yaml`).

Correzioni applicate (un task alla volta, suite verdi):

1. **Test stantio (frontend).** `frontend/src/App.test.tsx`: il redesign della UI aveva rinominato il bottone "Cancella database" → "Cancella"; il test è stato riallineato mantenendo identiche le asserzioni comportamentali (conferma esplicita con `alertdialog` + "Sì, cancella tutto" + "Annulla").
2. **Sicurezza (backend).** `POST /data/import`: body raw senza limite → memory-DoS. Aggiunto `backend/src/utils/request-body.ts` (`readBodyWithLimit`, cap 256 MB, risposta `400 VALIDATION_ERROR`) + unit test dedicati. Nessun cambio di contratto.
3. **Bug/qualità (backend).** Rimosso `BANK_NOT_FOUND` (residuo di template "bank") dall'unione `ErrorCode`; `ConflictError` ora richiede il `code` esplicito (nessun default errato). Tutti i 12 caller passavano già il codice.
4. **Bug async (backend).** `GeocodingService` costruisce ora il geocoder in modo sincrono (import statico): eliminata la finestra di startup in cui `this.geocoder` era `null` e le prime foto venivano saltate silenziosamente.
5. **Performance (backend, D1).** `reverseGeocode` risolve prima la località per hash normalizzato (`getLocalityByHash`) e chiama Geoapify solo in caso di miss: una sola chiamata serve molte foto vicine (~1 km). Eventi `geocoding.cache.hit/miss` (regola §31). Test d'integrazione aggiunto in `geocoding.integration.test.ts`.
6. **Bug async (frontend).** `TripsPage`: guard anti-stale (`reloadSeq`/`detailSeq`) contro risposte out-of-order + debounce (300 ms) della ricerca server. Test `frontend/src/pages/__tests__/trips-page.test.tsx` (debounce + risposta stantia ignorata).
7. **Igiene.** `ScansService.startScan` riusa `scansRepository.createScan` (rimossa la duplicazione inline + import `db`/`scans` non più usati); `db/client.ts` shutdown idempotente con `pool.end()` atteso; `render.yaml` ripulito da `cp backend/src/openapi.json` (file inesistente, mascherato da `|| true`) e dalle env var mai lette `FRONTEND_URL`/`STATIC_FILES_PATH`.

Verifiche: backend **306/306** (PostgreSQL reale `travelog_test` ricreato e migrato), frontend **174/174**, `tsc` backend e frontend puliti, build di produzione OK, Prettier pulito sui file toccati, `git diff --check` pulito, nessuna modifica non correlata.
