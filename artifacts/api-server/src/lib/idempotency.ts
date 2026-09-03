import { db } from "@workspace/db";
import { idempotencyRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import type { DbLike } from "./db";

// Returns a stored response for this idempotency key if it exists, else null.
export async function getIdempotentResponse<T>(
  key: string,
  userId: number,
  scope: string,
  tx: DbLike = db,
): Promise<T | null> {
  const rows = await tx
    .select()
    .from(idempotencyRecordsTable)
    .where(eq(idempotencyRecordsTable.key, key))
    .limit(1);
  const rec = rows[0];
  if (!rec) return null;
  // A stored response may only be replayed for the same user AND the same action
  // scope it was created under — never across users or operation types.
  if (rec.userId !== userId) return null;
  if (rec.scope !== scope) return null;
  return rec.response as T;
}

export async function saveIdempotentResponse(
  key: string,
  userId: number,
  scope: string,
  response: unknown,
  tx: DbLike = db,
): Promise<void> {
  await tx
    .insert(idempotencyRecordsTable)
    .values({ key, userId, scope, response })
    .onConflictDoNothing();
}
