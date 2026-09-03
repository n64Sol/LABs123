---
name: Labyrinths weapon catalog placement
description: Where swappable weapon items live, why they're in the generated catalog, and the TS2590 split.
---

# Weapon items live in the generated catalog (not seed.ts)

Swappable weapon-slot items belong in `generatedCatalog.ts` (`GENERATED_TEMPLATES`), NOT in `seed.ts`'s hand-curated `TEMPLATES`.

**Why:** `backfill.ts` (the non-destructive, idempotent path for live DBs) only inserts `GENERATED_TEMPLATES`. `seed.ts` TRUNCATES. So anything seed-only never reaches a running game without wiping player progress. Putting weapons in the generated catalog makes them droppable (loot samples all templates) and backfillable to live DBs. seed still inserts `[...TEMPLATES, ...GENERATED_TEMPLATES]`, so weapons appear on fresh seeds too. Keys must be unique — do NOT duplicate a weapon in both lists.

**How to apply:** New weapons → add to `generatedCatalog.ts`. Starter-loadout references in `seed.ts` (e.g. `rusted_shortsword`, `moonsilver_glaive`) resolve from the generated catalog.

## Weapon stat tuning is deterministic AND per-archetype
`generateCatalog.mjs` retunes weapon `baseValue`/`stats` per (slot,rarity) like all gear, but weapons branch on a `WEAPON_PROFILE` keyed by archetype instead of the shared `SLOT_PROFILE.weapon` (kept only as a fallback). Archetype is INFERRED from the item key via `weaponArchetype(key,category)` (keyword regex, specific→generic order; unknown ranged→bow, unknown melee→sword) — there is NO `weaponType` DB/schema field, so a new weapon just needs a recognisable key (e.g. `*_dagger`, `*_warhammer`, `*_wand`) and it inherits a feel automatically. Seven archetypes, all tuned to ~comparable STAT_WEIGHTS totals so weapons are side-grades, not strict upgrades: sword=balanced; dagger=fast/high crit/low dmg; axe=brutal mid; maul=big attack/no attackSpeed/tiny reach; glaive=long range+sweep/low dmg; bow=range+crit; staff=longest range caster. `damageType` is identity and preserved. The broad keyword set is deliberate forward-compat with the "wider weapon selection" work so new loot weapons differentiate without touching the generator.

**Why range now matters for bows:** Run.tsx previously ignored `range` for ranged attacks (fixed projectile life 1200). Now ranged projectile `life = max(450, (prange/unit)*9000)` so the range stat governs how far the arrow flies (bow epic range≈104 → life≈1200, unchanged feel). Melee already turned `range`→`prange` reach. **How to apply:** weapon feel = stat block + category only; do NOT add archetype branching in the client combat loop (glaive reach/maul slowness all fall out of the generated stats).

## TS2590: keep the big literal under the limit
The ~1144-entry `GENERATED_TEMPLATES` array literal sits right at tsc's union-complexity ceiling. Adding even ~5 inline object literals triggers `TS2590: union type too complex`. Fix used: weapons live in a small separate `const WEAPON_TEMPLATES: GeneratedTemplate[]` and are `...spread` into `GENERATED_TEMPLATES` (a spread of an already-typed array adds no literal-union members). Any future batch of new inline entries may re-trigger this — add them as a spread-in const, not inline.

## Bulk-import pipeline (full LPC weapon library)
Two-stage, idempotent: `extract_weapons.py` (raw LPC weapon spritesheets → per-variant 832x1344 `weapon_fg` overlays in `public/game/lpc/weapon/` + sidecar `tools/sprite-pipeline/out/imported_weapons.json`) → `gen_weapon_slash.py` (fills walk rows 8-11 + slash 12-15) → `gen_weapon_catalog.py` (reads sidecar, patches both `generated_manifest.json` AND `WEAPON_TEMPLATES` in `generatedCatalog.ts`). The catalog↔manifest link is the `file` path, never the key (manifest keys drop the `lpc_` prefix; catalog keys keep `lpc_wpn_`). gen_weapon_catalog strips existing `lpc_wpn_*` from both files before re-adding, so it's safe to re-run; the 5 hand-curated originals (non-`lpc_wpn_` keys) are preserved.

**Why:** raw 557MB LPC source is NOT committed (gdown to /tmp only). Re-importing means re-running all three scripts.

Rarity is deterministic by material/finish color (iron/copper→common … gold/dark→epic/legendary); uncolored "signature" variants get a curated per-weapon rarity so all 5 tiers are represented. `damageType` themed by color/family but MUST stay in {physical, fire, lightning, frost} — `mapElement()` in Run.tsx silently maps anything else to physical.

**Gotcha:** `gen_weapon_catalog.py` already emits `baseValue`/`stats` matching `generateCatalog.mjs`'s curve, so running `catalog:gen` after import reports "Retuned 0 templates" — that's correct, not a failure.

## Sprite contract: single 832x1344 sheet, bare weapon_fg key
Equippable weapon overlays are single 832x1344 sheets with a bare `weapon_fg` spriteLayer (walk rows 8-11 + slash rows 12-15 filled by `gen_weapon_slash.py`). The compositor blits them at the origin; empty spellcast/thrust/shoot rows mean the weapon is omitted there. `validate-sprite-assets.ts` ENFORCES 832x1344 + walk/slash-per-direction + manifest membership, so the older oversize per-action (`*_slash`, 1664x512) idea documented elsewhere would FAIL validation. New weapon paths must be added to `generated_manifest.json` or validation fails (catalog paths must be allowlisted).
