import { db } from "@workspace/db";
import {
  chamberTemplatesTable,
  type Labyrinth,
  type ChamberTemplate,
  type ChamberSpawnData,
} from "@workspace/db";
import type { ChamberLayoutData } from "@workspace/db";
import { biomeAccent, BIOME_BY_KEY, MATERIALS } from "./catalog";
import { getUnlockedRoomKeys, roomTypeKey } from "./roomPool";

import type { DbLike } from "./db";

// Deterministic PRNG so a given labyrinth always assembles the same run while
// different labyrinths feel distinct.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RoomRole = "entry" | "combat" | "gauntlet" | "hazard" | "treasure" | "boss";
type RoomSize = "small" | "medium" | "large";

const SIZE_RANK: Record<RoomSize, number> = { small: 0, medium: 1, large: 2 };

function roleOf(t: ChamberTemplate): RoomRole {
  return (t.role as RoomRole) ?? (t.hasBoss ? "boss" : "combat");
}

function sizeOf(t: ChamberTemplate): RoomSize {
  return (t.sizeClass as RoomSize) ?? "medium";
}

// The largest room size a labyrinth may use, gated by its depth so deeper labs
// unlock grander chambers.
function maxSizeRank(lab: Labyrinth): number {
  if (lab.depth >= 5) return SIZE_RANK.large;
  if (lab.depth >= 3) return SIZE_RANK.medium;
  return SIZE_RANK.small;
}

// Build the themed role arc for a run: an entry, a rising body of fights, an
// optional reward room, and a finale (boss when active).
function buildRoleArc(lab: Labyrinth, count: number): RoomRole[] {
  if (count <= 1) return [lab.bossActive ? "boss" : "combat"];

  const arc: RoomRole[] = ["entry"];
  const bodyRoles: RoomRole[] = ["combat", "gauntlet", "hazard"];
  // Reserve the finale slot; optionally a treasure room just before it.
  const finale: RoomRole = lab.bossActive ? "boss" : "treasure";
  const wantTreasure = count >= 4;
  const reserved = 1 + (wantTreasure ? 1 : 0); // entry + (treasure)
  const bodyCount = Math.max(0, count - reserved - 1); // minus finale

  for (let i = 0; i < bodyCount; i++) {
    arc.push(bodyRoles[i % bodyRoles.length]!);
  }
  if (wantTreasure) arc.push("treasure");
  arc.push(finale);
  return arc.slice(0, count);
}

// Pick a non-repeating template for each role slot from a deterministic pool.
function pickTemplates(
  all: ChamberTemplate[],
  lab: Labyrinth,
  count: number,
): ChamberTemplate[] {
  const rng = mulberry32((lab.id + 1) * 2654435761);
  const arc = buildRoleArc(lab, count);
  const maxRank = maxSizeRank(lab);
  const used = new Set<number>();
  const chosen: ChamberTemplate[] = [];

  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };

  for (const role of arc) {
    // Prefer rooms matching the role and within the depth size budget.
    let pool = all.filter(
      (t) => roleOf(t) === role && SIZE_RANK[sizeOf(t)] <= maxRank && !used.has(t.id),
    );
    if (pool.length === 0)
      pool = all.filter((t) => roleOf(t) === role && !used.has(t.id));
    if (pool.length === 0)
      pool = all.filter((t) => SIZE_RANK[sizeOf(t)] <= maxRank && !used.has(t.id));
    if (pool.length === 0) pool = all.filter((t) => !used.has(t.id));
    if (pool.length === 0) pool = all;

    const pick = shuffle(pool)[0]!;
    used.add(pick.id);
    chosen.push(pick);
  }
  return chosen;
}

export function lootTierForLab(lab: Labyrinth): number {
  return Math.min(5, Math.max(1, Math.ceil((lab.level + lab.depth + lab.rareNodeCount) / 4)));
}

