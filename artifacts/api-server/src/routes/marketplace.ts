import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  marketplaceListingsTable,
  playerItemsTable,
  playerLoadoutsTable,
  itemTemplatesTable,
  activityLogTable,
  chainTransactionsTable,
  treasuryTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, newToken } from "../lib/auth";
import { ROBINHOOD_NETWORK } from "../lib/robinhood";
import { getBalancesDto, addCurrency, ensureBalances } from "../lib/balances";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { writeLedger } from "../lib/ledger";
import { ensureTreasury } from "./economy";
import {
  marketplaceFee,
  activeListingForItem,
  buildListingDtos,
} from "../lib/marketplace";
import {
  MARKETPLACE_MIN_PRICE_CENTS,
  MARKETPLACE_MAX_PRICE_CENTS,
} from "../lib/catalog";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function usdcLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Browse all active listings (newest first).
router.get("/marketplace", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewerId = req.user?.id ?? null;
  const rows = await db
    .select()
    .from(marketplaceListingsTable)
    .where(eq(marketplaceListingsTable.status, "active"))
    .orderBy(desc(marketplaceListingsTable.createdAt))
    .limit(200);
  res.json(await buildListingDtos(rows, viewerId));
});

// The caller's own active listings.
router.get(
  "/marketplace/mine",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const rows = await db
      .select()
      .from(marketplaceListingsTable)
      .where(
        and(
          eq(marketplaceListingsTable.sellerUserId, userId),
          eq(marketplaceListingsTable.status, "active"),
        ),
      )
      .orderBy(desc(marketplaceListingsTable.createdAt));
    res.json(await buildListingDtos(rows, userId));
  },
);

// Marketplace USDC remains a separate settlement task. This development
// deposit credits the existing integer custodial ledger and records a chain-
// neutral settlement reference; it never pretends to be an on-chain transfer.
router.post(
  "/marketplace/deposit",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    const amountCents = Number(req.body?.amountCents);
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MARKETPLACE_MAX_PRICE_CENTS) {
      res.status(400).json({ error: "amountCents must be a positive integer" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "usdc_deposit");
    if (cached) {
      res.json(cached);
      return;
    }

    const result = await db.transaction(async (tx) => {
      await ensureBalances(userId, tx);
      await addCurrency(userId, { usdc: amountCents }, tx);
      await writeLedger(tx, {
        userId,
        type: "usdc_deposit_credit",
        direction: "credit",
        amount: amountCents,
        currency: "USDC",
        reason: `Deposited ${usdcLabel(amountCents)} USDC (mock on-ramp)`,
      });
      await tx.insert(chainTransactionsTable).values({
        userId,
        reference: newToken("ledger_"),
        kind: "usdc_deposit",
        status: "confirmed",
        amount: amountCents,
        currency: "USDC",
        memo: "USDC deposit (custodial ledger)",
        network: ROBINHOOD_NETWORK.name,
        chainId: ROBINHOOD_NETWORK.chainId,
      });
      const balances = await getBalancesDto(userId, tx);
      return { balances };
    });

    await saveIdempotentResponse(idempotencyKey, userId, "usdc_deposit", result);
    res.json(result);
  },
);

