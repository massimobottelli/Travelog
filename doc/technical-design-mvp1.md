# Technical Design — MVP1

**Progetto:** Travelog
**Versione:** MVP1
**Data:** 28 agosto 2026
**Stato:** Design tecnico consolidato

---

## 1. Scopo del documento

Questo documento definisce lo stack tecnologico e le principali decisioni architetturali necessarie per implementare Travelog MVP1.

Il documento è subordinato a:

* `doc/functional-requirements-mvp1.md`

I requisiti funzionali costituiscono la **source of truth funzionale**. Questo documento non modifica, interpreta diversamente o sostituisce i requisiti.

Il design tecnico definisce invece:

* tecnologie;
* architettura applicativa;
* organizzazione del codice;
* persistenza;
* API;
* pipeline di scansione;
* reverse geocoding;
* frontend;
* testing;
* deployment;
* principi operativi.

---

# 2. Principi architetturali

L'implementazione MVP1 segue questi principi:

1. **Semplicità prima della scalabilità prematura.**
2. **Frontend e backend separati.**
3. **API REST con contratto OpenAPI.**
4. **OpenAPI contract-first.**
5. **PostgreSQL come source of truth persistente.**
6. **Geoapify Reverse Geocoding API per il geocoding delle foto.**
7. **Il NAS rimane read-only per Travelog.**
8. **La scansione è incrementale, idempotente e riprendibile.**
9. **Una fotografia viene elaborata indipendentemente dalle altre.**
10. **I dati fotografici originali rilevanti vengono conservati.**
11. **I dati derivati non devono modificare automaticamente i viaggi già consolidati.**
12. **Nessuna dipendenza infrastrutturale non necessaria.**
13. **Niente Docker in MVP1.**
14. **Niente autenticazione applicativa in MVP1.**
15. **L'architettura deve essere facilmente comprensibile e modificabile da un AI coding agent.**

---

# 3. Stack tecnologico

## 3.1 Frontend

| Componente           | Tecnologia                              |
| -------------------- | --------------------------------------- |
| UI framework         | React                                   |
| Linguaggio           | TypeScript                              |
| Build tool           | Vite                                    |
| CSS framework        | **Tailwind CSS v4** (`@tailwindcss/vite`) |
| HTTP                 | Fetch API                               |
| API client           | Layer applicativo interno sopra `fetch` |
| API types            | Generati da OpenAPI                     |
| State management     | React state                             |
| Server-state library | Nessuna                                 |
| Test                 | Vitest                                  |

Non vengono introdotti in MVP1:

* Redux;
* Zustand;
* TanStack Query;
* altri global state manager;
* framework frontend full-stack.

**Tailwind CSS v4** è stato introdotto su richiesta esplicita dell'utente
(plugin Vite `@tailwindcss/vite`, utility classes; l'animazione indeterminata
della progress bar resta in CSS custom). Il CSS pre-esistente in
`index.css` è stato mantenuto per i componenti già realizzati; i componenti
nuovi o rivisitati usano le utility Tailwind.

### Motivazione

L'applicazione MVP1 ha una UI relativamente semplice e principalmente orientata alla consultazione e modifica di dati provenienti dall'API.

L'uso diretto di `fetch`, incapsulato in un API client interno, mantiene il numero di astrazioni ridotto.

---

## 3.2 Backend

| Componente            | Tecnologia                          |
| --------------------- | ----------------------------------- |
| Runtime               | Node.js                             |
| Linguaggio            | TypeScript                          |
| HTTP framework        | Express                             |
| API style             | REST                                |
| API contract          | OpenAPI                             |
| Validation            | OpenAPI / JSON Schema               |
| ORM / query layer     | Drizzle                             |
| Background processing | processo Node.js principale         |
| Logging               | structured logging su stdout/stderr |

Express viene utilizzato come framework HTTP minimale.

La struttura applicativa non deve essere determinata dalle convenzioni del framework: **la struttura del codice viene definita esplicitamente dal progetto**.

---

## 3.3 Database

| Componente            | Tecnologia                  |
| --------------------- | --------------------------- |
| Database              | PostgreSQL                  |
| Data access           | Drizzle                     |
| Schema migrations     | Drizzle migrations          |
| Test database         | PostgreSQL dedicato         |

PostgreSQL è la source of truth per:

* fotografie indicizzate;
* metadata;
* coordinate GPS originali;
* dati geografici (località);
* cache del reverse geocoding;
* scansioni;
* errori delle scansioni;
* presenze giorno/località;
* viaggi;
* configurazione;
* storico delle modifiche ai viaggi.

> **Nota:** PostGIS non è più utilizzato nell'MVP1. Il reverse geocoding avviene tramite API esterna (Geoapify) anziché tramite query spaziali su poligoni locali.

---

## 3.4 Geographic data — Reverse geocoding via external API

Travelog non importa dataset geografici offline e non mantiene poligoni territoriali nel database.

