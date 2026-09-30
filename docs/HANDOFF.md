# Handoff — status and next steps

Written at the end of the first build session (backend, frontend, audit log, Gmail email transport, browser tests; PRs #1–#4 on `main`). Read `CLAUDE.md` first for architecture and gotchas; this file is *where things stand*.

## What exists

| Area | State |
|---|---|
| Backend API (auth, RBAC, opportunities, experiments, discovery, agents, dashboard, users, audit) | Done per the Database & API Spec, plus small additions (see README → *Deviations*) |
| Agent framework + 5 agents + discovery/analysis orchestrator | Done; retries, timeouts, cancel, stale-task recovery, cost tracking |
| Frontend (all spec pages + Users, Audit log) | Done |
| Tests | 110 backend, 14 frontend, 22 browser scenarios — all green in CI on real MongoDB |
| Dev tooling | `scripts/dev.mjs` (setup/start/test), Dockerfile + compose for the API |

## Verified vs not verified (be honest in reviews and demos)

**Verified:** everything exercised by the tests above — including concurrency (atomic approvals, refresh rotation, single task claim) and `$text` search on real MongoDB via CI.

**Never run against the real service — treat as unproven:**
1. **OpenAI** (`services/aiService.js`): default model `gpt-4.1-mini` is a guess; uses chat completions with `response_format: json_object`.
2. **Tavily / Brave search** (`services/searchProviders.js`): written from public docs only.
3. **Gmail SMTP** (`services/emailTransports.js`): tested with a fake mailer only.
4. **Real-world agent quality**: the prompts have only ever seen scripted fake responses.

## First session on a machine with network access (do this before anything else)

1. `node scripts/dev.mjs setup --owner you@example.com`, then put real values in `backend/.env`: `OPENAI_API_KEY`, `SEARCH_PROVIDER=tavily`, `SEARCH_API_KEY`, optionally `GMAIL_USER` + `GMAIL_APP_PASSWORD`, and `AI_PRICE_INPUT_PER_MTOK`/`AI_PRICE_OUTPUT_PER_MTOK` (otherwise cost shows "not priced"). Keys go in that file only — never in chat, issues or commits.
2. **Email:** register a throwaway account in the UI and confirm the verification mail arrives and the link works. If Gmail rejects the login, the error says to use an App Password (needs 2-step verification).
3. **Search:** run one Scout task directly (Agents → Agents → *Run directly*, `{"market":"Ghana","targetCount":3}`) and inspect the run (input, output, sources). Expect `mode: "SEARCH"` and real `Source` rows. If it fails, check the adapter's request/response shape first.
4. **AI:** same run — if the model name is rejected, change `OPENAI_MODEL`; if output fails schema validation repeatedly (`AGENT_ERROR`), look at `AgentRun.error` and relax/adjust the schema in the agent file.
5. **Full pipeline:** run Discovery with count 3. Open each opportunity → Evidence tab. Check: what share of claims cite a real source, how many were downgraded (run output `uncertainties` says so), whether competitors/pricing are real, cost per opportunity (Dashboard → AI cost).
6. Fix what breaks **with a test that reproduces it using the fake providers**, so CI keeps covering it.

## Suggested next work (in rough priority)

1. **Make the live results trustworthy**: prompt/schema tuning from step 5 above; surface downgraded-claim counts in the UI; add a small quality checklist per discovery run. Consider respecting `robots.txt` in `safeFetch`.
2. **Validation phase** (Technical Spec V0.3): landing-page factory, lead capture, experiment analytics, pre-order/pilot workflow.
3. **Discovery quality of life** (V0.2): scheduled discovery, opportunity alerts, Trend agent / Market scanner, vector knowledge base for past research.
4. **Businesses / portfolio** (V0.4+): a `Business` model and pages once an opportunity is launched; CFO/portfolio metrics.
5. **Audit**: export and retention controls (the log grows unbounded).
6. **Production**: run the worker as its own process (`npm run worker`, `RUN_WORKER=false` on API instances), nginx + TLS in front (one origin for app and `/api`; `TRUST_PROXY=1`), Mongo backups, consider Redis/BullMQ if the Mongo-polling queue becomes a bottleneck, multi-device sessions (refresh tokens are single-session today), a real deployment pipeline.

## Known limitations (also in README)

- Audit writes are best-effort (no cross-collection transactions on standalone MongoDB).
- Cancelling a discovery run stops in-flight agents only if the worker shares the API process; otherwise results are discarded.
- Page fetching can't fully close DNS-rebinding TOCTOU; deploy where internal services aren't reachable.
- The browser suite's scenarios share state and run in order.
- No schema migrations yet.

## Security follow-ups

- **Credentials were pasted into the build session's chat** (a Gmail app password, an OpenAI key, a Tavily key). They must be treated as exposed: rotate them if not already done, and don't reuse them.
- Decide who gets OWNER/ADMIN: the first registered account becomes OWNER, later ones start as VIEWER.
