#!/usr/bin/env python3
"""Build-time LPC sprite composer for Labyrinths.

Turns approved LPC parts into finished sprite sheets. This is the reusable port
of the one-off feasibility script (`/tmp/lpc_work/compose.py`); the slot and
z-order model it relies on lives in `slots.py`, and the approved assets it is
allowed to touch live in `allowlist.json` / the equipment manifest.

Two modes:

  1. Base character bake (needs the raw LPC source tree):

       python compose.py base --source /path/to/lpc_root [--spec character_spec.json]

     Composes every layer in `character_spec.json` over an 832x1344 canvas using
     `slots.BASE_LAYER_ORDER`, applying the head-fix and 128px-weapon centering,
     and writes `public/game/player_full.png`. Refuses any source path not in the
     allowlist.

  2. Verify / preview (no raw source -- uses only committed assets):

       python compose.py verify [--loadout key1,key2,...] [--out preview.png]

     Composes the committed base sheet (`public/game/player_full.png`) plus a set
     of equipment overlays from `public/game/lpc` using the runtime z-order
     (`slots.EQUIP_LAYER_Z`), exactly as `src/lib/sprite.ts` does in the browser.
     Proves the layered system works and that swapping a slot's file changes the
     look. Overlays must appear in the equipment manifest (the allowlist).

The raw LPC pack (~557 MB) is NOT committed. Fetch it with gdown (see README) and
point --source at the extracted root.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image

import slots

HERE = Path(__file__).resolve().parent
# tools/sprite-pipeline -> artifacts/labyrinths
ARTIFACT_ROOT = HERE.parent.parent
PUBLIC = ARTIFACT_ROOT / "public"
MANIFEST = PUBLIC / "game" / "lpc" / "generated_manifest.json"
ALLOWLIST = HERE / "allowlist.json"
DEFAULT_SPEC = HERE / "character_spec.json"
DEFAULT_OUT = PUBLIC / "game" / "player_full.png"


# --- allowlist --------------------------------------------------------------

def load_allowlist() -> dict:
    return json.loads(ALLOWLIST.read_text())


def assert_source_allowed(rel_path: str, allow: dict) -> None:
    """Raise unless `rel_path` is covered by an allowlist entry. Directory
    entries (trailing slash) act as prefixes so a whole weapon folder can be
    approved at once."""
    entries = allow.get("baseCharacterSources", [])
    norm = rel_path.replace("\\", "/")
    for entry in entries:
        if entry.endswith("/"):
            if norm.startswith(entry):
                return
        elif norm == entry:
            return
    raise SystemExit(
        f"[allowlist] refused source not on the approved list: {rel_path}\n"
        f"  Add it to allowlist.json -> baseCharacterSources after vetting it."
    )


def load_equipment_allowlist() -> dict[str, dict]:
    """The equipment manifest is the approved-overlay allowlist. Returns a map
    of item key -> manifest entry."""
    data = json.loads(MANIFEST.read_text())
    return {row["key"]: row for row in data}


# --- low-level layer drawing ------------------------------------------------

def _paste_standard(canvas: Image.Image, sheet: Image.Image) -> None:
    """Paste a standard 64px LPC sheet's top 21 rows onto the canvas at 0,0.

    Source sheets are either classic (832x1344) or expanded (832x2944); both
    share the first 21 rows, so we crop the top SHEET_H pixels."""
    crop = sheet.crop((0, 0, slots.SHEET_W, min(sheet.height, slots.SHEET_H)))
    canvas.alpha_composite(crop, (0, 0))


def _paste_oversize_weapon(canvas: Image.Image, sheet: Image.Image, animation: str) -> None:
    """Place a 1664x512 oversize weapon sheet (128px frames, 4 dirs x 13 cols)
    into the target animation's rows, centering each 128px frame on the 64px
    cell with a -32,-32 offset.

    The source sheet holds one animation group as 4 direction rows (0..3). We map
    those onto the target rows for `animation` (e.g. walk -> rows 8..11)."""
    start_row, _frames = slots.ANIMATION_ROWS[animation]
    off = slots.OVERSIZE_OFFSET
    fp = slots.OVERSIZE_FRAME
    src_rows = sheet.height // fp  # typically 4 (one per direction)
    for d in range(src_rows):
        target_row = start_row + d
        if target_row >= slots.ROWS:
            break
        for c in range(slots.COLS):
            sx, sy = c * fp, d * fp
            if sx + fp > sheet.width or sy + fp > sheet.height:
                continue
            frame = sheet.crop((sx, sy, sx + fp, sy + fp))
            if frame.getbbox() is None:
                continue
            dx = c * slots.CELL + off
            dy = target_row * slots.CELL + off
            canvas.alpha_composite(frame, (dx, dy))


# --- mode 1: base character bake -------------------------------------------

def bake_base(source_root: Path, spec_path: Path, out_path: Path) -> None:
    allow = load_allowlist()
    spec = json.loads(spec_path.read_text())

    # Order the spec's layers by the canonical base z-order (stable for repeats
    # like weapon walk + weapon slash that share a slot).
    def sort_key(layer: dict) -> int:
        return slots.base_layer_index(layer["slot"])

    layers = sorted(spec["layers"], key=sort_key)

    canvas = Image.new("RGBA", (slots.SHEET_W, slots.SHEET_H), (0, 0, 0, 0))
    for layer in layers:
        rel = layer["sourcePath"]
        assert_source_allowed(rel, allow)
        src_file = source_root / rel
        if not src_file.exists():
            raise SystemExit(f"[source] missing layer file: {src_file}")
        sheet = Image.open(src_file).convert("RGBA")
        if layer.get("oversize"):
            _paste_oversize_weapon(canvas, sheet, layer.get("animation", "walk"))
        else:
            _paste_standard(canvas, sheet)
        print(f"  + {layer['slot']:<14} {rel}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    print(f"\nWrote {out_path} ({slots.SHEET_W}x{slots.SHEET_H})")


# --- mode 2: verify / preview from committed assets ------------------------

def _overlay_layers_for(entry: dict) -> list[tuple[int, Path]]:
    """An equipment manifest entry has a `layerKey` and a `file`. Return
    (z, abspath) using the runtime z-order."""
    z = slots.EQUIP_LAYER_Z.get(entry["layerKey"], slots.EQUIP_LAYER_Z_DEFAULT)
    return [(z, PUBLIC / entry["file"])]


def verify(loadout_keys: list[str], out_path: Path) -> None:
    equip = load_equipment_allowlist()

    base_file = DEFAULT_OUT
    if not base_file.exists():
        raise SystemExit(f"[verify] base sheet not found: {base_file}")
    base = Image.open(base_file).convert("RGBA")

    # Default demo loadout: pick a few real overlays across slots if none given.
    if not loadout_keys:
        wanted_layers = ["torso", "legs", "feet", "helmet", "shield", "cape"]
        seen: set[str] = set()
        loadout_keys = []
        for key, row in equip.items():
            lk = row["layerKey"]
            if lk in wanted_layers and lk not in seen:
                loadout_keys.append(key)
                seen.add(lk)

    behind: list[tuple[int, Path]] = []
    front: list[tuple[int, Path]] = []
    resolved: list[tuple[str, str]] = []
    for key in loadout_keys:
        # Catalog keys carry an `lpc_` prefix; manifest keys do not. Accept both.
        mkey = key if key in equip else key[4:] if key.startswith("lpc_") else key
        if mkey not in equip:
            raise SystemExit(
                f"[allowlist] '{key}' is not in the equipment manifest "
                f"({MANIFEST.name}); refusing to compose it."
            )
        resolved.append((key, mkey))
        for z, path in _overlay_layers_for(equip[mkey]):
            if not path.exists():
                raise SystemExit(f"[verify] overlay file missing: {path}")
            (behind if z < 0 else front).append((z, path))

    behind.sort(key=lambda t: t[0])
    front.sort(key=lambda t: t[0])

    canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))
    for _z, p in behind:
        canvas.alpha_composite(Image.open(p).convert("RGBA"))
    canvas.alpha_composite(base)
    for _z, p in front:
        canvas.alpha_composite(Image.open(p).convert("RGBA"))

    # Crop a single still pose and upscale 4x for an at-a-glance preview.
    r, f = slots.STILL_POSE["row"], slots.STILL_POSE["frame"]
    cell = canvas.crop(
        (f * slots.CELL, r * slots.CELL, (f + 1) * slots.CELL, (r + 1) * slots.CELL)
    )
    preview = cell.resize((slots.CELL * 4, slots.CELL * 4), Image.NEAREST)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(out_path)
    print("Composed loadout (over base sheet):")
    for key, mkey in resolved:
        print(f"  + {equip[mkey]['layerKey']:<10} {key}  -> {equip[mkey]['file']}")
    print(f"\nWrote still preview {out_path} ({preview.width}x{preview.height})")


# --- cli --------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)

    b = sub.add_parser("base", help="bake the base character sheet from raw LPC source")
    b.add_argument("--source", required=True, type=Path, help="path to the extracted LPC source root")
    b.add_argument("--spec", default=DEFAULT_SPEC, type=Path, help="character spec JSON")
    b.add_argument("--out", default=DEFAULT_OUT, type=Path, help="output PNG path")

    v = sub.add_parser("verify", help="compose committed assets into a preview (no raw source needed)")
    v.add_argument("--loadout", default="", help="comma-separated item template keys from the manifest")
    v.add_argument("--out", default=HERE / "out" / "preview.png", type=Path, help="output preview PNG")

    args = ap.parse_args(argv)
    if args.mode == "base":
        bake_base(args.source, args.spec, args.out)
    elif args.mode == "verify":
        keys = [k for k in args.loadout.split(",") if k.strip()]
        verify(keys, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