Il reverse geocoding è esternalizzato a **Geoapify Reverse Geocoding API** (https://apidocs.geoapify.com/docs/geocode/reverse).

Durante ogni scansione, per le foto con coordinate GPS valide:

1. Le coordinate vengono normalizzate (2 decimali ≈ 1km).
2. Si controlla la cache locale `geocoding_cache`.
3. Se la cache è miss, si chiama Geoapify che restituisce i dati amministrativi (città, provincia, regione, stato, paese).
4. Il risultato viene salvato in `localities` + `geocoding_cache`.

L'API è configurata tramite l'environment variable `GEOAPIFY_API_KEY`.
Se non configurata, il geocoding viene saltato ma la scansione prosegue (le foto vengono comunque salvate, solo senza informazioni geografiche).

### Provider alternativi

L'interfaccia `ReverseGeocoder` (`backend/src/domain/reverse-geocoder.ts`) astrae il provider esterno.
In futuro può essere sostituita senza modifiche ai caller con:

* `NominatimReverseGeocoder` (OpenStreetMap)
* `GoogleReverseGeocoder`
* `PostgisReverseGeocoder` (ripristino di un approccio locale basato su OSM boundaries)

Il costo corrente del piano gratuito Geoapify:
- **3.000 richieste/giorno**, nessuna carta di credito richiesta.
- Per una libreria tipica di ~500 foto → ~30 chiamate API grazie alla deduplicazione per hash delle coordinate.

---

## 3.5 Sistema operativo e deployment

Il target è:

* Debian Linux;
* server self-hosted;
* accesso tramite browser nella rete locale.

Componenti:

* Nginx;
* Node.js;
* Express;
* PostgreSQL/PostGIS;
* systemd;
* journald.

Docker non viene utilizzato in MVP1.

---

# 4. Architettura generale

L'architettura è composta da frontend e backend separati.

```text
                         Browser
                            |
                            | HTTP
                            v
                         Nginx
                       /       \
                      /         \
                     v           v
              React static      /api/*
                               |
                               v
                         Express / Node.js
                               |
                +--------------+--------------+
                |              |              |
                v              v              v
             Services      Repositories    Scan Job
                |              |              |
                +--------------+              |
                       |                      |
                       v                      v
                 PostgreSQL              NAS filesystem
                   + PostGIS                    |
                       ^                        |
                       |                        |
                       +---- ExifTool <---------+
```

Il browser non accede direttamente al database, al NAS o a ExifTool.

---

# 5. Separazione delle responsabilità

## 5.1 Frontend

Responsabile di:

* rendering della UI;
* navigazione;
* gestione dello stato locale della UI;
* chiamate all'API;
* visualizzazione degli errori;
* polling dello stato delle scansioni;
* input delle modifiche manuali ai viaggi;
* gestione delle impostazioni.

Il frontend non implementa logica di dominio.

---

## 5.2 Backend

Responsabile di:

* API REST;
* validazione delle richieste;
* business logic;
* scansione del filesystem;
* estrazione EXIF;
* reverse geocoding;
* persistenza;
* generazione delle aggregazioni;
* generazione dei viaggi;
* gestione delle modifiche manuali;
* applicazione delle regole di consistenza.

---

## 5.3 Database

Responsabile della persistenza dei dati.

Le regole di dominio non devono essere duplicate inutilmente in SQL e TypeScript.

Le query spaziali sono responsabilità di PostGIS.

---

# 6. Struttura del repository

La struttura iniziale proposta è:

```text
travelog/
├── doc/
│   ├── functional-requirements-mvp1.md
│   └── technical-design-mvp1.md
│
├── backend/
│   ├── src/
│   │   ├── api/
│   │   ├── domain/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── infrastructure/
│   │   ├── scans/
│   │   ├── geocoding/
│   │   ├── config/
│   │   ├── errors/
│   │   └── app.ts
│   │
│   ├── test/
│   │   ├── unit/
│   │   └── integration/
│   │
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── state/
│   │   └── main.tsx
│   │
│   └── package.json
│
├── openapi/
│   └── openapi.yaml
│
├── database/
│   ├── migrations/
│   └── seeds/
│
└── scripts/
    └── ...
```

La struttura può essere raffinata durante l'implementazione, ma le responsabilità principali devono rimanere separate.

---

# 7. Backend architecture

Il backend utilizza una struttura esplicita a livelli.

```text
HTTP / API
    |
    v
Controllers
    |
    v
Application / Domain Services
    |
    v
Repositories
    |
    v
PostgreSQL / PostGIS
```

## 7.1 Controllers

I controller:

* ricevono la request;
* ricevono dati già validati;
* chiamano i service;
* costruiscono la response;
* non contengono logica di dominio complessa.

---

## 7.2 Services

I service implementano le operazioni applicative.

Esempi:

```text
ScanService
TripService
TripMergeService
TripSplitService
TripCalculationService
GeocodingService
SettingsService
```

La logica di dominio deve essere collocata nei service/domain module appropriati e non nei controller.

---

## 7.3 Repositories

I repository incapsulano l'accesso al database.

Esempi:

```text
PhotoRepository
ScanRepository
TripRepository
LocationRepository
GeocodingCacheRepository
AdministrativeAreaRepository
SettingsRepository
```

I repository utilizzano Drizzle.

---

# 8. Configurazione

La configurazione infrastrutturale viene fornita tramite **environment variables**.

Esempi:

```text
TRAVELOG_PHOTO_ROOT=/mnt/travelog/photos
DATABASE_URL=postgresql://...
```

Non viene introdotto un file di configurazione applicativo obbligatorio.

Le impostazioni funzionali modificabili dall'utente appartengono invece al database.

## 8.1 Distinzione

```text
Environment variables
    |
    +-- photo root
    +-- database connection
    +-- deployment configuration


Database
    |
    +-- foto minime per visita
    +-- giorni senza foto
    +-- zone di esclusione
    +-- altre impostazioni funzionali
```

### Environment configuration

Environment variables are limited to deployment and runtime configuration.
Functional application settings are not configured through environment
variables; they are persisted in the database and managed through the
application.

The application uses a **single `.env` file at the repository root**, loaded
with a module-relative path (independent of the process working directory).
There is no per-package `.env`.

The MVP1 environment configuration is:

| Variable              | Purpose                                                  | Example                                                  |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string                             | `postgresql://travelog:password@localhost:5432/travelog` |
| `DATABASE_POOL_MAX`   | Maximum PostgreSQL connection pool size                  | `10`                                                     |
| `HOST`                | HTTP server bind address                                 | `0.0.0.0`                                                |
| `PORT`                | HTTP server port                                         | `3000`                                                   |
| `API_PREFIX`          | REST API path prefix                                     | `/api`                                                   |
| `CORS_ORIGIN`         | Allowed frontend origin                                  | `http://localhost:5173`                                  |
| `NODE_ENV`            | Node.js runtime environment                              | `development`                                            |
| `LOG_LEVEL`           | Application log level                                    | `info`                                                   |
| `EXIFTOOL_PATH`       | Path/name of the `exiftool` executable                   | `exiftool`                                               |
| `GEOAPIFY_API_KEY`  | Geoapify reverse-geocoding API key (optional)            | `your-api-key` (empty = geocoding skipped, scan continues) |
| `DEFAULT_MIN_CONSECUTIVE_DAYS_WITH_PHOTOS` | Default for the "Giorni consecutivi con foto" setting | `2` |
| `DEFAULT_DAYS_WITHOUT_PHOTOS_THRESHOLD`    | Default for the "Giorni consecutivi senza foto" setting | `3` |

The `.env` file carries the visible default values for every variable; the
code keeps the same values as hardcoded fallbacks. **`TRAVELOG_PHOTO_ROOT`
has been removed from the environment**: the photo root is a functional
setting stored in the PostgreSQL `settings` table (migration 0012) and is
configured from the Settings page like the other thresholds.

The canonical example configuration is stored in `.env.example` at the
repository root.

### Configuration summary — env vs database (authoritative)

Deployment/runtime configuration lives in the environment (`.env` file at
the repository root); functional settings live in the PostgreSQL `settings`
singleton table (`id=1`) and are editable from the Settings page.

**Environment variables** (`.env`, restart or live-update for photo root):

| Variable              | Default (if unset)  | Purpose                                  |
| --------------------- | ------------------- | ---------------------------------------- |
| `DATABASE_URL`        | — (required)        | PostgreSQL connection string             |
| `DATABASE_POOL_MAX`   | `10`                | Connection pool size                     |
| `TRAVELOG_PHOTO_ROOT` | empty (set via UI)  | Photo archive root, persisted in `.env`  |
| `HOST`                | `0.0.0.0`           | HTTP bind address                        |
| `PORT`                | `3000`              | HTTP port                                |
| `API_PREFIX`          | `/api`              | REST API path prefix                     |
| `CORS_ORIGIN`         | `http://localhost:5173` | Allowed frontend origin              |
| `NODE_ENV`            | `development`       | Runtime environment                      |
| `LOG_LEVEL`           | `info`              | Log level                                |
| `EXIFTOOL_PATH`       | `exiftool`          | ExifTool executable path                 |
| `GEOAPIFY_API_KEY`  | empty (geocoding skipped) | Geoapify API key                   |

**Database settings** (table `settings`, single row `id=1`, Settings page →
"Salva impostazioni"; they affect only the generation of NEW trips):

| Column                                       | UI label                              | Default (env) | Editable via     |
| -------------------------------------------- | ------------------------------------- | ------- | ---------------- |
| `min_consecutive_days_with_photos`           | Giorni consecutivi con foto           | `DEFAULT_MIN_CONSECUTIVE_DAYS_WITH_PHOTOS` (`2`) | `PUT /settings`  |
| `days_without_photos_threshold`              | Giorni consecutivi senza foto prima della chiusura | `DEFAULT_DAYS_WITHOUT_PHOTOS_THRESHOLD` (`3`) | `PUT /settings` |
| `photo_root`                                 | Percorso foto                         | empty   | `PUT /config`    |

The `DEFAULT_*` environment variables seed the settings row when it is
first created; the values saved by the user from the Settings page are
stored in the database and always take precedence over the defaults.

Exclusion zones (`exclusion_zones`) are functional configuration too and
live in PostgreSQL, managed from the Settings page (§49).

### Photo root configuration (DB-backed, updated)

In MVP1 the photo root is **user-configurable at runtime** and stored in the
`settings` table (migration 0012) — no longer in the `.env` file:

* `GET /api/config` returns the current value (null when unset).
* `PUT /api/config` validates the path (absolute, existing directory) and
  persists it in `settings.photo_root`; the change applies immediately —
  every scan start reads the value from the database, no restart required.

* The Scans page shows the currently configured root; starting a scan
  without a configured root fails fast with a validation error.

This is a deliberate deviation from the original "environment-only"
deployment configuration: the app is single-user and trusted (network-local),
so the photo root boundary is chosen by the operator through the UI. All
functional settings (thresholds, photo root, exclusion zones) live in
PostgreSQL.

---

# 9. API REST

## 9.1 OpenAPI contract-first

La specifica OpenAPI è la **source of truth ufficiale dell'API**.

File:

```text
openapi/openapi.yaml
```

Ogni modifica al contratto API deve partire dalla specifica OpenAPI.

Workflow:

```text
1. Modifica OpenAPI
2. Generazione tipi TypeScript
3. Implementazione backend
4. Aggiornamento frontend
5. Test
```

Non devono essere mantenuti manualmente DTO duplicati nel frontend.

---

## 9.2 API versioning

MVP1 utilizza una singola versione dell'API.

Il versionamento potrà essere introdotto quando emergerà una reale necessità di compatibilità tra versioni.

---

## 9.3 API client frontend

Il frontend utilizza un API client interno.

Struttura:

```text
frontend/src/api/

client.ts
scansions.ts
trips.ts
settings.ts
...
```

`client.ts` gestisce gli aspetti tecnici comuni:

* `fetch`;
* serializzazione JSON;
* headers;
* gestione HTTP status;
* parsing delle response;
* conversione degli errori API.

I moduli specifici espongono funzioni semantiche.

Esempio:

```text
startScan()
getScan(id)
getTrips()
getTrip(id)
updateTrip(id, data)
```

I componenti React non devono contenere chiamate `fetch` arbitrarie.

---

# 10. API validation

La validazione è basata direttamente sulla specifica OpenAPI / JSON Schema.

Non viene introdotto un secondo sistema di definizione degli schemi applicativi come Zod.

Il contratto definisce:

* request parameters;
* request body;
* response body;
* error response;
* tipi dei dati.

La validazione viene applicata lato backend prima dell'esecuzione della logica applicativa.

Dall'audit P4 (2026-09-17) la validazione è completa e derivata dal contratto:

* `backend/src/middleware/openapi.ts` compila, all'avvio dell'applicazione, gli
  schemi di `openapi.yaml` con AJV (draft 2020-12, `ajv-formats`); un contratto
  mancante o non compilabile impedisce l'avvio e non disattiva la validazione.
* Le route e la corrispondenza con le operazioni sono derivate dai `paths`
  dello spec (route letterali prima dei template con parametri); le tabelle
  manuali `ROUTE_OPS` e `REQUIRED_BODY_FIELDS` sono state eliminate.
* Sono validati il body JSON (`application/json`) e i parametri query e path di
  ogni operazione documentata. I parametri accettano la conversione numerica
  tipica delle query string; i body non vengono modificati né completati con
  valori predefiniti.
* Gli errori rispondono `400 VALIDATION_ERROR` con in `details.errors` i path
  JSON (es. `/query/page`, `/body/splitDate`, `/path/tripId`) e i messaggi AJV.
* Le richieste con proprietà extra sono rifiutate dove lo spec dichiara
  `additionalProperties: false`; lo spec non è stato allargato in questa fase.
* Verifica preventiva del piano AJV (§3.2): tutte le chiamate di
  `frontend/src/api/*.ts` rispettano gli schemi; la creazione manuale dei
  viaggi ora omette `localityIds` per i giorni senza località.
* Correzioni contrattuali puntuali autorizzate in questa fase:
  `DELETE /exclusion-zones/{id}` (l'`id` era già un parametro di percorso nel
  backend e nel frontend) e `MergeTripsRequest.title` con
  `type: [string, "null"]`; tipi OpenAPI rigenerati di conseguenza.

---

# 11. API error handling

Tutte le API utilizzano un formato uniforme di errore definito in OpenAPI.

Formato concettuale:

```json
{
  "code": "TRIP_NOT_FOUND",
  "message": "Trip not found",
  "details": {}
}
```

`code` è stabile e destinato anche al consumo programmatico del frontend.

Dall'audit igiene I5 (2026-09-17), con cambio contrattuale autorizzato,
`NotFoundError` usa un mapping tipizzato: `TRIP_NOT_FOUND`, `SCAN_NOT_FOUND`,
`LOCALITY_NOT_FOUND` e `EXCLUSION_ZONE_NOT_FOUND`. Questi codici maiuscoli
sostituiscono quelli minuscoli derivati dal nome dell'entità; status 404 e
messaggi restano invariati.

`message` è informativo.

`details` è opzionale.

Gli errori interni non devono esporre:

* stack trace;
* query SQL;
* percorsi interni;
* dettagli infrastrutturali;
* informazioni sensibili.

---

# 12. Database architecture

PostgreSQL è progettato secondo il dominio di Travelog.

Il modello non deve essere derivato dalla struttura delle schermate frontend.

Le entità principali previste sono concettualmente:

```text
photos
scans
scan_errors
localities                         ← sostituisce administrative_areas
geocoding_cache
presences
trips
trip_history / trip_operations
settings
exclusion_zones
```

Il nome e la normalizzazione definitiva delle tabelle saranno definiti nello schema Drizzle.

---

# 13. Dati originali e dati derivati

Il modello distingue logicamente tra dati importati/originali e dati derivati.

## Dati fotografici

Esempi:

* path;
* filename;
* file type;
* DateTimeOriginal;
* latitude;
* longitude;
* stato metadata;
* motivo di esclusione.

## Dati derivati

Esempi:

* località amministrativa;
* gerarchia amministrativa;
* presenza giorno/località;
* appartenenza alle zone di esclusione;
* dati utilizzati per la generazione dei viaggi.

I dati fotografici originali rilevanti non devono essere persi quando vengono generati dati derivati.

---

# 14. Migrations

Lo schema PostgreSQL viene evoluto tramite **Drizzle migrations versionate nel repository**.

Esempio:

```text
database/migrations/
    0001_initial.sql
    0002_add_trip_history.sql
    0003_add_geocoding_cache.sql
```

Le migration sono il meccanismo ufficiale per modificare lo schema.

`drizzle-kit push` non è il meccanismo ufficiale di deployment.

Ogni modifica strutturale deve produrre una migration versionata.

---

# 15. Accesso al NAS

Travelog non gestisce il protocollo di accesso al NAS.

Il server Debian deve avere una directory montata che punta al NAS.

Esempio:

```text
NAS
 |
 | SMB / NFS
 v
Debian
 |
 +-- /mnt/travelog/photos
```

La scelta SMB/NFS è fuori dal perimetro applicativo.

Travelog vede esclusivamente il filesystem locale.

---

# 16. Photo root

La directory radice configurata viene fornita tramite:

```text
TRAVELOG_PHOTO_ROOT
```

Il backend deve impedire che le operazioni di scansione escano dalla directory configurata.

Confinamento della scansione (audit P1, 2026-09-17):

* `folder` deve essere relativo: percorsi assoluti, risoluzioni fuori root,
  cartelle inesistenti o non-directory sono rifiutati con `400 VALIDATION_ERROR`
  prima del lock e della creazione della scansione, senza esporre percorsi interni.
* La root validata all'avvio rimane il confine del job anche se cambia la configurazione.
* I link a file sono ammessi solo se il realpath resta nella root configurata;
  i link esterni vengono saltati con evento strutturato `scan.symlink.skipped`.
* Non si attraversano directory symlinkate, nemmeno nei componenti di `folder`.
  La root configurata dall'operatore può essere essa stessa un alias.
* I percorsi originali restano nell'identità dei file; il realpath serve alla
  verifica del contenimento, ripetuta prima dell'elaborazione delle foto.

Questi controlli presuppongono la struttura NAS stabile prevista dai requisiti:
non costituiscono una garanzia atomica contro sostituzioni concorrenti dei file
tra controllo del percorso e apertura da parte del processo ExifTool.

La scansione opera esclusivamente in modalità read-only.

Travelog:

* non modifica file;
* non rinomina file;
* non sposta file;
* non cancella file.

---

# 17. Identificazione delle fotografie

MVP1 utilizza come identificazione tecnica del file:

```text
relative path + file size + modification time
```

Il path è relativo a `TRAVELOG_PHOTO_ROOT`.

Esempio:

```text
2025/Italy/IMG_1234.JPG
```

insieme a:

```text
size
mtime
```

costituisce la fingerprint utilizzata per riconoscere un file già osservato.

Non viene calcolato un hash del contenuto durante la normale scansione MVP1.

Non viene implementato un meccanismo per riconoscere automaticamente un file dopo rename/spostamento.

La scelta è coerente con il requisito che considera stabile la struttura del NAS.

### Scan processing model

The MVP1 scanner processes photos sequentially, one photo at a time.

Scan concurrency is not configurable.

This choice keeps the scanner implementation simple and predictable while
supporting the required properties:

* idempotent processing;
* restartability;
* isolation of individual file errors;
* prevention of concurrent scans.

No `SCAN_BATCH_SIZE` or `SCAN_CONCURRENCY` environment variables are
defined for MVP1.

---

# 18. Formati fotografici

MVP1 supporta:

```text
.jpg
.jpeg
.heic
.heif
```

Gli altri formati vengono ignorati.

Il confronto delle estensioni deve essere case-insensitive.

---

# 19. Estrazione metadata

I metadata fotografici vengono estratti utilizzando **ExifTool** come processo esterno.

Pipeline:

```text
Scanner
   |
   v
ExifTool
   |
   v
EXIF metadata
   |
   v
normalization
   |
   v
domain validation
```

Travelog non implementa direttamente un parser EXIF.

---

# 20. Metadata minimi

Una fotografia è utilizzabile per le elaborazioni geografiche quando dispone almeno di:

* identificativo;
* path;
* filename;
* tipo/formato;
* `DateTimeOriginal`;
* latitudine;
* longitudine.

L'altitudine GPS viene ignorata in MVP1.

---

# 21. Timestamp

La data/ora utilizzata è esclusivamente:

```text
EXIF DateTimeOriginal
```

Il timestamp filesystem non viene utilizzato come fallback.

Non viene applicata conversione timezone.

Il valore viene trattato come **naive local time**.

Esempio:

```text
2025-08-15 23:30:00
```

rimane:

```text
2025-08-15 23:30:00
```

indipendentemente dal timezone del server.

Il cambio di giornata avviene a mezzanotte del local time della fotografia.

---

# 22. Foto con EXIF incompleti

Una foto priva di metadata minimi non partecipa alle elaborazioni geografiche.

Esempi:

* `DateTimeOriginal` assente;
* GPS assente;
* EXIF illeggibili;
* EXIF non validi.

La fotografia viene comunque registrata nel database con:

* stato di esclusione;
* motivo dell'esclusione.

Questo impedisce che venga considerata una nuova fotografia a ogni scansione.

---

# 23. Coordinate GPS

Le coordinate originali vengono conservate separatamente:

```text
original_latitude
original_longitude
```

Non vengono sovrascritte dal risultato del geocoding.

PostGIS può inoltre utilizzare una rappresentazione spaziale derivata, ad esempio:

```text
geometry(Point, 4326)
```

quando utile alle query spaziali.

L'altitudine non viene persistita in MVP1.

Non è prevista modifica manuale delle coordinate da parte dell'utente.

---

# 24. Reverse geocoding

Il reverse geocoding utilizza **Geoapify Reverse Geocoding API** (o provider simile).

Invece di importare dataset geografici localmente e fare spatial queries PostGIS, si effettua una chiamata HTTP a un servizio esterno che restituisce i dati amministrativi per coordinate GPS.

La pipeline è:

```text
GPS lat/lon
    ↓
normalizzazione (rounding a 2 decimali ≈ 1km)
    ↓
geocoding_cache.lookup(original coordinates)
    ├─ hit → risultato restituito
    └─ miss → Geoapify API call
                 ↓
          parsing & normalizzazione risposta
                 ↓
          salvataggio in localities + cache
                 ↓
          risultato restituito
```

## 24.1 Normalizzazione delle coordinate

Le coordinate vengono arrotondate a **2 decimali** invece di 4.

```text
45.5621 → 45.56
9.1742  → 9.17
```

Questo riduce drasticamente il numero di chiamate API distinte:
- ~500 foto nella stessa area metropolitana
- → ~30 coordinate uniche dopo deduplicazione
- → ~30 chiamate API al massimo per scansione completa

## 24.2 Tabella localities

Non esiste più `administrative_areas` con geometrie PostGIS. Esiste `localities`, una tabella piatta con i dati strutturati del provider:

```sql
localities (
    id              serial PRIMARY KEY,
    locality_hash   varchar(100) NOT NULL UNIQUE,  -- "45.56:9.17"
    country_code    varchar(5) NOT NULL,
    name            text NOT NULL,                  -- es. "Monza"
    admin_level     integer NOT NULL,               -- tipo da Geoapify
    street          varchar(200),                   -- via/frazione
    county          varchar(200),                   -- provincia
    region          varchar(200),                   -- regione/stato
    country         varchar(200),                   -- nome paese completo
    raw_response    jsonb,                          -- risposta grezza
    source          varchar(20) DEFAULT 'geoapify',
    created_at      timestamp NOT NULL DEFAULT now()
);
```

La gerarchia amministrativa è conservata come campi piatti — nessun `parent_id` ricorsivo, nessuna query spaziale.

## 24.3 Interfaccia ReverseGeocoder

Il codice usa un'interfaccia astratta che permette di cambiare provider in futuro senza modificare chiamanti:

```typescript
interface ReverseGeocoder {
  resolve(latitude: number, longitude: number): Promise<Locality | null>;
}
```

Implementazioni disponibili:

- `GeoapifyReverseGeocoder` — principale
- In futuro: `NominatimReverseGeocoder`, `GoogleReverseGeocoder`, ecc.

## 24.4 Cache

La tabella `geocoding_cache` mappa ogni foto alla sua località:

```sql
geocoding_cache (
    original_latitude       double precision NOT NULL,
    original_longitude      double precision NOT NULL,
    locality_hash           varchar(100) NOT NULL,
    locality_id             integer REFERENCES localities(id),
    ...
);
```

I **coordinate originali** sono preservati così come compaiono negli EXIF della foto. La `locality_hash` deriva dalle coordinate normalizzate.

## 24.5 Exclusion zones

Le zone di esclusione puntano ora a `localities.id` invece che a `administrative_areas.id`. Quando l'utente crea un'esclusione per una località, può scegliere di escludere anche la regione o la provincia per coprire un'area più ampia.

---

# 25. Modello geografico (Semplificato per API esterna)

Con Geoapify non si definisce una gerarchia arbitraria basata su poligoni territoriali.

L'API restituisce già i dati strutturati:

```json
{
  "city": "Erice",
  "county": "Trapani",
  "state": "Sicily",
  "country": "Italy",
  "country_code": "IT"
}
```

Viene salvato tutto come campi piatti nella tabella `localities`.

### 25.1 Definizione di località (aggiornata)

La località Travelog è il nome amministrativo più specifico restituito dall'API Geoapify.

Non è un POI.

Se l'API non fornisce una città, viene utilizzato il livello superiore disponibile (town, village, county, ecc.).

### 25.2 Geocoding cache

Prima del reverse geocoding, le coordinate vengono normalizzate a **2 decimali**.

La combinazione `rounded_lat:rounded_lon` costituisce il `locality_hash`, la chiave primaria della deduplicazione per la tabella `localities`.

Concettualmente:

```text
geocoding_cache (by original coordinates)
-----------------------------------------
original_latitude       — coordinate EXIF grezze (non modificate)
original_longitude      — coordinate EXIF grezze (non modificate)
locality_hash           — "45.56:9.17" (chiave di deduplicazione API)
locality_id             — REFERENCES localities(id)
country_code            — IT
name                    — Erice
admin_level             — 4
geo_applied             — true
created_at              — timestamp
```

I **coordinate originali** sono preservati così come compaiono negli EXIF della foto. La `locality_hash` deriva dalle coordinate normalizzate ma non è una chiave univoca sulla cache.

### 25.3 Tabella localities

Tabella piatto con i dati strutturati dall'API Geoapify. Nessun campo geometrico.

```sql
localities (
    id              serial PRIMARY KEY,
    locality_hash   varchar(100) NOT NULL UNIQUE,  -- "45.56:9.17"
    country_code    varchar(5) NOT NULL,
    name            text NOT NULL,                 -- es. "Erice"
    admin_level     integer NOT NULL,              -- tipo da Geoapify
    street          varchar(200),                  -- via/frazione
    county          varchar(200),                  -- provincia/es. "Trapani"
    region          varchar(200),                  -- regione/stato es. "Sicily"
    country         varchar(200),                  -- nome paese es. "Italy"
    raw_response    jsonb,                         -- risposta grezza Geoapify
    source          varchar(20) DEFAULT 'geoapify',
    created_at      timestamp NOT NULL DEFAULT now()
);
```

La gerarchia amministrativa è conservata come campi piatti: `county`, `region`, `country`. Nessuna ricorsività tramite `parent_id`.

---

# 26. Dataset version (Removed — no longer relevant for external API)

No dataset import = no versioning needed. The `source` column in `localities` already identifies the provider.

---

# 27. Import dei dataset geografici (Removed — replaced by Geoapify API)

No offline dataset imports. No `import-geodata.mjs` script. No `data/geodata/` directory needed.

The runtime only needs an internet connection to call Geoapify during photo scans.


---

# 28. Repository layer (Updated for Geoapify approach)

I repository non devono più contenere logica di spatial queries o import di dataset.

Esempi aggiornati:

```text
PhotoRepository
ScanRepository
TripRepository
GeocodingCacheRepository      ← CRUD su geocoding_cache e localities
SettingsRepository
LocalitiesRepository          ← sostituisce AdministrativeAreaRepository
ExclusionZonesRepository      ← usa localityId invece di adminAreaId
```

I repository utilizzano Drizzle e query SQL native. Nessuna dipendenza da PostGIS.

---

# 29. Dataset version (Removed — no longer relevant for external API)

No dataset import = no versioning needed. The `source` column in `localities` already identifies the provider.

---

# 30. Import dei dataset geografici (Removed — replaced by Geoapify API)

No offline dataset imports. No `import-geodata.mjs` script. No `data/geodata/` directory needed.

The runtime only needs an internet connection to call Geoapify during photo scans.

---

# 31. Scan architecture
La scansione è un background job asincrono eseguito nello stesso processo Node.js di Express.

Non viene introdotto un worker separato in MVP1.

```text
POST /api/scansions
        |
        v
Express
        |
        +-- create scan
        |
        +-- start background job
                    |
                    v
                 scanner
```

La risposta HTTP non rimane aperta per tutta la durata della scansione.

---

# 32. Scan lifecycle

La scansione ha stato persistente nel database.

Gli stati funzionali previsti sono quelli definiti nei requisiti:

```text
PENDING
RUNNING
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
```

I nomi tecnici possono essere adattati al naming convention del database, mantenendo la semantica funzionale dei requisiti.

---

# 33. Scan pipeline

Per ogni scansione:

```text
1. Acquisizione scan lock
2. Creazione record scansione
3. Enumerazione ricorsiva filesystem
4. Filtro per formato supportato
5. Identificazione file già presenti
6. Per ogni nuova fotografia:
   a. lettura metadata con ExifTool
   b. validazione metadata
   c. normalizzazione coordinate
   d. lookup cache
   e. reverse geocoding se necessario
   f. persistenza atomica
7. Aggiornamento contatori
8. Completamento scansione
9. Rilascio lock
```

---

# 34. Scansione incrementale

La scansione è incrementale.

Un file già riconosciuto tramite la fingerprint:

```text
relative path + size + mtime
```

viene saltato.

Non vengono create duplicazioni.

Le fotografie con EXIF incompleti vengono comunque persistite e riconosciute nelle scansioni successive.

---

# 35. Scansione sequenziale

Le fotografie vengono elaborate una alla volta.

Non viene introdotto parallelismo in MVP1.

```text
photo 1
  |
  v
complete
  |
  v
photo 2
  |
  v
complete
  |
  v
...
```

Motivazioni:

* semplicità;
* prevedibilità;
* ridotto consumo di RAM;
* ridotto carico sul NAS;
* gestione più semplice degli errori;
* gestione più semplice del progress.

Una futura ottimizzazione potrà introdurre concorrenza controllata senza modificare il contratto funzionale.

---

# 36. Idempotenza e ripresa

La scansione deve essere idempotente.

Ogni fotografia viene trattata indipendentemente.

Se il processo viene interrotto:

* i record già committed rimangono persistiti;
* i record della fotografia in corso ma non committed vengono rollbackati;
* una nuova scansione può riconoscere ciò che è già stato importato;
* le fotografie non completate possono essere ritentate.

Non viene utilizzata una transazione globale per l'intera scansione.

---

# 37. Transazione per fotografia

Ogni fotografia viene persistita all'interno di una singola transazione PostgreSQL.

Concettualmente:

```text
BEGIN

  save photo
  save geocoding relation
  save derived geographic data
  save presence data

COMMIT
```

In caso di errore:

```text
ROLLBACK
```

La transazione deve comprendere tutte le modifiche che devono essere atomiche rispetto alla singola fotografia.

---

# 38. Error isolation

Un errore relativo a una fotografia non interrompe la scansione.

Esempio:

```text
photo 1 → OK
photo 2 → OK
photo 3 → ERROR
photo 4 → OK
photo 5 → OK
```

La fotografia 3 viene registrata come errore e la scansione continua.

Gli errori devono essere sufficientemente diagnostici da permettere all'utente o all'amministratore di capire cosa è accaduto.

---

# 39. Scan errors

Gli errori delle singole fotografie vengono persistiti separatamente dallo stato globale della scansione.

Concettualmente:

```text
scan_errors
------------
scan_id
path
error_code
message
created_at
```

Il database non viene utilizzato come una coda persistente di tutti i file da elaborare.

Il filesystem viene nuovamente enumerato durante le scansioni.

---

# 40. Scan locking

È consentita una sola scansione attiva per catalogo.

Il coordinamento viene effettuato tramite **PostgreSQL advisory lock**.

```text
start scan
    |
    v
pg_try_advisory_lock(...)
    |
    +-- acquired --> start
    |
    +-- busy ------> 409 Conflict
```

Non viene utilizzato:

* Redis;
* lock file;
* variabile globale Node.js;
* coda esterna.

Il lock PostgreSQL viene rilasciato automaticamente quando la connessione che lo possiede viene chiusa.

---

# 41. Scan progress

Il frontend riceve lo stato della scansione tramite polling REST.

Esempio:

```text
POST /api/scansions
        |
        v
scanId = 42

GET /api/scansions/42
GET /api/scansions/42
GET /api/scansions/42
...
```

La response contiene i dati necessari alla progress bar, inclusi:

* stato;
* file analizzati;
* nuovi file;
* file già presenti;
* file esclusi;
* errori;
* percentuale quando determinabile.

Non vengono utilizzati in MVP1:

* WebSocket;
* Server-Sent Events;
* broker di messaggi.

---

# 42. Scan history

Ogni scansione viene persistita.

Il modello deve supportare almeno:

* start time;
* end time;
* cartella;
* stato;
* file analizzati;
* nuove foto;
* file già presenti;
* foto escluse;
* errori;
* messaggi diagnostici.

Lo storico è consultabile tramite API.

---

# 43. Presenze giorno/località

La presenza fondamentale del dominio è:

```text
giorno + località amministrativa
```

La data viene derivata dal `DateTimeOriginal`.

Il numero di fotografie associato alla presenza è il numero di fotografie valide con GPS appartenenti alla combinazione.

Le foto in zona di esclusione rimangono dati geografici validi ma non contribuiscono alle statistiche di viaggio.

---

# 44. Regole di dominio dei viaggi

Le regole funzionali dei viaggi sono implementate nel backend e non nel frontend.

Il frontend non deve duplicare:

* soglia foto minima;
* determinazione giornata;
* gestione delle zone di esclusione;
* chiusura viaggio;
* gestione dei giorni senza foto.

Il backend deve essere l'unico punto che determina il risultato del dominio.

---

# 45. Immutabilità dei viaggi

Questo è un principio fondamentale del modello.

Una volta creato un viaggio, una nuova scansione non lo modifica automaticamente.

Lo stesso vale per:

* cambio soglie;
* ricalcolo;
* nuovi dati fotografici;
* aggiornamento dataset geografico;
* cambio del geocoder.

Le modifiche automatiche possono generare nuovi viaggi, ma non alterano quelli già consolidati.

Le modifiche ai viaggi avvengono esclusivamente attraverso le operazioni manuali previste dall'MVP1.

---

# 46. Ricalcolo

Il ricalcolo viene trattato come una operazione esplicita.

Quando l'utente modifica le configurazioni:

```text
save settings
      |
      v
nessuna modifica automatica ai viaggi
```

L'utente deve esplicitamente richiedere:

```text
Ricalcola
```

Il ricalcolo utilizza le nuove impostazioni per i dati non ancora consolidati, senza modificare o cancellare i viaggi esistenti.

### Ricalcolo su periodo (17 settembre 2026)

`POST /settings` accetta un body opzionale `RecalculateRequest` con
`startDate` e `endDate` (date ISO locali, estremi inclusivi). Body assente o
`{}` mantiene il comportamento globale. AJV valida formato, proprietà e
presenza congiunta delle date dal contratto OpenAPI; il controller verifica
anche l'ordine temporale prima di avviare il lavoro (`400 VALIDATION_ERROR`).
La risposta resta `202 { status: "ACCEPTED" }`, senza attendere il completamento.

`recalculate(window?)` ricostruisce globalmente le presenze, come prima;
`generateTrips(window?)` scarta le presenze fuori finestra prima di classificare
i giorni. Le soglie non possono essere soddisfatte da foto fuori periodo.
Il clipping usa sempre tutti i viaggi attivi. La generazione dopo scansione
resta globale (nessun argomento). Nessuna migrazione o nuova dipendenza.

Il menu apre `RecalculateModal`, riusando `Modal`, input data nativi e React
state. La conferma di accettazione rimane nel modal per 3 secondi; un refresh
best-effort della lista viene programmato dopo 2 secondi, con cleanup del timer
allo smontaggio. Non equivale a una conferma di completamento e non aggiorna
la cache heatmap. Le soglie continuano a essere gestite nelle Impostazioni.

---

# 47. Modifica manuale dei viaggi

Le operazioni manuali sui viaggi sono implementate come use case applicativi dedicati.

Esempi:

```text
renameTrip()
changeTripDates()
splitTrip()
mergeTrips()
```

Le regole di validazione vengono applicate dal backend.

In particolare:

* sovrapposizioni temporali vietate;
* split con data assegnata al secondo viaggio;
* merge senza cancellazione fisica dei viaggi originali.

---

# 47bis. Creazione manuale di viaggi senza GPS (aggiunta successiva)

Estensione richiesta dall'utente (post-MVP1 scope): quando le foto esistono
ma **non hanno GPS EXIF**, l'utente crea manualmente un viaggio aggiungendo
**giorni uno alla volta**, assegnando a ogni giorno le **località visitate**
cercate con la **Geoapify Address Autocomplete API** (stesso flusso già usato
per le zone di esclusione, §49.1).

## Modello dati

Due tabelle dedicate (migrations 0013 + 0014) — **non** `presences`, che è dati
derivati ricostruiti dal ricalcolo. Il giorno è una riga autonoma: il workflow
consente di aggiungere un giorno **prima** di assegnarne le località.

```sql
manual_trip_days (
    id         serial PRIMARY KEY,
    trip_id    integer NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    day_date   date NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (trip_id, day_date)
);

manual_trip_day_localities (
    day_id      integer NOT NULL REFERENCES manual_trip_days(id) ON DELETE CASCADE,
    locality_id integer NOT NULL REFERENCES localities(id),
    PRIMARY KEY (day_id, locality_id)
);
```

Invariante: i giorni manuali vivono sempre dentro l'intervallo del viaggio
(`start_date <= day_date <= end_date`).

### Esclusioni di giorno/località sui viaggi auto-generati (0016)

"Cancella giorno"/"cancella località" è disponibile su **tutti** i viaggi attivi.
Sui viaggi auto-generati i giorni derivano dalle presenze (dati derivati,
ricostruiti dal ricalcolo): la cancellazione è quindi persistita come
**esclusione esplicita e reversibile** nella tabella `trip_day_exclusions`
(migration 0016), così sopravvive a re-scan e ricalcolo senza violare l'immutabilità
automatica (§11). `locality_key` è la chiave di raggruppamento del dettaglio
(`lower(name)|county|region`); `NULL` = intero giorno escluso. Il dettaglio (§16),
la mappa e l'export CSV nascondono il contenuto escluso; il ri-aggiungimento
della località sulla data rimuove l'esclusione (operazione esplicita).

```sql
trip_day_exclusions (
    id           serial PRIMARY KEY,
    trip_id      integer NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    day_date     date NOT NULL,
    locality_key text,  -- NULL = intero giorno escluso
    created_at   timestamp NOT NULL DEFAULT now(),
    UNIQUE (trip_id, day_date, COALESCE(locality_key, ''))
);
```

### Cache della mappa panoramica (0017)

L'aggregazione della heatmap panoramica (una riga per località unica su tutti
i viaggi attivi, `GET /trips/map`) è costosa: la subquery correlata che deriva
`first_photo_at` unisce `photos` e `geocoding_cache` per ogni presenza. È
memorizzata in una **tabella singleton** (migration 0017) e servita
read-through, così la dashboard non ricalcola l'aggregazione a ogni richiesta:

