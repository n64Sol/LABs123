import {
  labyrinthsTable,
  runsTable,
  chainTransactionsTable,
  treasuryTable,
  type Labyrinth,
  type ChamberLayoutData,
  type Run,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { newToken } from "./auth";
import { addCurrency, ensureBalances } from "./balances";
import { writeLedger } from "./ledger";
import { addPendingEarning } from "./earnings";
import { ensureTreasury } from "../routes/economy";
import { ROBINHOOD_NETWORK } from "./robinhood";
import type { Tx } from "./db";

export interface StartRunArgs {
  tx: Tx;
  user: { id: number; displayName: string };
  lab: Labyrinth;
  isOwnerRun: boolean;
  chambers: ChamberLayoutData[];
  coopPartyId?: string | null;
  partySize?: number;
}

/**
 * Charge a single player's entry fee (if the labyrinth is a paid, published one)
 * and insert their run row, applying the 80/20 owner/treasury split exactly as
 * the solo path does. Runs inside the caller's transaction so co-op can create
 * several members' rows atomically. The shared `chambers` layout is passed in by
 * the caller so every member of a party fights the identical (scaled) dungeon.
 */
export async function startRunForMember(args: StartRunArgs): Promise<Run> {
  const { tx, user, lab, isOwnerRun, chambers } = args;
  const labyrinthId = lab.id;
  const isPaid = !isOwnerRun && lab.tollGateUnlocked && lab.entryFee > 0;
  const entryFee = isPaid ? lab.entryFee : 0;
  let ownerEntryShare = 0;
  let treasuryEntryShare = 0;

  if (isPaid) {
    // Split rounding rule: owner gets floor(amount * pct), treasury the remainder.
    ownerEntryShare = Math.floor(entryFee * 0.8);
    treasuryEntryShare = entryFee - ownerEntryShare;

    await addCurrency(user.id, { labToken: -entryFee }, tx);
    await tx.insert(chainTransactionsTable).values({
      userId: user.id,
      reference: newToken("ledger_"),
      kind: "entry_fee",
      status: "confirmed",
      amount: entryFee,
      currency: "LAB",
      memo: `Paid entry to ${lab.name}`,
      network: ROBINHOOD_NETWORK.name,
      chainId: ROBINHOOD_NETWORK.chainId,
    });
    await writeLedger(tx, {
      userId: user.id,
      type: "paid_entry_debit",
      direction: "debit",
      amount: entryFee,
      currency: "labToken",
      reason: `Paid entry to ${lab.name}`,
      labyrinthId,
    });

    await addPendingEarning(tx, labyrinthId, "entry_share", "labToken", ownerEntryShare);
    await tx
      .update(labyrinthsTable)
      .set({
        pendingEntryShare: lab.pendingEntryShare + ownerEntryShare,
        lifetimeEntryShare: lab.lifetimeEntryShare + ownerEntryShare,
        entryShareToday: lab.entryShareToday + ownerEntryShare,
      })
      .where(eq(labyrinthsTable.id, labyrinthId));
    await writeLedger(tx, {
      userId: lab.ownerUserId,
      type: "owner_entry_share_credit",
      direction: "credit",
      amount: ownerEntryShare,
      currency: "labToken",
      reason: `80% entry toll from ${user.displayName} on ${lab.name}`,
      labyrinthId,
    });

    const treasury = await ensureTreasury(tx);
    await tx
      .update(treasuryTable)
      .set({
        labTokenBalance: treasury.labTokenBalance + treasuryEntryShare,
        totalEntryFeesCollected: treasury.totalEntryFeesCollected + entryFee,
      })
      .where(eq(treasuryTable.id, treasury.id));
    await writeLedger(tx, {
      userId: null,
      type: "treasury_entry_share_credit",
      direction: "credit",
      amount: treasuryEntryShare,
      currency: "labToken",
      reason: `20% treasury share of entry to ${lab.name}`,
      labyrinthId,
    });
  }

  const inserted = await tx
    .insert(runsTable)
    .values({
      labyrinthId,
      visitorUserId: user.id,
      ownerUserId: lab.ownerUserId,
      status: "in_progress",
      isOwnerRun,
      isPaid,
      entryFee,
      ownerEntryShare,
      treasuryEntryShare,
      coopPartyId: args.coopPartyId ?? null,
      partySize: args.partySize ?? 1,
      chambers,
    })
    .returning();
  return inserted[0]!;
}

/** True when the player can afford a labyrinth's entry, used to gate co-op start. */
export async function canAffordEntry(
  userId: number,
  lab: Labyrinth,
  isOwnerRun: boolean,
  tx: Tx,
): Promise<boolean> {
  const isPaid = !isOwnerRun && lab.tollGateUnlocked && lab.entryFee > 0;
  if (!isPaid) return true;
  const bal = await ensureBalances(userId, tx);
  return bal.labToken >= lab.entryFee;
}
