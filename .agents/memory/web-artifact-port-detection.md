---
name: web-artifact port detection broken in this environment
description: react-vite (kind="web") artifacts fail workflow port-detection probe despite healthy servers; not a code/config issue.
---

# Symptom
Restarting any `kind = "web"` artifact workflow (react-vite scaffold) fails with
`DIDNT_OPEN_A_PORT` / `openPorts: null`, even though vite logs "ready" and the
server genuinely serves HTTP 200.

# Proof it is environment-level, not the app
- A brand-new, unmodified `createArtifact({artifactType:"react-vite"})` scaffold
  (zero custom code/deps) fails the probe identically.
- The same vite server, run manually with the same env (PORT/BASE_PATH/NODE_ENV/REPL_ID),
  returns 200 on: direct `127.0.0.1:PORT`, the proxy `localhost:80/`, and the public
  `$REPLIT_DEV_DOMAIN`. Module transforms (main.tsx/App.tsx/pages) all 200.
- Other kinds work fine in the same repl: `api-server` (kind `api`, express) and
  `mockup-sandbox` (kind `design`, also vite) both detect their ports normally.
- The `screenshot` tool (headless browser via proxy) also fails with a
  browser-unreachable error. The coherent explanation: the readiness probe used for
  `web`-kind artifacts (and the screenshot browser) is broken/unavailable here.

# What does NOT matter (all ruled out, zero effect)
Port number (tested 22486, 5000, 9000 — supported and unsupported alike), IPv6
(disabled; binding `::` throws EAFNOSUPPORT), vite plugins (cartographer, dev-banner),
`strictPort`, `--host 0.0.0.0`, dev script form, orphan processes (none).

# Workaround to make the app viewable despite the failed workflow marker
The preview proxy routes by `artifact.toml`'s `localPort`, NOT by the workflow's
port-wait result. So run the dev server manually on the registered localPort and the
preview/dev-domain work:
`nohup env PORT=<localPort> BASE_PATH=<basePath> NODE_ENV=development REPL_ID="$REPL_ID" pnpm --filter @workspace/<slug> run dev &`
This is not durable (dies on repl restart). Production publish serves static build
output (no dev-server probe), so deployment is unaffected by this dev-only bug.

**Why this matters:** do not waste cycles tweaking vite config / ports / plugins when a
web workflow won't open its port — first confirm with a blank scaffold; if that also
fails, it is the environment, escalate to the user instead of re-trying restarts.

# Build-time env nuance (do NOT "fix" the vite config)
The scaffold's `vite.config.ts` throws if `PORT`/`BASE_PATH` are unset — this is the
canonical pattern (mockup-sandbox is identical). A bare `pnpm --filter <slug> run build`
therefore FAILS locally with "PORT environment variable is required". This is expected:
the publish pipeline injects `[services.env]` (PORT, BASE_PATH) during the production
build, so publish succeeds. To verify a build locally, inject env yourself:
`PORT=<localPort> BASE_PATH=<basePath> pnpm --filter <slug> run build` → emits dist/public.

# Reaping of manual dev servers (confirmed)
Even `setsid`-detached dev servers get reaped shortly after the spawning bash call
returns (vite logs "ready", then dies; nothing listens on the port in the next call).
So the manual-server workaround is NOT usable to leave a viewable dev preview between
turns. The only durable way for the user to view a web artifact here is to PUBLISH.