```sql
trips_overview_map_cache (
    id          integer PRIMARY KEY,   -- singleton: sempre 1
    payload     jsonb NOT NULL,        -- { bounds, markers } (DTO pre-colori)
    computed_at timestamp NOT NULL DEFAULT now()  -- orario locale naive
);
```

* **Lettura** (`GET /trips/map`): cache hit → lo snapshot è servito così com'è
  e `computedAt` ne riporta l'età; cache miss (primo avvio o payload
  malformato, trattato come miss) → calcolo, memorizzazione e risposta. I
  colori di provincia sono deterministici e ri-applicati a ogni lettura (il
  payload non li duplica).
* **Ricalcolo** (`POST /trips/map/recalculate`): operazione **esplicita**
  (comando "Ricalcola heatmap" del menu azioni, stesso pattern del ricalcolo
  viaggi §12): ricalcola, sovrascrive la riga singleton e risponde in modo
  sincrono con i dati freschi.
* **Nessuna invalidazione automatica**: nessun'altra operazione (scan,
  ricalcolo viaggi, split/merge, esclusioni, giorni manuali) tocca la cache.
  La freschezza dei dati è responsabilità dell'utente, informata da
  `computedAt` (decisione di prodotto: il ricalcolo è manuale).

## Regole di dominio

