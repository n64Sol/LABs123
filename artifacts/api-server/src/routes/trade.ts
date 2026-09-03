import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  playerItemsTable,
  playerLoadoutsTable,
  activityLogTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { userById, templatesByKeys } from "../lib/dto";
import {
  ensureBalances,
  addCurrency,
  type CurrencyKey,
} from "../lib/balances";
import { writeLedger } from "../lib/ledger";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { itemValue } from "../lib/game";
import {
  tradeStore,
  emptyBag,
  TRADE_CURRENCIES,
  type CurrencyBag,
  type TradeSession,
  type TradeSide,
} from "../lib/trade";

const router: IRouter = Router();

// --- DTO --------------------------------------------------------------------

interface TradeOfferItemDto {
  playerItemId: number;
  templateKey: string;
  name: string;
  icon: string;
  rarity: string;
  slot: string;
  level: number;
  value: number;
}

interface TradeSideDto {
  userId: number;
  displayName: string;
  avatarUrl: string;
  confirmed: boolean;
  currency: CurrencyBag;
  items: TradeOfferItemDto[];
}

interface TradeSessionDto {
  id: string;
  status: TradeSession["status"];
  version: number;
  role: "initiator" | "recipient";
  me: TradeSideDto;
  them: TradeSideDto;
  bothConfirmed: boolean;
  note: string | null;
  updatedAt: string;
}

// Enrich a session's offered item ids into display rows for the client. A viewer
// may not own the counterpart's items, so the server resolves every offered id.
async function buildTradeDto(
  s: TradeSession,
  viewerUserId: number,
): Promise<TradeSessionDto> {
  const allIds = Array.from(
    new Set([...s.initiator.itemIds, ...s.recipient.itemIds]),
  );
  const itemRows = allIds.length
    ? await db.select().from(playerItemsTable).where(inArray(playerItemsTable.id, allIds))
    : [];
  const templates = await templatesByKeys(itemRows.map((i) => i.templateKey));
  const byId = new Map(itemRows.map((i) => [i.id, i]));

  const toItems = (ids: number[]): TradeOfferItemDto[] => {
    const out: TradeOfferItemDto[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) continue;
      const tpl = templates[item.templateKey];
      if (!tpl) continue;
      out.push({
        playerItemId: id,
        templateKey: tpl.key,
        name: tpl.name,
        icon: tpl.icon ?? "",
        rarity: tpl.rarity,
        slot: tpl.slot,
        level: item.level,
        value: itemValue(tpl.baseValue, item.level),
      });
    }
    return out;
  };

  const sideDto = (side: TradeSide): TradeSideDto => ({
    userId: side.userId,
    displayName: side.displayName,
    avatarUrl: side.avatarUrl,
    confirmed: side.confirmed,
    currency: { ...side.currency },
    items: toItems(side.itemIds),
  });

  const isInitiator = s.initiator.userId === viewerUserId;
  const me = isInitiator ? s.initiator : s.recipient;
  const them = isInitiator ? s.recipient : s.initiator;
  return {
    id: s.id,
    status: s.status,
    version: s.version,
    role: isInitiator ? "initiator" : "recipient",
    me: sideDto(me),
    them: sideDto(them),
    bothConfirmed: tradeStore.bothConfirmed(s),
    note: s.note ?? null,
    updatedAt: new Date(s.updatedAt).toISOString(),
  };
}

function parsePositiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Coerce a client-supplied currency object into a clean, non-negative bag.
function parseCurrencyBag(raw: unknown): CurrencyBag {
  const bag = emptyBag();
  if (raw && typeof raw === "object") {
    for (const key of TRADE_CURRENCIES) {
      const n = Number((raw as Record<string, unknown>)[key]);
      if (Number.isInteger(n) && n > 0) bag[key] = n;
    }
  }
  return bag;
}

// --- Routes -----------------------------------------------------------------

// GET /trade/active — the polling endpoint. Returns the caller's live or most
// recent terminal trade (so both parties observe the final outcome), or null.
router.get("/trade/active", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const s = tradeStore.visibleSessionFor(userId);
  if (!s) {
    res.json({ trade: null });
    return;
  }
  res.json({ trade: await buildTradeDto(s, userId) });
});

