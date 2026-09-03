import { db } from "@workspace/db";
import {
  usersTable,
  labyrinthsTable,
  itemTemplatesTable,
  playerLoadoutsTable,
  playerItemsTable,
  type Labyrinth,
  type User,
  type ItemTemplate,
  type PlayerItem,
  type Rating,
  type ItemStatsData,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  applyDailyReset,
  computeAppealScore,
  getLabRatingStats,
  getUpgradeLevels,
  itemValue,
  scaleStats,
  sumStats,
  deriveArchetype,
} from "./game";
import { biomeAccent, LOADOUT_SLOTS, type LoadoutSlotKey } from "./catalog";

import type { DbLike } from "./db";

export async function userById(id: number, tx: DbLike = db): Promise<User | null> {
  const rows = await tx.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface LabyrinthDto {
  id: number;
  ownerUserId: number;
  ownerName: string;
  ownerAvatarUrl: string;
  name: string;
  description: string;
  biome: string;
  level: number;
  depth: number;
  chamberCount: number;
  rareNodeCount: number;
  published: boolean;
  tollGateUnlocked: boolean;
  entryFee: number;
  ratingAverage: number;
  ratingCount: number;
  runsToday: number;
  runsAllTime: number;
  rewardValueToday: number;
  dailyRunCapacity: number;
  dailyRewardCapacity: number;
  appealScore: number;
  bossActive: boolean;
  isOwner: boolean;
  accentColor: string;
  createdAt: string;
}

export async function buildLabyrinthDto(
  lab: Labyrinth,
  viewerUserId: number | null,
  tx: DbLike = db,
): Promise<LabyrinthDto> {
  const fresh = await applyDailyReset(lab, tx);
  const owner = await userById(fresh.ownerUserId, tx);
  const { ratingAverage, ratingCount } = await getLabRatingStats(fresh.id, tx);
  const upgradeLevels = await getUpgradeLevels(fresh.id, tx);
  const appealScore = computeAppealScore(fresh, ratingAverage, ratingCount, upgradeLevels);
  return {
    id: fresh.id,
    ownerUserId: fresh.ownerUserId,
    ownerName: owner?.displayName ?? "Unknown",
    ownerAvatarUrl: owner?.avatarUrl ?? "",
    name: fresh.name,
    description: fresh.description,
    biome: fresh.biome,
    level: fresh.level,
    depth: fresh.depth,
    chamberCount: fresh.chamberCount,
    rareNodeCount: fresh.rareNodeCount,
    published: fresh.published,
    tollGateUnlocked: fresh.tollGateUnlocked,
    entryFee: fresh.entryFee,
    ratingAverage,
    ratingCount,
    runsToday: fresh.runsToday,
    runsAllTime: fresh.runsAllTime,
    rewardValueToday: fresh.rewardValueToday,
    dailyRunCapacity: fresh.dailyRunCapacity,
    dailyRewardCapacity: fresh.dailyRewardCapacity,
    appealScore,
    bossActive: fresh.bossActive,
    isOwner: viewerUserId != null && viewerUserId === fresh.ownerUserId,
    accentColor: fresh.accentColor || biomeAccent(fresh.biome),
    createdAt: fresh.createdAt.toISOString(),
  };
}

export async function ownedLabyrinthId(
  userId: number,
  tx: DbLike = db,
): Promise<number | null> {
  const rows = await tx
    .select({ id: labyrinthsTable.id })
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.ownerUserId, userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function buildPlayerDto(user: User, tx: DbLike = db) {
  const { getBalancesDto } = await import("./balances");
  const balances = await getBalancesDto(user.id, tx);
  const labId = await ownedLabyrinthId(user.id, tx);
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    tagline: user.tagline,
    balances,
    ownedLabyrinthId: labId,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toItemTemplateDto(t: ItemTemplate) {
  return {
    key: t.key,
    name: t.name,
    description: t.description,
    slot: t.slot,
    category: t.category,
    rarity: t.rarity,
    damageType: t.damageType,
    baseValue: t.baseValue,
    stats: t.stats,
    abilityKey: t.abilityKey,
    abilityName: t.abilityName,
    abilityDescription: t.abilityDescription,
    icon: t.icon ?? undefined,
    spriteLayers: (t.spriteLayers as Record<string, string> | null) ?? undefined,
  };
}

export interface PlayerItemDto {
  id: number;
  template: ReturnType<typeof toItemTemplateDto>;
  level: number;
  equipped: boolean;
  slot: string;
  value: number;
  stats: ItemStatsData;
  acquiredAt: string;
  // True when this item has an active marketplace listing (escrowed): it cannot
  // be equipped, upgraded, or disposed until the listing is cancelled or sold.
  listed: boolean;
}

export function toPlayerItemDto(
  item: PlayerItem,
  template: ItemTemplate,
  equippedSlot: string | null,
  listed = false,
): PlayerItemDto {
  return {
    id: item.id,
    template: toItemTemplateDto(template),
    level: item.level,
    equipped: equippedSlot != null,
    slot: equippedSlot ?? "",
    value: itemValue(template.baseValue, item.level),
    stats: scaleStats(template.stats, item.level),
    acquiredAt: item.acquiredAt.toISOString(),
    listed,
  };
}

export async function templatesByKeys(
  keys: string[],
  tx: DbLike = db,
): Promise<Record<string, ItemTemplate>> {
  if (keys.length === 0) return {};
  const rows = await tx
    .select()
    .from(itemTemplatesTable)
    .where(inArray(itemTemplatesTable.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

// Returns map of playerItemId -> loadout slot key for a user
export async function equippedSlotMap(
  userId: number,
  tx: DbLike = db,
): Promise<Record<number, string>> {
  const rows = await tx
    .select()
    .from(playerLoadoutsTable)
    .where(eq(playerLoadoutsTable.userId, userId));
  const map: Record<number, string> = {};
  for (const r of rows) {
    if (r.playerItemId != null) map[r.playerItemId] = r.slotKey;
  }
  return map;
}

export async function buildLoadoutDto(userId: number, tx: DbLike = db) {
  const loadoutRows = await tx
    .select()
    .from(playerLoadoutsTable)
    .where(eq(playerLoadoutsTable.userId, userId));
  const slotToItemId: Record<string, number | null> = {};
  for (const s of LOADOUT_SLOTS) slotToItemId[s] = null;
  const itemIds: number[] = [];
  for (const r of loadoutRows) {
    slotToItemId[r.slotKey] = r.playerItemId;
    if (r.playerItemId != null) itemIds.push(r.playerItemId);
  }

  const items =
    itemIds.length > 0
      ? await tx.select().from(playerItemsTable).where(inArray(playerItemsTable.id, itemIds))
      : [];
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const templates = await templatesByKeys(items.map((i) => i.templateKey), tx);

  const slots: Record<string, PlayerItemDto | null> = {};
  const equippedStats: ItemStatsData[] = [];
  for (const slotKey of LOADOUT_SLOTS) {
    const itemId = slotToItemId[slotKey];
    if (itemId != null && itemById[itemId]) {
      const item = itemById[itemId]!;
      const template = templates[item.templateKey];
      if (template) {
        const dto = toPlayerItemDto(item, template, slotKey);
        slots[slotKey] = dto;
        equippedStats.push(dto.stats);
        continue;
      }
    }
    slots[slotKey] = null;
  }

  const combatStats = sumStats(equippedStats);
  const { archetype, archetypeDescription } = deriveArchetype(combatStats);

  return {
    slots: {
      weapon: slots.weapon ?? null,
      armor: slots.armor ?? null,
      boots: slots.boots ?? null,
      relic: slots.relic ?? null,
      abilityStone: slots.abilityStone ?? null,
      abilityStone2: slots.abilityStone2 ?? null,
      charm: slots.charm ?? null,
      helmet: slots.helmet ?? null,
      cape: slots.cape ?? null,
      shoulders: slots.shoulders ?? null,
      gloves: slots.gloves ?? null,
      pants: slots.pants ?? null,
      shield: slots.shield ?? null,
      neck: slots.neck ?? null,
    },
    combatStats,
    archetype,
    archetypeDescription,
  };
}

export function toRatingDto(
  rating: Rating,
  rater: User | null,
) {
  return {
    id: rating.id,
    labyrinthId: rating.labyrinthId,
    raterName: rater?.displayName ?? "Unknown",
    raterAvatarUrl: rater?.avatarUrl ?? "",
    stars: rating.stars,
    comment: rating.comment,
    difficultyVote: rating.difficultyVote,
    createdAt: rating.createdAt.toISOString(),
  };
}

export const LOADOUT_SLOT_SET = new Set<string>(LOADOUT_SLOTS as readonly string[]);
export type { LoadoutSlotKey };