// Create a fixed-price USDC listing. Escrows the item: it must be owned by the
// caller, not equipped, and not already listed. Server-authoritative — only
// legitimately owned (server-minted) items can ever be referenced.
router.post(
  "/marketplace/list",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const playerItemId = parseId(req.body?.playerItemId);
    const priceCents = Number(req.body?.priceCents);
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();

    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    if (playerItemId == null) {
      res.status(400).json({ error: "playerItemId is required" });
      return;
    }
    if (
      !Number.isInteger(priceCents) ||
      priceCents < MARKETPLACE_MIN_PRICE_CENTS ||
      priceCents > MARKETPLACE_MAX_PRICE_CENTS
    ) {
      res.status(400).json({ error: "priceCents must be a valid USDC price" });
      return;
    }

    const cached = await getIdempotentResponse(idempotencyKey, userId, "marketplace_list");
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const itemRows = await tx
          .select()
          .from(playerItemsTable)
          .where(eq(playerItemsTable.id, playerItemId))
          .limit(1);
        const item = itemRows[0];
        if (!item || item.userId !== userId) {
          throw { status: 404, message: "Item not found" };
        }
        // Equipped items cannot be listed — unequip first.
        const equippedRows = await tx
          .select()
          .from(playerLoadoutsTable)
          .where(
            and(
              eq(playerLoadoutsTable.userId, userId),
              eq(playerLoadoutsTable.playerItemId, playerItemId),
            ),
          )
          .limit(1);
        if (equippedRows[0]) {
          throw { status: 400, message: "Unequip this item before listing it." };
        }
        // No duplicate active listing for the same item.
        const existing = await activeListingForItem(playerItemId, tx);
        if (existing) {
          throw { status: 409, message: "This item is already listed." };
        }

        const inserted = await tx
          .insert(marketplaceListingsTable)
          .values({
            playerItemId,
            sellerUserId: userId,
            priceCents,
            feeCents: marketplaceFee(priceCents),
            status: "active",
          })
          .returning();
        const listing = inserted[0]!;

        const tplRows = await tx
          .select()
          .from(itemTemplatesTable)
          .where(eq(itemTemplatesTable.key, item.templateKey))
          .limit(1);
        const tplName = tplRows[0]?.name ?? "an item";

        await tx.insert(activityLogTable).values({
          type: "list",
          message: `${req.user!.displayName} listed ${tplName} for ${usdcLabel(priceCents)} USDC`,
          actorUserId: userId,
          value: priceCents,
        });

        const [dto] = await buildListingDtos([listing], userId, tx);
        return { listing: dto! };
      });

      await saveIdempotentResponse(idempotencyKey, userId, "marketplace_list", result);
      res.json(result);
    } catch (err) {
      const e = err as { status?: number; message?: string; code?: string; constraint?: string };
      if (e?.status) {
        res.status(e.status).json({ error: e.message ?? "Could not list item" });
        return;
      }
      // Unique-violation on the partial "one active listing per item" index:
      // a concurrent request listed the same item first. Surface as a 409.
      if (e?.code === "23505") {
        res.status(409).json({ error: "This item is already listed." });
        return;
      }
      throw err;
    }
  },
);

// Cancel an active listing, returning the item from escrow. Seller-only.
router.post(
  "/marketplace/:id/cancel",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const listingId = parseId(req.params.id);
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    if (listingId == null) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "marketplace_cancel");
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Lock the listing row so a concurrent buy and cancel cannot both win.
        const rows = await tx
          .select()
          .from(marketplaceListingsTable)
          .where(eq(marketplaceListingsTable.id, listingId))
          .limit(1)
          .for("update");
        const listing = rows[0];
        if (!listing || listing.sellerUserId !== userId) {
          throw { status: 404, message: "Listing not found" };
        }
        if (listing.status !== "active") {
          throw { status: 409, message: "This listing is no longer active." };
        }
        // Conditional transition: only an active listing can be cancelled.
        const cancelled = await tx
          .update(marketplaceListingsTable)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(
            and(
              eq(marketplaceListingsTable.id, listingId),
              eq(marketplaceListingsTable.status, "active"),
            ),
          )
          .returning({ id: marketplaceListingsTable.id });
        if (cancelled.length === 0) {
          throw { status: 409, message: "This listing is no longer active." };
        }
        return { ok: true, listingId };
      });

      await saveIdempotentResponse(idempotencyKey, userId, "marketplace_cancel", result);
      res.json(result);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e?.status) {
        res.status(e.status).json({ error: e.message ?? "Could not cancel listing" });
        return;
      }
      throw err;
    }
  },
);

