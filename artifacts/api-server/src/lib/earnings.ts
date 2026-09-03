import { db } from "@workspace/db";
import { ownerEarningsPendingTable, type OwnerEarningsPending } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { DbLike } from "./db";

export type EarningSource = "drop_share" | "entry_share";

/** The five wallet currencies; everything else is treated as a crafting material. */
export const WALLET_CURRENCIES = ["gold", "ore", "dust", "keys", "labToken"] as const;
export type WalletCurrency = (typeof WALLET_CURRENCIES)[number];

export function isWalletCurrency(currency: string): currency is WalletCurrency {
  return (WALLET_CURRENCIES as readonly string[]).includes(currency);
}

/**
 * Accrue per-currency pending owner earnings. Amounts must already be the
 * floored owner share for that currency; non-positive amounts are ignored so
 * whole-only currencies (e.g. keys) that floor to 0 add nothing.
 */
export async function addPendingEarning(
  tx: DbLike,
  labyrinthId: number,
  source: EarningSource,
  currency: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  const existing = await tx
    .select()
    .from(ownerEarningsPendingTable)
    .where(
      and(
        eq(ownerEarningsPendingTable.labyrinthId, labyrinthId),
        eq(ownerEarningsPendingTable.source, source),
        eq(ownerEarningsPendingTable.currency, currency),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await tx
      .update(ownerEarningsPendingTable)
      .set({ amount: existing[0].amount + amount })
      .where(eq(ownerEarningsPendingTable.id, existing[0].id));
  } else {
    await tx
      .insert(ownerEarningsPendingTable)
      .values({ labyrinthId, source, currency, amount });
  }
}

export async function getPendingEarnings(
  labyrinthId: number,
  tx: DbLike = db,
): Promise<OwnerEarningsPending[]> {
  return tx
    .select()
    .from(ownerEarningsPendingTable)
    .where(eq(ownerEarningsPendingTable.labyrinthId, labyrinthId));
}

export async function clearPendingEarnings(
  tx: DbLike,
  labyrinthId: number,
): Promise<void> {
  await tx
    .delete(ownerEarningsPendingTable)
    .where(eq(ownerEarningsPendingTable.labyrinthId, labyrinthId));
}
