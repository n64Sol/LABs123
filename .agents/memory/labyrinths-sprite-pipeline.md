---
name: Labyrinths build-time LPC sprite pipeline
description: Where the build-time LPC composer lives, the two distinct z-orders, and how it relates to the runtime compositor and the committed assets.
---

# Build-time LPC sprite pipeline

The build-time composer lives at `artifacts/labyrinths/tools/sprite-pipeline/`
(Python + Pillow). It is the reusable port of the one-off feasibility script and
the "sprite pipeline" that `generatedCatalog.ts` says to regenerate from.

- `slots.py` — canonical slot/z-order model + frame geometry. Single source of truth.
- `compose.py base --source <LPC_ROOT>` — bakes `public/game/player_full.png` from raw LPC layers (allowlist-gated).
- `compose.py verify [--loadout k1,k2]` — composes committed base + `public/game/lpc` overlays into a still preview WITHOUT the 557MB source. Use this to verify the system in-env.
- `analyze.py` — inspects sheet geometry / prints the model.
- `character_spec.json`, `allowlist.json` — base layers + approved-asset gate.

**Two distinct z-orders — do not confuse them:**
- BASE bake order (full character, bottom→top): shadow, weapon_behind, cape, body, **head**, eyes, hair, legs, feet, torso, shield, weapon_fg. Head MUST be between body and eyes or the face goes black.
- RUNTIME equipment overlay z (gear on TOP of player_full.png): mirrors `LAYER_Z` in `src/lib/sprite.ts` (cape -20 … weapon_fg 90). Keep the two in lockstep.

**Why:** the runtime compositor (`src/lib/sprite.ts`) only overlays already-built equipment PNGs; the BUILD pipeline is what produces those PNGs and the base sheet from raw LPC parts. They are different layers of the system.

**Key namespace gotcha:** catalog keys carry an `lpc_` prefix (`lpc_arms_armour_gold`); `generated_manifest.json` keys do NOT (`arms_armour_gold`). `compose.py verify` accepts both.

**Allowlist scope:** allowlist.json gates WHICH assets compose; per-asset license/attribution (CC-BY-SA/GPL vs permissive) is the separate "legally safe to ship" task.

**Raw LPC source is NOT committed** (~557MB). Fetch via gdown id `1_SlDDh8c5UlCpUEeFtl-w-Iu9mWxfI4L`, extract, point `--source` at it.

**Weapon walk + slash rows are synthesized, not baked.** The baked base body (`player_full.png`) plays the slash/walk *body motion* but renders NO weapon (bbox of slash-down cols match body-only walk). The hand-curated weapon items live in `seed.ts` (NOT generatedCatalog.ts), reference small `weapon_fg` overlays under `game/lpc/weapon/`, and are NOT in the manifest. As authored, most overlays only had the DOWN-facing walk row (10) filled, so an equipped weapon vanished whenever the player faced up/left/right and mid-attack. `tools/sprite-pipeline/gen_weapon_slash.py` does TWO deterministic passes per sheet: (1) walk-fill — for any incomplete up/left/right walk row (8/9/11), COPY the authored down walk row frame-by-frame and apply a small per-direction transform (WALK_MIRROR flips left; WALK_OFFSET nudges). Copying the real down frames (NOT rotating a single extracted blade) preserves the weapon's natural held orientation AND the per-step walk motion — the earlier rotate-a-blade approach made held weapons tower up to the head / read as detached blobs. The authored down row and any fully-authored facing (e.g. sword_basic's real left/right) are preserved via row_is_complete. (2) slash-fill — sweeps a representative blade through an arc (HAND pivot + SWING_DEG) across rows 12-15. Idempotent, no raw source, placeholder-grade.
**Idempotency trap:** synth and authored rows are pixel-indistinguishable, so re-running on already-synth sheets PRESERVES the old synth (row_is_complete is true). To re-derive walk with a changed method, first restore the authored sheets from git (the commit BEFORE the synth was baked) via `git show <commit>:<path> > <file>`, then regenerate. Bow art is intrinsically tiny in the authored source — looks minimal in every facing regardless; real weapon art is separate (real-weapons task).
**Why:** can't bake real per-weapon LPC frames without the 557MB source; the compositor renders standard 832×1344 sheets via `drawImage(0,0)` so a single full `weapon_fg` sheet (walk+slash) suffices — separate `*_slash` keys/oversize sheets are NOT needed (and would fail the 832×1344 validation). The run renderer picks the row from facing (`baseRow + dirIdx`, walk 8-11 / slash 12-15), so EVERY direction's row must be filled or the weapon disappears for that facing.
**How to apply:** after editing/regenerating any `game/lpc/weapon/*.png`, re-run `gen_weapon_slash.py` (run from the labyrinths artifact root; `--preview` dumps a 4-direction+slash composite over the base body). `validate:sprites` decodes RGBA alpha (built-in `zlib`, no img lib) and FAILS if ANY individual walk row (8,9,10,11) OR slash row (12-15) is empty — per-direction, not just per-band.
