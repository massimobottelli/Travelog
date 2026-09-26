# Travelog API — Guida d'uso con esempi reali

Documentazione operativa di tutte le chiamate API di Travelog MVP1.
Il contratto autorevole è `openapi/openapi.yaml`; gli esempi riportati qui sono
risposte reali catturate da un'istanza in esecuzione.

## Indice

1. [Avvio del server](#avvio-del-server)
2. [Health](#health)
3. [Config (percorso foto)](#config-percorso-foto)
4. [Settings](#settings)
5. [Scansioni](#scansioni)
6. [Foto](#foto)
7. [Viaggi](#viaggi)
8. [Mappa viaggio](#mappa-viaggio)
9. [Operazioni su viaggi (audit trail)](#operazioni-su-viaggi-audit-trail)
10. [Zone di esclusione](#zone-di-esclusione)
11. [Località](#località)
12. [Cancellazione dati](#cancellazione-dati)
13. [Backup e ripristino database](#backup-e-ripristino-database)
14. [Contratto errori comune](#contratto-errori-comune)
15. [Schema completo endpoint](#schema-completo-endpoint)
16. [Fase 4 — Geographic data + geocoding](#fase-4--geographic-data--geocoding)

---

## Avvio del server

Avviare il server prima di lanciare le richieste API:

```bash
# Dal progetto root, vai nella cartella backend e avvia il server
cd /Users/massimo/VSCode/travelog/backend

# Avvia il server con le variabili d'ambiente necessarie
DATABASE_URL="postgresql://massimo@localhost:5432/travelog_dev" \
TRAVELOG_PHOTO_ROOT="/Users/massimo/VSCode/travelog/test" \
node dist/index.js
```

Quando vedi questo messaggio, il server è pronto:

```
[server] Travelog backend listening on port 3000
```

**Nota sul parametro `folder`:**
È il percorso **relativo** a `TRAVELOG_PHOTO_ROOT`, non un path assoluto.

Se `TRAVELOG_PHOTO_ROOT` è `/Users/massimo/VSCode/travelog/test`, per scansionare
quella stessa cartella usa `"folder": "."`. Se il path è `/Volumes/home/Photos` e
vuoi scansionare `MobileBackup/iPhone/2026/08`, usa `"folder": "MobileBackup/iPhone/2026/08"`.

Tutte le richieste seguono la forma:

```bash
curl http://localhost:3000/api/<endpoint>
```

---

## Health

### `GET /api/health`

Verifica di disponibilità dell'API.

```bash
curl http://localhost:3000/api/health
```

**Risposta reale (200):**

```json
{
  "status": "ok",
  "timestamp": "2026-09-08T19:59:10.565Z",
  "uptime_seconds": 10.696413917,
  "version": "0.1.0",
  "environment": "development"
}
```

---

## Config (percorso foto)

### `GET /api/config`

Legge il percorso radice dell'archivio foto (persistito nella tabella `settings`).

```bash
curl http://localhost:3000/api/config
```

**Risposta reale (200):**

```json
{ "photoRoot": "/Volumes/home/Photos" }
```

`photoRoot` è `null` quando non è ancora stato configurato.

### `PUT /api/config`

Aggiorna il percorso radice. Il path deve essere **assoluto** ed esistere come directory.
Una stringa vuota o `null` cancella la configurazione.

```bash
curl -X PUT http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -d '{"photoRoot": "/Volumes/home/Photos"}'
```

**Risposta (200):** la configurazione aggiornata, come per `GET /api/config`.

**Errori:**

| Codice | HTTP | Causa |
|--------|------|-------|
| `VALIDATION_ERROR` | 400 | Path relativo, inesistente o non directory |

---

## Settings

### `GET /api/settings`

Parametri di generazione automatica dei viaggi.

```bash
curl http://localhost:3000/api/settings
```

**Risposta reale (200):**

```json
{
  "minimumConsecutiveDaysWithPhotos": 3,
  "consecutiveDaysWithoutPhotosBeforeClosing": 3
}
```

### `PUT /api/settings`

Aggiorna uno o più parametri; i campi omessi restano invariati.

```bash
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"minimumConsecutiveDaysWithPhotos": 2}'
```

**Risposta (200):** i settings aggiornati, come per `GET /api/settings`.

> Cambiare i settings **non** ricalcola automaticamente i viaggi esistenti:
> il ricalcolo è un'operazione esplicita (vedi `POST /api/settings/recalculate`).

### `POST /api/settings/recalculate`

Richiede esplicitamente il ricalcolo dei viaggi. L'operazione torna subito
e procede in modo asincrono.

```bash
curl -X POST http://localhost:3000/api/settings/recalculate
```

**Risposta (202):**

```json
{ "status": "ACCEPTED" }
```

---

## Scansioni

### `POST /api/scans`

Avvia una scansione asincrona della cartella indicata (relativa alla photo root).
Solo una scansione può girare alla volta (lock advisory PostgreSQL).
Stringa vuota (`""`) = scansiona l'intera photo root.

```bash
curl -X POST http://localhost:3000/api/scans \
  -H "Content-Type: application/json" \
  -d '{"folder": "."}'
```

**Risposta immediata (HTTP 202):**

```json
{
  "id": 7,
  "folder": ".",
  "status": "running",
  "filesAnalyzed": 0,
  "newPhotos": 0,
  "existingPhotos": 0,
  "excludedPhotos": 0,
  "errors": 0,
  "endedAt": null
}
```

La risposta torna subito — la scansione procede in background senza bloccare
la risposta HTTP. Quando l'enumerazione dei file è completa, la scansione
espose anche `filesTotal`, che abilita la barra di progresso proporzionale.

**Errori:**

```bash
curl -s -w "\nHTTP %{http_code}" -X POST http://localhost:3000/api/scans \
  -H "Content-Type: application/json" -d '{}'
```

```
{"code":"VALIDATION_ERROR","message":"Missing required fields: folder","details":{"fields":{"fields":["folder"]}}}
HTTP 400
```

Se una scansione è già in corso: `409` con codice `SCAN_ALREADY_RUNNING`.

### `GET /api/scans/{scanId}`

Stato e progresso di una scansione. Per il polling frontend, ripeti la richiesta
ogni 2–3 secondi finché lo status non diventa terminale.

```bash
# Sostituisci 7 con l'ID restituito da POST /scans
curl http://localhost:3000/api/scans/7
```

**Risposta aggiornata:**

```json
{
  "id": 7,
  "folder": ".",
  "status": "completed",
  "filesAnalyzed": 6,
  "newPhotos": 6,
  "existingPhotos": 0,
  "excludedPhotos": 0,
  "errors": 0,
  "startedAt": "2026-08-31T13:45:00.000Z",
  "endedAt": "2026-08-31T13:45:01.000Z"
}
```

**Errore reale (scan inesistente):**

```
{"code":"scan_not_found","message":"Scan with id 99999 not found","details":{}}
HTTP 404
```

### `GET /api/scans/{scanId}/errors`

Elenco degli errori registrati per una scansione (uno per file fallito).
Utile quando lo status è `completed_with_errors`.

```bash
curl http://localhost:3000/api/scans/7/errors
```

**Risposta (200):**

```json
{
  "items": [
    {
      "id": 3,
      "scanId": 7,
      "filePath": "2026/08/IMG_9892.JPEG",
      "errorCode": "EXIF_READ_FAILED",
      "message": "exiftool exited with code 1",
      "createdAt": "2026-08-31T13:45:00.000Z"
    }
  ]
}
```

### `POST /api/scans/{scanId}/cancel`

Richiede la cancellazione di una scansione in corso: la scansione si ferma
dopo la foto corrente e viene marcata `failed` con messaggio diagnostico
("Scan cancelled by the user"). Le foto già salvate restano nel database.

```bash
curl -X POST http://localhost:3000/api/scans/7/cancel
```

**Risposta (202):** snapshot corrente della scansione (schema `Scan`).

**Errori:** `404` (`scan_not_found`), `409` se la scansione non è in esecuzione.

### `GET /api/scans`

Storico delle scansioni, paginato.

```bash
curl "http://localhost:3000/api/scans?page=1&pageSize=20"
```

**Risposta paginata:**

```json
{
  "items": [
    { "id": 7, "folder": ".", "status": "completed", "newPhotos": 6 },
    { "id": 6, "folder": ".", "status": "completed", "newPhotos": 6 }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 2
}
```

### Stati possibili di una scansione

| Stato | Significato |
|-------|-------------|
| `pending` | Accettata, in attesa di avvio |
| `running` | Scansione in corso |
| `completed` | Completata senza errori |
| `completed_with_errors` | Completata ma alcune foto hanno avuto errori |
| `failed` | Fallimento fatale della scansione (inclusa la cancellazione richiesta) |
| `stopped` | Scansione interrotta |

---

## Foto

### `GET /api/photos`

Elenco tecnico delle foto catalogate, ordinate per data di scatto decrescente.
Espone i metadati persistiti: timestamp EXIF originale, coordinate GPS originali
(mai sovrascritte dal reverse geocoding) e la località amministrativa risolta
quando disponibile.

```bash
curl "http://localhost:3000/api/photos?pageSize=2"
```

**Risposta reale (200):**

```json
{
  "items": [
    {
      "id": 1572,
      "filePath": "/Volumes/home/Photos/MobileBackup/iPhone/2026/08/IMG_9892.JPEG",
      "fileName": "IMG_9892.JPEG",
      "fileType": ".jpeg",
      "dateTimeOriginal": "2026-08-25T05:10:17",
      "originalLatitude": 41.73556388888889,
      "originalLongitude": 10.449913888888888,
      "metadataStatus": "valid",
      "exclusionReason": null,
      "locality": null
    },
    {
      "id": 214,
      "filePath": "/Users/massimo/VSCode/travelog/test/08/IMG_9892.JPEG",
      "fileName": "IMG_9892.JPEG",
      "fileType": ".jpeg",
      "dateTimeOriginal": "2026-08-25T05:10:17",
      "originalLatitude": 41.73556388888889,
      "originalLongitude": 10.449913888888888,
      "metadataStatus": "valid",
      "exclusionReason": null,
      "locality": null
    }
  ],
  "page": 1,
  "pageSize": 2,
  "total": 46558
}
```

**Parametri query:**

| Parametro | Valori | Default |
|-----------|--------|---------|
| `metadataStatus` | `valid`, `excluded` | — |
| `page` | ≥ 1 | 1 |
| `pageSize` | 1–100 | 20 |

Quando il reverse geocoding ha successo, `locality` contiene la gerarchia:

```json
{
  "locality": {
    "countryCode": "IT",
    "name": "Erice",
    "county": "Trapani",
    "region": "Sicily",
    "country": "Italy"
  }
}
```

`dateTimeOriginal` è `null` per le foto escluse (EXIF illeggibile); `locality`
è `null` se non c'è GPS o il geocoding non ha trovato un'area.

---

## Viaggi

### `GET /api/trips`

Elenco dei viaggi, ordinato per data di inizio decrescente. Di default solo
i viaggi attivi; quelli archiviati/sostituiti vanno richiesti esplicitamente.

**Parametri query:**

| Parametro | Valori | Default |
|-----------|--------|---------|
| `status` | `active`, `archived` | `active` |
| `search` | testo libero (nome, anno/mese) | — |
| `sort` | `startDateDesc`, `startDateAsc` | `startDateDesc` |
| `page` / `pageSize` | paginazione | 1 / 20 |

```bash
curl "http://localhost:3000/api/trips?pageSize=2"
```

**Risposta reale (200):**

```json
{
  "items": [
    {
      "id": 19,
      "name": "Sicilia",
      "startDate": "2026-08-10",
      "endDate": "2026-08-24",
      "autoGenerated": true,
      "status": "active",
      "createdAt": "2026-09-01T19:11:01"
    },
    {
      "id": 282,
      "name": "Lozon",
      "startDate": "2026-07-03",
      "endDate": "2026-08-01",
      "autoGenerated": false,
      "status": "active",
      "createdAt": "2026-09-04T16:10:15"
    }
  ],
  "page": 1,
  "pageSize": 2,
  "total": 110
}
```

> Nota: nei viaggi creati manualmente è presente anche `createdManually: true`;
> per i viaggi auto-generati il campo può non comparire nei record storici
> precedenti alla colonna `created_manually`.

### `GET /api/trips/{tripId}`

Dettaglio del viaggio con la cronologia dei giorni: località visitate con
gerarchia amministrativa e conteggio foto per giorno/località. I giorni senza
foto (buchi di 1–2 giorni) compaiono con `noPhotos: true` ("Nessuna foto").

```bash
curl http://localhost:3000/api/trips/19
```

**Risposta reale (200, estratto):**

```json
{
  "id": 19,
  "name": "Sicilia",
  "startDate": "2026-08-10",
  "endDate": "2026-08-24",
  "autoGenerated": true,
  "status": "active",
  "createdAt": "2026-09-01T19:11:01",
  "days": [
    {
      "date": "2026-08-10",
      "noPhotos": false,
      "localities": [
        {
          "localityId": 40,
          "name": "Genoa",
          "county": "Genova",
          "region": "Liguria",
          "country": "Italy",
          "photoCount": 6
        }
      ]
    },
    {
      "date": "2026-08-11",
      "noPhotos": false,
      "localities": [
        {
          "localityId": 44,
          "name": "Bonagia",
          "county": "Trapani",
          "region": "Sicily",
          "country": "Italy",
          "photoCount": 6
        },
        {
          "localityId": 15,
          "name": "Erice",
          "county": "Trapani",
          "region": "Sicily",
          "country": "Italy",
          "photoCount": 2
        }
      ]
    }
  ]
}
```

**Errore reale (viaggio inesistente):**

```
{"code":"trip_not_found","message":"Trip with id 999999 not found","details":{}}
HTTP 404
```

### `POST /api/trips`

Creazione manuale di un viaggio. Può essere creato con date esplicite
oppure con una lista di giorni manuali (con località risolte in anticipo
via `POST /api/localities/resolve`). Con i giorni presenti, l'intervallo
viaggio è derivato da min/max data. I giorni manuali ignorano le zone di
esclusione (intenzione esplicita dell'utente). Non usato dall'elaborazione
automatica delle scansioni.

```bash
# Variante A: solo date
curl -X POST http://localhost:3000/api/trips \
  -H "Content-Type: application/json" \
  -d '{"name": "Weekend in Liguria", "startDate": "2026-10-03", "endDate": "2026-10-04"}'

# Variante B: con giorni manuali (le date di inizio/fine sono derivate)
curl -X POST http://localhost:3000/api/trips \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekend in Liguria",
    "days": [
      { "date": "2026-10-03", "localityIds": [40] },
      { "date": "2026-10-04" }
    ]
  }'
```

**Risposta (201):** il viaggio creato (schema `Trip`).

**Errori:**

| HTTP | Causa |
|------|-------|
| 400 | Body malformato, date incoerenti |
| 409 | Il viaggio si sovrappone a un altro viaggio attivo |

### `PATCH /api/trips/{tripId}`

Modifica manuale supportata in MVP1: rinomina e/o modifica date inizio/fine.
I viaggi attivi non devono sovrapporsi temporalmente. L'elaborazione automatica
non modifica mai un viaggio esistente.

```bash
curl -X PATCH http://localhost:3000/api/trips/282 \
  -H "Content-Type: application/json" \
  -d '{"name": "Losone"}'
```

**Risposta (200):** il viaggio aggiornato.

**Errori:** `400` validazione, `404` `trip_not_found`, `409` sovrapposizione.

### `PUT /api/trips/{tripId}/days`

Sostituzione completa (atomica e idempotente) dei giorni visibili del viaggio.
Operazione esplicita dell'utente, sia per aggiungere che per rimuovere giorni.

- **Viaggi manuali:** le righe giorno manuali sono sostituite; l'intervallo
  viaggio segue i giorni residui (estensione soggetta a validazione di
  sovrapposizione, `409`).
- **Viaggi auto-generati:** i giorni/località mancanti dalla richiesta vengono
  persistiti come esclusioni giorno esplicite e reversibili (sopravvivono a
  ri-scansioni e ricalcoli); le località aggiuntive diventano righe manuali.
  L'intervallo non cambia; i giorni richiesti devono cadervi dentro (`400`).

Il viaggio deve conservare almeno un giorno; i viaggi archiviati non si modificano.

```bash
curl -X PUT http://localhost:3000/api/trips/282/days \
  -H "Content-Type: application/json" \
  -d '{
    "days": [
      { "date": "2026-07-03", "localityIds": [1112] },
      { "date": "2026-07-04" }
    ]
  }'
```

**Risposta (200):** il viaggio aggiornato con i suoi giorni (schema `TripDetail`).

**Errori:** `400`, `404` `trip_not_found`, `409` (sovrapposizione o viaggio archiviato).

### `DELETE /api/trips/{tripId}`

Cancellazione esplicita di un viaggio. L'operazione viene registrata
nell'audit trail (`type: DELETE`).

```bash
curl -X DELETE http://localhost:3000/api/trips/282
```

**Risposta:** `204 No Content`.

**Errori:** `404` `trip_not_found`.

### `GET /api/trips/{tripId}/ics`

Esporta un singolo viaggio come file ICS (iCalendar, RFC 5545) da importare
in qualsiasi applicazione calendario (Google Calendar, Apple Calendar,
Outlook, …). L'evento è un evento giornaliero (all-day) che copre l'intervallo
del viaggio: `DTSTART` è la data di inizio, `DTEND` è il giorno successivo alla
data di fine (esclusivo, come previsto da RFC 5545 §3.6.1).

Il campo `SUMMARY` è il nome del viaggio. Il campo `LOCATION` è la località
con più foto nel viaggio (aggregata su tutte le giornate). Il campo
`DESCRIPTION` contiene la gerarchia amministrativa completa della località
(nome, provincia, regione, paese) seguita dalla nota "Creato da Travelog".
Quando il viaggio non ha località (viaggio manuale senza foto), `LOCATION` è
omesso e `DESCRIPTION` contiene solo "Creato da Travelog".

```bash
curl -o viaggio.ics "http://localhost:3000/api/trips/19/ics"
```

**Risposta (200):** `text/calendar`.

**Errori:** `404` `trip_not_found`.

### `GET /api/trips/export`

Esporta in CSV tutti i viaggi attivi, con una riga per giorno/località visitata
e conteggio foto; i giorni senza foto sono esportati con la nota "Nessuna foto".
Il file usa separatore `;` e BOM UTF-8.

```bash
curl -o trips.csv "http://localhost:3000/api/trips/export"
```

**Risposta (200):** `text/csv`.

### `POST /api/trips/{tripId}/split`

Divide un viaggio alla data indicata. La data di split appartiene al secondo
viaggio risultante. Il viaggio originale resta nello storico.

```bash
curl -X POST http://localhost:3000/api/trips/19/split \
  -H "Content-Type: application/json" \
  -d '{"splitDate": "2026-08-16", "name": "Sicilia - Favignana"}'
```

**Risposta (200):**

```json
{
  "operation": {
    "id": 112,
    "type": "SPLIT",
    "createdAt": "2026-09-08T20:15:00",
    "sourceTripIds": [19],
    "resultingTripIds": [19, 300]
  },
  "trips": [
    { "id": 19, "name": "Sicilia", "startDate": "2026-08-10", "endDate": "2026-08-15" },
    { "id": 300, "name": "Sicilia - Favignana", "startDate": "2026-08-16", "endDate": "2026-08-24" }
  ]
}
```

**Errori:** `400` data di split non valida, `404` `trip_not_found`,
`409` lo split violerebbe i vincoli del viaggio.

### `POST /api/trips/merge`

Unisce due o più viaggi in un nuovo viaggio. I viaggi originali restano nello
storico e vengono marcati come sostituiti.

```bash
curl -X POST http://localhost:3000/api/trips/merge \
  -H "Content-Type: application/json" \
  -d '{"tripIds": [19, 300], "title": "Sicilia completa"}'
```

**Risposta (200):** come lo split (schema `TripOperationResult`).

**Errori:** `400` unione non valida, `404` uno o più viaggi non trovati,
`409` i viaggi non possono essere uniti.

---

## Mappa viaggio

### `GET /api/trips/{tripId}/map`

Dati per la visualizzazione della mappa di un viaggio: un marker per ogni
località del dettaglio viaggio (presenze nell'intervallo più località dei
giorni manuali), aggregate per nome amministrativo (nome + county + region).
Ordinati cronologicamente per primo timestamp foto. Le coordinate provengono
dagli hash di località della cache geocoding; i colori per regione sono
assegnati in modo deterministico.

```bash
curl http://localhost:3000/api/trips/19/map
```

**Risposta reale (200, estratto):**

```json
{
  "id": 19,
  "name": "Sicilia",
  "startDate": "2026-08-10",
  "endDate": "2026-08-24",
  "bounds": { "minLat": 37.58, "minLon": 8.91, "maxLat": 44.41, "maxLon": 13.35 },
  "markers": [
    {
      "localityId": 40,
      "name": "Genoa",
      "latitude": 44.41,
      "longitude": 8.91,
      "photoCount": 6,
      "firstPhotoAt": "2026-08-10 17:03:59",
      "county": "Genova",
      "region": "Liguria",
      "country": "Italy",
      "countyColor": "#4285F4"
    },
    {
      "localityId": 15,
      "name": "Erice",
      "latitude": 38.05,
      "longitude": 12.55,
      "photoCount": 100,
      "firstPhotoAt": "2026-08-11 16:32:39",
      "county": "Trapani",
      "region": "Sicily",
      "country": "Italy",
      "countyColor": "#EA4335"
    }
  ],
  "countyColors": {
    "Genova": "#4285F4",
    "Trapani": "#EA4335"
  }
}
```

`firstPhotoAt` è `null` per le località manuali senza foto.

**Errori:** `404` `trip_not_found`, `500` `INTERNAL_ERROR` per errori inattesi.

---

## Mappa panoramica (heatmap, cache persistente)

Con nessun viaggio selezionato la dashboard mostra la heatmap della densità
fotografica: un punto di calore per località unica (nome + provincia + regione)
su tutti i viaggi attivi, intensità proporzionale al numero di foto.
L'aggregazione è **costosa** (subquery correlata `photos ⋈ geocoding_cache` per
ogni presenza): è quindi memorizzata in una **cache persistente** (migration
0017, tabella singleton `trips_overview_map_cache`) e **non** viene ricalcolata
a ogni richiesta.

### `GET /api/trips/map`

Serve lo snapshot cachato dell'aggregazione (read-through: se la cache è vuota
— primo avvio — calcola, memorizza e restituisce). Il campo `computedAt`
(orario locale naive del server, `YYYY-MM-DDTHH:mm:ss`) riporta quando è stato
calcolato lo snapshot servito. La UI non lo mostra sulla mappa: l'aggiornamento
è gestito esplicitamente dal comando di ricalcolo, che alla fine mostra una
notifica di conferma. Il campo resta nel contratto per diagnostica/debug.

```json
{
  "bounds": { "minLat": 37, "minLon": 7, "maxLat": 46, "maxLon": 13 },
  "markers": [
    {
      "localityId": 10,
      "name": "Erice",
      "latitude": 38.0396,
      "longitude": 12.6199,
      "photoCount": 7,
      "firstPhotoAt": "2026-08-01T10:00:00",
      "county": "Trapani",
      "region": "Sicilia",
      "country": "Italy",
      "countyColor": "#EA4335"
    }
  ],
  "countyColors": { "Trapani": "#EA4335" },
  "computedAt": "2026-11-09T21:43:58"
}
```

Nessun'altra operazione API invalida la cache: dopo una scansione, un ricalcolo
viaggi, uno split/merge o la modifica di giorni/esclusioni lo snapshot resta
servito com'è finché non viene richiesto esplicitamente il ricalcolo.

### `POST /api/trips/map/recalculate`

Ricalcolo **esplicito** della cache (comando "Ricalcola heatmap" del menu
azioni dell'header): ricalcola l'aggregazione, sovrascrive lo snapshot e
restituisce i dati freschi in modo **sincrono** (200). È l'unico modo di
ricalcolare la mappa panoramica.

**Errori:** `500` `INTERNAL_ERROR` per errori inattesi.

---

## Operazioni su viaggi (audit trail)

### `GET /api/operations`

Cronologia delle operazioni manuali sui viaggi (split, merge, delete).
Ogni voce registra i viaggi sorgente, i viaggi risultanti e il timestamp.

```bash
curl "http://localhost:3000/api/operations?pageSize=2"
```

**Risposta reale (200):**

```json
{
  "items": [
    {
      "id": 111,
      "type": "DELETE",
      "createdAt": "2026-09-04T18:11:49",
      "sourceTripIds": [285],
      "resultingTripIds": []
    },
    {
      "id": 110,
      "type": "DELETE",
      "createdAt": "2026-09-04T17:57:28",
      "sourceTripIds": [284],
      "resultingTripIds": []
    }
  ],
  "page": 1,
  "pageSize": 2,
  "total": 110
}
```

`type` può essere `SPLIT`, `MERGE` o `DELETE`. Per split/merge
`resultingTripIds` contiene gli id dei viaggi generati.

---

## Zone di esclusione

Le zone di esclusione indicano aree (località, provincia o regione) le cui
foto non devono contribuire alla generazione automatica dei viaggi (§9.1).

### `GET /api/exclusion-zones`

```bash
curl http://localhost:3000/api/exclusion-zones
```

**Risposta reale (200, estratto):**

```json
{
  "items": [
    {
      "id": 11,
      "scope": "county",
      "locality": {
        "id": 1112,
        "localityHash": "45.54:9.07",
        "source": "geoapify",
        "countryCode": "IT",
        "name": "Arese",
        "adminLevel": 8,
        "region": "Lombardy",
        "county": "Milano",
        "country": "Italy"
      }
    },
    {
      "id": 13,
      "scope": "locality",
      "locality": {
        "id": 812,
        "localityHash": "45.60:9.04",
        "source": "geoapify",
        "countryCode": "IT",
        "name": "Caronno Pertusella",
        "adminLevel": 8,
        "region": "Lombardy",
        "county": "Varese",
        "country": "Italy"
      }
    }
  ]
}
```

### `POST /api/exclusion-zones`

Crea una zona di esclusione a partire da una località esistente (id ottenibile
con `GET /api/localities/search` o `POST /api/localities/resolve`). Lo `scope`
indica il livello gerarchico: la località stessa, la sua provincia o la sua
regione (la località deve avere il livello corrispondente).

```bash
curl -X POST http://localhost:3000/api/exclusion-zones \
  -H "Content-Type: application/json" \
  -d '{"localityId": 1112, "scope": "county"}'
```

**Risposta (201):** la zona creata (schema `ExclusionZone`).

**Errori:** `400` richiesta non valida, `404` area amministrativa non trovata.

### `DELETE /api/exclusion-zones/{id}`

```bash
curl -X DELETE http://localhost:3000/api/exclusion-zones/11
```

**Risposta:** `204 No Content`.

**Errori:** `404` zona di esclusione non trovata.

---

## Località

### `GET /api/localities/search`

Ricerca tra le località già presenti nel database (derivate dal geocoding
delle foto), per nome, regione o provincia.

```bash
curl "http://localhost:3000/api/localities/search?q=milano&limit=2"
```

**Risposta reale (200):**

```json
{
  "items": [
    {
      "id": 1112,
      "localityHash": "45.54:9.07",
      "source": "geoapify",
      "countryCode": "IT",
      "name": "Arese",
      "adminLevel": 8,
      "region": "Lombardy",
      "county": "Milano"
    },
    {
      "id": 2983,
      "localityHash": "45.56:9.06",
      "source": "geoapify",
      "countryCode": "IT",
      "name": "Arese",
      "adminLevel": 8,
      "region": "Lombardy",
      "county": "Milano"
    }
  ]
}
```

**Parametri query:** `q` (obbligatorio), `limit` (1–100, default 20).

### `GET /api/localities/autocomplete`

Ricerca globale di qualsiasi luogo del mondo tramite la Geoapify Address
Autocomplete API (proxy). Richiede la variabile d'ambiente `GEOAPIFY_API_KEY`.
I risultati sono **suggerimenti**: per persistere il luogo scelto e ottenere
una `Locality` con id usabile nelle zone di esclusione, va chiamato poi
`POST /api/localities/resolve`.

```bash
curl "http://localhost:3000/api/localities/autocomplete?q=Erice&limit=5"
```

**Risposta (200):**

```json
{
  "items": [
    {
      "placeId": "5163b1a0492b0b51c059e15c8839a8e84940f2000f",
      "name": "Erice",
      "countryCode": "IT",
      "county": "Trapani",
      "region": "Sicily",
      "country": "Italy",
      "resultType": "city"
    }
  ]
}
```

**Errori:** `400` parametro non valido, `503` chiave Geoapify non configurata.

### `POST /api/localities/resolve`

Risolve un place id Geoapify (restituito dall'autocomplete) in una `Locality`
persistita: scarica i dettagli dal provider, fa upsert nella tabella `localities`
e restituisce la località con il suo id di database.

```bash
curl -X POST http://localhost:3000/api/localities/resolve \
  -H "Content-Type: application/json" \
  -d '{"placeId": "5163b1a0492b0b51c059e15c8839a8e84940f2000f"}'
```

**Risposta (200):** la località persistita, es.:

```json
{
  "id": 2999,
  "localityHash": "38.04:12.36",
  "source": "geoapify",
  "countryCode": "IT",
  "name": "Erice",
  "adminLevel": 8,
  "region": "Sicily",
  "county": "Trapani",
  "country": "Italy",
  "createdAt": "2026-09-08T20:30:00"
}
```

**Errori:** `400` body non valido, `404` place non trovato su Geoapify,
`503` chiave Geoapify non configurata.

---

## Cancellazione dati

### `DELETE /api/data`

Cancella in modo **irreversibile** tutte le foto, scansioni, errori di scansione,
località, cache geocoding, presenze, viaggi, storico viaggi e settings
applicativi. La configurazione photo root non viene modificata.
L'operazione è rifiutata mentre una scansione è in corso.

```bash
curl -X DELETE http://localhost:3000/api/data
```

**Risposta:** `204 No Content`.

**Errori:** `409` `SCAN_ALREADY_RUNNING` se una scansione è in corso.

---

## Backup e ripristino database

Operazioni di manutenzione per esportare e importare l'intero database in formato
JSON. Utili per backup, migrazione tra istanze o ripristino da snapshot.

Il formato del backup è un documento JSON con struttura:

```json
{
  "format": "travelog-backup",
  "version": 1,
  "exportedAt": "2026-09-26T14:47:12",
  "tables": {
    "localities": [...],
    "photos": [...],
    "scans": [...],
    ...
  }
}
```

Il file è **pretty-printed** (indentato) per leggibilità. Lo schema del database
non è incluso nel backup: viene riprodotto dalle migration versionate.

### `GET /api/data/export`

Esporta l'intero database in un file JSON. L'operazione è una transazione
**read-only REPEATABLE READ**: produce uno snapshot consistente senza bloccare
le scansioni in corso.

```bash
curl -o travelog-backup.json http://localhost:3000/api/data/export
```

**Risposta (200):** file JSON scaricabile con nome `travelog-backup-YYYYMMDD-HHMMSS.json`.

Il file contiene tutte le righe di ogni tabella (localities, photos, scans,
scan_errors, geocoding_cache, presences, trips, manual_trip_days,
manual_trip_day_localities, trip_day_exclusions, trip_history, settings,
exclusion_zones, trips_overview_map_cache).

**Errori:** `500` `INTERNAL_ERROR` per errori inattesi.

### `POST /api/data/import`

Ripristina il database da un file JSON di backup. L'operazione è **atomica**:
esegue TRUNCATE + insert + risincronizzazione sequenze in una singola
transazione. Qualsiasi errore causa il rollback e lascia i dati esistenti
intatti.

Il documento viene validato prima di acquisire il lock: un file invalido non
blocca mai le scansioni. Il photo root locale viene preservato (quello nel
backup viene scartato, perché specifico della macchina di origine).

```bash
curl -X POST http://localhost:3000/api/data/import \
  -H "Content-Type: application/octet-stream" \
  --data-binary @travelog-backup.json
```

**Risposta (200):**

```json
{
  "totalRows": 1234,
  "counts": {
    "localities": 50,
    "photos": 1000,
    "scans": 5,
    "scan_errors": 2,
    "geocoding_cache": 800,
    "presences": 400,
    "trips": 20,
    "manual_trip_days": 30,
    "manual_trip_day_localities": 45,
    "trip_day_exclusions": 3,
    "trip_history": 15,
    "settings": 1,
    "exclusion_zones": 4,
    "trips_overview_map_cache": 1
  }
}
```

**Errori:**

| HTTP | Codice | Causa |
|------|--------|-------|
| 400 | `VALIDATION_ERROR` | File JSON non valido o formato backup non riconosciuto |
| 400 | `VALIDATION_ERROR` | Versione backup non supportata |
| 409 | `SCAN_ALREADY_RUNNING` | Una scansione è in corso |
| 500 | `INTERNAL_ERROR` | Errore durante il ripristino (transazione rollback) |

**Esempio di errore (file non valido):**

```bash
curl -s -w "\nHTTP %{http_code}" -X POST http://localhost:3000/api/data/import \
  -H "Content-Type: application/octet-stream" \
  --data-binary "not a backup"
```

```
{"code":"VALIDATION_ERROR","message":"Il file selezionato non è un backup JSON valido.","details":{}}
HTTP 400
```

**Note importanti:**

- Dopo l'import, le sequenze degli ID sono risincronizzate per evitare collisioni
  con i nuovi insert.
- Il photo root nel backup viene sostituito con quello locale (stessa policy di
  `DELETE /api/data`).
- L'operazione è idempotente: importare lo stesso backup più volte produce lo
  stesso risultato.
- Le righe della tabella `settings` vengono inserite con `id=1` (singleton);
  se già presente, viene aggiornata preservando il photo root locale.

---

## Contratto errori comune

Tutti gli errori API seguono lo stesso contratto:

```json
{
  "code": "TRIP_NOT_FOUND",
  "message": "Trip not found",
  "details": {}
}
```

**Esempi reali catturati:**

```json
{"code":"scan_not_found","message":"Scan with id 99999 not found","details":{}}
```

```json
{"code":"trip_not_found","message":"Trip with id 999999 not found","details":{}}
```

```json
{"code":"VALIDATION_ERROR","message":"Missing required fields: folder","details":{"fields":{"fields":["folder"]}}}
```

```json
{"code":"INTERNAL_ERROR","message":"An unexpected internal error occurred","details":{}}
```

| Codice | HTTP tipico | Significato |
|--------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Body o query param mancante/malformato |
| `SCAN_NOT_FOUND` / `scan_not_found` | 404 | ID scansione inesistente |
| `TRIP_NOT_FOUND` / `trip_not_found` | 404 | ID viaggio inesistente |
| `SCAN_ALREADY_RUNNING` | 409 | Un'altra scansione è già in corso (lock advisory PG) |
| `INTERNAL_ERROR` | 500 | Errore interno inatteso (mai dettagli interni) |

Gli errori non espongono mai stack trace, query SQL o dettagli del filesystem.

---

## Schema completo endpoint

| Metodo | Endpoint | Descrizione | Risposta |
|--------|----------|-------------|----------|
| `GET` | `/api/health` | Verifica disponibilità API | 200 |
| `GET` | `/api/config` | Legge la photo root | 200 |
| `PUT` | `/api/config` | Aggiorna la photo root | 200 |
| `GET` | `/api/settings` | Parametri generazione viaggi | 200 |
| `PUT` | `/api/settings` | Aggiorna parametri | 200 |
| `POST` | `/api/settings/recalculate` | Ricalcolo esplicito viaggi | 202 |
| `POST` | `/api/scans` | Avvia scansione (`{ "folder": "path/to/dir" }`) | 202 |
| `GET` | `/api/scans` | Storico scansioni paginato | 200 |
| `GET` | `/api/scans/{scanId}` | Stato e progresso scansione | 200 |
| `GET` | `/api/scans/{scanId}/errors` | Errori per-file della scansione | 200 |
| `POST` | `/api/scans/{scanId}/cancel` | Richiede cancellazione scansione | 202 |
| `GET` | `/api/photos` | Elenco foto catalogate | 200 |
| `GET` | `/api/trips` | Elenco viaggi (filtri, ricerca, sort) | 200 |
| `POST` | `/api/trips` | Creazione manuale viaggio | 201 |
| `GET` | `/api/trips/export` | Export CSV viaggi attivi | 200 |
| `GET` | `/api/trips/{tripId}` | Dettaglio viaggio con giorni | 200 |
| `PATCH` | `/api/trips/{tripId}` | Rinomina / cambia date | 200 |
| `PUT` | `/api/trips/{tripId}/days` | Sostituzione giorni viaggio | 200 |
| `DELETE` | `/api/trips/{tripId}` | Cancella viaggio | 204 |
| `GET` | `/api/trips/{tripId}/ics` | Export viaggio come evento calendario (ICS) | 200 |
| `GET` | `/api/trips/{tripId}/map` | Dati mappa viaggio | 200 |
| `GET` | `/api/trips/map` | Mappa panoramica (heatmap, snapshot cachato) | 200 |
| `POST` | `/api/trips/map/recalculate` | Ricalcolo esplicito cache mappa panoramica | 200 |
| `POST` | `/api/trips/{tripId}/split` | Split viaggio | 200 |
| `POST` | `/api/trips/merge` | Merge di 2+ viaggi | 200 |
| `GET` | `/api/operations` | Audit trail operazioni viaggi | 200 |
| `GET` | `/api/exclusion-zones` | Elenco zone di esclusione | 200 |
| `POST` | `/api/exclusion-zones` | Crea zona di esclusione | 201 |
| `DELETE` | `/api/exclusion-zones/{id}` | Cancella zona di esclusione | 204 |
| `GET` | `/api/localities/search` | Ricerca località nel DB | 200 |
| `GET` | `/api/localities/autocomplete` | Autocomplete Geoapify globale | 200 |
| `POST` | `/api/localities/resolve` | Persiste un place Geoapify | 200 |
| `DELETE` | `/api/data` | Cancella tutti i dati catalogati | 204 |
| `GET` | `/api/data/export` | Export database JSON (backup) | 200 |
| `POST` | `/api/data/import` | Import database da JSON (ripristino) | 200 |













## Fase 4 — Geographic data + geocoding

La Fase 4 introduce il reverse geocoding locale con cache persistente e la gestione dei dataset geografici.  
Non sono esposte endpoint REST per l'import dei dataset (è un'operazione offline via script CLI), ma ci sono operazioni di consultazione e interrogazione spaziale.

### 4.1 Consultare le versioni dei dataset geografici importati

```bash
# L'elenco delle versioni importate è disponibile via query diretta al database,
# oppure tramite l'endpoint amministrativo se implementato in fase successiva.

# Query diretta (consigliata per MVP1):
psql -U massimo -d travelog_dev \
  -c "SELECT name, version, description, imported_at, row_count FROM dataset_versions ORDER BY imported_at DESC;"
```

**Risultato tipico:**
```
      name       | version |        description         |     imported_at      | row_count
-----------------+---------+----------------------------+----------------------+-----------
 osm_boundaries  | 1.0.0   | Initial OSM boundaries     | 2026-08-31 14:00:00  |       5234
```

### 4.2 Importare un dataset geografico (CLI)

L'import dei dati geografici è un'operazione **offline** eseguita via riga di comando, non tramite API HTTP.  
Questo mantiene la separazione architetturale tra runtime applicativo e strumento di manutenzione.

```bash
# Strumento per importare confini amministrativi da file GeoJSON
node scripts/import-geodata.mjs --input ./data/geodata --source osm_boundaries

# Con filtro paese opzionale
node scripts/import-geodata.mjs --input ./data/geodata --source italy_boundaries --country IT
```

**Formato input atteso:** File GeoJSON `.geojson` o `.json` contenente un `FeatureCollection` con proprietà standard (`NAME`, `ISO_A2`, `ADMIN_LEVEL`).

Le geometrie vengono convertite in formato WKT (Well-Known Text) salvate nella colonna `geometry` della tabella `administrative_areas`, con indicizzazione spaziale PostGIS.

#### Dataset consigliati

| Dataset | Formato | Come ottenere | Livelli | Costo |
|---------|---------|---------------|---------|-------|
| **GeoBoundaries** (consigliato MVP1) | GeoJSON diretto | API: `https://geoboundaries.org/api/download/v1/files/adminLevel/{level}/countryCodes/{CODE}/format/geojson/version/1.0` | Layer 0–3 (nazionale, primi sottolivelli, province/dipartimenti, comuni principali) | Dominio pubblico |
| Natural Earth | Shapefile → ogr2ogr→ GeoJSON | `curl -O https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_1_states_provinces.shp.zip` + `ogr2ogr -f GeoJSON output.geojson input.shp` | Admin Level 0–1 (paesi, regioni/stati) | Dominio pubblico |
| GADM v4 | ZIP → ogr2ogr → GeoJSON | `https://gadm.org/download.html` (selezione paesi) | Fino a 5 livelli (stato→regione→provincia→comune→sottocomune) | CC BY-SA (uso libero, citazione richiesta) |
| Eurostat NUTS | GeoJSON | `https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/` | NUTS 0–3 (stati, regioni, province, comuni UE) | Pubblico dominio UE |

Per importare tutti i livelli Italia con GeoBoundaries (Layer 0–3):

```bash
# Layer 0: confini nazionali (paese stesso)
curl -sL "https://geoboundaries.org/api/download/v1/files/adminLevel/0/countryCodes/ITA/format/geojson/version/1.0" \
     -o data/geodata/gadm_IT_layer0.geojson
node scripts/import-geodata.mjs --input ./data/geodata/gadm_IT_layer0.geojson --source italy_boundaries --country IT

# Layer 1: primi sottolivelli (es. regioni italiane)
curl -sL "https://geoboundaries.org/api/download/v1/files/adminLevel/1/countryCodes/ITA/format/geojson/version/1.0" \
     -o data/geodata/gadm_IT_layer1.geojson
node scripts/import-geodata.mjs --input ./data/geodata/gadm_IT_layer1.geojson --source italy_regions

# Layer 2: province/dipartimenti
curl -sL "https://geoboundaries.org/api/download/v1/files/adminLevel/2/countryCodes/ITA/format/geojson/version/1.0" \
     -o data/geodata/gadm_IT_layer2.geojson
node scripts/import-geodata.mjs --input ./data/geodata/gadm_IT_layer2.geojson --source italy_provinces

# Layer 3: comuni principali
curl -sL "https://geoboundaries.org/api/download/v1/files/adminLevel/3/countryCodes/ITA/format/geojson/version/1.0" \
     -o data/geodata/gadm_IT_layer3.geojson
node scripts/import-geodata.mjs --input ./data/geodata/gadm_IT_layer3.geojson --source italy_comunes
```

Dopo l'import, verificare che il dataset sia stato caricato correttamente:

```bash
# Contare le aree importate per paese e livello
psql -U massimo -d travelog_dev \
  -c "SELECT country_code, admin_level, count(*) FROM administrative_areas GROUP BY country_code, admin_level ORDER BY country_code, admin_level;"
```

### 4.3 Test del reverse geocoding (query diretta)

Per verificare che il geocoding funzioni correttamente dopo l'import di un dataset:

```bash
# Test: una foto a Milano (45.4642°N, 9.1897°E) dovrebbe restituire un'area italiana
psql -U massimo -d travelog_dev << 'SQL'
SELECT aa.id, aa.name, aa.country_code, aa.admin_level, aa.geometry
FROM administrative_areas aa
WHERE ST_Contains(ST_GeomFromText(aa.geometry, 4326), 
                   ST_SetSRID(ST_MakePoint(9.1897, 45.4642), 4326))
ORDER BY aa.admin_level DESC
LIMIT 1;
SQL
```

### 4.4 Consultare la cache del geocoding

La cache memorizza i risultati dei geocoding precedenti per evitare ripetizioni costose delle query spaziali:

```bash
# Verificare voci in cache (coordinate arrotondate a 4 decimali ≈ 11 metri)
psql -U massimo -d travelog_dev \
  -c "SELECT normalized_latitude, normalized_longitude, name, country_code, admin_level, geo_version FROM geocoding_cache LIMIT 10;"

# Conteggio totali
psql -U massimo -d travelog_dev \
  -c "SELECT count(*) AS cache_hits_available FROM geocoding_cache;"
```

**Note sulla normalizzazione:** Le coordinate vengono arrotondate a **4 decimali** prima del lookup in cache. Questo significa che punti entro ~11 metri dello stesso luogo condividono la stessa voce di cache.

### 4.5 Gerarchia amministrativa

Gli ambiti amministrativi sono organizzati in una gerarchia ad albero tramite `parent_id`:

```bash
# Vedere la struttura ad albero delle aree italiane
psql -U massimo -d travelog_dev << 'SQL'
WITH RECURSIVE area_tree AS (
  SELECT id, name, country_code, admin_level, parent_id, 0 AS depth,
         CAST(name AS VARCHAR(1000)) AS path
  FROM administrative_areas
  WHERE country_code = 'IT' AND parent_id IS NULL
  
  UNION ALL
  
  SELECT aa.id, aa.name, aa.country_code, aa.admin_level, aa.parent_id, 
         at.depth + 1,
         CAST(at.path || ' / ' || aa.name AS VARCHAR(1000))
  FROM administrative_areas aa
  JOIN area_tree at ON aa.parent_id = at.id
  WHERE aa.country_code = 'IT'
)
SELECT depth, path, country_code, admin_level, id
FROM area_tree
WHERE depth <= 2
ORDER BY path;
SQL
```

### Schema completo API Geographic (Fase 4)

| Operazione | Metodo | Endpoint/Tool | Descrizione | Stato |
|------------|--------|---------------|-------------|-------|
| Import dataset | CLI | `scripts/import-geodata.mjs` | Importa confini da GeoJSON | ✅ Implementato |
| Versioni dataset | DB Query | `dataset_versions` table | Elenco dataset importati | ✅ Disponibile |
| Lookup spaziale | Intern | `ST_Contains()` + GIST index | Trova area amministrativa per punto GPS | ✅ Funzionante |
| Cache geocoding | CRUD | `geocoding_cache` table | Cache persistenza risultati | ✅ Funzionante |
| Risoluzione gerarchia | Intern | Walk su `parent_id` | Ricostruisce albero amministrativo | ✅ Funzionante |

### Note tecniche Fase 4

1. **Precisione coordinate:** 4 decimali → ~11 metri di precisione (accettabile per boundari amministrativi).

2. **Performance spaziale:** La colonna `geom geometry(Polygon, 4326)` ha un indice GIST. Per query veloci su grandi dataset, usare query dirette su questa colonna invece che sulla colonna text `geometry`.

3. **Aggiornamento dataset:** Quando si importa una nuova versione di un dataset, la pipeline scan utilizza automaticamente la versione più recente registrata in `dataset_versions`.

4. **Offline-only:** Nessun servizio esterno di geocoding viene chiamato. Tutti i dati geografici risiedono nel database PostgreSQL locale.