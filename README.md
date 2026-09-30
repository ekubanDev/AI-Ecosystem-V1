# AI Business Factory

An AI-agent system that discovers online business opportunities, gathers **source-backed evidence**, reverse-engineers business models, and routes the results to a human for approval before any validation experiment.

This repository contains **Backend Implementation v0.1** and the **React frontend** — the executable form of the three specifications in [`docs/specs/`](docs/specs):

| Document | Role |
|---|---|
| [Blueprint v0.1](docs/specs/AI_Business_Factory_Blueprint_v0.1.md) | Strategy, agent hierarchy, guiding rules |
| [Technical Specification v0.1](docs/specs/AI_Business_Factory_Technical_Specification_v0.1.md) | Architecture, agents, workflow |
| [Database & API Specification v0.1](docs/specs/AI_Business_Factory_Database_API_Specification_v0.1.md) | Schemas, API contracts, states (this backend implements it) |

> Continuing the project in an AI coding tool (e.g. Claude Code in Cursor)? Read [`CLAUDE.md`](CLAUDE.md) (architecture, rules, gotchas) and [`docs/HANDOFF.md`](docs/HANDOFF.md) (status, what's unverified, next steps).

## Quick start

Fastest path (Node ≥ 20; uses Docker for MongoDB only if none is running):

```bash
node scripts/dev.mjs setup --owner you@example.com   # prints a one-time password; never overwrites backend/.env (re-running --owner for the same email resets that account's password)
npm run dev                                          # API :3001 + frontend :3000
node scripts/dev.mjs test [--e2e]                    # all test suites
```

Manual path:

```bash
cd backend
cp .env.example .env            # set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (see comment in the file)
npm install
docker run -d -p 27017:27017 mongo:7      # or: docker compose -f ../docker/docker-compose.yml up --build
SEED_OWNER_EMAIL=you@example.com SEED_OWNER_PASSWORD='choose-a-strong-one' npm run seed
npm start                       # API + in-process task worker on :3001
npm test
```

Smoke test (verification links are printed to the server log until an email provider is plugged in — see *Not included*):

```bash
curl -s localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"choose-a-strong-one"}'
# then, with the returned accessToken:
curl -s localhost:3001/api/discovery/run -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"objective":"Find B2B opportunities adaptable to Ghana.","count":20,"market":"Ghana","customerType":"B2B"}'
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 — proxies /api to the backend on :3001
npm test           # unit tests
npm run build      # static files in frontend/dist
```

Log in with the account you seeded. Pages: Overview, Opportunities (search/filter/sort, details with Evidence · Business model · Competitors · Economics · Differentiation · Experiments · Agent runs · Decision tabs), Discovery (run + live progress), Experiments, Agents (registry, runs, tasks with retry), Users and Audit log (owner/admin), Settings. Buttons a role can't use are hidden; the server still enforces every rule.

The UI relies on **one origin for the app and `/api`** (the refresh token is an HttpOnly cookie). The dev server and `vite preview` proxy `/api`; in production serve `frontend/dist` and reverse-proxy `/api/` to the backend, e.g. with nginx:

```nginx
location /api/ { proxy_pass http://backend:3001; proxy_set_header X-Forwarded-For $remote_addr; }
location /     { root /srv/abf; try_files $uri /index.html; }
```

Set `TRUST_PROXY=1` on the backend and `CLIENT_URL` to the public origin.

To get real results configure `OPENAI_API_KEY` **and** a search provider (`SEARCH_PROVIDER=tavily|brave` + `SEARCH_API_KEY`). Without a search provider the agents cannot gather sources; they say so and report thin evidence instead of inventing any (see below).

## How it works

```
POST /api/discovery/run ─► DiscoveryRun + Scout task
                               │  (worker claims tasks from MongoDB; durable across restarts)
        Scout ─► dedupe ─► per opportunity:  Research ─► Competitor ─► Business Model ─► Analyst
                               │                                                        │
                               └───────────────  persisted as evidence  ◄───────────────┘
                                        opportunity: DISCOVERED → RESEARCHING → ANALYZING → VALIDATED → AWAITING_APPROVAL
                                                         human: approve / reject / pause  ─► experiments
```

* **Tasks & runs.** Every step is an `AgentTask` (work to do); each execution is an `AgentRun` (input, output, model, tokens, cost, duration, error). Retry policy: transient failures go `FAILED → RETRYING → QUEUED` with exponential backoff up to `MAX_AGENT_RETRIES` (3), then `WAITING_REVIEW`; permanent errors stay `FAILED`. OWNER/ADMIN can re-queue either via `POST /api/agents/tasks/:id/retry`.
* **State machine.** Opportunity transitions are enforced server-side with atomic conditional updates (concurrent approvals can't double-fire) and audited. `VALIDATED` means "analysed with evidence attached", not "proven profitable".
* **Human gates.** Approving opportunities, rejecting/pausing, and starting experiments that spend money (`budget > EXPERIMENT_APPROVAL_BUDGET_THRESHOLD`) require OWNER/ADMIN.
* **Roles.** OWNER / ADMIN / ANALYST / VIEWER per spec §4. The first registered account becomes OWNER; later ones are VIEWERs until promoted (`PATCH /api/users/:id`).

### Evidence integrity (the spec's governing rule)

Agents never cite sources they made up: web results are stored as `Source` records and handed to the model as numbered documents; the model cites numbers, and the backend resolves them.

* A claim labelled `VERIFIED`/`SUPPORTED` that cites no real source is downgraded to `INFERRED`; confidence is capped by evidence type (estimates never `HIGH`).
* Competitor pricing/complaints without a valid citation are dropped; a price range is stored only if cited; economic estimates are stored only with a stated basis.
* The Analyst's confidence is capped at `LOW` when nothing sourced backs the analysis.
* Scraped page text is treated as untrusted data (delimited, cannot close its block, instructions in it are ignored by the system prompt).
* With no search provider the Scout runs in `KNOWLEDGE_ONLY` mode (all claims `INFERRED`/`ASSUMED`, no sources) and Research/Competitor skip the model entirely.

### Security notes

JWT access token (15 min) + rotating HttpOnly refresh cookie (old refresh tokens die atomically); hashed single-use verification/reset tokens; bcrypt; Helmet; CORS allow-list; rate limits; zod validation with stripped unknown keys; Mongo-operator injection rejected (`$`/`.` keys) and simple query parser; whitelisted filters/sorts; append-only audit log; SSRF-guarded page fetching (public http(s) only, every redirect hop re-checked); `Idempotency-Key` on discovery, analyze, direct agent runs and experiment start.

## Layout

```
backend/
  config/ models/ validators/ middleware/ controllers/ routes/ services/   HTTP + data layer
  agents/            BaseAgent, registry, the five agents, prompt/evidence helpers
  orchestrator/      workflows, task runner (retries, timeouts, cancel), worker, persistence
  scripts/seed.js    create the first OWNER
  tests/             node:test + supertest, no network (fake AI / search / email)
frontend/          React + MUI + React Router + TanStack Query (Vite)
docker/docker-compose.yml   MongoDB + API
```

## Deviations from the specs

* Added `DiscoveryRun` (needed by `/api/discovery/runs`) and `IdempotencyKey` collections.
* Opportunity gains `analysis`, `uncertainties`, `assumptions`, `pausedFromStatus`, `decision`, `discoveryRunId`, `economics.basis`; `BusinessModel.evidenceTypes` records the evidence type per field.
* Extra endpoints: `POST /opportunities/:id/pause|resume`, `POST /experiments/:id/cancel`, `GET /agents/tasks`, `POST /agents/tasks/:id/retry`, `GET|PATCH /users`, `GET /audit` and `GET /audit/facets` (OWNER/ADMIN; filter by action, resource, actor, actor type and date range; events carry IP/user agent, so the log is not exposed to ANALYST/VIEWER).
* `capitalRequirement: LOW_TO_MEDIUM` (Analyst output) maps to `MEDIUM` on the stored `complexity.capital` enum.
* Registration returns 409 for duplicate emails as the spec's test matrix requires (this reveals account existence; forgot-password/resend do not).

## Not included / known limitations

* **Email delivery**: set `GMAIL_USER` + `GMAIL_APP_PASSWORD` (a Google *App Password*, not the account password) to send verification/reset mail through Gmail SMTP; leave them empty to log the links instead. Sending is best-effort: a provider outage never fails registration or reveals whether an address exists (users can use "resend"). The Gmail transport is tested with a fake mailer only — **it has not been run against Gmail**. Only SMTP is implemented; other providers plug in via `createEmailService({ transport })`.
* **Search adapters** (Tavily, Brave) follow the public API docs but were **not exercised against the live services**; the OpenAI provider likewise has not been run against the real API here. Tests inject fakes.
* **Refresh tokens are single-session** (rotation increments a per-user version), so signing in on a second device signs out the first.
* Audit events are readable through the API and UI but never editable or deletable (append-only at the model level). Audit writes are best-effort (standalone MongoDB has no cross-collection transactions); failures are logged.
* Page fetching does not honour `robots.txt` yet, and can't fully close DNS-rebinding TOCTOU — deploy the API where internal services aren't reachable.
* Cancelling a discovery run aborts in-flight agents only when the worker runs in the same process as the API; with a separate worker process their results are discarded instead.
* Cost is recorded only when `AI_PRICE_*_PER_MTOK` is set; otherwise `estimatedCost` is `null` (no guessed prices).

## Frontend notes

* The access token is held in memory only; a non-sensitive `localStorage` flag tells a returning visitor to try the refresh cookie (first-time visitors don't fire a doomed request). Refresh is single-flight because refresh tokens rotate.
* Evidence is never shown without its type: sourced claims (`VERIFIED`/`SUPPORTED`) and AI inference (`INFERRED`/`ASSUMED`) have distinct chips, the Evidence tab states how many claims cite a stored source, and economic figures carry an "AI estimates, not facts" warning with their stated basis.
* Source links only render for `http(s)` URLs and use `rel="noopener noreferrer nofollow"`.
* MUI v9 silently ignores removed props (`inputProps`, `fontWeight`, `color`… on `Typography`/`Stack`); a unit test guards against reintroducing them.
* Verified with 14 unit tests plus a 22-scenario Playwright suite in real Chromium against the real backend and worker (fake AI/search/email providers; see [`e2e/`](e2e)), which also runs in CI: auth incl. email verification, live discovery progress, evidence/competitor/economics tabs, approve/reject dialogs, the experiment lifecycle with the budget gate, role-restricted UI, mobile drawer, logout.
* The Audit log page (owner/admin) filters and pages through events and opens a full before/after/metadata view; each opportunity has a History tab (same roles) showing its ordered status path.
* Not built: Businesses/portfolio pages.

## Test status

`npm test` passes locally against **FerretDB** (a MongoDB-compatible server), not real MongoDB — the sandbox this was built in could not download `mongod`. FerretDB lacks `$text`, atomic conditional `findOneAndUpdate` under concurrency, TTL indexes, and multi-`$sum` groups, so the tests that need those probe the server and **skip themselves with a reason** there (search via `$text`, concurrent approve/refresh/claim races, token totals on the dashboard). CI (`.github/workflows/ci.yml`) runs the whole suite against real `mongo:7`, where they execute. Until that has run green, treat those behaviours as designed-for but unverified.