// POST /trade/invite — initiate a trade with an encountered player.
router.post("/trade/invite", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const targetUserId = parsePositiveInt(req.body?.toUserId);
  if (targetUserId == null) {
    res.status(400).json({ error: "toUserId is required" });
    return;
  }
  const target = await userById(targetUserId);
  if (!target) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  const { session, error } = tradeStore.invite(
    {
      id: userId,
      displayName: req.user!.displayName,
      avatarUrl: req.user!.avatarUrl,
    },
    { id: target.id, displayName: target.displayName, avatarUrl: target.avatarUrl },
  );
  if (error || !session) {
    res.status(409).json({ error: error ?? "Could not start trade" });
    return;
  }
  res.json({ trade: await buildTradeDto(session, userId) });
});

// POST /trade/:id/respond — recipient accepts or declines a pending invite.
router.post("/trade/:id/respond", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const accept = req.body?.accept === true;
  const { session, error } = tradeStore.respond(String(req.params.id), userId, accept);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not respond" });
    return;
  }
  res.json({ trade: await buildTradeDto(session, userId) });
});

// POST /trade/:id/offer — stage this participant's full offer (replaces prior).
router.post("/trade/:id/offer", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const rawIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
  const itemIds = Array.from(
    new Set(rawIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0)),
  ) as number[];
  const currency = parseCurrencyBag(req.body?.currency);

  // Validate the staged offer against the live DB so a player can only stage
  // assets they actually own / can afford. Settlement re-validates anyway, but
  // this gives immediate, honest feedback.
  if (itemIds.length > 0) {
    const owned = await db.select().from(playerItemsTable).where(inArray(playerItemsTable.id, itemIds));
    const ownedMine = owned.filter((i) => i.userId === userId);
    if (ownedMine.length !== itemIds.length) {
      res.status(400).json({ error: "You can only offer items you own" });
      return;
    }
  }
  const bal = await ensureBalances(userId);
  for (const key of TRADE_CURRENCIES) {
    if (currency[key] > (bal[key] ?? 0)) {
      res.status(400).json({ error: `Insufficient ${key} to offer` });
      return;
    }
  }

  const { session, error } = tradeStore.setOffer(String(req.params.id), userId, itemIds, currency);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not update offer" });
    return;
  }
  res.json({ trade: await buildTradeDto(session, userId) });
});

// POST /trade/:id/confirm — toggle the caller's confirmation. When both sides
// are confirmed the swap is settled atomically.
router.post("/trade/:id/confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const confirmed = req.body?.confirmed !== false; // default true
  const id = String(req.params.id);
  const { session, error } = tradeStore.setConfirm(id, userId, confirmed);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not confirm" });
    return;
  }

  if (tradeStore.bothConfirmed(session) && !session.settling) {
    session.settling = true;
    try {
      await settleTrade(session);
      tradeStore.markSettled(session);
    } catch (e) {
      tradeStore.markFailed(
        session,
        e instanceof Error ? e.message : "Trade failed to settle",
      );
    }
  }

  res.json({ trade: await buildTradeDto(session, userId) });
});

// POST /trade/:id/cancel — either participant cancels, returning everything.
router.post("/trade/:id/cancel", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { session, error } = tradeStore.cancel(String(req.params.id), userId);
  if (error || !session) {
    res.status(400).json({ error: error ?? "Could not cancel" });
    return;
  }
  res.json({ trade: await buildTradeDto(session, userId) });
});

// --- Settlement -------------------------------------------------------------

function ledgerCurrencyEntries(bag: CurrencyBag): { currency: CurrencyKey; amount: number }[] {
  const out: { currency: CurrencyKey; amount: number }[] = [];
  for (const key of TRADE_CURRENCIES) {
    if (bag[key] > 0) out.push({ currency: key, amount: bag[key] });
  }
  return out;
}

/**
 * Execute the asset swap atomically. Re-validates ownership and balances inside
 * the transaction (the in-memory offer is never trusted as the source of truth),
 * transfers items + currency in both directions, clears loadout references on
 * transferred items, records ledger + activity, and is idempotent on the trade
 * id so a retried second-confirm cannot double-apply.
 */
