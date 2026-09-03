---
name: Catalog must be backfilled into every DB (incl. post-merge)
description: Why the gear/weapon catalog lives in generatedCatalog.ts and must be backfilled, and that post-merge now runs it.
---

The gear/weapon catalog (incl. the 147 LPC weapons) lives in
`artifacts/api-server/src/data/generatedCatalog.ts`, NOT in `seed.ts`. A fresh or
isolated DB therefore only has the ~5 hand-authored seed weapons until the
idempotent backfill (`pnpm --filter @workspace/api-server run backfill`) runs and
upserts every generated template.

Any feature that reads templates from the DB (e.g. the Codex/Armory gallery at
`artifacts/labyrinths/src/pages/Codex.tsx`, which hits `GET /items/templates`)
will look near-empty until backfill runs.

**Why:** keeping the big catalog out of seed avoids wiping player progress on
re-seed, but it means the catalog reaches a DB only via backfill.

**How to apply:** `scripts/post-merge.sh` now runs the backfill after `db push`,
so the main app's DB stays in sync on every merge. When working in an isolated
env and the catalog looks sparse, run the backfill before debugging the UI.
