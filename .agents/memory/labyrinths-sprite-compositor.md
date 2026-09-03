---
name: Labyrinths shared sprite compositor & slot defs
description: Where the LPC character compositor and loadout slot definitions live, and the still-pose convention.
---

# Shared sprite compositor + slot definitions

The LPC character compositor and the loadout slot definitions are shared modules
in the labyrinths artifact, not inlined per-screen.

- Compositor: `artifacts/labyrinths/src/lib/sprite.ts` — `composeLoadoutSprite(slots, baseUrl)`
  gathers every equipped `template.spriteLayers`, orders by `LAYER_Z`, draws around
  the base body (`game/player_full.png`), returns an `OffscreenCanvas` (or `null`).
  `drawStillPose` blits one cell; `STILL_POSE` = row 10 / frame 0 (front-facing idle).
  Both the run renderer (`Run.tsx`) and the loadout preview consume this — do NOT
  fork a second compositor.
- Slot defs: `artifacts/labyrinths/src/lib/slots.ts` — `SLOT_ORDER` is derived from
  the shared `EquipInputSlot` enum so newly added slots appear automatically;
  `slotMeta(slot)` gives label/icon/templateSlot with a graceful fallback.

**Why:** Two enums exist — `EquipInputSlot` (camelCase loadout keys, e.g.
`abilityStone`/`abilityStone2`) vs `ItemTemplateSlot` (snake, e.g. `ability_stone`).
`slotMeta().templateSlot` maps a loadout key to the template slot it accepts; both
ability-stone loadout slots map to the single `ability_stone` template slot.

**How to apply:** When adding screens that render the character or list slots,
import from these modules rather than hardcoding. The overworld still uses its own
`drawLpcAvatar` (single animated sheet, no equipment layers) — adopting the
compositor there is a separate task.

## Weapon layers are animation-targeted, not full sheets

Standard gear sheets are full 832-wide LPC sheets that cover every animation row,
so the compositor blits them at the origin. **Weapons are different:** oversize
weapons (katana) ship one 1664-wide (128px-frame) sheet PER action, each holding
only 4 direction rows for a single animation. The compositor routes them by layer
key: `weapon_fg`/`weapon_behind` -> walk rows 8-11, `weapon_fg_slash`/
`weapon_behind_slash` -> slash rows 12-15, centering each 128px frame on its 64px
cell (-32 offset) — a direct port of `_paste_oversize_weapon` in the build
pipeline. `*_slash` z inherits its walk counterpart's z.

**Why:** the default katana is baked into `player_full.png` for walk+slash only;
an equipped weapon must override those rows itself. Provide NO spellcast/thrust/
shoot/hurt weapon layers so those animations gracefully drop the weapon.

**How to apply:** New weapon catalog items must declare both the bare and `_slash`
weapon layer keys to swing correctly. Keep `LAYER_Z` (sprite.ts) and
`EQUIP_LAYER_Z` (tools/sprite-pipeline/slots.py) in lockstep when adding keys.