* **Creazione**: `POST /trips` accetta `days: [{ date, localityIds? }]`; l'intervallo
  del viaggio è derivato da min/max dei giorni; transazione atomica trip + giorni;
  sovrapposizioni temporali bloccate (409 `TRIP_OVERLAP`, §21.17).
* **Giorno senza località**: `localityIds` è opzionale — un giorno può esistere
  prima di avere località (workflow: giorno aggiunto, poi località cercate).
* **Modifica giorni**: `PUT /trips/{tripId}/days` sostituisce atomicamente l'elenco
  giorni (aggiunta/rimozione di giorni e assegnazione località). Se un giorno
  eccede l'intervallo, le date del viaggio sono estese (con validazione
  sovrapposizioni). Almeno 1 giorno obbligatorio.
* **Modifica date (§13.2)**: i giorni manuali fuori dal nuovo intervallo sono rimossi
  dalla stessa operazione esplicita.
* **Split/merge**: i giorni manuali sono **copiati** nei viaggi risultanti per data
  (data split → secondo viaggio); gli originali archiviati conservano le proprie
  righe per lo storico (§13.3, §13.4).
* **Zone di esclusione**: i giorni manuali le ignorano — sono intenzione esplicita
  dell'utente, non evidenza fotografica.
* **Dettaglio (§16)**: i giorni manuali sono uniti ai giorni derivati da `presences`
  (flag `manual` sul giorno e sulla località); le località manuali espongono
  `photoCount: 0`.
