#!/usr/bin/env python3
"""Generate manifest + catalog entries for the imported LPC weapons.

Reads the sidecar written by `extract_weapons.py` and, for every imported
weapon variant, emits:

  * an entry in `public/game/lpc/generated_manifest.json` (the approved
    overlay allowlist the sprite validator checks against), and
  * an entry in the `WEAPON_TEMPLATES` const of
    `artifacts/api-server/src/data/generatedCatalog.ts` (so the weapon drops as
    loot and equips). Each line uses the exact `baseValue:N, stats:{...}` shape
    `generateCatalog.mjs` retunes by (slot, rarity).

Idempotent: existing `lpc_wpn_*` entries are stripped from both files before the
fresh set is written, so re-running after re-extracting is safe. The 5
hand-curated original weapons (non `lpc_wpn_` keys) are preserved.

    python gen_weapon_catalog.py    # patch manifest + catalog in place
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARTIFACT_ROOT = HERE.parent.parent
REPO_ROOT = ARTIFACT_ROOT.parent.parent
SIDECAR = HERE / "out" / "imported_weapons.json"
MANIFEST = ARTIFACT_ROOT / "public" / "game" / "lpc" / "generated_manifest.json"
CATALOG = REPO_ROOT / "artifacts" / "api-server" / "src" / "data" / "generatedCatalog.ts"

KEY_PREFIX = "lpc_wpn_"

# Material/finish -> rarity. Colored gem hues read as higher-grade arcane foci.
COLOR_RARITY = {
    "iron": "common", "copper": "common", "ceramic": "common", "bronze": "common",
    "steel": "uncommon", "light": "uncommon", "medium": "uncommon",
    "silver": "rare", "brass": "rare", "blue": "rare", "green": "rare",
    "orange": "rare", "yellow": "rare",
    "gold": "epic", "purple": "epic", "red": "epic",
    "dark": "legendary",
}

# Signature (uncolored) weapon -> rarity. Spread across all tiers so each is
# represented and the named weapons feel like distinct finds.
SIGNATURE_RARITY = {
    "dagger": "common", "mace": "common", "club": "common", "slingshot": "common",
    "simple": "common", "cane": "common",
    "flail": "uncommon", "waraxe": "uncommon", "spear": "uncommon",
    "loop": "uncommon", "crossbow": "uncommon",
    "rapier": "rare", "saber": "rare", "longsword": "rare", "longspear": "rare",
    "bow": "rare", "gnarled": "rare", "s": "rare", "crystal": "rare",
    "scimitar": "epic", "katana": "epic", "halberd": "epic", "trident": "epic",
    "diamond": "epic", "longsword_alt": "epic", "glowsword": "epic",
    "scythe": "legendary", "dragonspear": "legendary",
}

# Per-rarity defaults (mirrors generateCatalog.mjs so entries are sane even
# before catalog:gen runs; the generator overwrites these anyway).
RARITY_BASE_VALUE = {"common": 40, "uncommon": 95, "rare": 200, "epic": 390, "legendary": 700}
RARITY_STAT_MULT = {"common": 1.0, "uncommon": 1.9, "rare": 3.4, "epic": 6.5, "legendary": 11.0}

COLOR_DAMAGE = {
    "red": "fire", "orange": "fire",
    "blue": "frost",
    "yellow": "lightning", "purple": "lightning",
}
# Signature magic weapons get a flavor element; everything else is physical.
SIGNATURE_DAMAGE = {
    "crystal": "frost", "diamond": "lightning", "loop": "lightning",
    "s": "fire", "gnarled": "physical", "simple": "physical",
    "glowsword": "lightning",
}

FLAVOR = {
    "melee": "A finely balanced {n}, ready for the fray.",
    "ranged": "A {n} that strikes true from afar.",
    "magic": "A {n} humming with channeled power.",
}


def rarity_for(s: dict) -> str:
    if s["color"] == "_signature":
        return SIGNATURE_RARITY.get(s["weapon"], "common")
    return COLOR_RARITY.get(s["color"], "uncommon")


def damage_for(s: dict) -> str:
    if s["color"] != "_signature" and s["color"] in COLOR_DAMAGE:
        return COLOR_DAMAGE[s["color"]]
    if s["weapon"] in SIGNATURE_DAMAGE and (s["color"] == "_signature" or s["family"] == "magic"):
        return SIGNATURE_DAMAGE[s["weapon"]]
    return "physical"


def stats_for(rarity: str) -> str:
    mult = RARITY_STAT_MULT[rarity]
    atk = max(1, round(12 * mult))
    crit = max(1, round(4 * mult))
    return f"{{attack:{atk},critChance:{crit}}}"


def ts_escape(text: str) -> str:
    return text.replace('"', '\\"')


def build_catalog_line(s: dict) -> str:
    rarity = rarity_for(s)
    dmg = damage_for(s)
    desc = FLAVOR[s["category"]].format(n=s["name"])
    return (
        f'  {{ key:"{s["key"]}", name:"{ts_escape(s["name"])}", '
        f'description:"{ts_escape(desc)}", slot:"weapon", category:"{s["category"]}", '
        f'rarity:"{rarity}", damageType:"{dmg}", baseValue:{RARITY_BASE_VALUE[rarity]}, '
        f'stats:{stats_for(rarity)}, icon:"{s["icon"]}", '
        f'spriteLayers:{{weapon_fg:"{s["file"]}"}} }},'
    )


def build_manifest_entry(s: dict) -> dict:
    return {
        "slot": "weapon", "layerKey": "weapon_fg", "key": s["key"],
        "name": s["name"], "tier": rarity_for(s),
        "color": "signature" if s["color"] == "_signature" else s["color"],
        "file": s["file"],
    }


def patch_manifest(sidecar: list[dict]) -> int:
    data = json.loads(MANIFEST.read_text())
    data = [r for r in data if not r.get("key", "").startswith(KEY_PREFIX)]
    data.extend(build_manifest_entry(s) for s in sidecar)
    MANIFEST.write_text(json.dumps(data, indent=2) + "\n")
    return len(sidecar)


def patch_catalog(sidecar: list[dict]) -> int:
    text = CATALOG.read_text()
    lines = text.split("\n")
    start = next(i for i, l in enumerate(lines) if l.startswith("const WEAPON_TEMPLATES"))
    end = next(i for i in range(start, len(lines)) if lines[i].strip() == "];")

    body = lines[start + 1:end]
    # Drop any previously generated lpc_wpn_ lines; keep hand-curated originals.
    body = [l for l in body if f'key:"{KEY_PREFIX}' not in l]
    new_lines = [build_catalog_line(s) for s in sidecar]

    patched = lines[:start + 1] + body + new_lines + lines[end:]
    CATALOG.write_text("\n".join(patched))
    return len(new_lines)


def main() -> int:
    sidecar = json.loads(SIDECAR.read_text())
    sidecar.sort(key=lambda s: s["key"])
    m = patch_manifest(sidecar)
    c = patch_catalog(sidecar)
    from collections import Counter
    rc = Counter(rarity_for(s) for s in sidecar)
    print(f"Manifest: +{m} weapon entries")
    print(f"Catalog:  +{c} WEAPON_TEMPLATES entries")
    print("Rarity spread:", dict(rc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
