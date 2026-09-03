import type { ItemStats } from "@workspace/api-client-react";

export const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITY_ORDER)[number];

export const RARITY_COLORS: Record<string, { text: string; bg: string; border: string; glow: string; label: string }> = {
  common: { text: "text-slate-600", bg: "bg-slate-100", border: "border-slate-300", glow: "rgba(100,116,139,0.35)", label: "Common" },
  uncommon: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-300", glow: "rgba(16,185,129,0.45)", label: "Uncommon" },
  rare: { text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-300", glow: "rgba(14,165,233,0.5)", label: "Rare" },
  epic: { text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-300", glow: "rgba(139,92,246,0.55)", label: "Epic" },
  legendary: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-400", glow: "rgba(245,158,11,0.65)", label: "Legendary" },
};

export function rarity(r?: string | null) {
  return RARITY_COLORS[r ?? "common"] ?? RARITY_COLORS.common;
}

export const BIOMES: Record<string, { name: string; accent: string; bg: string }> = {
  sunlit_ruins: { name: "Sunlit Ruins", accent: "#f5b942", bg: "radial-gradient(circle at 30% 20%, #fff4d6, #e8c977)" },
  verdant_grove: { name: "Verdant Grove", accent: "#5fd97a", bg: "radial-gradient(circle at 30% 20%, #d6ffe0, #7fd99a)" },
  crystal_caverns: { name: "Crystal Caverns", accent: "#5fc9f5", bg: "radial-gradient(circle at 30% 20%, #d6f3ff, #7fc4e0)" },
  emberforge: { name: "Emberforge Depths", accent: "#f57c5f", bg: "radial-gradient(circle at 30% 20%, #ffe0d6, #e08f7f)" },
  astral_spire: { name: "Astral Spire", accent: "#b98cf5", bg: "radial-gradient(circle at 30% 20%, #ece0ff, #b89ae0)" },
  tidecaller: { name: "Tidecaller Hollow", accent: "#5fe0d4", bg: "radial-gradient(circle at 30% 20%, #d6fff9, #7fd9cf)" },
};

export function biome(key?: string) {
  return BIOMES[key ?? "sunlit_ruins"] ?? { name: key ?? "Unknown", accent: "#f5b942", bg: "radial-gradient(circle at 30% 20%, #fff4d6, #e8c977)" };
}

export const STAT_LABELS: Record<keyof ItemStats, string> = {
  attack: "Attack",
  defense: "Defense",
  health: "Health",
  moveSpeed: "Move Speed",
  attackSpeed: "Attack Speed",
  range: "Range",
  critChance: "Crit Chance",
  lootBonus: "Loot Bonus",
  cooldownReduction: "Cooldown Reduction",
};

export function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null) return "0";
  return Math.round(n).toLocaleString();
}

/** Format integer USDC cents as a dollar string, e.g. 12345 -> "$123.45". */
export function fmtUsdc(cents: number | undefined | null): string {
  const c = cents ?? 0;
  return `$${(c / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The stats a player actually gets from an item: the level-scaled `stats` if
 * present, otherwise the template's base stats. Mirrors the inline
 * `it.stats ?? it.template.stats` used across the inventory UI.
 */
export function effectiveStats(
  item?: { stats?: ItemStats | null; template?: { stats?: ItemStats | null } } | null,
): ItemStats | undefined {
  if (!item) return undefined;
  return (item.stats ?? item.template?.stats) ?? undefined;
}

/**
 * Per-point combat weight for each stat, used to turn an item's stat block into a
 * single comparable power score (upgrade / best-in-slot). A flat sum is
 * misleading because a point of Health (raw magnitudes in the tens/hundreds)
 * would dwarf a point of Attack even though Attack is far more impactful — and
 * pure-loot pieces would rank as combat upgrades.
 *
 * Weights are derived from how the run-time combat sim (Run.tsx buildChamber)
 * actually converts these stats into effective power, normalised so 1 point of
 * Health = 1.0:
 *  - attack (4.0):   adds directly to per-hit damage (patk = 12 + attack); the
 *                    dominant DPS lever since every swing/ability scales off it.
 *  - critChance (2): pcrit is % chance of a 2x hit → ~+1% damage per point.
 *  - attackSpeed (2): shortens the attack interval (720 - as*7 ms) → ~+1% DPS/pt.
 *  - cooldownReduction (2): faster autos (interval * (1 - cdr/200)) plus more
 *                    ability uptime.
 *  - defense (1.6):  mitigation curve 100/(100+def) → ~+1% effective HP per point.
 *  - health (1.0):   +1 max HP per point (pmaxhp = 100 + health); reference unit.
 *  - moveSpeed (0.7): kiting + faster dash cooldown; survival utility.
 *  - range (0.6):    extra reach/safety.
 *  - lootBonus (0.2): no combat impact at all — kept tiny so loot pieces aren't
 *                    flagged as combat upgrades but aren't entirely invisible.
 */
export const STAT_WEIGHTS: Record<keyof ItemStats, number> = {
  attack: 4.0,
  critChance: 2.0,
  attackSpeed: 2.0,
  cooldownReduction: 2.0,
  defense: 1.6,
  health: 1.0,
  moveSpeed: 0.7,
  range: 0.6,
  lootBonus: 0.2,
};

/**
 * A single-number combat power score for an item, used to decide whether one
 * piece beats another (upgrade / best-in-slot). Stats are weighted by their real
 * combat impact (see STAT_WEIGHTS) rather than summed flat, so stat-skewed items
 * (e.g. a pure-Attack weapon vs a Health-padded one) rank the way a player would
 * intuitively expect.
 */
export function statTotal(stats?: ItemStats | null): number {
  if (!stats) return 0;
  return (Object.keys(STAT_WEIGHTS) as (keyof ItemStats)[]).reduce(
    (sum, k) => sum + (stats[k] ?? 0) * STAT_WEIGHTS[k],
    0,
  );
}

export function makeIdempotencyKey(prefix = "k"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
