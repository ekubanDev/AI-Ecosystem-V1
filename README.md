# AI Business Factory

An AI-agent system that discovers online business opportunities, gathers **source-backed evidence**, reverse-engineers business models, and routes the results to a human for approval before any validation experiment.

This repository currently contains **Backend Implementation v0.1** — the executable form of the three specifications in [`docs/specs/`](docs/specs):

| Document | Role |
|---|---|
| [Blueprint v0.1](docs/specs/AI_Business_Factory_Blueprint_v0.1.md) | Strategy, agent hierarchy, guiding rules |
| [Technical Specification v0.1](docs/specs/AI_Business_Factory_Technical_Specification_v0.1.md) | Architecture, agents, workflow |
| [Database & API Specification v0.1](docs/specs/AI_Business_Factory_Database_API_Specification_v0.1.md) | Schemas, API contracts, states (this backend implements it) |

The React frontend is the next milestone and is **not** part of this change.

## Quick start

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
docker/docker-compose.yml   MongoDB + API
```

## Deviations from the specs

* Added `DiscoveryRun` (needed by `/api/discovery/runs`) and `IdempotencyKey` collections.
* Opportunity gains `analysis`, `uncertainties`, `assumptions`, `pausedFromStatus`, `decision`, `discoveryRunId`, `economics.basis`; `BusinessModel.evidenceTypes` records the evidence type per field.
* Extra endpoints: `POST /opportunities/:id/pause|resume`, `POST /experiments/:id/cancel`, `GET /agents/tasks`, `POST /agents/tasks/:id/retry`, `GET|PATCH /users`.
* `capitalRequirement: LOW_TO_MEDIUM` (Analyst output) maps to `MEDIUM` on the stored `complexity.capital` enum.
* Registration returns 409 for duplicate emails as the spec's test matrix requires (this reveals account existence; forgot-password/resend do not).

## Not included / known limitations

* **Email delivery**: only a logging transport ships; plug a provider into `createEmailService({ transport })`. No provider was named in the specs.
* **Search adapters** (Tavily, Brave) follow the public API docs but were **not exercised against the live services**; the OpenAI provider likewise has not been run against the real API here. Tests inject fakes.
* **Refresh tokens are single-session** (rotation increments a per-user version), so signing in on a second device signs out the first.
* Audit writes are best-effort (standalone MongoDB has no cross-collection transactions); failures are logged.
* Page fetching does not honour `robots.txt` yet, and can't fully close DNS-rebinding TOCTOU — deploy the API where internal services aren't reachable.
* Cancelling a discovery run aborts in-flight agents only when the worker runs in the same process as the API; with a separate worker process their results are discarded instead.
* Cost is recorded only when `AI_PRICE_*_PER_MTOK` is set; otherwise `estimatedCost` is `null` (no guessed prices).

## Test status

`npm test` passes locally against **FerretDB** (a MongoDB-compatible server), not real MongoDB — the sandbox this was built in could not download `mongod`. FerretDB lacks `$text`, atomic conditional `findOneAndUpdate` under concurrency, TTL indexes, and multi-`$sum` groups, so the tests that need those probe the server and **skip themselves with a reason** there (search via `$text`, concurrent approve/refresh/claim races, token totals on the dashboard). CI (`.github/workflows/ci.yml`) runs the whole suite against real `mongo:7`, where they execute. Until that has run green, treat those behaviours as designed-for but unverified.