// Co-op difficulty scaling. A larger party makes every enemy hit harder
// (PARTY_STAT_STEP per extra member) and adds more bodies to fight
// (PARTY_SPAWN_STEP extra copies of each enemy/elite per extra member), so a
// 4-player run is meaningfully tougher than a solo one. The boss is never
// duplicated — only its stats scale — so the finale stays a single showdown.
const PARTY_STAT_STEP = 0.35;
const PARTY_SPAWN_STEP = 0.6;

export function partyStatMultiplier(partySize: number): number {
  return 1 + PARTY_STAT_STEP * (Math.max(1, partySize) - 1);
}

// Number of EXTRA copies to add per enemy/elite spawn for a given party size.
function extraEnemyCopies(partySize: number): number {
  return Math.round(PARTY_SPAWN_STEP * (Math.max(1, partySize) - 1));
}

// Assemble the playable chamber layout for a labyrinth run. `partySize` scales
// enemy stats and counts for co-op runs (1 = solo, unchanged).
export async function assembleChambers(
  lab: Labyrinth,
  tx: DbLike = db,
  partySize = 1,
): Promise<ChamberLayoutData[]> {
  const all = await tx.select().from(chamberTemplatesTable);
  if (all.length === 0) return [];
  // Restrict template selection to the owner's unlocked room-type pool. The
  // role-arc, size gating, and difficulty scaling in pickTemplates still apply —
  // owners curate which room types exist, not how a run is balanced. Fall back to
  // the full set if the pool somehow excludes everything, so runs never break.
  const unlocked = await getUnlockedRoomKeys(lab.id, tx);
  const pool = all.filter((t) =>
    unlocked.has(roomTypeKey(roleOf(t), sizeOf(t))),
  );
  const usable = pool.length > 0 ? pool : all;
  const count = Math.max(1, lab.chamberCount);
  const templates = pickTemplates(usable, lab, count);
  const accent = lab.accentColor || biomeAccent(lab.biome);
  const bg = BIOME_BY_KEY[lab.biome]?.backgroundStyle;

  const baseScale = 1 + (lab.level - 1) * 0.12 + (lab.depth - 1) * 0.08;
  const partyMul = partyStatMultiplier(partySize);
  const extraCopies = extraEnemyCopies(partySize);
  // Deterministic jitter for duplicated co-op spawns so the same party size
  // always assembles the same dungeon.
  const jitter = mulberry32((lab.id + 7) * 40503);

  return templates.map((tpl, idx) => {
    const isLast = idx === templates.length - 1;
    // Per-index ramp so later chambers in the same run hit harder.
    const difficultyScale = baseScale * (1 + idx * 0.08);
    const statScale = difficultyScale * partyMul;
    const spawns: ChamberSpawnData[] = [];
    for (const s of tpl.spawns) {
      if (s.type === "enemy" || s.type === "elite" || s.type === "boss") {
        spawns.push({
          ...s,
          hp: Math.floor((s.hp ?? 30) * statScale),
          damage: Math.floor((s.damage ?? 6) * statScale),
        });
        // Add party-scaled extra enemies (never duplicate bosses).
        if ((s.type === "enemy" || s.type === "elite") && extraCopies > 0) {
          for (let k = 1; k <= extraCopies; k++) {
            const dx = (jitter() - 0.5) * 80;
            const dy = (jitter() - 0.5) * 80;
            spawns.push({
              ...s,
              id: `${s.id}-p${k}`,
              x: Math.max(24, Math.min(tpl.width - 24, s.x + dx)),
              y: Math.max(24, Math.min(tpl.height - 24, s.y + dy)),
              hp: Math.floor((s.hp ?? 30) * statScale),
              damage: Math.floor((s.damage ?? 6) * statScale),
            });
          }
        }
      } else {
        spawns.push({ ...s });
      }
    }

    // Inject a boss into the final chamber if the labyrinth has one and the template lacks it
    if (isLast && lab.bossActive && !spawns.some((s) => s.type === "boss")) {
      spawns.push({
        id: `boss-${tpl.id}`,
        type: "boss",
        x: tpl.width / 2,
        y: tpl.height * 0.25,
        variant: "guardian",
        hp: Math.floor(280 * statScale),
        damage: Math.floor(16 * statScale),
        speed: 1.1,
        lootTier: lootTierForLab(lab) + 1,
        label: "Guardian Boss",
      });
    }

    return {
      id: tpl.id * 1000 + idx,
      name: tpl.name,
      biome: lab.biome,
      width: tpl.width,
      height: tpl.height,
      accentColor: accent,
      backgroundStyle: tpl.backgroundStyle ?? bg,
      spawns,
      obstacles: tpl.obstacles,
      tiles: tpl.tiles ?? undefined,
      hazardZones: tpl.hazardZones ?? undefined,
      doors: tpl.doors ?? undefined,
      role: tpl.role ?? undefined,
      sizeClass: tpl.sizeClass ?? undefined,
    };
  });
}

