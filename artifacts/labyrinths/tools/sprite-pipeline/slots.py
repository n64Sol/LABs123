"""Canonical slot + z-order model for the Labyrinths LPC sprite pipeline.

This is the single source of truth for how layers stack when a character or an
equipped look is composed. It is intentionally plain data so both the build-time
composer (`compose.py`) and the analyzer (`analyze.py`) share the exact same
ordering, and so it stays readable as documentation.

There are TWO distinct z-orders, because there are two distinct composition
contexts:

1. BASE_LAYER_ORDER -- used to bake the full base character sheet
   (`public/game/player_full.png`, the "Sunlit Adventurer"). It composes raw LPC
   parts (body, head, hair, default clothing, etc.) into one finished sheet.

2. EQUIP_LAYER_Z -- used at *runtime* (mirrored in `src/lib/sprite.ts`) to draw
   equipment overlays on TOP of the already-baked base sheet when a player equips
   gear. Negative values render behind the body; positive values render in front,
   low to high.

Keep EQUIP_LAYER_Z in lockstep with `LAYER_Z` in `src/lib/sprite.ts`; they are
the same contract expressed in two languages.
"""

# --- Frame geometry (LPC classic) -------------------------------------------

CELL = 64
"""Side length, in pixels, of one standard LPC frame cell."""

COLS = 13
"""Columns per row in a classic LPC sheet (max frame count of any animation)."""

ROWS = 21
"""Rows in a classic LPC sheet (832x1344). Expanded sheets (832x2944, 46 rows)
share these first 21 rows, so we always take the top 21."""

SHEET_W = COLS * CELL  # 832
SHEET_H = ROWS * CELL  # 1344

# Animation row groups in a classic sheet. (start_row, frame_count) per the
# four-direction block up/left/down/right.
ANIMATION_ROWS = {
    "spellcast": (0, 7),
    "thrust": (4, 8),
    "walk": (8, 9),
    "slash": (12, 6),
    "shoot": (16, 13),
    "hurt": (20, 6),  # down direction only
}

DIRECTION_ORDER = ("up", "left", "down", "right")

# A clean, front-facing idle pose used for still previews (LPC walk rows:
# 8=up, 9=left, 10=down, 11=right; frame 0 is the standing frame).
STILL_POSE = {"row": 10, "frame": 0}

# Oversize weapons (e.g. katana) ship one 1664x512 sheet PER action with 128px
# frames. Each 128px frame is centered onto a 64px target cell with this offset.
OVERSIZE_FRAME = 128
OVERSIZE_OFFSET = (CELL - OVERSIZE_FRAME) // 2  # -32

# --- Base character build order (bottom -> top) -----------------------------
#
# Each entry is the logical layer slot. `head` MUST sit between `body` and
# `eyes`: LPC bodies are headless by design, and omitting the head leaves an
# empty dark face gap under the hair.
BASE_LAYER_ORDER = [
    "shadow",
    "weapon_behind",
    "cape",
    "body",
    "head",
    "eyes",
    "hair",
    "legs",
    "feet",
    "torso",
    "shield",
    "weapon_fg",
]

# --- Runtime equipment overlay z-order --------------------------------------
#
# Mirrors LAYER_Z in src/lib/sprite.ts. Gear is drawn over the baked base sheet.
# Weapon `*_slash` variants inherit the z of their walk counterpart: an equipped
# weapon ships a separate per-action sheet for the slash rows (12-15), drawn on
# the same side of the body as its walk sheet (rows 8-11).
EQUIP_LAYER_Z = {
    "cape": -20,
    "weapon_behind": -10,
    "weapon_behind_slash": -10,
    "legs": 10,
    "feet": 20,
    "torso": 30,
    "shoulders": 40,
    "neck": 50,
    "gloves": 60,
    "helmet": 70,
    "shield": 80,
    "weapon_fg": 90,
    "weapon_fg_slash": 90,
}

# Default z for an unknown equipment layer key (drawn just over the body).
EQUIP_LAYER_Z_DEFAULT = 35


def base_layer_index(slot: str) -> int:
    """Stack index (lower = further back) of a base layer slot."""
    return BASE_LAYER_ORDER.index(slot)