* **Statistiche per le trip card (redesign UI)**: `GET /trips` e `GET /trips/{id}`
  arricchiscono ogni `Trip` con due campi derivati, **senza migrazione** (nessuna
  nuova colonna):
  * `photoCount`: somma di `presences.photo_count` per le presenze con
    `photo_date` nell'intervallo `[start_date, end_date]` del viaggio;
  * `regions`: elenco distinto e ordinato alfabeticamente di `county / region`
    delle località visitate nell'intervallo (tag geografici della card).
  Il calcolo avviene nel repository (`attachStats`) con una query di aggregazione
  sulle `presences` dell'intervallo; i campi sono opzionali nel contratto OpenAPI
  (`Trip.photoCount`, `Trip.regions`) e sono valori **derivati** (mai memorizzati,
  come tutti i dati derivati — §13/§45).

## UI (workflow nel modal)

Bottone **"Crea viaggio"** nella toolbar della pagina Viaggi (dopo "Ricalcola") →
il modal si apre **subito sotto il titolo, prima della lista viaggi**:

1. l'utente inserisce il nome;
2. sceglie la data e preme **"Aggiungi giorno"** → compare la riga del giorno
   (senza località);
3. cerca una località (Geoapify Autocomplete, debounce 300 ms) e preme
   **"Aggiungi"** → la località compare nella lista del giorno;
4. può aggiungere altre località allo stesso giorno o un nuovo giorno;
5. **"Salva"** crea il viaggio con una sola richiesta.

---

# 47ter. Esportazione viaggio come evento calendario (ICS)

Estensione richiesta dall'utente: esportare un singolo viaggio come file ICS
(iCalendar, RFC 5545) da importare in qualsiasi applicazione calendario
(Google Calendar, Apple Calendar, Outlook, …).