async function settleTrade(s: TradeSession): Promise<void> {
  const idemKey = `trade_settle_${s.id}`;
  const cached = await getIdempotentResponse(idemKey, s.initiator.userId, "trade_settle");
  if (cached) return;

  const a = s.initiator;
  const b = s.recipient;

  await db.transaction(async (tx) => {
    // Re-validate ownership of every offered item, currently, in-tx.
    const validateOwnership = async (side: TradeSide): Promise<void> => {
      if (side.itemIds.length === 0) return;
      const rows = await tx
        .select()
        .from(playerItemsTable)
        .where(inArray(playerItemsTable.id, side.itemIds));
      if (rows.length !== side.itemIds.length) {
        throw new Error("An offered item no longer exists");
      }
      for (const r of rows) {
        if (r.userId !== side.userId) {
          throw new Error("An offered item is no longer owned by its sender");
        }
      }
    };
    await validateOwnership(a);
    await validateOwnership(b);

    // Re-validate balances cover each side's currency offer.
    const balA = await ensureBalances(a.userId, tx);
    const balB = await ensureBalances(b.userId, tx);
    for (const key of TRADE_CURRENCIES) {
      if (a.currency[key] > (balA[key] ?? 0)) throw new Error(`Sender lacks ${key}`);
      if (b.currency[key] > (balB[key] ?? 0)) throw new Error(`Sender lacks ${key}`);
    }

    // Transfer items: A's → B, B's → A. Clear the giver's loadout slots that
    // referenced any transferred item so no dangling cross-user equip remains.
    const transfer = async (from: TradeSide, toUserId: number): Promise<void> => {
      if (from.itemIds.length === 0) return;
      await tx
        .update(playerLoadoutsTable)
        .set({ playerItemId: null })
        .where(inArray(playerLoadoutsTable.playerItemId, from.itemIds));
      await tx
        .update(playerItemsTable)
        .set({ userId: toUserId })
        .where(inArray(playerItemsTable.id, from.itemIds));
    };
    await transfer(a, b.userId);
    await transfer(b, a.userId);

    // Currency: pure transfer (no minting). Each side loses what it gave and
    // gains what it received.
    const deltaA: Partial<Record<CurrencyKey, number>> = {};
    const deltaB: Partial<Record<CurrencyKey, number>> = {};
    for (const key of TRADE_CURRENCIES) {
      const aGives = a.currency[key];
      const bGives = b.currency[key];
      const dA = bGives - aGives;
      const dB = aGives - bGives;
      if (dA !== 0) deltaA[key] = dA;
      if (dB !== 0) deltaB[key] = dB;
    }
    if (Object.keys(deltaA).length) await addCurrency(a.userId, deltaA, tx);
    if (Object.keys(deltaB).length) await addCurrency(b.userId, deltaB, tx);

    // Ledger: record what each side gave (debit) and received (credit).
    for (const e of ledgerCurrencyEntries(a.currency)) {
      await writeLedger(tx, {
        userId: a.userId,
        type: "trade_debit",
        direction: "debit",
        amount: e.amount,
        currency: e.currency,
        reason: `Traded ${e.amount} ${e.currency} to ${b.displayName}`,
        metadata: { tradeId: s.id },
      });
      await writeLedger(tx, {
        userId: b.userId,
        type: "trade_credit",
        direction: "credit",
        amount: e.amount,
        currency: e.currency,
        reason: `Received ${e.amount} ${e.currency} from ${a.displayName}`,
        metadata: { tradeId: s.id },
      });
    }
    for (const e of ledgerCurrencyEntries(b.currency)) {
      await writeLedger(tx, {
        userId: b.userId,
        type: "trade_debit",
        direction: "debit",
        amount: e.amount,
        currency: e.currency,
        reason: `Traded ${e.amount} ${e.currency} to ${a.displayName}`,
        metadata: { tradeId: s.id },
      });
      await writeLedger(tx, {
        userId: a.userId,
        type: "trade_credit",
        direction: "credit",
        amount: e.amount,
        currency: e.currency,
        reason: `Received ${e.amount} ${e.currency} from ${b.displayName}`,
        metadata: { tradeId: s.id },
      });
    }

    const itemsSwapped = a.itemIds.length + b.itemIds.length;
    await tx.insert(activityLogTable).values({
      type: "trade",
      message: `${a.displayName} and ${b.displayName} completed a trade`,
      actorUserId: a.userId,
      value: itemsSwapped,
    });

    await saveIdempotentResponse(idemKey, a.userId, "trade_settle", { settled: true }, tx);
  });
}

export default router;
