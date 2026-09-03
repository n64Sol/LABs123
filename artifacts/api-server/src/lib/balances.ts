import { db } from "@workspace/db";
import {
  playerBalancesTable,
  playerMaterialsTable,
  type PlayerBalances,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { MATERIALS, MATERIAL_BY_KEY } from "./catalog";

import type { DbLike } from "./db";

export interface BalancesDto {
  gold: number;
  ore: number;
  dust: number;
  keys: number;
  labToken: number;
  usdc: number;
  materials: { key: string; name: string; amount: number; icon: string }[];
}

export async function ensureBalances(
  userId: number,
  tx: DbLike = db,
): Promise<PlayerBalances> {
  const existing = await tx
    .select()
    .from(playerBalancesTable)
    .where(eq(playerBalancesTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await tx
    .insert(playerBalancesTable)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await tx
    .select()
    .from(playerBalancesTable)
    .where(eq(playerBalancesTable.userId, userId))
    .limit(1);
  return again[0]!;
}

export async function getMaterialMap(
  userId: number,
  tx: DbLike = db,
): Promise<Record<string, number>> {
  const rows = await tx
    .select()
    .from(playerMaterialsTable)
    .where(eq(playerMaterialsTable.userId, userId));
  const map: Record<string, number> = {};
  for (const m of MATERIALS) map[m.key] = 0;
  for (const r of rows) map[r.materialKey] = r.amount;
  return map;
}

export async function getBalancesDto(
  userId: number,
  tx: DbLike = db,
): Promise<BalancesDto> {
  const bal = await ensureBalances(userId, tx);
  const matMap = await getMaterialMap(userId, tx);
  return {
    gold: bal.gold,
    ore: bal.ore,
    dust: bal.dust,
    keys: bal.keys,
    labToken: bal.labToken,
    usdc: bal.usdc,
    materials: MATERIALS.map((m) => ({
      key: m.key,
      name: m.name,
      icon: m.icon,
      amount: matMap[m.key] ?? 0,
    })),
  };
}

export type CurrencyKey = "gold" | "ore" | "dust" | "keys" | "labToken" | "usdc";

export async function addCurrency(
  userId: number,
  deltas: Partial<Record<CurrencyKey, number>>,
  tx: DbLike = db,
): Promise<void> {
  const bal = await ensureBalances(userId, tx);
  await tx
    .update(playerBalancesTable)
    .set({
      gold: bal.gold + (deltas.gold ?? 0),
      ore: bal.ore + (deltas.ore ?? 0),
      dust: bal.dust + (deltas.dust ?? 0),
      keys: bal.keys + (deltas.keys ?? 0),
      labToken: bal.labToken + (deltas.labToken ?? 0),
      usdc: bal.usdc + (deltas.usdc ?? 0),
    })
    .where(eq(playerBalancesTable.userId, userId));
}

export async function addMaterial(
  userId: number,
  materialKey: string,
  delta: number,
  tx: DbLike = db,
): Promise<void> {
  if (!MATERIAL_BY_KEY[materialKey]) return;
  const existing = await tx
    .select()
    .from(playerMaterialsTable)
    .where(
      and(
        eq(playerMaterialsTable.userId, userId),
        eq(playerMaterialsTable.materialKey, materialKey),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await tx
      .update(playerMaterialsTable)
      .set({ amount: Math.max(0, existing[0].amount + delta) })
      .where(eq(playerMaterialsTable.id, existing[0].id));
  } else {
    await tx
      .insert(playerMaterialsTable)
      .values({ userId, materialKey, amount: Math.max(0, delta) });
  }
}