## Endpoint

`GET /trips/{tripId}/ics` — operazione di sola lettura, idempotente, coerente
con l'export CSV (`GET /trips/export`). Risponde con `text/calendar` e
`Content-Disposition: attachment`.

## Formato ICS

L'evento è un all-day event (VALUE=DATE) che copre l'intervallo del viaggio:

- **SUMMARY**: nome del viaggio
- **DTSTART;VALUE=DATE**: data di inizio (YYYYMMDD)
- **DTEND;VALUE=DATE**: giorno successivo alla data di fine (YYYYMMDD, esclusivo
  per RFC 5545 §3.6.1)
- **LOCATION**: nome della località con più foto nel viaggio
- **DESCRIPTION**: gerarchia amministrativa completa (nome, provincia, regione,
  paese) seguita da "Creato da Travelog"
- **UID**: `trip-{id}@travelog`
- **DTSTAMP**: timestamp UTC di generazione

Quando il viaggio non ha località (viaggio manuale senza foto), `LOCATION` è
omesso e `DESCRIPTION` contiene solo "Creato da Travelog".

## Località con più foto

Il repository `getTopLocalityForTrip(tripId, startDate, endDate)` aggrega le
`presences` nell'intervallo del viaggio raggruppando per chiave località
(`name|county|region`, stessa chiave del dettaglio §6.3/§7.2) e somma i
`photo_count`. Unisce le località dei giorni manuali (`manual_trip_day_localities`,
`photoCount=0`) solo se non già presenti nelle presenze. Restituisce la località
con il totale foto maggiore, o `null` se il viaggio non ha alcuna località.

Nessuna migration: la query usa tabelle esistenti (`presences`,
`manual_trip_day_localities`, `localities`).

## UI

Voce **"Aggiungi al Calendario"** nel menu contestuale del viaggio
(`TripContextMenu`), posizionata **prima di "Elimina viaggio"**. L'azione
invoca `exportTripIcs(tripId)` dal modulo API `trips.ts` (nessun `fetch`
diretto nel componente, regola §6). L'handler in `TripsPage` gestisce
l'errore attraverso il messaggio di pagina.

---

# 48. Audit trail dei viaggi

Le operazioni distruttive dal punto di vista logico non devono eliminare lo storico.

Le operazioni principali da tracciare sono:

* split;
* merge.

Lo storico deve permettere di determinare:

* viaggio origine;
* operazione;
* viaggi risultanti;
* timestamp.

Il modello deve quindi supportare una relazione tra operazione e viaggi coinvolti.

---

# 49. Zone di esclusione

Le zone di esclusione sono dati di configurazione applicativa persistiti nel database.

Sono riferite a unità amministrative.

Possono essere:

* località/comuni;
* aree amministrative intermedie;
* regioni/aree superiori.

L'utente non deve gestire manualmente le relazioni gerarchiche.

La logica di appartenenza deve essere determinata dal modello amministrativo.

### 49.1 Ricerca globale delle località di esclusione (Aggiornato)

La ricerca delle località da escludere non è più limitata alle località già
visitate (`localities` importate dal geocoding delle foto). È disponibile una
ricerca **globale** basata sulla **Geoapify Address Autocomplete API**:

* `GET /api/localities/autocomplete?q=&limit=` — proxy backend verso
  `https://api.geoapify.com/v1/geocode/autocomplete`. La chiave
  `GEOAPIFY_API_KEY` resta sul server (nessuna chiamata diretta del
  browser a Geoapify, nessuna libreria frontend aggiuntiva). Se la chiave
  non è configurata l'API risponde `503 GEOAPIFY_NOT_CONFIGURED`.
* `POST /api/localities/resolve` (body `{ placeId }`) — scarica i dettagli
  del place scelto, esegue l'upsert nella tabella `localities` (hash dalle
  coordinate normalizzate a 2 decimali, stesso key space del reverse
  geocoding; `source='geoapify-autocomplete'`) e restituisce la `Locality`
  con l'id, usabile per `POST /exclusion-zones`.

Il flusso UI è: ricerca (debounce 300 ms) → suggerimenti raggruppati per
Comune/Provincia/Regione → "Escludi" risolve il place e crea la zona con lo
scope scelto. Le regole di validazione scope (county/regione presenti sulla
località di ancoraggio) restano in `exclusion-zones.service`.

---

# 50. Effetto delle zone di esclusione

Una fotografia in zona esclusa:

* rimane nel database;
* rimane geograficamente valida;
* non contribuisce alle statistiche di viaggio;
* non contribuisce alla generazione dei viaggi.

Una giornata mista, con fotografie dentro e fuori zona esclusa, rimane una giornata di viaggio.

Una giornata composta esclusivamente da fotografie in zone escluse non è una giornata di viaggio.

---

## 50bis. Statistiche temporali aggregate (17 settembre 2026)

`GET /api/stats` restituisce `TravelStats` definito in OpenAPI: anni crescenti,
numero viaggi, totale giorni e array di 12 conteggi mensili. Nessun filtro.
Una singola query PostgreSQL via Drizzle nel repository interseca i viaggi
attivi con mesi di calendario, usando date e timestamp senza timezone.
Durata inclusiva completa, inclusi manuali e giorni senza foto; partenze contate
una volta nell'anno iniziale, archiviati esclusi. Nessun join con presenze o
zone: per questa metrica valgono i periodi salvati (FR §24bis). Il calendario
copre sempre fino all'anno corrente (colonne a zero se senza viaggi) e oltre
per viaggi futuri.
Nessuna scrittura, cache persistente, migrazione o chiamata esterna.
La pagina React `/stats`, raggiungibile da Azioni, usa l'API layer e i tipi
generati. Barre CSS e tabella heatmap accessibile, scala bianco–verde 0–31,
senza librerie aggiuntive. Caricamento, errore con retry e storico vuoto espliciti.

# 51. Frontend architecture

Il frontend React viene organizzato per responsabilità funzionali.

Esempio:

```text
src/
├── api/
├── components/
├── pages/
├── hooks/
├── state/
└── main.tsx
```

Le pagine rappresentano i principali contesti dell'applicazione.

La UI non contiene business logic di dominio.

### Nuova dashboard dei viaggi (redesign UI)

La pagina **Viaggi** (`/trips`, `TripsPage`) è organizzata a due colonne; la
vecchia tabella (`TripsTable`) è stata rimossa: la lista è ora composta dalle
card.

```text
TripsPage                       (dati, operazioni, dialoghi)
├── TripDaysModal / merge-bar / messaggi        (sopra le colonne)
├── TripsDashboard              (layout, solo UI state)
│   ├── colonna sinistra (~420px, scroll interno)
│   │   ├── GlobalActionMenu ("+ Azioni", §1.1)
│   │   ├── campo di ricerca (filtro server-side via GET /trips?search=)
│   │   ├── TripCard (accordion) + TripContextMenu + link scheda
│   │   └── TripTimeline (card espansa, §2.2, "Modifica viaggio" §51)
│   ├── footer sidebar (paginazione)
│   └── colonna destra (flex-grow)
│       └── TripMap (fullHeight)
├── Modal ─ TripDialog          (rinomina / date / dividi)
├── Modal ─ MergeDialog         (unione, §13.4)
└── Modal ─ conferma eliminazione
```

* **`TripCard`** — card viaggio espandibile (accordion): titolo, periodo e
  durata calcolata (`formatTripPeriodShort`, es. `3 Lug - 31 Lug 2026 · 29 gg`),
  tag geografici da `Trip.regions`, badge foto da `Trip.photoCount` e chevron
  di espansione.
* **`Modal`** — wrapper di presentazione riusabile (`createPortal` su
  `document.body`, overlay oscurato, box centrato orizzontalmente e
  verticalmente, larghezza 50% con limiti di sicurezza). **Tutti** i dialoghi
  della pagina vivono dentro un `Modal` e condividono lo stesso aspetto: il
  `TripDialog` (rinomina / date / dividi), la conferma di eliminazione, la
  creazione manuale (`TripDaysModal`) e la conferma di unione (`MergeDialog`).
* **`TripContextMenu`** — menu contestuale (icona ingranaggio) del singolo
  viaggio con *Rinomina / Modifica date / Modifica viaggio / Dividi viaggio /
  Aggiungi al Calendario / Elimina viaggio*. La voce *Modifica viaggio* compare solo sui viaggi
  `active` e abilita la modifica inline di giorni/località nella card espansa
  (§51). Le azioni sono delegate al parent, che riusa `TripDialog` e la
  conferma di eliminazione esistenti.
* **`MergeDialog`** — conferma dell'unione (§13.4) in una finestra centrata:
  riepilogo dei viaggi selezionati (recap in `selectedTrips`) e campo opzionale
  per il nome del viaggio unito. La *selezione* resta invece sulle card in
  merge mode (`TripCard` checkbox, `onToggleSelected`): la barra `merge-bar`
  tiene solo il suggerimento e il pulsante che apre il dialog. Un overlay
  modale bloccherebbe i click sulla sidebar, per questo selezione e conferma
  sono separate.
* **Notifica di conferma in-dialog** — le operazioni eseguite dentro un
  dialogo (rinomina, modifica date, dividi, eliminazione, creazione manuale,
  unione) non scrivono la conferma nel messaggio di pagina: il messaggio
  (`alert-success`) viene mostrato **al posto dei pulsanti** di conferma e il
  dialogo resta aperto fino all'auto-dismiss (3s, `useAutoDismiss`), che azzera
  il messaggio e chiude il dialogo.
* **`GlobalActionMenu`** — dropdown primario "+ Azioni" (blu, come il
  pulsante di conferma; UI
  §1.1) con le azioni d'ingresso *Scansione* (→ `/scans`), *Crea Viaggio*
  (modale `TripDaysModal`, §47bis), *Esporta* (`exportTripsCsv`) e *Unisci*
  (attiva la merge mode sulle card, §13.4), più il comando esplicito
  *Ricalcola* (§46).
  Il componente non esegue chiamate API: ogni voce è delegata al parent, che
  possiede le chiamate, la merge mode e la modale di creazione.
