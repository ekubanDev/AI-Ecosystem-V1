# Browser end-to-end tests

Real Chromium driving the **built frontend** against the **real API, worker and MongoDB**. The AI, web search and email providers are the same fakes the backend tests use, so it needs no network access and no API keys.

```bash
# prerequisites: MongoDB on 127.0.0.1:27017 (or TEST_MONGODB_URI), and the frontend built
(cd ../frontend && npm ci && npm run build)
npm ci
npx playwright install chromium
npm test
```

`run-all.mjs` starts `server.mjs` (the test backend, seeded with one user per role and a finished discovery run, plus a helper on 127.0.0.1:3002 that exposes the seeded credentials and captured emails) and `vite preview` (which proxies `/api`), runs `run.mjs`, then tears everything down. Screenshots land in `shots/` (git-ignored; CI uploads them as an artifact).

`run.mjs` covers 22 scenarios: auth incl. the emailed verification link, live discovery progress, opportunity list/search/sort, every detail tab, approve/reject dialogs, the full experiment lifecycle with the budget gate, the audit log and History tab, role-restricted UI, the mobile drawer and logout. It fails on any uncaught page error or console error.

Environment: `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (use an existing Chromium instead of the managed one), `TEST_SEARCH_MODE=regex` (for MongoDB-compatible servers without `$text`), `E2E_BASE_URL`, `E2E_HELPER_URL`.

The scenarios share state and run in order; `server.mjs` must never be deployed (it exposes credentials by design).
