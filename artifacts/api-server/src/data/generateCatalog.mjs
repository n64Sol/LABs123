// Catalog stat/value tuning generator.
//
// The LPC equipment catalog (generatedCatalog.ts) carries the identity of every
// item — key, name, description, slot, rarity, sprite layers, abilities — but its
// numeric `baseValue` and `stats` were originally assigned by a coarse heuristic
// (tier multiplier x per-slot base) that was never playtested.
//
// This script is the single source of truth for that tuning. It rewrites ONLY the
// `baseValue` and `stats:{...}` fields of each template in-place, leaving every
// identity/sprite field untouched, so it is safe to re-run after the sprite
// pipeline regenerates the catalog. Run it with:
//
//   node src/data/generateCatalog.mjs
//
// Design goals (see docs/balance-pass.md for the full rationale):
//  - Common/uncommon gear is left near its old power so the early game is stable.
//  - Rare -> epic -> legendary curves are steepened so each tier is a clear,
//    rewarding power spike that justifies its rarity.
//  - baseValue (economy) scales faster than raw stats at the top end so a
//    legendary drop is a genuine windfall, not just a marginally better common.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, "generatedCatalog.ts");

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];

// Power multiplier applied to a slot's base (common) stat block per rarity.
// Steeper than the old [1, 1.8, 3.2, 5.5, 9]: epic and legendary pull away so the
// top of the ladder feels meaningfully stronger.
const RARITY_STAT_MULT = {
  common: 1.0,
  uncommon: 1.9,
  rare: 3.4,
  epic: 6.5,
  legendary: 11.0,
};

// Gold-equivalent base value per rarity. Old curve was [39, 91, 182, 338, 598];
// the new curve keeps the bottom stable and accelerates the top so rarer loot is
// worth disproportionately more.
const RARITY_BASE_VALUE = {
  common: 40,
  uncommon: 95,
  rare: 200,
  epic: 390,
  legendary: 700,
};

// Per-slot stat profile: ordered [statKey, commonBaseValue] pairs. The order here
// is preserved in the emitted `stats:{...}` so diffs stay clean. Common base
// values match the existing catalog, so common gear is essentially unchanged.
//
// The `weapon` slot is special: instead of one profile shared by every weapon,
// each weapon archetype (sword/glaive/maul/bow) gets its own profile so that
// same-rarity weapons play differently. See WEAPON_PROFILE / weaponArchetype.
const SLOT_PROFILE = {
  weapon: [["attack", 12], ["critChance", 4]], // fallback; real weapons use WEAPON_PROFILE
  gloves: [["attackSpeed", 6], ["critChance", 3]],
  shoulders: [["defense", 4], ["attack", 4]],
  cape: [["moveSpeed", 6], ["lootBonus", 4]],
  boots: [["moveSpeed", 8], ["defense", 2]],
  helmet: [["defense", 5], ["health", 12]],
  pants: [["defense", 4], ["moveSpeed", 4]],
  neck: [["lootBonus", 8], ["critChance", 3]],
  shield: [["defense", 8], ["health", 10]],
  armor: [["defense", 6], ["health", 18]],
};

// Per-archetype weapon stat profiles ([statKey, commonBaseValue] pairs). All are
// tuned to roughly comparable weighted power at a given rarity (see STAT_WEIGHTS
// in the client's lib/game.ts) so weapons are side-grades with distinct feels
// rather than strict upgrades of one another:
//  - sword:  the balanced baseline (decent damage, speed, reach, crit).
//  - dagger: fast — very high attack-speed + crit, low per-hit damage, tiny reach.
//  - axe:    brutal — high per-hit damage, modest speed/reach (between sword & maul).
//  - maul:   heavy — big per-hit damage, no attack-speed (slow swings), tiny reach.
//  - glaive: reach — long melee range + sweep, lower per-hit damage.
//  - bow:    ranged — long range (projectile travel) + high crit, lower base damage.
//  - staff:  ranged caster — longest range, steady damage, low crit/speed.
const WEAPON_PROFILE = {
  sword: [["attack", 12], ["critChance", 5], ["attackSpeed", 4], ["range", 4]],
  dagger: [["attack", 9], ["attackSpeed", 7], ["critChance", 6], ["range", 2]],
  axe: [["attack", 14], ["critChance", 5], ["attackSpeed", 2], ["range", 3]],
  maul: [["attack", 16], ["critChance", 4], ["range", 2]],
  glaive: [["attack", 11], ["range", 22], ["attackSpeed", 3], ["critChance", 2]],
  bow: [["attack", 11], ["range", 16], ["critChance", 6], ["attackSpeed", 2]],
  staff: [["attack", 12], ["range", 20], ["critChance", 3], ["attackSpeed", 2]],
};

