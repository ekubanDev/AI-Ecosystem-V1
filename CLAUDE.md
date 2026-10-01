# CLAUDE.md

AI Business Factory: a system that discovers online business opportunities, gathers **source-backed evidence** with AI agents, and routes the result to a human for approval before any validation experiment. The specs are in `docs/specs/` (Blueprint → Technical Spec → Database & API Spec); the code implements the last. Status and next steps: `docs/HANDOFF.md`.

## Layout

| Path | What it is |
|---|---|
| `backend/` | Express 5 + Mongoose 9 API, agent framework, task worker (ESM, Node ≥ 22) |
| `frontend/` | React 19 + MUI v9 + React Router + TanStack Query, built with Vite |
| `e2e/` | Playwright browser suite (real Chromium, real API, **fake** AI/search/email) |
| `scripts/dev.mjs` | `setup` / `start` / `test` helper (also `npm run setup\|dev\|test` at the root) |

## Commands

```bash
node scripts/dev.mjs setup --owner you@example.com   # deps, backend/.env (generated JWT secrets), MongoDB (Docker if needed), OWNER
npm run dev                                           # API :3001 (+ in-process worker) and frontend :3000
cd backend && npm test                                # 110 tests; needs MongoDB (TEST_MONGODB_URI, default 127.0.0.1:27017)
cd frontend && npm test && npm run build              # 14 unit tests; build must pass
cd e2e && npm test                                    # 22 browser scenarios; needs `frontend` built first
```
CI (`.github/workflows/ci.yml`) runs backend (real `mongo:7`), frontend and e2e. **Run all three suites for any change that touches more than one layer; run e2e for any UI change.**

## Architecture in one screen

- **Pipeline:** `POST /api/discovery/run` → `DiscoveryRun` + Scout task → dedupe → per opportunity **Research → Competitor → Business Model → Analyst** → `AWAITING_APPROVAL` → human approves/rejects → experiments. Steps are `AgentTask`s in MongoDB (the durable queue); `orchestrator/taskWorker.js` claims them atomically; `orchestrator/orchestrator.js` persists output and queues the next step; retries/timeouts/cancel live in `orchestrator/taskRunner.js`.
- **Opportunity states** (`models/stateMachine.js`): DISCOVERED → RESEARCHING → ANALYZING → VALIDATED → AWAITING_APPROVAL → APPROVED → EXPERIMENT → …; PAUSED/REJECTED exits. All transitions go through `opportunityService.transitionOpportunity` (atomic conditional update + audit). `VALIDATED` means "analysed with evidence", **not** "proven profitable".
- **Layers:** `routes` → `middleware` (auth, `requireCapability`, `validate`, `idempotent`) → `controllers` (thin) → `services` → `models`. Validation is zod; parsed input is on `req.valid.{body,query,params}` (never read `req.body` after `validate`). Permissions: `backend/config/permissions.js` (mirrored in `frontend/src/auth/permissions.js` for showing/hiding buttons only; the server is the enforcer).
- **Responses:** `{ success, data, meta: { requestId, pagination? } }`; errors `{ success:false, error:{ code, message, details } }` (codes in `utils/errors.js`). Validation is 422, bad state 409.
- **Auth:** 15-min access JWT (memory only in the UI) + rotating HttpOnly refresh cookie (old refresh tokens die atomically; one session per user). The UI needs **one origin for app and `/api`** (Vite proxies in dev/preview; nginx in prod).
- **Audit:** append-only `AuditEvent`s, readable by OWNER/ADMIN at `/api/audit` (UI: Audit log page, opportunity History tab). Audit writes are best-effort.

## The rule that matters most: evidence before conclusions

Agents must never present inference as fact. This is enforced **in code**, not just prompts (`agents/agentUtils.js`, each agent, `orchestrator/persistence.js`):
- Sources are real `Source` records handed to the model as numbered documents; the model cites numbers; invalid citations are dropped.
- `VERIFIED`/`SUPPORTED` without a valid citation, or whose cited text doesn't lexically support the claim (`isGrounded`: figures must appear, ≥50% of content words must overlap) → downgraded to `INFERRED` and the citation dropped; snippet-only evidence is capped at MEDIUM. The grounding check is a cheap guard, not a semantic judge, and its threshold has not been calibrated on live data; confidence capped by evidence type; Analyst confidence capped at LOW with no sourced evidence; economics stored only with a stated basis; competitor pricing/complaints dropped without a citation.
- No search provider → Scout runs `KNOWLEDGE_ONLY` (everything inferred), Research/Competitor skip the model. Don't "fix" thin results by letting the model guess.
- Scraped page text is untrusted (delimited; can't close its block). Page fetching is SSRF-guarded (`utils/safeFetch.js`). Keep both properties when touching research code.
- Agents get only the capabilities they declare (`createAgentContext`); persistence checks write permission. Keep agents least-privilege.

## Gotchas (each cost real debugging time)

- **MUI v9 silently ignores removed props.** No `inputProps`/`InputProps`/`SelectProps` (use `slotProps`), and no system props (`fontWeight`, `color`, `display`, `justifyContent`, `alignItems`… ) on `Typography`/`Stack`/`Link` (use `sx`). `frontend/src/test/muiProps.test.js` guards this. The symptom is wrong styling/labels with no error.
- **Express 5:** `req.query` is read-only (hence `req.valid`). Async handler errors are forwarded automatically. Mongoose 9: use `returnDocument: "after"`, not `new: true`.
- **LLM schemas** are converted with `z.toJSONSchema`: **no `.transform()`** in them (normalize after parsing). Use `enumCI` for case-insensitive enums.
- **Express query parser is `simple`** and `$`/`.` keys are rejected everywhere: keep filters whitelisted; never pass request objects into Mongo queries.
- **User model has no `select:false`** on purpose (breaks `findOneAndUpdate` on some servers); secrets are stripped by `toJSON` and audit redaction. Never serialize a user another way.
- **Backend tests** use `tests/helpers.js` (sets env *before* importing app code: import it first), a scripted fake AI provider, fake search/fetch, capturing email. They never touch the network. Concurrency/`$text`/multi-`$sum` tests probe the database and **skip on MongoDB-compatible emulators** (FerretDB) — only real MongoDB runs them.
- **e2e scenarios share state and run in order**; the first failure is the one to read. The e2e server (`e2e/server.mjs`) exposes credentials by design: never deploy it.
- Refresh/CSRF: cookie endpoints check `Origin` against `CLIENT_URL` (default `http://localhost:3000`), so the dev server must stay on port 3000.

## Conventions

- ESM everywhere, no TypeScript. Match surrounding style; comments explain *why*, not what.
- New endpoint = route + `requireCapability` + zod validator + audit event where material + tests (incl. RBAC 401/403 and invalid input 422). New UI = error state (`ErrorAlert` shows the request id), loading state, empty state, role-gated actions.
- Migrations don't exist yet: adding required schema fields needs a backfill plan.
- Work in branches off `main`, open a PR, keep CI green; don't push to `main`.

## Secrets and safety

- **Never commit secrets.** `backend/.env` is git-ignored; the setup script generates JWT secrets and never overwrites it. API keys (`OPENAI_API_KEY`, `SEARCH_API_KEY`, `GMAIL_*`) go only in `backend/.env` or the deploy environment.
- **Don't accept API keys pasted into chat** — if one is pasted, tell the user to rotate it.
- Human approval gates are deliberate (approving opportunities, experiments with a budget). Don't automate them away.
- Live integrations (OpenAI, Tavily/Brave, Gmail SMTP) have **only been tested against fakes** so far; treat first live runs as likely to surface bugs.
