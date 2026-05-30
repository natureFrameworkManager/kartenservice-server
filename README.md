# Kartenservice - Server/Middleware

A self-hosted middleware and web UI that bridges the university Kartenservice API with the OpenMensa and Mensa XML meal data sources. It stores transaction history and meal data locally in SQLite, matches purchased meals to menu entries, and exposes a REST API together with a management UI.

## Prerequisites

- Node.js ≥ 22 (uses the built-in `node:sqlite` module with `--experimental-sqlite`)
- npm

## Setup

### 1. Environment variables

Create a `.env` file in the project root based on the .env.example template.

### 2. Setup Infisical to store secrets

Create a `.env` file in the infisical directory based on the `infisical/.env.example` template, filling in the required values.
Run the docker-compose file at `infisical/docker-compose.yaml` to start a self-hosted Infisical instance for secret management.

### 3. Install dependencies

```bash
npm install
```

### 4. Build the UI CSS (optional)

```bash
cd ui
npx tailwindcss -i css/main.css -o css/css.css
```

Use `--watch` during development.

### 5. Run

```bash
node --experimental-sqlite server.js
```

The server listens on port `3000` by default.  
Web UI: `http://localhost:3000/ui`  
API docs: `http://localhost:3000/docs`

## API

See the full OpenAPI specification at [`docs/openapi.yaml`](docs/openapi.yaml) or browse the interactive Swagger UI at `/docs` when the server is running.

Authentication uses HTTP Basic Auth (`cardnumber:password`). For SSE endpoints (EventSource), pass the Base64-encoded credentials as a `?token=` query parameter instead of a header.

## Docker

A production-ready `Dockerfile` is included. It:
- Runs the Fastify server as an unprivileged `appuser` (UID 8888)
- Mounts `/data` as a persistent volume for `database.db`
- Installs a cron job that calls `sync-all.js` at 01:00 and hourly from 09:00–14:00

```bash
docker build -t kartenservice .
docker run -d \
  --env-file .env \
  -v kartenservice-data:/data \
  -p 3000:3000 \
  kartenservice
```

An Infisical self-hosted deployment (for secret management) can be started with the compose file at [`infisical/docker-compose.yaml`](infisical/docker-compose.yaml).

## ToDo

- Remove transaction history after card deletion
- Improve file structure (see suggestion below)

### Backend Bugs & Missing Implementations

#### Security
- **`PATCH /meals/:id`, `POST /locations`, `PUT /locations/:id` have no authentication** (`server.js`): These endpoints modify server data but have no `preHandler: authenticate`, so any unauthenticated user can overwrite meal categories and add/edit canteen locations
- **`POST /fetch/open-mensa` and `POST /fetch/mensa-xml` have no authentication** (`server.js`): Any anonymous caller can trigger remote fetches, causing unnecessary upstream API calls and potentially hitting rate limits

### Suggested File Structure Improvement

The current flat layout mixes server modules, UI assets, and tooling at the root. A cleaner structure:

```
kartenservice-server/
├── src/                        # All backend source
│   ├── server.js               # Fastify app + route registration
│   ├── routes/                 # One file per resource group
│   │   ├── cards.js
│   │   ├── meals.js
│   │   ├── locations.js
│   │   ├── transactions.js
│   │   └── fetch.js
│   ├── db.js                   # SQLite access layer
│   ├── logic.js                # Fetch orchestration + meal matching
│   └── api.js                  # Upstream HTTP clients
├── ui/                         # Frontend (unchanged)
│   ├── index.html
│   ├── js.js
│   ├── css/
│   └── assets/
├── docs/                       # Swagger UI (generated/static)
├── scripts/
│   └── sync-all.js             # Cron/CLI sync script
├── infisical/
│   └── docker-compose.yaml
├── kartenservice-api-doc/
│   └── openapi.yaml
├── Dockerfile
├── .env.example                # Committed template (no secrets)
├── package.json
└── README.md
```

Key changes:
- **`src/`** isolates all server-side JS from config and asset files at the root
- **`src/routes/`** splits the single large `server.js` into one file per resource group, making each endpoint group independently readable and testable
- **`scripts/`** makes it clear that `sync-all.js` is a CLI tool, not part of the running server
- **`.env.example`** replaces the undocumented `.env` requirement with a committed template

## Future Ideas

### New API Endpoints & Query Options

The patterns below are drawn from the AlmaWeb and Planer APIs (rich per-resource filtering, sparse fieldsets, pagination, sorting, export formats) and adapted to the data this server actually stores.

---

#### `GET /meals` — rich filtering, sorting, and pagination

