# Labyrinths LPC sprite pipeline

Build-time tooling that composes **approved** [Universal-LPC](https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator)
parts into the game's layered character + equipment sprite sheets. This is the
reusable home for the logic that started life as a one-off feasibility script;
it now lives in the repo with a documented slot/z-order model and an allowlist.

## Files

| File | Purpose |
| --- | --- |
| `slots.py` | Canonical **slot + z-order model** and frame geometry. Single source of truth shared by every script here. |
| `character_spec.json` | The "Sunlit Adventurer" base character: one approved LPC layer per slot. |
| `allowlist.json` | Approved-asset gate. The composer refuses any source path not covered here. |
| `compose.py` | The composer: bakes the base sheet from raw LPC source, or verifies/previews from committed assets. |
| `analyze.py` | Inspects sheets and prints the geometry/z-order model. |

## The slot + z-order model

LPC frames are **64x64**, laid out 13 columns wide. A classic sheet is
**832x1344** (21 rows); expanded sheets are **832x2944** (46 rows) and share the
same first 21 rows, so we always take the top 21. Direction order within a walk
block is **up, left, down, right**.

Animation row groups (classic sheet):

| Animation | Rows | Frames |
| --- | --- | --- |
| spellcast | 0–3 | 7 |
| thrust | 4–7 | 8 |
| walk | 8–11 | 9 |
| slash | 12–15 | 6 |
| shoot | 16–19 | 13 |
| hurt | 20 | 6 (down only) |

There are **two** z-orders, for two composition contexts:

**1. Base character bake** (`slots.BASE_LAYER_ORDER`, bottom → top), used to
produce `public/game/player_full.png`:

```
shadow · weapon_behind · cape · body · head · eyes · hair · legs · feet · torso · shield · weapon_fg
```

> ⚠️ `head` MUST sit between `body` and `eyes`. LPC bodies are **headless** by
> design; omit the head and the character shows a dark empty face under the hair.

**2. Runtime equipment overlays** (`slots.EQUIP_LAYER_Z`), used when a player
equips gear over the baked base sheet. This mirrors `LAYER_Z` in
`src/lib/sprite.ts` — keep the two in lockstep. Negative = behind the body:

```
cape -20 · weapon_behind -10 · [BODY] · legs 10 · feet 20 · torso 30 ·
shoulders 40 · neck 50 · gloves 60 · helmet 70 · shield 80 · weapon_fg 90
```

**Oversize weapons** (e.g. katana, `1664x512`) ship one sheet per action with
**128px** frames. Each frame is centered onto its 64px target cell with a
`-32, -32` offset, and the source's 4 direction rows map onto the target
animation's rows (walk → 8–11, slash → 12–15).

## Equipment variants map to layers

Every gear item carries `spriteLayers` (see `lib/api-spec/openapi.yaml` and
`artifacts/api-server/src/data/generatedCatalog.ts`) — a map of LPC layer key →
overlay PNG under `public/game/lpc/`. Equipping an item adds its overlay at the
z given by `EQUIP_LAYER_Z`, so **swapping a slot's file changes the look** with
no re-bake. The approved overlay set is enumerated in
`public/game/lpc/generated_manifest.json`, which the composer treats as the
equipment allowlist.

## Usage

The pipeline needs Python with Pillow (`pip install pillow`).

### Verify / preview (no raw source — runs on committed assets)

```bash
cd artifacts/labyrinths/tools/sprite-pipeline
python compose.py verify                       # default demo loadout
python compose.py verify --loadout arms_armour_gold,torso_armour_plate_gold
```

Writes a 4x still preview to `out/preview.png`. Overlays must exist in the
equipment manifest or composition is refused.

### Bake the base character sheet (needs the raw LPC pack)

The raw LPC pack (~557 MB) is **not** committed. Fetch and extract it, then:

```bash
pip install gdown
gdown 1_SlDDh8c5UlCpUEeFtl-w-Iu9mWxfI4L -O lpc.zip && unzip -q lpc.zip -d lpc_root
python compose.py base --source lpc_root
```

This rewrites `public/game/player_full.png`. Any source path not in
`allowlist.json` is refused.

### Inspect / analyze

```bash
python analyze.py layout                        # print the model above
python analyze.py inspect lpc_root/.../body.png # classify a sheet
python analyze.py scan lpc_root                 # tally sheet dimensions
```

## Licensing (allowlist scope)

`allowlist.json` gates **which** assets may be composed — a hard requirement so
no un-vetted art reaches a shipped sprite. It does **not** by itself resolve
per-asset license/attribution. LPC parts are multi-licensed (CC-BY-SA, GPL,
CC-BY, OGA-BY, CC0); a composed sprite inherits the **union** of its layers'
obligations, and ShareAlike layers conflict with selling the art as exclusive.
Reconstructing per-asset authors/licenses and producing the shipped CREDITS file
is tracked under the separate "legally safe to ship" work. Vet an asset's
license before adding it to the allowlist.
