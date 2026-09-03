---
name: Labyrinths streaming overworld
description: Chunked unbounded world, lazy plot assignment, zoom LOD, in-world labyrinth popup
---

The overworld is an unbounded, chunk-streamed, infinitely-zoomable world. Land plots are
persistent per labyrinth; players onboard by picking a biome at signup.

## Plots are lazy, not backfilled
- `plotX`/`plotY` (nullable) on labyrinthsTable. `ensurePlot(lab,tx)` assigns + persists a
  deterministic plot if missing; `ensureAllPlots()` runs it for every lab on each chunk read.
- **Why:** because reads self-heal, you do NOT need a migration/backfill to populate plots on
  live DBs — first `/overworld/chunks` view assigns any missing plot. Placement is a
  deterministic per-biome wedge (`plotPosition`/`world.ts`) so plots are stable and non-overlapping.
- Plots are also assigned on claim (so a freshly claimed lab has a home immediately).

## Endpoints are raw fetch, not openapi codegen
- `worldClient.ts` hits `/api/overworld/{meta,chunks,spawn,labyrinth/:id/leaderboard}` directly.
  `/meta` is async (DB biome counts → `biomeRegions`). `/chunks?keys=cx_cy,cx_cy` returns
  entrance DTOs; client sends underscore keys, server compares against comma `chunkKey`.

## Client: camera + LOD + chunk cache
- `OverworldMap.tsx` holds a `{x,y,scale}` camera centered on the player; wheel/pinch/±buttons zoom.
- `DETAIL_SCALE` (~0.34) is the LOD switch: above it = detailed sprites/floor tiles; below it =
  symbolic region blobs + labels + dots drawn from `/meta` `biomeRegions`.
- `ChunkStreamer` loads cells near the camera and evicts far ones (CACHE_CAP). Infinite decor is
  procedural via a hash (no server data).
- Presence clamps to ±`WORLD_LIMIT` (not the legacy WORLD_W/H); default spawn is the central hub,
  or the player's own plot via `/overworld/spawn`.

## Onboarding + popup
- No owned labyrinth → `AuthGuard` redirects to `/welcome` (biome picker → claim mutation → invalidate
  getCurrentPlayer/getMyLabyrinth → navigate "/").
- `LabyrinthPopup.tsx` is an in-world overlay (no page nav): quick-glance name+owner, difficulty,
  combat power, loot ceiling (max item value), entry fee, biome; "More info" fetches leaderboard;
  Enter starts the run and navigates to `/run/:id`. Replaces the old navigate-to-detail-page flow.
