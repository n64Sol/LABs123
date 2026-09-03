import { ledgerEntriesTable } from "@workspace/db";
import type { DbLike } from "./db";

export type LedgerDirection = "credit" | "debit";

export interface LedgerInput {
  /** Owning user of the entry. Null for non-user entries (e.g. treasury). */
  userId?: number | null;
  /** Canonical ledger type, e.g. paid_entry_debit, owner_drop_share_credit. */
  type: string;
  direction: LedgerDirection;
  /** Positive magnitude; direction carries the sign semantics. */
  amount: number;
  currency: string;
  reason: string;
  labyrinthId?: number | null;
  runId?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write a single canonical ledger record. The economy ledger is the source of
 * accounting truth, so every balance or pending-earnings mutation must call this
 * inside the same transaction as the mutation it records.
 */
export async function writeLedger(tx: DbLike, entry: LedgerInput): Promise<void> {
  await tx.insert(ledgerEntriesTable).values({
    userId: entry.userId ?? null,
    type: entry.type,
    direction: entry.direction,
    description: entry.reason,
    reason: entry.reason,
    amount: Math.abs(entry.amount),
    currency: entry.currency,
    labyrinthId: entry.labyrinthId ?? null,
    runId: entry.runId ?? null,
    metadata: entry.metadata ?? null,
  });
}
