import { db } from "@workspace/db";
import {
  labyrinthsTable,
  labyrinthUpgradesTable,
  ratingsTable,
  type Labyrinth,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CURRENCY_VALUE, MATERIALS, UPGRADE_BY_KEY } from "./catalog";
import type { ItemStatsData } from "@workspace/db";

import type { DbLike } from "./db";

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Lazily reset a labyrinth's daily counters if the day has rolled over.
export async function applyDailyReset(
  lab: Labyrinth,
  tx: DbLike = db,
): Promise<Labyrinth> {
  const today = todayStr();
  if (lab.lastResetDate === today) return lab;
  const updated = await tx
    .update(labyrinthsTable)
    .set({
      runsToday: 0,
      rewardValueToday: 0,
      dropShareToday: 0,
      entryShareToday: 0,
      lastResetDate: today,
    })
    .where(eq(labyrinthsTable.id, lab.id))
    .returning();
  return updated[0] ?? lab;
}

export interface LabAggregates {
  ratingAverage: number;
  ratingCount: number;
  upgradeLevels: Record<string, number>;
  appealScore: number;
}

export async function getLabRatingStats(
  labyrinthId: number,
  tx: DbLike = db,
): Promise<{ ratingAverage: number; ratingCount: number }> {
  const rows = await tx
    .select({
      avg: sql<number>`coalesce(avg(${ratingsTable.stars}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(ratingsTable)
    .where(eq(ratingsTable.labyrinthId, labyrinthId));
  const r = rows[0];
  return {
    ratingAverage: Math.round((Number(r?.avg ?? 0)) * 10) / 10,
    ratingCount: Number(r?.count ?? 0),
  };
}

export async function getUpgradeLevels(
  labyrinthId: number,
  tx: DbLike = db,
): Promise<Record<string, number>> {
  const rows = await tx
    .select()
    .from(labyrinthUpgradesTable)
    .where(eq(labyrinthUpgradesTable.labyrinthId, labyrinthId));
  const map: Record<string, number> = {};
  for (const r of rows) map[r.upgradeKey] = r.level;
  return map;
}

export function computeAppealScore(
  lab: Labyrinth,
  ratingAverage: number,
  ratingCount: number,
  upgradeLevels: Record<string, number>,
): number {
  let score = 0;
  score += lab.depth * 5;
  score += lab.chamberCount * 4;
  score += lab.rareNodeCount * 8;
  score += lab.level * 3;
  if (lab.bossActive) score += 18;
  for (const [key, level] of Object.entries(upgradeLevels)) {
    const def = UPGRADE_BY_KEY[key];
    if (!def) continue;
    const weight = def.category === "appeal" ? 6 : def.category === "utility" ? 5 : 3;
    score += level * weight;
  }
  score += Math.round(ratingAverage * 6);
  score += Math.min(ratingCount, 25);
  return Math.max(1, Math.round(score));
}

export function suggestedFeeRange(appealScore: number): {
  suggestedMin: number;
  suggestedMax: number;
} {
  return {
    suggestedMin: Math.max(1, Math.floor(appealScore * 0.25)),
    suggestedMax: Math.max(2, Math.floor(appealScore * 0.7)),
  };
}

export function difficultyLabel(appealScore: number): string {
  if (appealScore < 30) return "novice";
  if (appealScore < 70) return "adept";
  if (appealScore < 120) return "veteran";
  if (appealScore < 200) return "master";
  return "mythic";
}

// ----- Combat stats & archetype -----

export function scaleStat(base: number, level: number): number {
  return Math.floor(base + base * 0.15 * (level - 1));
}

export function itemValue(baseValue: number, level: number): number {
  return Math.floor(baseValue * (1 + 0.25 * (level - 1)));
}

export function scaleStats(base: ItemStatsData, level: number): ItemStatsData {
  const out: ItemStatsData = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === "number") out[k as keyof ItemStatsData] = scaleStat(v, level);
  }
  return out;
}

const STAT_KEYS: (keyof ItemStatsData)[] = [
  "attack",
  "defense",
  "health",
  "moveSpeed",
  "attackSpeed",
  "range",
  "critChance",
  "lootBonus",
  "cooldownReduction",
];

export function sumStats(list: ItemStatsData[]): ItemStatsData {
  const out: ItemStatsData = {};
  for (const k of STAT_KEYS) {
    let total = 0;
    for (const s of list) total += s[k] ?? 0;
    if (total !== 0) out[k] = total;
  }
  return out;
}

export function deriveArchetype(stats: ItemStatsData): {
  archetype: string;
  archetypeDescription: string;
} {
  const attack = stats.attack ?? 0;
  const defense = stats.defense ?? 0;
  const health = stats.health ?? 0;
  const crit = stats.critChance ?? 0;
  const loot = stats.lootBonus ?? 0;
  const speed = (stats.moveSpeed ?? 0) + (stats.attackSpeed ?? 0);
  const range = stats.range ?? 0;

  const scores: { name: string; desc: string; score: number }[] = [
    { name: "Bladedancer", desc: "A whirl of steel — high attack and critical strikes shred foes up close.", score: attack + crit * 2 },
    { name: "Warden", desc: "An immovable bulwark — heavy armor and vitality outlast any onslaught.", score: defense * 1.5 + health },
    { name: "Stormcaller", desc: "A storm of strikes from afar — rapid, ranged, relentless.", score: speed + range * 1.5 },
    { name: "Treasure Hunter", desc: "Greed made manifest — every clear yields far richer spoils.", score: loot * 3 },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  if (top.score <= 0) {
    return {
      archetype: "Wanderer",
      archetypeDescription: "An unequipped soul — gear up to forge your identity.",
    };
  }
  return { archetype: top.name, archetypeDescription: top.desc };
}

// ----- Loot rolling (server-authoritative) -----

export interface RolledReward {
  gold: number;
  ore: number;
  dust: number;
  keys: number;
  materials: { key: string; name: string; icon: string; amount: number }[];
  totalValue: number;
}

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface RunStatsInput {
  cleared: boolean;
  enemiesDefeated: number;
  nodesHarvested: number;
  chestsOpened: number;
  bossDefeated: boolean;
}

export function rollRewards(
  input: RunStatsInput,
  lootTier: number,
  lootBonusPct: number,
): RolledReward {
  const tierMul = 1 + (lootTier - 1) * 0.35;
  const bonusMul = 1 + lootBonusPct / 100;
  const mul = tierMul * bonusMul;

  let gold = 0;
  let ore = 0;
  let dust = 0;
  let keys = 0;

  for (let i = 0; i < input.enemiesDefeated; i++) {
    gold += Math.floor(randInt(4, 11) * mul);
    if (Math.random() < 0.4) dust += Math.floor(randInt(1, 3) * mul);
  }
  for (let i = 0; i < input.nodesHarvested; i++) {
    ore += Math.floor(randInt(3, 8) * mul);
    if (Math.random() < 0.3) gold += Math.floor(randInt(2, 6) * mul);
  }
  for (let i = 0; i < input.chestsOpened; i++) {
    gold += Math.floor(randInt(15, 40) * mul);
    if (Math.random() < 0.5) keys += 1;
  }
  if (input.bossDefeated) {
    gold += Math.floor(randInt(80, 160) * mul);
    keys += randInt(1, 3);
  }
  if (input.cleared) {
    gold += Math.floor(randInt(20, 50) * mul);
  }

  // Materials from nodes and chests
  const materialCounts: Record<string, number> = {};
  const materialRolls = input.nodesHarvested + input.chestsOpened + (input.bossDefeated ? 2 : 0);
  for (let i = 0; i < materialRolls; i++) {
    if (Math.random() < 0.55) {
      const m = MATERIALS[randInt(0, MATERIALS.length - 1)]!;
      materialCounts[m.key] = (materialCounts[m.key] ?? 0) + Math.floor(randInt(1, 2) * tierMul);
    }
  }

  const materials = Object.entries(materialCounts)
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => {
      const def = MATERIALS.find((m) => m.key === key)!;
      return { key, name: def.name, icon: def.icon, amount };
    });

  const totalValue =
    gold * CURRENCY_VALUE.gold +
    ore * CURRENCY_VALUE.ore +
    dust * CURRENCY_VALUE.dust +
    keys * CURRENCY_VALUE.keys +
    materials.reduce((acc, m) => {
      const def = MATERIALS.find((x) => x.key === m.key)!;
      return acc + def.value * m.amount;
    }, 0);

  return { gold, ore, dust, keys, materials, totalValue };
}

// Rarity drop weights per loot tier (1-5). Tuned so legendaries stay genuinely
// rare and impactful: even at the highest tier a legendary is ~1-in-20, and the
// only way to push past that is a boss kill (which rolls its first drop at
// lootTier + 1, clamped to the tier-5 table). Epics carry the "exciting but
// attainable" band; rares are the reliable mid-game upgrade. Each row sums to 100
// so the weights read as direct percentages.
const RARITY_WEIGHTS: Record<number, [Rarity, number][]> = {
  1: [["common", 70], ["uncommon", 25], ["rare", 5], ["epic", 0], ["legendary", 0]],
  2: [["common", 55], ["uncommon", 32], ["rare", 11], ["epic", 2], ["legendary", 0]],
  3: [["common", 40], ["uncommon", 34], ["rare", 19], ["epic", 6], ["legendary", 1]],
  4: [["common", 26], ["uncommon", 33], ["rare", 26], ["epic", 12], ["legendary", 3]],
  5: [["common", 16], ["uncommon", 28], ["rare", 31], ["epic", 20], ["legendary", 5]],
};

export function rollRarity(lootTier: number): Rarity {
  const table = RARITY_WEIGHTS[Math.min(5, Math.max(1, lootTier))]!;
  const total = table.reduce((a, [, w]) => a + w, 0);
  let roll = Math.random() * total;
  for (const [rarity, w] of table) {
    roll -= w;
    if (roll <= 0) return rarity;
  }
  return "common";
}

// Ability stones are a tiny, hand-authored pool (10 templates) next to the
// hundreds of procedurally generated gear items. If every drop were chosen
// uniformly from the rolled-rarity pool, stones would be drowned out by gear and
// almost never appear, starving players of combat abilities. Instead, each item
// drop first makes a dedicated, tunable roll to BE an ability stone; only if that
// fails do we fall back to a normal rarity-weighted gear roll. Raise this to make
// stones more common, lower it to make them rarer. At the current rate a player
// can expect a stone every few runs regardless of how large the gear pool grows.
export const ABILITY_STONE_DROP_CHANCE = 0.2;

// Whether a given item drop should be drawn from the ability-stone pool instead
// of the regular gear pool. Frequency is governed solely by the explicit weight
// above, not by incidental gear-vs-stone pool ratios.
export function rollIsAbilityStone(): boolean {
  return Math.random() < ABILITY_STONE_DROP_CHANCE;
}

// Number of item drops a run should award
export function rollItemDropCount(input: RunStatsInput): number {
  let count = 0;
  for (let i = 0; i < input.chestsOpened; i++) {
    if (Math.random() < 0.45) count++;
  }
  if (input.bossDefeated) count++;
  return count;
}
