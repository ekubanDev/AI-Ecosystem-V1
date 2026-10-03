# Handoff — status and next steps

Written at the end of the first build session (PRs #1–#4), updated after the first live-service session (PRs #6–#10, October 2026). Read `CLAUDE.md` first for architecture and gotchas; this file is *where things stand*.

## What exists

| Area | State |
|---|---|
| Backend API (auth, RBAC, opportunities, experiments, discovery, agents, dashboard, users, audit) | Done per the Database & API Spec, plus small additions (see README → *Deviations*) |
| Agent framework + 5 agents + discovery/analysis orchestrator | Done; retries, timeouts, cancel, stale-task recovery, cost tracking |
| Frontend (all spec pages + Users, Audit log) | Done; opportunity page shows evidence-quality counts under the title |
| Tests | 145 backend, 22 frontend, 24 browser scenarios, all green (the browser suite passed locally for the first time with the landing-page work; it needs ports 3000-3002 free) |
| Business Architect (Blueprint Phase 4, first slice) | Sixth agent: drafts a business blueprint (positioning, offer, brand ideas, pricing hypotheses, MVP scope, manual-first plan, launch checklist, validation gates) for an *approved* opportunity; Blueprint tab on the opportunity page. Planning only: no product generation, deployment or brand/domain checks yet. **Run live once for B2BMAP** (about 15 s, ~6.5k tokens, no schema failures). That showed it ignored the running experiment and hid a paid-ads step in the plan; both fixed (it now receives each experiment's method and success criteria, and plan steps get the same approval flag as checklist items). Output quality beyond that one opportunity is unreviewed |
| Validation (first slice) | Public landing page per approved opportunity (`/p/:slug`) with consent-based lead capture, a *Landing page & leads* tab (publish = OWNER/ADMIN, leads = OWNER/ADMIN/ANALYST), lead status and deletion. Results panel per page: views, leads, conversion, by day and source (cookie-free counters, so views include refreshes and bots; conversion is only a rough signal under ~30 views). Still no payments or CRM |
| Dev tooling | `scripts/dev.mjs` (setup/start/test), Dockerfile + compose for the API. **Node ≥ 22 is required** (`openai@7`); `.nvmrc` is provided |

## Verified vs not verified (be honest in reviews and demos)

**Verified with the real services (first live session):**
- **OpenAI** (`gpt-4.1-mini`) and **web search** work end to end: discovery runs complete, `mode: SEARCH`, real `Source` rows. Typical agent durations: Competitor/Research ~35 s, Business Model/Analyst ~8 s; a tiny call is ~1 s.
- Full pipeline ran live: Scout → Research → Competitor → Business Model → Analyst → AWAITING_APPROVAL (4 of 4 opportunities completed with no failed tasks after the fixes below).

**Still unproven:**
1. **Gmail SMTP** (`services/emailTransports.js`): tested with a fake mailer only. Register a throwaway account and confirm the verification mail arrives.
2. **Browser suite on a dev machine**: it needs ports 3000/3001 free (it starts its own API and preview). It failed locally only because a dev stack was already running; it has not been seen passing on this machine. CI runs it.
3. **Grounding threshold** (see below): unit-tested, not calibrated on live data.

## What the first live runs taught us (and what was fixed)

Fixed (all merged):
- **Schema caps rejected whole runs.** The model returned more search queries than `max(6/8)`; 20 of 34 Competitor runs failed. Caps raised (agents already slice). Validation issues are now in `AgentRun.error` so failures are diagnosable.
- **Citation mismatch.** A VERIFIED/HIGH claim cited a source about a different company. `resolveEvidence` now requires cited text to contain the claim's figures and ≥50% of its content words, else downgrades to INFERRED and drops the citation; snippet-only evidence is capped at MEDIUM (`agents/agentUtils.js`, `isGrounded`).
- **Duplicates** (TradeDepot, Shopa, AgroCenta, Trade Ghana, Boost Ghana, Make Jewel listed twice): `findDuplicate` now also matches by brand and by distinctive words (`services/opportunityService.js`).
- **Noise sources** (finance.yahoo.com was the most-cited domain): `SEARCH_BLOCKED_DOMAINS` drops them.
- **Off-mission output** (generic "European …" patterns for a Ghana/Africa mission): Scout prompts now require the geography in queries and specific named businesses. Prompt-only, so it reduced but did not eliminate this.

Measured effect on a fresh run (count 5): HIGH-confidence claims fell from 87% to 43%; 7 of 58 claims were downgraded by grounding; no blocked domains; all four candidates tagged Ghana.

## Open issues and cautions

- **The 38 opportunities from the first live batch are lower quality** (generic European patterns, duplicates, noisy competitors). 17 of them are APPROVED. Nothing was changed automatically — approvals are a human gate. Review them and reject/un-approve the weak ones before acting on any.
- **Residual weak candidates still appear**, e.g. a vendor product (Yo!Kart) with irrelevant competitors, and a category ("B2B Data and Directory Services") instead of a business. Idea: reject category-style names in code; consider a stricter "is this a specific business operating in/near the target market" check.
- **Grounding threshold is a guess.** `Source` stores only a 500-character summary (and, despite the `SEARCH_RESULT` type, fetched pages are stored the same way), so past claims cannot be replayed against the text the model actually saw. To calibrate, log grounding outcomes per run or store more text, then tune `GROUNDING_MIN_OVERLAP`. Watch the "downgraded" count on new runs: if most real claims are downgraded the threshold is too strict.
- **`Source.sourceType` is not a reliable "was the page fetched" signal.** Consider recording `fetched: true/false`.
- **Competitor data is thin:** across the first batch, 32% had a website, 17% pricing, 7% any customer complaint, and several were irrelevant large companies.
- **Retries are short.** Four attempts happen within about a minute, so a brief network drop sends a task to WAITING_REVIEW (use *Retry* on the task). A longer backoff would be kinder.
- **Undiagnosed failures:** one Business Model and one Analyst run failed with schema validation before the error text carried details. The next occurrence will show the field.
- **Cost tracking is wrong until the prices are fixed.** `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` are *dollars per million tokens*, but `backend/.env` held per-token amounts (0.0000015 / 0.000006), so every recorded cost is ~a million times too small. Set them to the model's real per-million prices (e.g. 1.5 and 6 if those were the intended rates). Runs recorded earlier keep their wrong cost.
- **Stray servers silently share the database.** Every API process runs its own task worker. A forgotten old-code server once claimed a new agent's task and failed it ("Unknown agent"). Before debugging task failures run `ps -axo pid,lstart,command | grep "node.*server.js"` and stop old ones.
- **Evidence-quality row** is on the detail page only (the list endpoint does not return evidence) and its "downgraded" count reads the agents' note in `uncertainties`, so it only covers newer runs.

## Suggested next work (in rough priority)

1. **Triage the existing opportunities** (human): reject/un-approve the weak ones; decide whether to re-run discovery for the same mission with the fixed pipeline.
2. **Verify Gmail** and run the browser suite locally once the dev servers are stopped.
3. **Calibrate grounding** with live data (see above); add the `fetched` flag.
4. **Category-name rejection and competitor quality** (completeness, relevance filter).
5. **Validation phase** (Technical Spec V0.3): landing-page factory, lead capture, experiment analytics, pre-order/pilot workflow.
6. **Discovery quality of life** (V0.2): scheduled discovery, opportunity alerts, Trend agent / Market scanner, vector knowledge base. Consider respecting `robots.txt` in `safeFetch`.
7. **Businesses / portfolio** (V0.4+): a `Business` model and pages once an opportunity is launched; CFO/portfolio metrics.
8. **Audit**: export and retention controls (the log grows unbounded).
9. **Production**: worker as its own process (`npm run worker`, `RUN_WORKER=false` on API instances), nginx + TLS (one origin for app and `/api`; `TRUST_PROXY=1`), Mongo backups, Redis/BullMQ if the Mongo-polling queue becomes a bottleneck, multi-device sessions, a real deployment pipeline.

## Known limitations (also in README)

- Audit writes are best-effort (no cross-collection transactions on standalone MongoDB).
- Cancelling a discovery run stops in-flight agents only if the worker shares the API process; otherwise results are discarded.
- Page fetching can't fully close DNS-rebinding TOCTOU; deploy where internal services aren't reachable.
- The browser suite's scenarios share state and run in order.
- No schema migrations yet.

## Operating notes

- **Ports:** the dev setup needs 3000 (frontend) and 3001 (API). Starting a second API on 3001 makes `npm run dev`'s backend fail silently and the UI then shows 502 on login. Stop stray servers first (`lsof -tiTCP:3001 -sTCP:LISTEN | xargs kill`).
- **`backend/.env` is never overwritten by setup.** If it exists without the JWT secrets, the app refuses to start; rebuild it from `.env.example` (keep your keys, generate two distinct 32+ char secrets).

## Security follow-ups

- **Credentials were pasted into earlier chat sessions** (a Gmail app password, an OpenAI key, a Tavily key). They have since been rotated; make sure the rotated values are the ones in `backend/.env`, and delete any `backend/.env.bak`.
- A seeded OWNER password was also shown in chat during setup; change it after first login and avoid sharing passwords in chat.
- Decide who gets OWNER/ADMIN: the first registered account becomes OWNER, later ones start as VIEWER.