* **`TripsDashboard`** — layout a due colonne, riceve dati e handler dal
  parent e possiede solo UI state (`highlightedLocalityId`,
  `editingTripId`, la card espansa in modalità di eliminazione località,
  e `closedYears`, gli anni chiusi dell'accordion per anno).
* **Raggruppamento per anno** — la lista della sidebar è raggruppata per
  anno della data inizio del viaggio (`Trip.startDate`, derived at render
  time, nessun campo aggiuntivo). Ogni anno ha un header accordion con
  chevron e conteggio viaggi ("N viaggio/viaggi"); tutti gli anni sono
  aperti al primo render (set `closedYears` vuoto) e ogni anno può essere
  chiuso/riaperto indipendentemente (più anni chiusi contemporaneamente).
  L'ordine dei gruppi è quello della lista del backend (cronologico
  inverso). Stato puramente UI: nessuna persistenza, nessun cambio di
  contratto o schema.
  La selezione è controllata: il click sulla
  card riporta l'id del viaggio (`onSelectTrip`); il parent carica `getTrip` +
  `getTripMap` e passa i nuovi `mapData` alla mappa, che esegue il
  *fly-to/zoom fit* sui pin del viaggio selezionato.
* **Ricerca** — server-side: ogni digitazione è riportata al parent, che
  ri-interroga `listTrips` con il termine di ricerca.
* **Heatmap panoramica (nessun viaggio selezionato)** — con `selectedTripId`
  nullo il pannello mappa mostra `HeatMap` (leaflet.heat): un punto di calore
  per località unica di tutti i viaggi attivi, intensità normalizzata sul
  numero di foto e fit frazionario stretto sui dati. I dati arrivano da
  `GET /trips/map`, snapshot cachato (migration 0017): nessun indicatore è
  mostrato sulla mappa (l'età del dato è leggibile da `computedAt` nell'API) e
  il comando "Ricalcola heatmap" del menu azioni
  (`POST /trips/map/recalculate`) è l'unico modo di ricalcolare; al
  completamento compare una notifica di conferma. Il click su logo/titolo
  riporta la heatmap (rimontaggio della pagina).
* **`TripTimeline`** — cronologia dei giorni/località del viaggio (linea
  verticale con un nodo per giorno, data, card località con badge foto,
  marcatore "Nessuna foto" per i giorni vuoti). È **estratto** da
  `TripDetailPanel` (§16) ed è riusato sia nella card espansa sia nella
  pagina di dettaglio `/trips/:id`; il pannello di dettaglio conserva solo
  l'intestazione, la mappa e il toggle "Modifica" (nella dashboard la
  modalità si attiva invece dalla voce "Modifica viaggio", §51).
* **Sincronizzazione timeline ↔ mappa (§3.1)** — `TripsDashboard` possiede
  `activeLocalityId`: l'hover o il click su una località nella timeline
  (`onLocalityHover` / `onLocalityClick`) apre il popup del pin
  corrispondente e vi vola sopra; il click su un pin (`onMarkerClick`) evidenzia
  la riga corrispondente nella timeline.
