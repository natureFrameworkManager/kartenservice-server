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
- Fix UI using wrong date for request of meals (one day off)

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
[endpoints.md](./endpoints.md)