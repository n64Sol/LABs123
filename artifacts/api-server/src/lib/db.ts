import { db } from "@workspace/db";

// A transaction handle, derived from db.transaction's callback parameter.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Accepts either the root db or an active transaction so helpers can run in both.
export type DbLike = typeof db | Tx;