* **Modifica giorni/località (§51)** — `TripTimeline` mostra i comandi
  (cestino giorno/località, ricerca località con "+" e "Aggiungi
  giorno"/"Fine") solo quando il parent abilita `editing` e fornisce
  `onReplaceDays` (§47bis). Sulla **pagina di dettaglio** il toggle
  "Modifica" attiva la modifica completa; nella **dashboard** la voce
  "Modifica viaggio" del menu contestuale (solo viaggi `active`) espande la
  card e attiva la stessa modifica inline; `TripsPage` fornisce
  `onReplaceDays` (PUT `/trips/{tripId}/days` seguito dal refresh di
  dettaglio, mappa e lista).
* **Link scheda condivisibile** — ogni card espone un pulsante (icona link
  esterno) che apre `/trips/:id` in una nuova scheda: la pagina di dettaglio
  `TripDetailPage` (§16) resta raggiungibile e condivisibile.
* **Paginazione** — il backend limita la pagina a 100 viaggi: i controlli
  vivono nel footer della sidebar (`sidebarFooter` di `TripsDashboard`) e
  scompaiono quando tutti i viaggi stanno in una pagina.
* **Badge di provenienza** — le card conservano il badge `MANUALE`
  (viaggi creati a mano) e `Archiviato`, come nella precedente lista.

Le regole di dominio dei viaggi restano nel backend (§44, §45); i componenti
frontend non contengono business logic.

---

# 52. Frontend state

Lo stato viene classificato in:

## UI state

Gestito con React:

* dialog aperto;
* form corrente;
* filtro;
* selezione;
* stato locale del componente.

## Server data

Ottenuti tramite API client e `fetch`.

Non viene introdotto un global state manager.

Non viene introdotto TanStack Query in MVP1.

Robustezza della navigazione (audit P3, 2026-09-17):

* Il caricamento di `TripDetailPage` usa un flag `active` invalidato dal cleanup
  dell'effetto: risposte di dettaglio/mappa, errori e completamenti di caricamento
  relativi al precedente `tripId` non aggiornano lo stato corrente.
* Il cambio viaggio azzera dettaglio e mappa e chiude la modalità modifica.
  Il fallimento della sola mappa non impedisce la visualizzazione del dettaglio.
* L'ErrorBoundary della pagina è identificato dalla rotta, incluso l'ID del
  viaggio: navigando a un'altra pagina o viaggio il fallback viene resettato.
* Gli errori del salvataggio giorni sono intercettati da `TripTimeline.persistDays`
  e mostrati inline; la pagina non duplica né nasconde questa gestione.

---

# 53. Polling frontend

Il polling delle scansioni è incapsulato in un hook o modulo dedicato.

Concettualmente:

```text
useScanProgress(scanId)
        |
        +-- GET /api/scansions/:id
        |
        +-- wait
        |
        +-- GET /api/scansions/:id
        |
        +-- ...
```

Il polling termina automaticamente quando la scansione raggiunge uno stato terminale.

---

# 54. Foto nel frontend

Le fotografie **non vengono visualizzate in MVP1**.

Il frontend visualizza i dati derivati richiesti dai requisiti:

* viaggi;
* giornate;
* località;
* gerarchie amministrative;
* conteggi;
* stato scansioni;
* impostazioni.

Non deve essere implementata una galleria fotografica.

---

# 55. Authentication

MVP1 non implementa autenticazione applicativa.

Non sono previsti:

* utenti;
* password;
* sessioni;
* ruoli;
* login.

La sicurezza dell'accesso è demandata all'ambiente self-hosted e alla rete locale.

L'applicazione non deve essere considerata progettata per esposizione diretta a Internet.

---

# 56. Nginx

Nginx costituisce il punto di ingresso HTTP.

Configurazione concettuale:

```text
Browser
   |
   v
Nginx
   |
   +-- /       → React static build
   |
   +-- /api/*  → Express
```

Il browser utilizza una singola origin.

Questo evita la necessità di configurare CORS tra frontend e backend in produzione.

---

# 57. Backend process

Express viene eseguito come servizio systemd.

Concettualmente:

```text
systemd
   |
   v
Node.js
   |
   v
Express
```

systemd è responsabile di:

* avvio;
* stop;
* restart;
* gestione del processo;
* integrazione con journald.

Lifecycle delle scansioni (audit P2, 2026-09-17):

* Prima di aprire la porta HTTP, il backend attende il recupero delle scansioni
  rimaste `running` o `pending`, marcandole `failed` con timestamp di fine e
  messaggio diagnostico di riavvio. Le foto già salvate sono preservate.
* Se il recupero fallisce, registra `server.stale_scans_recovery_failed` e
  prosegue l'avvio; in quel caso il recupero dello storico non è garantito.
* Il job elimina il proprio flag di cancellazione nel `finally`, anche in caso
  di errore durante enumerazione o finalizzazione, prima del rilascio del lock.
* Le Promise rifiutate senza gestione producono un log strutturato
  `server.unhandled_rejection`, senza uscita esplicita del processo.
* Le eccezioni non gestite producono un log fatal `server.uncaught_exception`
  seguito da uscita con codice 1; il riavvio resta responsabilità di systemd.

---

# 58. Logging

Il backend utilizza structured logging.

I log vengono scritti su:

```text
stdout
stderr
```

e raccolti da:

```text
systemd / journald
```

Non viene introdotto uno stack esterno di logging.

Gli eventi importanti devono avere almeno:

* timestamp;
* livello;
* evento;
* identificativo scansione quando disponibile;
* path quando utile;
* errore strutturato quando presente.

Esempi:

```text
scan.started
scan.file.processed
scan.file.skipped
scan.file.failed
scan.completed
geocoding.cache.hit
geocoding.cache.miss
trip.created
trip.merged
trip.split
```

---

# 59. Testing strategy

MVP1 utilizza due livelli principali di test:

1. unit test;
2. integration test.

Non vengono introdotti test end-to-end browser in MVP1.

---

# 60. Unit tests

I unit test verificano la logica isolata.

Esempi:

* calcolo giorno;
* soglia minima per visita;
* determinazione giornata di viaggio;
* chiusura viaggio;
* gestione giorni senza foto;
* split;
* merge;
* validazione date;
* regole zone di esclusione;
* normalizzazione coordinate.

I test devono essere deterministici e non dipendere dal filesystem o dal database quando non necessario.

---

# 61. Integration tests (Updated — no more PostGIS spatial tests)

Gli integration test utilizzano un database PostgreSQL reale dedicato.

Database:

```text
travelog_test
```

Le migration vengono applicate al database di test prima dei test.

Gli integration test verificano:

* repository;
* query PostgreSQL;
* transazioni;
* vincoli;
* API Express;
* integrazione tra service e repository;
* geocoding cache CRUD (localities + geocoding_cache).

Non viene più utilizzato PostGIS nei test, poiché il reverse geocoding avviene tramite API esterna.

---

# 62. Test database (Updated)

Il database di test è separato dal database di sviluppo.

Esempio:

```text
PostgreSQL
├── travelog_dev
└── travelog_test
```

Non viene utilizzato Docker per creare il database di test.

Test e integration tests utilizzano **PostgreSQL senza PostGIS** (necessaria in MVP1).

---

# 63. Data integrity (Updated for Geoapify approach)

Il database deve utilizzare vincoli SQL quando questi rappresentano invarianti reali del dominio.

Esempi:

* unique constraint sulla fingerprint della fotografia;
* foreign keys verso `localities.id` (anziché `administrative_areas.id`);
* check constraints;
* vincoli sulle relazioni;
* eventuale exclusion constraints PostgreSQL per intervalli temporali, quando appropriati.

Le regole complesse che richiedono contesto applicativo rimangono nel domain/service layer.

---

# 64. API e database transaction boundary

Una richiesta HTTP che modifica dati deve utilizzare transazioni quando l'operazione coinvolge più modifiche che devono essere atomiche.

In particolare:

* importazione di una fotografia;
* split viaggio;
* merge viaggi;
* modifica di dati correlati.

La transazione viene gestita nel service/repository boundary appropriato.

---

# 65. Performance

MVP1 non introduce ottimizzazioni premature.

Principi:

* scansione sequenziale;
* un file alla volta;
* cache persistente del geocoding;
* query spaziali indicizzate;
* paginazione API dove necessaria;
* niente caricamento dell'intero catalogo in memoria.

Il sistema deve essere progettato per gestire migliaia di fotografie senza richiedere la presenza simultanea dei file in RAM.

---

# 66. Memory management

Travelog non deve caricare l'intera libreria fotografica in memoria.

La scansione opera a stream/logica per file:

```text
enumerate
   |
   v
one file
   |
   +-- ExifTool
   |
   +-- DB transaction
   |
   v
next file
```

Il contenuto binario completo delle fotografie non viene caricato inutilmente in memoria.

---

# 67. Security boundaries

MVP1 è una applicazione trusted self-hosted.

Nonostante l'assenza di autenticazione, devono essere rispettati alcuni confini:

* `photoRoot` è l'unica area filesystem accessibile allo scanner;
* il filesystem NAS è read-only per Travelog;
* non vengono eseguiti comandi shell costruiti direttamente da input utente;
* l'invocazione di ExifTool utilizza argomenti separati e controllati;
* gli errori interni non vengono esposti nelle API;
* il database non è esposto direttamente al browser.

---

# 68. ExifTool process execution

ExifTool viene invocato come processo esterno tramite API di child process di Node.js.

Non devono essere utilizzate shell interpolation con path provenienti dal filesystem.

Il path viene passato come argomento separato al processo.

L'output di ExifTool viene interpretato e trasformato in un modello interno minimale.

Non vengono salvati indiscriminatamente tutti gli EXIF.

---

# 69. Deployment layout (Updated)

Installazione concettuale:

```text
Debian Server
│
├── Nginx
│
├── Travelog frontend
│   └── static build
│
├── Travelog backend
│   └── Node.js / Express
│
├── PostgreSQL
│
├── ExifTool
│
├── systemd
│
├── journald
│
└── /mnt/travelog/photos
    └── NAS mount

Internet access required at runtime for:
└── Geoapify Reverse Geocoding API (calls per photo scan)
```

---

# 70. Runtime dependencies (Updated)

Il runtime MVP1 richiede:

* Debian/Linux;
* Node.js;
* PostgreSQL;
* ExifTool;
* Nginx;
* filesystem NAS montato;
* connessione internet verso Geoapify API (solo durante le scansioni).

Non richiede:

* Docker;
* Redis;
* message broker;
* cloud storage;
* PostGIS;
* servizi di geocoding esterni alternativi;
* authentication server;
* logging server esterno;
* dataset geografici locali (nessun download offline richiesto).

---

# 71. Principi per AI coding agent

Il progetto è esplicitamente progettato per essere implementato con l'assistenza di un AI coding agent.

L'agente deve seguire queste regole:

## 71.1 Requisiti prima del codice

Prima di modificare il comportamento funzionale, l'agente deve consultare:

```text
doc/functional-requirements-mvp1.md
```

e rispettarne i vincoli.

## 71.2 API contract prima dell'implementazione

Per modifiche API:

```text
OpenAPI
   ↓
types
   ↓
backend
   ↓
frontend
```

## 71.3 Nessuna duplicazione della business logic

La business logic deve vivere nel backend.

Il frontend non deve reimplementare algoritmi di dominio.

## 71.4 Migrations esplicite

Ogni modifica dello schema deve avere una migration versionata.

## 71.5 Test insieme alla modifica

Ogni nuova logica di dominio deve avere unit test.

Ogni modifica significativa a repository, database o API deve avere integration test appropriati.

---

# 72. Decisioni tecnologiche consolidate (Updated for Geoapify approach)

| Area                      | Decisione                      |
| ------------------------- | ------------------------------ |
| Architecture              | Frontend/backend separati      |
| Frontend                  | React + TypeScript + Vite      |
| Frontend state            | React state                    |
| Server state              | Fetch/API client               |
| TanStack Query            | No                             |
| Global state manager      | No                             |
| Backend                   | Node.js + TypeScript + Express |
| API                       | REST                           |
| API contract              | OpenAPI                        |
| API design                | Contract-first                 |
| API validation            | OpenAPI / JSON Schema          |
| API types                 | Generated TypeScript           |
| API client                | Internal fetch wrapper         |
| Database                  | PostgreSQL                     |
| Spatial DB                | **Non utilizzato** (rimosso)   |
| Data access               | Drizzle                        |
| Migrations                | Drizzle migrations             |
| Photo storage             | NAS                            |
| NAS access                | Mounted filesystem             |
| NAS protocol              | Outside application scope      |
| Photo formats             | JPEG/JPG + HEIC/HEIF           |
| EXIF                      | ExifTool                       |
| Photo identity            | relative path + size + mtime   |
| Timestamp                 | DateTimeOriginal               |
| Timezone                  | Naive local time               |
| GPS editing               | Not supported                  |
| Geocoding                 | External API (Geoapify)        |
| Geographic data           | Reverse geocoding via HTTP     |
| Spatial queries           | **Non utilizzate** (rimosse)   |
| Geocoding cache           | PostgreSQL persistent          |
| Geographic dataset import | **Rimosso** — nessuna import  |
| ReverseGeocoder interface | `ReverseGeocoder.resolve()`    |
| Scan execution            | Node background job            |
| Scan worker               | Same Node process              |
| Scan concurrency          | One scan at a time             |
| File concurrency          | One file at a time             |
| Scan lock                 | PostgreSQL advisory lock       |
| Scan progress             | REST polling                   |
| Scan persistence          | PostgreSQL                     |
| Photo transaction         | One transaction per photo      |
| Scan errors               | Isolated                       |
| Derived data              | Domain-oriented                |
| Trip immutability         | Yes                            |
| Authentication            | None                           |
| Deployment                | Native Debian                  |
| Docker                    | No                             |
| Web server                | Nginx                          |
| Backend process           | systemd                        |
| Logging                   | stdout/stderr + journald       |
| Testing                   | Unit + integration             |
| Test DB                   | Dedicated PostgreSQL           |
| E2E tests                 | Not in MVP1                    |

---

# 73. Architectural decisions intentionally deferred (Updated)

Le seguenti decisioni non sono necessarie per definire l'architettura MVP1 e possono essere definite durante l'implementazione senza modificare i principi architetturali:

* scelta precisa della libreria middleware Express per OpenAPI/JSON Schema validation;
* scelta precisa del generator OpenAPI → TypeScript;
* dettagli finali dello schema Drizzle;
* naming definitivo delle API;
* strategia di paginazione delle singole risorse;
* formato definitivo dei structured logs;
* dettagli dei systemd unit file;
* dettaglio della risposta Geoapify in caso di edge cases;
* eventuale strategia futura di passaggio a PostGIS se richiesto.

Queste decisioni devono essere documentate quando vengono prese e non devono contraddire questo design.

---

# 74. Definition of Done tecnica MVP1 (Updated for Geoapify approach)

Una implementazione MVP1 è tecnicamente completa quando:

* frontend e backend sono separati;
* React/Vite produce un build statico;
* Express espone API REST;
* OpenAPI è versionato e contract-first;
* i tipi frontend sono generati da OpenAPI;
* le request API sono validate secondo OpenAPI/JSON Schema;
* PostgreSQL è utilizzato come persistence layer;
* Drizzle gestisce accesso dati e migration;
* il NAS è utilizzato tramite directory montata;
* ExifTool estrae i metadata;
* la scansione è incrementale;
* la scansione è idempotente e riprendibile;
* una fotografia viene elaborata alla volta;
* gli errori delle singole fotografie non bloccano la scansione;
* una sola scansione può essere attiva;
* il lock viene gestito tramite PostgreSQL advisory lock;
* il progress è disponibile tramite polling REST;
* il reverse geocoding avviene tramite API esterna (Geoapify);
* il geocoding utilizza una cache persistente in `geocoding_cache`;
* nessun dataset geografico offline viene importato o richiesto;
* i dati originali GPS vengono conservati;
* i viaggi già creati non vengono modificati automaticamente;
* merge e split mantengono lo storico richiesto;
* non viene introdotta autenticazione;
* il backend gira tramite systemd;
* Nginx serve frontend e reverse-proxy verso Express;
* i log sono disponibili tramite journald;
* esistono unit test;
* esistono integration test con PostgreSQL reale (no PostGIS);
* Docker non è richiesto per il deployment o il testing.

---

# 75. Riferimenti

* `doc/functional-requirements-mvp1.md` — requisiti funzionali MVP1.
* `openapi/openapi.yaml` — contratto API MVP1.
* `database/migrations/` — schema database versionato.

Il presente documento definisce il design tecnico MVP1 e deve essere aggiornato quando una decisione architetturale viene modificata.