export interface ChamberSummaryDto {
  id: number;
  name: string;
  biome: string;
  difficulty: number;
  enemyCount: number;
  hasBoss: boolean;
  lootTier: number;
}

export function summarizeChambers(chambers: ChamberLayoutData[], lab: Labyrinth): ChamberSummaryDto[] {
  const lootTier = lootTierForLab(lab);
  return chambers.map((c, idx) => ({
    id: c.id,
    name: c.name,
    biome: c.biome,
    difficulty: lab.level + idx,
    enemyCount: c.spawns.filter((s) => s.type === "enemy" || s.type === "elite").length,
    hasBoss: c.spawns.some((s) => s.type === "boss"),
    lootTier,
  }));
}

export interface LootTableEntryDto {
  kind: "currency" | "material" | "item";
  label: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  chance: number;
  minValue: number;
  maxValue: number;
  icon?: string;
}

export function buildLootTable(lab: Labyrinth): LootTableEntryDto[] {
  const lootTier = lootTierForLab(lab);
  const tierMul = 1 + (lootTier - 1) * 0.35;
  const entries: LootTableEntryDto[] = [
    { kind: "currency", label: "Gold", rarity: "common", chance: 1.0, minValue: Math.floor(20 * tierMul), maxValue: Math.floor(120 * tierMul), icon: "🪙" },
    { kind: "currency", label: "Ore", rarity: "common", chance: 0.7, minValue: Math.floor(5 * tierMul), maxValue: Math.floor(30 * tierMul), icon: "⛏️" },
    { kind: "currency", label: "Dust", rarity: "uncommon", chance: 0.5, minValue: Math.floor(3 * tierMul), maxValue: Math.floor(20 * tierMul), icon: "✨" },
    { kind: "currency", label: "Keys", rarity: "rare", chance: 0.4, minValue: 1, maxValue: Math.max(1, Math.floor(3 * tierMul)), icon: "🗝️" },
    { kind: "currency", label: "$LAB", rarity: "epic", chance: 0.3, minValue: 1, maxValue: Math.floor(12 * tierMul), icon: "💎" },
  ];
  for (const m of MATERIALS) {
    entries.push({
      kind: "material",
      label: m.name,
      rarity: lootTier >= 4 ? "rare" : "uncommon",
      chance: 0.35,
      minValue: 1,
      maxValue: Math.max(2, Math.floor(3 * tierMul)),
      icon: m.icon,
    });
  }
  entries.push({
    kind: "item",
    label: "Equipment Drop",
    rarity: lootTier >= 4 ? "legendary" : lootTier >= 3 ? "epic" : "rare",
    chance: lab.bossActive ? 0.6 : 0.4,
    minValue: Math.floor(40 * tierMul),
    maxValue: Math.floor(200 * tierMul),
    icon: "⚔️",
  });
  return entries;
}
