#!/usr/bin/env python3
"""Bulk weapon importer for the Labyrinths LPC sprite pipeline.

Walks the raw Universal-LPC `spritesheets/weapon` tree and produces one finished
832x1344 `weapon_fg` overlay per (weapon, color) variant under
`public/game/lpc/weapon/`, plus a sidecar JSON describing each variant for the
manifest + catalog generators.

Two source layouts are handled:

  * standard  -- an 832x1344 foreground sheet already in the target geometry
                 (its walk rows are copied straight in; the down walk row is the
                 seed `gen_weapon_slash.py` completes).
  * oversize  -- a 1664x512 per-action sheet (128px frames, 4 direction rows);
                 each frame is centered onto its 64px target walk cell (-32,-32).

After this runs, finish the sheets with `gen_weapon_slash.py` (walk-fill +
slash-fill), then regenerate the manifest/catalog.

    python extract_weapons.py --source /path/to/lpc_root [--dry-run]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

import slots

HERE = Path(__file__).resolve().parent
ARTIFACT_ROOT = HERE.parent.parent
OUT_DIR = ARTIFACT_ROOT / "public" / "game" / "lpc" / "weapon"
SIDECAR = HERE / "out" / "imported_weapons.json"

WEAPON_REL = (
    "weapon/universal-lpc/Universal-LPC-Spritesheet-Character-Generator-master/"
    "spritesheets/weapon"
)

# Per family: category + a default damage flavor + icon. damageType is a free
# string in the schema; stats are retuned later by generateCatalog.mjs.
FAMILY_META = {
    "sword":   {"category": "melee",  "icon": "\u2694\ufe0f"},
    "polearm": {"category": "melee",  "icon": "\U0001f531"},
    "blunt":   {"category": "melee",  "icon": "\U0001f528"},
    "magic":   {"category": "magic",  "icon": "\U0001fa84"},
    "ranged":  {"category": "ranged", "icon": "\U0001f3f9"},
}

# Friendly display names for weapon folder stems.
WEAPON_NAMES = {
    "dagger": "Dagger", "katana": "Katana", "longsword": "Longsword",
    "longsword_alt": "Broadsword", "rapier": "Rapier", "saber": "Saber",
    "scimitar": "Scimitar", "glowsword": "Glowblade", "arming": "Arming Sword",
    "cane": "Cane", "dragonspear": "Dragon Spear", "halberd": "Halberd",
    "longspear": "Long Spear", "scythe": "Scythe", "spear": "Spear",
    "trident": "Trident", "club": "Club", "flail": "Flail", "mace": "Mace",
    "waraxe": "War Axe", "crystal": "Crystal Wand", "diamond": "Diamond Staff",
    "gnarled": "Gnarled Staff", "loop": "Looped Wand", "s": "Serpent Wand",
    "simple": "Apprentice Wand", "boomerang": "Boomerang", "bow": "Bow",
    "crossbow": "Crossbow", "slingshot": "Slingshot",
}

# Colors that read as a material/finish (used in display names).
COLOR_NAMES = {
    "brass": "Brass", "bronze": "Bronze", "ceramic": "Ceramic", "copper": "Copper",
    "dark": "Obsidian", "gold": "Gold", "iron": "Iron", "light": "Pale",
    "medium": "Burnished", "red": "Crimson", "silver": "Silver", "steel": "Steel",
    "blue": "Azure", "green": "Verdant", "orange": "Amber", "purple": "Violet",
    "yellow": "Gilded",
}


def _down_walk_ok(im: Image.Image) -> bool:
    return im.crop((0, 10 * 64, 832, 11 * 64)).getbbox() is not None


def _paste_oversize_walk(canvas: Image.Image, sheet: Image.Image) -> None:
    start_row, _ = slots.ANIMATION_ROWS["walk"]
    off = slots.OVERSIZE_OFFSET
    fp = slots.OVERSIZE_FRAME
    src_rows = sheet.height // fp
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
            canvas.alpha_composite(frame, (c * slots.CELL + off, target_row * slots.CELL + off))


def discover(weapon_root: Path) -> list[dict]:
    """Return canonical variant descriptors. One per (family, weapon, color)."""
    variants: dict[tuple, dict] = {}

    for png in sorted(weapon_root.rglob("*.png")):
        rel = png.relative_to(weapon_root)
        parts = rel.parts
        if len(parts) < 2:
            continue
        family, weapon = parts[0], parts[1]
        if family not in FAMILY_META:
            continue
        low = "/".join(parts).lower()
        # Skip behind/background layers, off-hand mirrors, arrows, gendered female.
        if any(x in low for x in ("behind", "background", "/bg/", "arrow", "/female/", "_off/")):
            continue

        try:
            im = Image.open(png).convert("RGBA")
        except Exception:
            continue

        is_std = im.size == (832, 1344)
        is_oversize_walk = im.size == (1664, 512) and "walk" in low

        if not (is_std or is_oversize_walk):
            continue
        if is_std and not _down_walk_ok(im):
            continue

        # Determine color token from the filename stem.
        stem = png.stem
        color = stem if stem not in (weapon, "foreground", "great", "recurve") else "_signature"

        key = (family, weapon, color)
        # Prefer standard fg sheets over oversize; prefer foreground/ dir.
        prio = 0
        if is_std:
            prio = 3 if "foreground" in low else 2
        else:
            prio = 1

        prev = variants.get(key)
        if prev is None or prio > prev["_prio"]:
            variants[key] = {
                "family": family, "weapon": weapon, "color": color,
                "src": str(png), "oversize": is_oversize_walk, "_prio": prio,
            }

    return list(variants.values())


def make_key(family: str, weapon: str, color: str) -> str:
    base = f"lpc_wpn_{weapon}"
    return base if color == "_signature" else f"{base}_{color}"


def make_name(weapon: str, color: str) -> str:
    wn = WEAPON_NAMES.get(weapon, weapon.replace("_", " ").title())
    if color == "_signature":
        return wn
    cn = COLOR_NAMES.get(color, color.replace("_", " ").title())
    return f"{cn} {wn}"


def build(args) -> None:
    weapon_root = args.source / WEAPON_REL
    if not weapon_root.exists():
        raise SystemExit(f"[source] weapon tree not found: {weapon_root}")

    variants = discover(weapon_root)
    variants.sort(key=lambda v: (v["family"], v["weapon"], v["color"]))
    print(f"Discovered {len(variants)} weapon variants")

    sidecar = []
    for v in variants:
        key = make_key(v["family"], v["weapon"], v["color"])
        name = make_name(v["weapon"], v["color"])
        meta = FAMILY_META[v["family"]]
        rel_out = f"game/lpc/weapon/{key}.png"
        sidecar.append({
            "key": key, "name": name, "family": v["family"], "weapon": v["weapon"],
            "color": v["color"], "category": meta["category"], "icon": meta["icon"],
            "file": rel_out, "src": v["src"], "oversize": v["oversize"],
        })

    if args.dry_run:
        from collections import Counter
        fam = Counter(s["family"] for s in sidecar)
        print("by family:", dict(fam))
        for s in sidecar:
            print(f"  {s['key']:34} {'OVR' if s['oversize'] else 'std'}  {s['name']}")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SIDECAR.parent.mkdir(parents=True, exist_ok=True)
    for s in sidecar:
        src = Path(s["src"])
        im = Image.open(src).convert("RGBA")
        if s["oversize"]:
            canvas = Image.new("RGBA", (slots.SHEET_W, slots.SHEET_H), (0, 0, 0, 0))
            _paste_oversize_walk(canvas, im)
            out = canvas
        else:
            # Standard sheet: keep the full top 21 rows (walk lives at 8-11).
            out = im.crop((0, 0, slots.SHEET_W, slots.SHEET_H))
        out.save(ARTIFACT_ROOT / "public" / s["file"])

    # Strip transient fields from the sidecar.
    for s in sidecar:
        s.pop("src", None)
    SIDECAR.write_text(json.dumps(sidecar, indent=2))
    print(f"Wrote {len(sidecar)} overlays to {OUT_DIR}")
    print(f"Sidecar: {SIDECAR}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true")
    build(ap.parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