// Infer a weapon's archetype from its key/category. Rule-based so the generator
// stays repeatable: new weapons just need a recognisable key (e.g. *_bow,
// *_glaive, *_dagger) and they inherit the right feel automatically. Order
// matters — more specific families are matched before generic "sword". A weapon
// with no recognised keyword falls back to staff/bow if it is ranged, else the
// balanced sword profile, so unrecognised weapons are still sane (never crash).
function weaponArchetype(key, category) {
  const k = (key || "").toLowerCase();
  // Ranged families first (these decide projectile feel too).
  if (/bow|crossbow|longbow|shortbow|sling|throw/.test(k)) return "bow";
  if (/staff|wand|scepter|sceptre|rod|tome|grimoire|orb|focus/.test(k)) return "staff";
  // Reach polearms.
  if (/glaive|spear|halberd|polearm|pike|lance|naginata|trident|scythe/.test(k)) return "glaive";
  // Two-handed crushers (check hammer before generic "axe"/"mace" subsets).
  if (/maul|hammer|warhammer|mace|club|cudgel|flail|morningstar/.test(k)) return "maul";
  // Choppers — distinct from maul: faster, less raw burst.
  if (/axe|hatchet|cleaver|tomahawk/.test(k)) return "axe";
  // Light, fast blades.
  if (/dagger|knife|dirk|stiletto|shiv|kunai|fang/.test(k)) return "dagger";
  // Generic swords (and any other bladed melee).
  if (/sword|blade|sabre|saber|katana|rapier|scimitar|falchion|claymore|broadsword|greatsword|edge/.test(k)) return "sword";
  // Unrecognised: keep it sane.
  if (category === "ranged") return "bow";
  return "sword";
}

function emitStats(profile, rarity) {
  const mult = RARITY_STAT_MULT[rarity];
  const parts = profile.map(
    ([key, base]) => `${key}:${Math.max(1, Math.round(base * mult))}`,
  );
  return `{${parts.join(",")}}`;
}

function statsFor(slot, rarity, key, category) {
  if (slot === "weapon") {
    const profile = WEAPON_PROFILE[weaponArchetype(key, category)];
    return emitStats(profile, rarity);
  }
  const profile = SLOT_PROFILE[slot];
  if (!profile) throw new Error(`No stat profile for slot "${slot}"`);
  return emitStats(profile, rarity);
}

function main() {
  const original = readFileSync(FILE, "utf8");
  const lines = original.split("\n");
  let changed = 0;
  const counts = Object.fromEntries(RARITIES.map((r) => [r, 0]));

  const out = lines.map((line) => {
    const slotMatch = line.match(/\bslot:"([^"]+)"/);
    const rarityMatch = line.match(/\brarity:"([^"]+)"/);
    if (!slotMatch || !rarityMatch) return line;
    const slot = slotMatch[1];
    const rarity = rarityMatch[1];
    if (!SLOT_PROFILE[slot] || !RARITY_BASE_VALUE[rarity]) return line;
    const key = (line.match(/\bkey:"([^"]+)"/) || [])[1];
    const category = (line.match(/\bcategory:"([^"]+)"/) || [])[1];

    let next = line.replace(/\bbaseValue:\d+/, `baseValue:${RARITY_BASE_VALUE[rarity]}`);
    next = next.replace(/\bstats:\{[^}]*\}/, `stats:${statsFor(slot, rarity, key, category)}`);
    if (next !== line) changed++;
    counts[rarity]++;
    return next;
  });

  writeFileSync(FILE, out.join("\n"));
  console.log(`Retuned ${changed} templates.`);
  console.log("Per-rarity counts:", counts);
  console.log("baseValue curve:", RARITY_BASE_VALUE);
  console.log("stat multiplier curve:", RARITY_STAT_MULT);
}

main();
