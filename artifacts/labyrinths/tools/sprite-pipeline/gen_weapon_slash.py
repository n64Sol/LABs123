#!/usr/bin/env python3
"""Synthesize the missing walk + slash rows for the runtime weapon overlay sheets.

The hand-curated weapon items (artifacts/api-server/src/seed.ts) ship small
`weapon_fg` overlay sheets under public/game/lpc/weapon/. As authored, most only
carry the *down-facing* walk frames (row 10): the up/left/right walk rows
(8/9/11) and every slash row (12-15) are empty or partial. The run renderer
picks the sprite row from the direction the character faces, so an equipped
weapon vanishes whenever the player faces a direction the sheet never filled
(and during the slash attack, where the baked base body draws no weapon).

This tool makes every weapon visible in all four facings, idle/walking AND
attacking, in two deterministic passes per sheet (no external/raw LPC source):

  1. Walk fill — for any up/left/right walk row that is not already complete
     (all 9 frames), synthesize the full row by stamping the weapon's own
     held-blade (sourced from its down-facing walk art) at a per-direction hand
     pivot, with a subtle walk bob. The down row and any fully-authored
     direction are preserved.
  2. Slash fill — sweep the same held-blade through an arc around a per-direction
     hand pivot across the 6 slash frames so the weapon swings during the attack.

Both passes are idempotent: re-running rebuilds the same rows from the committed
down-facing walk art. Run from the labyrinths artifact root:

    python tools/sprite-pipeline/gen_weapon_slash.py            # rewrite sheets
    python tools/sprite-pipeline/gen_weapon_slash.py --preview  # also dump preview
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

CELL = 64
HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent / "public"
WEAPON_DIR = PUBLIC / "game" / "lpc" / "weapon"

# LPC direction order within an animation block: up, left, down, right.
DIRECTIONS = ["up", "left", "down", "right"]
WALK_ROW = {"up": 8, "left": 9, "down": 10, "right": 11}
SLASH_ROW = {"up": 12, "left": 13, "down": 14, "right": 15}
WALK_FRAMES = 9
SLASH_FRAMES = 6

# Directions whose walk rows we may synthesize. `down` is the canonical authored
# source and is never overwritten; the rest are filled only when incomplete.
WALK_SYNTH_DIRECTIONS = ["up", "left", "right"]

# Each missing walk facing is derived by copying the authored DOWN walk row
# frame-by-frame (which already carries the natural held-weapon pose and the
# per-step walk motion) and applying a small per-direction transform. This keeps
# the weapon's real orientation and animation instead of re-stamping a single
# rotated blade. `mirror` flips the cell horizontally so the weapon swaps to the
# correct side; `offset` nudges it into place for that facing.
WALK_MIRROR = {"up": False, "left": True, "right": False}
WALK_OFFSET = {"up": (0, -3), "left": (-1, 0), "right": (1, 0)}

# Grip target (where the weapon hilt sits, ~ the slashing hand) per direction,
# in pixels within a 64x64 cell. Calibrated against the base body's slash pose.
HAND = {
    "up": (34, 30),
    "left": (24, 40),
    "down": (38, 42),
    "right": (40, 40),
}

# Swing arc: rotation (degrees, CCW positive) applied to the held blade across
# the 6 slash frames — raised wind-up -> downward strike -> recover. Mirrored for
# left-facing so the blade sweeps toward the same screen side as the body.
SWING_DEG = [60, 30, -10, -50, -30, -12]


def first_nonempty_cell(sheet: Image.Image, direction: str) -> Image.Image | None:
    """Pick a representative held-blade frame for a facing, falling back to the
    down-facing walk art (and finally any populated walk/hurt frame) so even the
    sparsest placeholder sheet yields a blade to swing."""
    candidates = [
        (WALK_ROW[direction], 0), (WALK_ROW[direction], 2),
        (WALK_ROW["down"], 0), (WALK_ROW["down"], 2),
        (WALK_ROW["left"], 0), (WALK_ROW["right"], 0), (WALK_ROW["up"], 0),
        (7, 0), (20, 0),
    ]
    for r, c in candidates:
        cell = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
        if cell.getbbox():
            return cell
    return None


def render_frame(blade: Image.Image, angle: float, hand: tuple[int, int]) -> Image.Image:
    """Render one 64x64 slash frame: rotate `blade` about its grip and place the
    grip at `hand`. Grip = bottom-center of the blade's tight bounding box (the
    hilt end held by the hand)."""
    bbox = blade.getbbox()
    tight = blade.crop(bbox)
    grip = (tight.width // 2, tight.height - 1)

    # Pad onto a square canvas with the grip at the exact center so rotation
    # pivots around the hilt and the blade never clips during the spin.
    pad = max(tight.width, tight.height) * 2 + 4
    canvas = Image.new("RGBA", (pad, pad), (0, 0, 0, 0))
    cx = cy = pad // 2
    canvas.alpha_composite(tight, (cx - grip[0], cy - grip[1]))
    rotated = canvas.rotate(angle, resample=Image.NEAREST, center=(cx, cy), expand=False)

    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    out.alpha_composite(rotated, (hand[0] - cx, hand[1] - cy))
    return out


def row_is_complete(sheet: Image.Image, row: int, frames: int) -> bool:
    """True if every one of the first `frames` cells in `row` carries pixels."""
    for c in range(frames):
        cell = sheet.crop((c * CELL, row * CELL, (c + 1) * CELL, (row + 1) * CELL))
        if not cell.getbbox():
            return False
    return True


def walk_cell(sheet: Image.Image, direction: str, frame: int) -> Image.Image:
    """The 64x64 weapon cell for a walk facing/frame (transparent if empty)."""
    r = WALK_ROW[direction]
    return sheet.crop((frame * CELL, r * CELL, (frame + 1) * CELL, (r + 1) * CELL))


def synth_walk(path: Path) -> int:
    """Fill any incomplete up/left/right walk row by copying the authored
    down-facing walk row frame-by-frame and applying a small per-direction
    transform (mirror + offset). Copying the real down frames preserves the
    weapon's natural held pose and the per-step walk motion, so an equipped
    weapon is visible — and animates — facing every direction. The authored down
    row and any fully-populated facing are left untouched."""
    sheet = Image.open(path).convert("RGBA")
    # Need a populated down row to derive the other facings from.
    if not any(walk_cell(sheet, "down", f).getbbox() for f in range(WALK_FRAMES)):
        return 0
    # A representative down frame to backfill any (shouldn't happen) empty cell.
    fallback = first_nonempty_cell(sheet, "down")
    written = 0
    for direction in WALK_SYNTH_DIRECTIONS:
        row = WALK_ROW[direction]
        if row_is_complete(sheet, row, WALK_FRAMES):
            continue  # preserve fully-authored facing art
        mirror = WALK_MIRROR[direction]
        dx, dy = WALK_OFFSET[direction]
        # Clear the row first so re-runs are idempotent.
        sheet.paste((0, 0, 0, 0), (0, row * CELL, sheet.width, (row + 1) * CELL))
        for f in range(WALK_FRAMES):
            src = walk_cell(sheet, "down", f)
            if not src.getbbox() and fallback is not None:
                src = fallback
            if mirror:
                src = src.transpose(Image.FLIP_LEFT_RIGHT)
            frame = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            frame.alpha_composite(src, (dx, dy))
            sheet.alpha_composite(frame, (f * CELL, row * CELL))
            written += 1
    if written:
        sheet.save(path)
    return written


def synth_sheet(path: Path) -> int:
    sheet = Image.open(path).convert("RGBA")
    written = 0
    for direction in DIRECTIONS:
        blade = first_nonempty_cell(sheet, direction)
        if blade is None:
            continue
        sign = -1 if direction == "left" else 1
        hand = HAND[direction]
        row = SLASH_ROW[direction]
        # Clear the slash row first so re-runs are idempotent.
        sheet.paste((0, 0, 0, 0), (0, row * CELL, sheet.width, (row + 1) * CELL))
        for f in range(SLASH_FRAMES):
            frame = render_frame(blade, SWING_DEG[f] * sign, hand)
            sheet.alpha_composite(frame, (f * CELL, row * CELL))
            written += 1
    sheet.save(path)
    return written


def make_preview(out: Path) -> None:
    base = Image.open(PUBLIC / "game" / "player_full.png").convert("RGBA")
    names = sorted(p.name for p in WEAPON_DIR.glob("*.png"))
    scale = 4
    rows = len(names)
    # One idle walk frame per facing (up/left/down/right) then 6 slash frames.
    walk_cols = [("walk", WALK_ROW[d], 0) for d in DIRECTIONS]
    slash_cols = [("slash", SLASH_ROW["down"], f) for f in range(SLASH_FRAMES)]
    columns = walk_cols + slash_cols
    cols = len(columns)
    img = Image.new("RGBA", (cols * CELL * scale, rows * CELL * scale), (40, 40, 52, 255))
    for ri, name in enumerate(names):
        wpn = Image.open(WEAPON_DIR / name).convert("RGBA")
        for ci, (_kind, r, f) in enumerate(columns):
            cell = base.crop((f * CELL, r * CELL, (f + 1) * CELL, (r + 1) * CELL)).copy()
            cell.alpha_composite(wpn.crop((f * CELL, r * CELL, (f + 1) * CELL, (r + 1) * CELL)))
            cell = cell.resize((CELL * scale, CELL * scale), Image.NEAREST)
            img.alpha_composite(cell, (ci * CELL * scale, ri * CELL * scale))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out)
    print(f"wrote preview {out} ({img.width}x{img.height}) rows={names}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", action="store_true", help="also write out/weapon_slash_preview.png")
    args = ap.parse_args(argv)

    sheets = sorted(WEAPON_DIR.glob("*.png"))
    if not sheets:
        raise SystemExit(f"no weapon sheets found under {WEAPON_DIR}")
    for path in sheets:
        # Walk fill first so the slash pass can source a per-direction blade.
        w = synth_walk(path)
        n = synth_sheet(path)
        print(f"  {path.name}: wrote {w} walk frame(s), {n} slash frame(s)")
    if args.preview:
        make_preview(HERE / "out" / "weapon_slash_preview.png")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
