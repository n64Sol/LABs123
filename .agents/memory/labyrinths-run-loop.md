---
name: Labyrinths run loop
description: Constraints for the client-side combat loop in the Labyrinths game (Run page) and its server contract.
---

## Server completion contract is a fixed aggregate signal
All combat in the Labyrinths run page is computed client-side. The ONLY thing the
server trusts on completion is the aggregate payload: `cleared, enemiesDefeated,
nodesHarvested, chestsOpened, bossDefeated, timeSeconds, damageTaken` (+ idempotency key).
**Why:** server-authoritative economy — rewards are derived server-side from these
counters, not from anything visual. **How to apply:** add as much combat depth/juice
as you want client-side, but never change or extend this completion payload shape, and
keep counters gated so they can't double-count (kills/pickups gate on `alive`).

## rAF loop early-returns must reschedule unless the run is ending
The game loop schedules the next frame with `requestAnimationFrame(loop)` at the very
bottom. Any `return` placed earlier (portal advance, death, etc.) skips that scheduling.
**Why:** advancing to the next chamber swaps `stateRef.current` and returns early; if it
does not re-queue a frame, the loop dies and the game soft-locks mid-run (this bug
shipped once). **How to apply:** only early-return WITHOUT rescheduling when the run is
truly ending (`finishRun` cancels rAF + flips phase). For mid-run transitions, call
`requestAnimationFrame(loop)` before returning. `advanceOrFinish()` returns `true` only
when it called `finishRun` (final chamber); `false` means it advanced and the caller must
re-queue the loop.

## Ability blink/teleport must sweep, not single-clamp
The blink Art teleports the player. A single clamp-then-collision-check is not enough:
if the clamped destination lands inside an obstacle, a naive fallback (e.g. shorten to
40% of the vector) can still be out of bounds OR inside another obstacle.
**Why:** combat is client-side but the world has bounds + rect obstacles; a bad teleport
can embed the player in a wall. **How to apply:** march from origin toward the target in
small steps and keep the furthest step that passes BOTH a bounds check and a
`circleRectHit` check against every obstacle; if no step is valid, stay put. Compute
path-damage radius from the ACTUAL traveled distance, not the requested distance.

## Combat has Auto vs Manual input modes (device-local preference)
Single-player runs read a device-local combat-mode preference (`src/lib/combatMode.ts`,
localStorage, Auto default). The loop branches on `combatModeRef.current`: **Auto** aims
at the nearest enemy and auto-fires; **Manual** aims at the mouse and fires only while the
attack input is held (mouse button or `f`). **Why:** the old hidden idle-mouse handoff felt
ambiguous. **How to apply:** in Manual a canvas click means *attack* (sets `attackHeldRef`),
NOT click-to-move — click-to-move stays Auto-only or the two conflict. PvP duels are headless
server sims and never read this. Melee reach/arc are widened via `MELEE_REACH_MULT` /
`MELEE_ARC_DOT` in the melee branch only, so ranged range is untouched.

## Procedural ability VFX live in s.fx (VisualFx[]) and must self-decay
Animated ability effects (crescent/shockwave/bolt/blink/burst) are pushed onto
`s.fx` at cast time and drawn in a renderer block (after slashes, before particles),
inside the world transform. Each decays via `f.t -= f.speed * dt` and the array is
filtered `f.t > 0` each frame. **Why:** without dt-scaled decay + filtering the array
grows unbounded and effects run at frame-rate-dependent speed. **How to apply:** any new
fx kind must set t/speed and be filtered; keep lightning jitter deterministic (sin of
seed+now, no Math.random) so the glow + core passes trace the same path.