// Buy an active listing. Settles in USDC (server-authoritative price), transfers
// the item to the buyer, credits the seller minus the marketplace fee, and
// accrues the fee to the house treasury. Idempotent.
router.post(
  "/marketplace/:id/buy",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const listingId = parseId(req.params.id);
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    if (listingId == null) {
      res.status(404).json({ error: "Listing not found" });
      return;
    }
    const cached = await getIdempotentResponse(idempotencyKey, userId, "marketplace_buy");
    if (cached) {
      res.json(cached);
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Lock the listing row for the duration of the transaction so two
        // concurrent buyers cannot both pass the status check and double-settle.
        const rows = await tx
          .select()
          .from(marketplaceListingsTable)
          .where(eq(marketplaceListingsTable.id, listingId))
          .limit(1)
          .for("update");
        const listing = rows[0];
        if (!listing) {
          throw { status: 404, message: "Listing not found" };
        }
        if (listing.status !== "active") {
          throw { status: 409, message: "This listing is no longer available." };
        }
        if (listing.sellerUserId === userId) {
          throw { status: 400, message: "You cannot buy your own listing." };
        }

        const price = listing.priceCents;
        const fee = marketplaceFee(price);
        const sellerProceeds = price - fee;

        const buyerBal = await ensureBalances(userId, tx);
        if (buyerBal.usdc < price) {
          throw {
            status: 402,
            message: `Insufficient USDC. Need ${usdcLabel(price)}, have ${usdcLabel(buyerBal.usdc)}.`,
          };
        }

        // Re-fetch the escrowed item and confirm it still belongs to the seller.
        const itemRows = await tx
          .select()
          .from(playerItemsTable)
          .where(eq(playerItemsTable.id, listing.playerItemId))
          .limit(1);
        const item = itemRows[0];
        if (!item || item.userId !== listing.sellerUserId) {
          throw { status: 409, message: "This item is no longer available." };
        }

        const tplRows = await tx
          .select()
          .from(itemTemplatesTable)
          .where(eq(itemTemplatesTable.key, item.templateKey))
          .limit(1);
        const tplName = tplRows[0]?.name ?? "an item";

        // Settle USDC: debit buyer, credit seller (minus fee).
        await addCurrency(userId, { usdc: -price }, tx);
        await addCurrency(listing.sellerUserId, { usdc: sellerProceeds }, tx);

        // Transfer item ownership to the buyer.
        await tx
          .update(playerItemsTable)
          .set({ userId, acquiredAt: new Date() })
          .where(eq(playerItemsTable.id, item.id));

        // Mark listing sold with a conditional transition (status must still be
        // 'active'). Combined with the row lock above this guarantees a listing
        // settles at most once even under concurrent buyers.
        const sold = await tx
          .update(marketplaceListingsTable)
          .set({ status: "sold", buyerUserId: userId, soldAt: new Date(), feeCents: fee })
          .where(
            and(
              eq(marketplaceListingsTable.id, listingId),
              eq(marketplaceListingsTable.status, "active"),
            ),
          )
          .returning({ id: marketplaceListingsTable.id });
        if (sold.length === 0) {
          throw { status: 409, message: "This listing is no longer available." };
        }

        // House fee → treasury.
        if (fee > 0) {
          const treasury = await ensureTreasury(tx);
          await tx
            .update(treasuryTable)
            .set({ usdcFeesCollected: treasury.usdcFeesCollected + fee })
            .where(eq(treasuryTable.id, 1));
        }

        // Ledger: buyer debit, seller credit, house fee.
        await writeLedger(tx, {
          userId,
          type: "marketplace_purchase_debit",
          direction: "debit",
          amount: price,
          currency: "USDC",
          reason: `Bought ${tplName} for ${usdcLabel(price)} USDC`,
        });
        await writeLedger(tx, {
          userId: listing.sellerUserId,
          type: "marketplace_sale_credit",
          direction: "credit",
          amount: sellerProceeds,
          currency: "USDC",
          reason: `Sold ${tplName} for ${usdcLabel(sellerProceeds)} USDC (after fee)`,
        });
        if (fee > 0) {
          await writeLedger(tx, {
            userId: null,
            type: "marketplace_fee_collected",
            direction: "credit",
            amount: fee,
            currency: "USDC",
            reason: `Marketplace fee on ${tplName} (${usdcLabel(fee)} USDC)`,
          });
        }

        // Chain-neutral custodial settlement records for both parties.
        await tx.insert(chainTransactionsTable).values([
          {
            userId,
            reference: newToken("ledger_"),
            kind: "marketplace_purchase",
            status: "confirmed",
            amount: price,
            currency: "USDC",
            memo: `Purchased ${tplName}`,
            network: ROBINHOOD_NETWORK.name,
            chainId: ROBINHOOD_NETWORK.chainId,
          },
          {
            userId: listing.sellerUserId,
            reference: newToken("ledger_"),
            kind: "marketplace_sale",
            status: "confirmed",
            amount: sellerProceeds,
            currency: "USDC",
            memo: `Sold ${tplName}`,
            network: ROBINHOOD_NETWORK.name,
            chainId: ROBINHOOD_NETWORK.chainId,
          },
        ]);

        await tx.insert(activityLogTable).values({
          type: "purchase",
          message: `${req.user!.displayName} bought ${tplName} for ${usdcLabel(price)} USDC`,
          actorUserId: userId,
          value: price,
        });

        const balances = await getBalancesDto(userId, tx);
        return {
          listingId,
          playerItemId: item.id,
          pricePaidCents: price,
          feeCents: fee,
          balances,
        };
      });

      await saveIdempotentResponse(idempotencyKey, userId, "marketplace_buy", result);
      res.json(result);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e?.status) {
        res.status(e.status).json({ error: e.message ?? "Could not complete purchase" });
        return;
      }
      throw err;
    }
  },
);

export default router;
