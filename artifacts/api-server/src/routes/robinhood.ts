import { Router, type IRouter, type Request, type Response } from "express";
import { db, chainTransactionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { robinhoodConfigDto, ROBINHOOD_NETWORK, ROBINHOOD_SETTLEMENT_MODE } from "../lib/robinhood";

const router: IRouter = Router();

router.get("/chain/status", async (_req: Request, res: Response): Promise<void> => {
  res.json({
    connected: true,
    network: ROBINHOOD_NETWORK.name,
    chainId: ROBINHOOD_NETWORK.chainId,
    explorerUrl: ROBINHOOD_NETWORK.explorerUrl,
    settlementMode: ROBINHOOD_SETTLEMENT_MODE,
    note:
      ROBINHOOD_SETTLEMENT_MODE === "custodial_ledger"
        ? "Gameplay balances settle in the server-authoritative integer ledger. On-chain token contracts can be enabled after audit and configuration."
        : "Robinhood Chain settlement is enabled.",
  });
});

router.get("/chain/config", async (_req: Request, res: Response): Promise<void> => {
  res.json(robinhoodConfigDto());
});

router.get("/chain/transactions", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(chainTransactionsTable)
    .orderBy(desc(chainTransactionsTable.createdAt))
    .limit(50);
  res.json(
    rows.map((row) => ({
      id: row.id,
      // Legacy rows predate the Robinhood settlement boundary. Keep them
      // available for audit history without presenting their old synthetic
      // signature as an on-chain transaction hash.
      transactionReference: row.network ? row.reference : `legacy-ledger-${row.id}`,
      kind: row.kind,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      memo: row.network ? row.memo : row.memo?.replace(/\s*\(mock\)\s*$/i, ""),
      network: row.network ?? "legacy",
      chainId: row.chainId,
      createdAt: row.createdAt.toISOString(),
    })),
  );
});

export default router;