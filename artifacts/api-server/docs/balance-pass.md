# Gear balance pass — rarer gear feels more rewarding

Tuning the LPC equipment catalog so that rarity actually means something: rarer
gear is harder to find, hits noticeably harder, and is worth disproportionately
more. Source of truth for the numbers below:

- Stat/value curves: `src/data/generateCatalog.mjs` (run `pnpm catalog:gen`)
- Drop weights: `RARITY_WEIGHTS` in `src/lib/game.ts`

## Problem

`baseValue` and `stats` were assigned by a coarse, un-playtested heuristic
(tier multiplier × per-slot base). The old stat multipliers were roughly
`[1, 1.8, 3.2, 5.5, 9]` and `baseValue` was `[39, 91, 182, 338, 598]`. Drop
weights let legendaries fall ~14% of the time at the top tier, so legendaries
were neither rare nor a clear power spike — progression felt flat.

## Combat frame of reference

The client battler (`Run.tsx`) starts the player at **100 HP, 12 attack, 0
defense**. Key relationships used to calibrate:

- 12 attack ≈ +100% DPS, so each point of attack matters a lot.
- 100 defense ≈ 50% damage reduction (≈ +100% effective HP); diminishing.
- 10 health ≈ +10% survivability.
- 1 lootBonus ≈ +1% currency drops (server `rollRewards`).
- Enemy HP: grunt 30, elite 60–80, boss 200–320.

Generated gear covers armor/accessory slots (gloves, shoulders, cape, boots,
helmet, pants, neck, shield, armor); weapons remain bespoke hand-authored
templates in `seed.ts`, so the generated curve is mostly defense / health /
utility, where the steep top end is safe (defense has diminishing returns).

## New stat curve

Per-rarity multiplier applied to each slot's common base stat block:

| rarity | old ≈ | new | jump vs prev |
| --- | --- | --- | --- |
| common | 1.0 | 1.0 | — |
| uncommon | 1.8 | 1.9 | ×1.9 |
| rare | 3.2 | 3.4 | ×1.8 |
| epic | 5.5 | 6.5 | ×1.9 |
| legendary | 9.0 | 11.0 | ×1.7 |

Common/uncommon are left near their old power so the early game is stable; epic
and legendary pull away so each high tier is a clear, felt upgrade. Example —
boots legendary moveSpeed/defense goes 72/18 → 88/22; armor legendary
defense/health goes 54/162 → 66/198.

## New value curve

`baseValue` per rarity (gold-equivalent), keeping the bottom stable and
accelerating the top so a legendary drop is a windfall:

| rarity | old | new |
| --- | --- | --- |
| common | 39 | 40 |
| uncommon | 91 | 95 |
| rare | 182 | 200 |
| epic | 338 | 390 |
| legendary | 598 | 700 |

A legendary is now worth ~17.5× a common (was ~15×) and ~1.8× an epic, so
rarity and value track each other.

## New drop weights (`rollRarity`)

Each row sums to 100, so weights read as percentages. Boss kills roll their first
drop at `lootTier + 1` (clamped to tier 5), the only route to the best odds.

| tier | common | uncommon | rare | epic | legendary |
| --- | --- | --- | --- | --- | --- |
| 1 | 70 | 25 | 5 | 0 | 0 |
| 2 | 55 | 32 | 11 | 2 | 0 |
| 3 | 40 | 34 | 19 | 6 | 1 |
| 4 | 26 | 33 | 26 | 12 | 3 |
| 5 | 16 | 28 | 31 | 20 | 5 |

Legendaries top out at ~1-in-20 (vs ~1-in-7 before) and are impossible below
tier 3, so they stay special. Epics fill the "exciting but attainable" band;
rares are the reliable mid-game upgrade.

Expected single-drop value scales smoothly with tier: ~62 (t1) → ~82 (t2) →
~117 (t3) → ~162 (t4) → ~208 (t5), giving deeper labyrinths a clear payoff
without runaway inflation.

## Signature (bespoke) gear

The hand-authored named items in `seed.ts` (`TEMPLATES`) are not touched by
`generateCatalog.mjs`, so they were retuned by hand to the same curves. The rule:
a named item should **match or beat** a generated item of the same rarity and
slot, since its unique ability is meant to be a bonus on top, not a trade-off for
weaker raw numbers.

- `baseValue` follows the rarity curve above. Named items carry a small premium so
  they clearly out-class generic loot: legendaries sit at **750** (vs generated
  700), epics at **410** (vs 390), rares at **210** (vs 200), uncommons match at
  ~95/100. Common starters sit at the floor (40).
- Armor/boots stats are lifted to meet-or-exceed the generated block for that slot
  (e.g. Aegis of Dawn 40/120 → 72/210 defense/health, just past generated legendary
  armor's 66/198; Tidewalker Greaves 22 → 56 moveSpeed, past generated epic boots'
  52).
- Weapons have no generated counterpart, so attack is raised only modestly
  (Worldroot Maul 52 → 60). Attack has **no diminishing returns** (12 ≈ +100% DPS),
  so the steep generated multiplier is deliberately *not* applied to weapon damage.
- Relics / ability stones / charms (no generated slot) are nudged up to feel
  appropriate for their new value tier while their ability stays the headline.

Crafting recipe gold costs were rescaled by roughly the same factor as the item's
value increase, so a craft still costs a sensible fraction above the item's worth
(e.g. Phoenix Feather 600 → 1050 gold as its value rose 420 → 750).

## Applying changes

1. `pnpm catalog:gen` — rewrites `generatedCatalog.ts` numeric fields in place.
2. `pnpm build && pnpm backfill` — idempotent upsert into the live DB (no
   player progress is wiped). `pnpm seed` also picks up the new values but is
   destructive.