The current endpoint returns the entire table unconditionally. Suggested query parameters (all optional; filters combine with **AND**, repeated values within one filter combine with **OR**):

| Parameter | Type | Description |
|---|---|---|
| `date` | `string (date)` | Exact date filter (`YYYY-MM-DD`). Repeatable — OR across values. |
| `date_from` | `string (date)` | Earliest date, inclusive. |
| `date_to` | `string (date)` | Latest date, inclusive. |
| `canteenId` | `integer` | Filter by canteen/location ID. Repeatable. |
| `name` | `string` | Case-insensitive substring match on meal name. Repeatable — OR across values. |
| `category` | `string` | Filter by `internalCategory`. Repeatable — OR. |
| `price_students_min` | `number` | Minimum student price, inclusive. |
| `price_students_max` | `number` | Maximum student price, inclusive. |
| `has_price` | `boolean` | `true` = only meals with at least one non-null price; `false` = meals with no price data. |
| `fields` | `string[]` | Sparse fieldset — return only the listed fields. Repeatable. Omit for all fields. |
| `sort` | `string` | Column to sort by: `date`, `name`, `canteenId`, `category`, `price_students`. Default: `date`. |
| `order` | `asc` \| `desc` | Sort direction. Default: `asc`. |
| `page` | `integer ≥ 1` | Page number. Pagination is disabled when both `page` and `page_size` are omitted. |
| `page_size` | `integer ≥ 1` | Items per page. |
| `format` | `json` \| `csv` | Response format. `csv` sets `Content-Type: text/csv` and streams a flat table. |

Response when paginated:
```json
{ "items": [...], "total": 240, "page": 2, "page_size": 50, "pages": 5 }
```

---

#### `GET /meals/today`, `/meals/tomorrow`, `/meals/week`

Convenience shortcuts, equivalent to calling `GET /meals?date={today}` etc. All accept the same filtering and pagination parameters as `GET /meals` except `date`, `date_from`, and `date_to`.

- `GET /meals/today[?canteenId=&category=&fields=&format=]`
- `GET /meals/tomorrow[?canteenId=&category=&fields=&format=]`
- `GET /meals/week[?canteenId=&category=&page=&page_size=&format=]` — all meals for the current calendar week (Monday–Sunday)

---

#### `GET /meals/range/{startDate}/{endDate}`

Returns all meals for the given date range. Accepts the same filter/sort/pagination params as `GET /meals` (minus the date params). The Essensplan API caps range queries to prevent unbounded responses; a `MAX_RANGE_DAYS` environment variable (default 31) should enforce this.

---

#### `GET /meals/distinct/fields`

Mirrors AlmaWeb's `/modules/distinct/fields` and `/events/distinct/fields`. Returns the set of distinct values for a given column, useful for building filter dropdowns without a full table fetch.

| Parameter | Type | Description |
|---|---|---|
| `field` | `string` (required) | Column name: `date`, `canteenId`, `category`, `name`. |
| `date_from` | `string (date)` | Constrain distinct values to this date range. |
| `date_to` | `string (date)` | Constrain distinct values to this date range. |
| `canteenId` | `integer` | Pre-filter before collecting distinct values. Repeatable. |

Example: `GET /meals/distinct/fields?field=category` → `["Hauptgericht", "Beilage", "Dessert"]`

---

#### `GET /meals/available-dates[/{year}]`

Mirrors Essensplan's `/available-days/{year}` and `/years`. Returns dates for which at least one meal row exists locally — lets calendar UIs enable only those days.

- `GET /meals/available-dates` — all available dates across all years
- `GET /meals/available-dates/{year}` — scoped to a single year
- `GET /meals/available-years` — list of years that have at least one meal row

---

#### `GET /meals/card/:cardNumber` — additional filters

The matched-meal endpoints already exist but are not filterable. Suggested additions matching the pattern on `GET /meals`:

| Parameter | Type | Description |
|---|---|---|
| `date_from` | `string (date)` | Filter matched meals from this date. |
| `date_to` | `string (date)` | Filter matched meals to this date. |
| `canteenId` | `integer` | Filter by canteen. Repeatable. |
| `category` | `string` | Filter by `internalCategory`. Repeatable. |
| `fields` | `string[]` | Sparse fieldset. |
| `sort` | `string` | `date`, `name`, `price_students`. Default: `date`. |
| `order` | `asc` \| `desc` | Default: `desc` (most recent first). |
| `page` / `page_size` | `integer` | Pagination. |
| `format` | `json` \| `csv` | Export format. |

---

#### `GET /trans/:cardNumber` — filtering, sorting, pagination

The current endpoint returns the full history with no filtering. Suggested query parameters:

| Parameter | Type | Description |
|---|---|---|
| `date_from` | `string (date)` | Earliest transaction date, inclusive. |
| `date_to` | `string (date)` | Latest transaction date, inclusive. |
| `amount_min` | `number` | Minimum transaction amount (absolute value). |
| `amount_max` | `number` | Maximum transaction amount. |
| `description` | `string` | Case-insensitive substring match on the transaction description. |
| `sort` | `string` | `date`, `amount`. Default: `date`. |
| `order` | `asc` \| `desc` | Default: `desc`. |
| `page` / `page_size` | `integer` | Pagination. |
| `format` | `json` \| `csv` | Export all matching transactions as a CSV. |

---

#### `GET /trans/:cardNumber/stats`

Aggregate spending summary for the authenticated card. No filter parameters needed initially, though accepting the same `date_from` / `date_to` window as `GET /trans` would be useful.

```json
{
  "total_spent": 142.50,
  "transaction_count": 47,
  "date_range": { "from": "2025-10-01", "to": "2026-05-30" },
  "by_canteen": [
    { "canteenId": 1, "name": "Mensa Hauptgebäude", "total": 98.20, "count": 31 }
  ],
  "by_category": [
    { "category": "Hauptgericht", "total": 87.00, "count": 29 }
  ],
  "by_month": [
    { "month": "2026-04", "total": 22.50, "count": 8 }
  ]
}
```

---

#### `GET /transpos/:cardNumber` — filtering and pagination

Mirrors the enhancements for `/trans`:

| Parameter | Type | Description |
|---|---|---|
| `date_from` / `date_to` | `string (date)` | Filter by position date. |
| `name` | `string` | Substring match on position/item name. |
| `sort` | `string` | `date`, `amount`. Default: `date`. |
| `order` | `asc` \| `desc` | Default: `desc`. |
| `page` / `page_size` | `integer` | Pagination. |
| `format` | `json` \| `csv` | Export. |

---

#### `GET /card/:cardNumber`

Returns non-sensitive metadata for a registered card. Requires authentication as that card.

```json
{
  "cardNumber": "12345678",
  "registeredAt": "2025-09-15T10:23:00Z",
  "lastFetchAt": "2026-05-30T08:01:00Z",
  "transactionCount": 47,
  "transactionPositionCount": 132
}
```

---

#### `GET /locations` — filtering and field selection

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Case-insensitive substring match on `name` or `internalName`. |
| `has_open_mensa_id` | `boolean` | `true` = only locations with an `openMensaId`. |
| `has_mensa_xml_id` | `boolean` | `true` = only locations with a `mensaXMLId`. |
| `fields` | `string[]` | Sparse fieldset: `id`, `name`, `internalName`, `openMensaId`, `mensaXMLId`. |
| `sort` | `string` | `id`, `name`. Default: `id`. |
| `order` | `asc` \| `desc` | Default: `asc`. |

#### `DELETE /locations/:id`

Completes the CRUD surface that `POST /locations` and `PUT /locations/:id` already started. Should reject deletion if meals referencing this location exist (return `409 Conflict`) unless a `?force=true` query parameter is passed.

---

#### `GET /meta/health`

Liveness check. Returns `200` with server state; used by load balancers and uptime monitors.

```json
{
  "status": "ok",
  "uptime_seconds": 3602,
  "db": "reachable",
  "infisical": "reachable"
}
```

#### `GET /meta/stats`

Mirrors AlmaWeb's `/admin/stats`. Returns row counts and last-sync timestamps for monitoring dashboards.

```json
{
  "meals": { "count": 4820, "last_inserted": "2026-05-30T08:00:00Z" },
  "transactions": { "count": 312 },
  "transaction_positions": { "count": 891 },
  "cards": { "count": 3 },
  "locations": { "count": 7 }
}
```

---

#### OpenMensa compatibility

The Essensplan API exposes a `/openmensa/feed-v2` endpoint so canteens can be listed on [openmensa.org](https://openmensa.org). Since this server already caches OpenMensa meal data locally, re-exposing it as a standard feed allows third-party OpenMensa clients to consume it without a custom integration.

- `GET /openmensa/feed-v2[?canteenId=]` — OpenMensa v2.1 XML feed built from the local meal database, optionally scoped to a single canteen
- `GET /openmensa/api-v2/canteens` — list registered canteens in OpenMensa API v2 JSON format
- `GET /openmensa/api-v2/canteens/:id/days[?start=]` — list days that have meals for a canteen
- `GET /openmensa/api-v2/canteens/:id/days/:date/meals` — meals for a specific day in OpenMensa format
