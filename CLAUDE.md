# Vector Brain — notes for AI coding sessions

- **Read [docs/RELIABILITY.md](docs/RELIABILITY.md) before changing the agent,
  the engines, the companion APK protocol or anything that decides whether a run
  succeeded.** Its hierarchy of methods, per-action checks, handoff rules, limits
  and KPIs are the standard every such change is judged against.
- Work lands on `develop` only. A push to `develop` deploys to production
  (Coolify, after CI's "Build gate") and restarts the server, which cuts off
  runs in progress: batch changes and push when no large run is going.
- The repository is public: never commit secrets, tokens, run data or exports.
- Before shipping: backend `npm run build` + `npx jest`, frontend
  `cd frontend && npx tsc -b && npm run build`, and the harness
  (`node test/harness/run.mjs`, needs MariaDB with test/harness/.env.harness).
