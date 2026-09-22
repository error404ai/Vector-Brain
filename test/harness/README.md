# Test harness

Runs the real backend against a throwaway database with fake phones, and checks
the orchestration behaviour that used to break in production.

```
pnpm run build          # the harness runs dist/app.js
pnpm run harness        # all scenarios
pnpm run harness lane   # only scenarios whose name contains "lane"
```

**Needs:** a local MySQL/MariaDB with the user and password in `.env.harness`
(the database itself is dropped and recreated on every run — never point this at
production).

**How it works**
- `AGENT_SIMULATION=1` makes each run perform real device actions over the
  WebSocket but skip the AI model, so no tokens are spent. It is ignored when
  `NODE_ENV=production`. Tune a run with `[sim steps=6 delay=400 fail]` in the prompt.
- `fake-phone.mjs` speaks the companion protocol: register, heartbeat, action
  responses; it can drop the connection, go silent, or fail actions.
- A local rotation endpoint on port 4700 stands in for the proxy provider.

**Scenarios:** basic run · proxy lane concurrency · Stop All with a queue ·
graceful shutdown · hard crash + lease sweep · phone dropping mid-run · hung phone.

Every fix to orchestration should come with a scenario here that fails before
the fix and passes after it.
