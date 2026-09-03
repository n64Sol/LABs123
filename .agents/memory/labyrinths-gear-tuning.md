---
name: Labyrinths gear/loot tuning
description: How the LPC equipment catalog's stats/values and rarity drop rates are tuned and applied.
---

# Gear stat/value/drop tuning

- The LPC catalog's numeric fields (`baseValue`, `stats`) are **deterministic per (slot, rarity)**: every item of a given slot+rarity shares the same stat block and value. Slot determines the two stat keys; rarity scales them. Identity/sprite fields are unique per item.
- `generateCatalog.mjs` is the single source of truth for those curves. It rewrites ONLY `baseValue` and `stats:{...}` in `generatedCatalog.ts` in place (regex per line, preserving everything else), so it's safe to re-run after the sprite pipeline regenerates the catalog. Run `pnpm catalog:gen`.
- Drop-rate weights live in `RARITY_WEIGHTS` (`lib/game.ts`), rows sum to 100 (= percentages). Boss first drop rolls at `lootTier+1` (clamped to 5) — that's the only path to the best legendary odds.
- **Why:** the original values were a coarse, un-playtested heuristic; legendaries were neither rare nor impactful. Rationale + full tables are in `artifacts/api-server/docs/balance-pass.md`.

## Applying catalog changes to a running DB
- `seed.mjs` / `backfill.mjs` (committed, git-tracked, at api-server root) are **runtime bootstrappers**: they bundle `src/seed.ts` / `src/backfill.ts` via esbuild on each run and import live TS — so they always pick up the current `generatedCatalog.ts`. No prebuilt bundle to refresh.
- `build.mjs` only bundles `src/index.ts`; it does NOT build seed/backfill.
- `backfill` is the non-destructive path (idempotent upsert, keeps player progress); `seed` truncates. The post-merge script only does `pnpm install` + `db push`, so catalog data changes need a manual `pnpm backfill` (or seed) to reach an existing DB.
