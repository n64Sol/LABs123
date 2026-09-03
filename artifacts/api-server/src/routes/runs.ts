import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  labyrinthsTable,
  runsTable,
  usersTable,
  ratingsTable,
  ledgerEntriesTable,
  activityLogTable,
  chainTransactionsTable,
  treasuryTable,
  playerItemsTable,
  itemTemplatesTable,
  type Run,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, newToken } from "../lib/auth";
import { ROBINHOOD_NETWORK } from "../lib/robinhood";
import { buildLoadoutDto, toRatingDto } from "../lib/dto";
import {
  getBalancesDto,
  ensureBalances,
  addCurrency,
  addMaterial,
} from "../lib/balances";
import { getIdempotentResponse, saveIdempotentResponse } from "../lib/idempotency";
import { ensureTreasury } from "./economy";
import { assembleChambers, lootTierForLab } from "../lib/chambers";
import { applyDailyReset, rollRewards, rollItemDropCount, rollRarity, rollIsAbilityStone, itemValue } from "../lib/game";
import { writeLedger } from "../lib/ledger";
import { addPendingEarning } from "../lib/earnings";
import { CURRENCY_VALUE, MATERIAL_BY_KEY } from "../lib/catalog";
import { coop } from "../lib/coop";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface RunDtoOpts {
  includeChambers?: boolean;
  includeLoadout?: boolean;
  includeSummary?: boolean;
}

async function buildRunDto(run: Run, opts: RunDtoOpts = {}) {
  const labRows = await db
    .select({ name: labyrinthsTable.name, biome: labyrinthsTable.biome })
    .from(labyrinthsTable)
    .where(eq(labyrinthsTable.id, run.labyrinthId))
    .limit(1);
  const visitorRows = await db
    .select({ name: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, run.visitorUserId))
    .limit(1);

  const dto: Record<string, unknown> = {
    id: run.id,
    labyrinthId: run.labyrinthId,
    labyrinthName: labRows[0]?.name ?? "Unknown",
    biome: labRows[0]?.biome ?? "sunlit_ruins",
    visitorUserId: run.visitorUserId,
    visitorName: visitorRows[0]?.name ?? "Unknown",
    ownerUserId: run.ownerUserId,
    status: run.status,
    isOwnerRun: run.isOwnerRun,
    isPaid: run.isPaid,
    entryFee: run.entryFee,
    ownerEntryShare: run.ownerEntryShare,
    treasuryEntryShare: run.treasuryEntryShare,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    coopPartyId: run.coopPartyId ?? null,
    partySize: run.partySize,
  };
  if (opts.includeChambers) dto.chambers = run.chambers;
  if (opts.includeLoadout) dto.loadout = await buildLoadoutDto(run.visitorUserId);
  if (opts.includeSummary) dto.summary = run.summary ?? null;
  return dto;
}

// POST /runs — start a run (free, paid, or owner self-run)
router.post("/runs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const labyrinthId = parseId(req.body?.labyrinthId);
  const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
  if (labyrinthId == null) {
    res.status(400).json({ error: "labyrinthId is required" });
    return;
  }
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  const cached = await getIdempotentResponse<{ id: number }>(idempotencyKey, userId, "start_run");
  if (cached) {
    res.status(201).json(cached);
    return;
  }

  let labRows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, labyrinthId)).limit(1);
  let lab = labRows[0];
  if (!lab) {
    res.status(404).json({ error: "Labyrinth not found" });
    return;
  }
  lab = await applyDailyReset(lab);

  const isOwnerRun = lab.ownerUserId === userId;
  if (!isOwnerRun && !lab.published) {
    res.status(403).json({ error: "This labyrinth is not published" });
    return;
  }

  const isPaid = !isOwnerRun && lab.tollGateUnlocked && lab.entryFee > 0;
  const entryFee = isPaid ? lab.entryFee : 0;
  let ownerEntryShare = 0;
  let treasuryEntryShare = 0;

  if (isPaid) {
    const bal = await ensureBalances(userId);
    if (bal.labToken < entryFee) {
      res.status(402).json({ error: `Insufficient $LAB. Entry costs ${entryFee}, you have ${bal.labToken}.` });
      return;
    }
    // Split rounding rule (spec): the OWNER share is floor(amount * pct) and the
    // treasury absorbs the remainder, so owner + treasury == entryFee exactly.
    ownerEntryShare = Math.floor(entryFee * 0.8);
    treasuryEntryShare = entryFee - ownerEntryShare;
  }

  const chambers = await assembleChambers(lab);

  const response = await db.transaction(async (tx) => {
    if (isPaid) {
      // Visitor pays the entry fee in $LAB
      await addCurrency(userId, { labToken: -entryFee }, tx);
      await tx.insert(chainTransactionsTable).values({
        userId,
        reference: newToken("ledger_"),
        kind: "entry_fee",
        status: "confirmed",
        amount: entryFee,
        currency: "LAB",
        memo: `Paid entry to ${lab!.name}`,
        network: ROBINHOOD_NETWORK.name,
        chainId: ROBINHOOD_NETWORK.chainId,
      });
      await writeLedger(tx, {
        userId,
        type: "paid_entry_debit",
        direction: "debit",
        amount: entryFee,
        currency: "labToken",
        reason: `Paid entry to ${lab!.name}`,
        labyrinthId,
      });

      // Owner accrues 80% of the entry fee (pending per-currency until collected)
      await addPendingEarning(tx, labyrinthId, "entry_share", "labToken", ownerEntryShare);
      await tx
        .update(labyrinthsTable)
        .set({
          pendingEntryShare: lab!.pendingEntryShare + ownerEntryShare,
          lifetimeEntryShare: lab!.lifetimeEntryShare + ownerEntryShare,
          entryShareToday: lab!.entryShareToday + ownerEntryShare,
        })
        .where(eq(labyrinthsTable.id, labyrinthId));
      await writeLedger(tx, {
        userId: lab!.ownerUserId,
        type: "owner_entry_share_credit",
        direction: "credit",
        amount: ownerEntryShare,
        currency: "labToken",
        reason: `80% entry toll from ${req.user!.displayName} on ${lab!.name}`,
        labyrinthId,
      });

      // Treasury takes the remaining 20% immediately
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
        reason: `20% treasury share of entry to ${lab!.name}`,
        labyrinthId,
      });
    }

    const inserted = await tx
      .insert(runsTable)
      .values({
        labyrinthId,
        visitorUserId: userId,
        ownerUserId: lab!.ownerUserId,
        status: "in_progress",
        isOwnerRun,
        isPaid,
        entryFee,
        ownerEntryShare,
        treasuryEntryShare,
        chambers,
      })
      .returning();
    return inserted[0]!;
  });

  const dto = await buildRunDto(response, { includeChambers: true, includeLoadout: true });
  await saveIdempotentResponse(idempotencyKey, userId, "start_run", dto);
  res.status(201).json(dto);
});

// GET /runs/mine
router.get("/runs/mine", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(runsTable)
    .where(eq(runsTable.visitorUserId, req.user!.id))
    .orderBy(desc(runsTable.startedAt))
    .limit(40);
  const out = [];
  for (const r of rows) out.push(await buildRunDto(r, { includeSummary: true }));
  res.json(out);
});

// GET /runs/:id
router.get("/runs/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db.select().from(runsTable).where(eq(runsTable.id, id)).limit(1);
  const run = rows[0];
  if (!run) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (run.visitorUserId !== req.user!.id) {
    res.status(403).json({ error: "This is not your run" });
    return;
  }
  res.json(await buildRunDto(run, { includeChambers: true, includeLoadout: true, includeSummary: true }));
});

// POST /runs/:id/complete — settle loot and economy
router.post("/runs/:id/complete", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const userId = req.user!.id;
  const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  const cached = await getIdempotentResponse(idempotencyKey, userId, "complete_run");
  if (cached) {
    res.json(cached);
    return;
  }

  const runRows = await db.select().from(runsTable).where(eq(runsTable.id, id)).limit(1);
  const run = runRows[0];
  if (!run) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (run.visitorUserId !== userId) {
    res.status(403).json({ error: "This is not your run" });
    return;
  }
  if (run.status !== "in_progress") {
    res.status(400).json({ error: "Run is already completed" });
    return;
  }

  // Server-authoritative settlement: derive the maximum reward-bearing entities
  // from the chamber layout assembled at run start, then clamp client-reported
  // counters to those caps. A client cannot claim more loot than the dungeon holds.
  let maxEnemies = 0;
  let maxNodes = 0;
  let maxChests = 0;
  let contentHasBoss = false;
  for (const chamber of run.chambers ?? []) {
    for (const spawn of chamber.spawns ?? []) {
      if (spawn.type === "enemy" || spawn.type === "elite") maxEnemies++;
      else if (spawn.type === "node") maxNodes++;
      else if (spawn.type === "chest") maxChests++;
      else if (spawn.type === "boss") contentHasBoss = true;
    }
  }
  const clampCount = (raw: unknown, max: number): number =>
    Math.min(max, Math.max(0, Number(raw ?? 0) | 0));

  let enemiesDefeated: number;
  let nodesHarvested: number;
  let chestsOpened: number;
  let bossDefeated: boolean;
  let cleared: boolean;

  const coopSettle = run.coopPartyId ? coop.settlementFor(run.coopPartyId, userId) : null;
  if (run.coopPartyId && coopSettle) {
    // Co-op run: rewards come from the server-authoritative SHARED tally split
    // evenly across the party (see CoopStore.settlementFor). The client's own
    // counters are ignored entirely — each member is credited only their fair
    // fraction of the deduped, content-validated kills the whole party logged,
    // so a party can never mint more than the (party-scaled) dungeon holds.
    enemiesDefeated = Math.min(maxEnemies, coopSettle.enemies);
    nodesHarvested = Math.min(maxNodes, coopSettle.nodes);
    chestsOpened = Math.min(maxChests, coopSettle.chests);
    bossDefeated = contentHasBoss && coopSettle.boss;
    cleared = coopSettle.cleared;
    coop.markFinished(userId);
  } else if (run.coopPartyId) {
    // Co-op session was lost (e.g. server restart mid-run). Fall back to clamped
    // client counts divided by the frozen party size so a member still cannot
    // claim the full party-scaled content as if solo.
    const size = Math.max(1, run.partySize);
    enemiesDefeated = Math.floor(clampCount(req.body?.enemiesDefeated, maxEnemies) / size);
    nodesHarvested = Math.floor(clampCount(req.body?.nodesHarvested, maxNodes) / size);
    chestsOpened = Math.floor(clampCount(req.body?.chestsOpened, maxChests) / size);
    bossDefeated = false;
    cleared = false;
  } else {
    enemiesDefeated = clampCount(req.body?.enemiesDefeated, maxEnemies);
    nodesHarvested = clampCount(req.body?.nodesHarvested, maxNodes);
    chestsOpened = clampCount(req.body?.chestsOpened, maxChests);
    // Boss reward is bounded to content (one boss max) AND gated on a full enemy
    // clear — the boss sits behind the dungeon, so a bare client boolean cannot
    // mint the boss bonus on a trivial run. Per-frame combat proof is intentionally
    // out of scope for this client-side mock battler; what matters for economy
    // integrity is that rewards stay bounded by server-stored content per run.
    bossDefeated =
      contentHasBoss && Boolean(req.body?.bossDefeated) && enemiesDefeated >= maxEnemies;
    // "Cleared" is only honored when the player actually accounted for all content.
    cleared =
      Boolean(req.body?.cleared) &&
      enemiesDefeated >= maxEnemies &&
      (!contentHasBoss || bossDefeated);
  }
  const timeSeconds = Math.max(0, Number(req.body?.timeSeconds ?? 0) | 0);
  const damageTaken = Math.max(0, Number(req.body?.damageTaken ?? 0) | 0);

  const labRows = await db.select().from(labyrinthsTable).where(eq(labyrinthsTable.id, run.labyrinthId)).limit(1);
  const lab = labRows[0]!;
  const lootTier = lootTierForLab(lab);

  const loadout = await buildLoadoutDto(userId);
  const lootBonusPct = loadout.combatStats.lootBonus ?? 0;

  const statsInput = { cleared, enemiesDefeated, nodesHarvested, chestsOpened, bossDefeated };
  const rewards = rollRewards(statsInput, lootTier, lootBonusPct);

  // Roll item drops
  const allTemplates = await db.select().from(itemTemplatesTable);
  // Ability stones are a tiny, hand-authored pool; split them out so they get a
  // dedicated, weighted roll instead of being drowned out by the much larger
  // procedurally generated gear pool when picking uniformly within a rarity.
  const stoneTemplates = allTemplates.filter((t) => t.slot === "ability_stone");
  const gearTemplates = allTemplates.filter((t) => t.slot !== "ability_stone");
  const dropCount = rollItemDropCount(statsInput);
  const itemDrops: {
    templateKey: string;
    name: string;
    rarity: string;
    slot: string;
    value: number;
    playerItemId?: number;
  }[] = [];
  let itemDropValue = 0;
  for (let i = 0; i < dropCount; i++) {
    let rarity = bossDefeated && i === 0 ? rollRarity(lootTier + 1) : rollRarity(lootTier);
    // Each drop independently rolls whether it's an ability stone at an explicit,
    // tunable rate (see ABILITY_STONE_DROP_CHANCE), keeping stone frequency from
    // scaling with the size of the gear catalog.
    const wantStone = stoneTemplates.length > 0 && rollIsAbilityStone();
    const source = wantStone ? stoneTemplates : gearTemplates;
    // Stones have no "common" tier, so a common roll maps up to the lowest stone
    // tier; rarity gating (epics/legendaries at higher loot tiers) still applies.
    if (wantStone && rarity === "common") rarity = "uncommon";
    const pool = source.filter((t) => t.rarity === rarity);
    const fallback = source.length > 0 ? source : allTemplates;
    const arr = pool.length > 0 ? pool : fallback;
    const chosen = arr[Math.floor(Math.random() * arr.length)];
    if (!chosen) continue;
    const value = itemValue(chosen.baseValue, 1);
    itemDropValue += value;
    itemDrops.push({
      templateKey: chosen.key,
      name: chosen.name,
      rarity: chosen.rarity,
      slot: chosen.slot,
      value,
    });
  }

  const totalValue = rewards.totalValue + itemDropValue;

  // Owner cut: 20% taken OUT of the running party's fungible loot (gold, ore, dust,
  // keys, and crafting materials) — the visitor keeps the remaining 80% and nothing
  // new is minted. Item drops go entirely to the visitor (no owner cut). Owner
  // self-runs and runs past the daily run capacity take no cut, so the visitor
  // keeps 100%. $LAB is never a loot drop, so it is not part of this split.
  const capacityReached = lab.runsToday >= lab.dailyRunCapacity;
  const takeCut = !run.isOwnerRun && !capacityReached;
  const cut = (amount: number) => (takeCut ? Math.floor(amount * 0.2) : 0);

  const currencyCut = {
    gold: cut(rewards.gold),
    ore: cut(rewards.ore),
    dust: cut(rewards.dust),
    keys: cut(rewards.keys),
  };
  const materialCut = rewards.materials.map((m) => ({ ...m, cut: cut(m.amount) }));

  // Net amounts the visitor actually receives (gross minus the owner cut).
  const visitorRewards = {
    gold: rewards.gold - currencyCut.gold,
    ore: rewards.ore - currencyCut.ore,
    dust: rewards.dust - currencyCut.dust,
    keys: rewards.keys - currencyCut.keys,
    materials: materialCut.map((m) => ({
      key: m.key,
      name: m.name,
      icon: m.icon,
      amount: m.amount - m.cut,
    })),
  };

  // Gold-equivalent value of the owner's cut (display aggregates only). Equals the
  // value subtracted from the visitor's fungible haul, so totals reconcile exactly.
  const ownerDropShareValue =
    currencyCut.gold * CURRENCY_VALUE.gold +
    currencyCut.ore * CURRENCY_VALUE.ore +
    currencyCut.dust * CURRENCY_VALUE.dust +
    currencyCut.keys * CURRENCY_VALUE.keys +
    materialCut.reduce(
      (acc, m) => acc + (MATERIAL_BY_KEY[m.key]?.value ?? 0) * m.cut,
      0,
    );

  const result = await db.transaction(async (tx) => {
    // Credit visitor the post-cut currency + materials (their 80%)
    await addCurrency(
      userId,
      {
        gold: visitorRewards.gold,
        ore: visitorRewards.ore,
        dust: visitorRewards.dust,
        keys: visitorRewards.keys,
      },
      tx,
    );
    for (const m of visitorRewards.materials)
      if (m.amount > 0) await addMaterial(userId, m.key, m.amount, tx);

    // Create dropped items
    for (const drop of itemDrops) {
      const ins = await tx
        .insert(playerItemsTable)
        .values({ userId, templateKey: drop.templateKey, level: 1 })
        .returning();
      drop.playerItemId = ins[0]!.id;
    }

    // Owner cut — the 20% slice taken out of the visitor's fungible loot above.
    // Each currency/material is cut independently with floor rounding (whole-only
    // currencies like keys floor to 0). No cut is taken from item drops, and no
    // new currency is minted: every unit credited here was subtracted from the
    // visitor's haul, so owner + visitor add up to exactly what the run produced.
    if (ownerDropShareValue > 0) {
      const perCurrencyShare: Record<string, number> = {
        gold: currencyCut.gold,
        ore: currencyCut.ore,
        dust: currencyCut.dust,
        keys: currencyCut.keys,
      };
      for (const [currency, amount] of Object.entries(perCurrencyShare)) {
        if (amount <= 0) continue;
        await addPendingEarning(tx, lab.id, "drop_share", currency, amount);
        await writeLedger(tx, {
          userId: lab.ownerUserId,
          type: "owner_drop_share_credit",
          direction: "credit",
          amount,
          currency,
          reason: `20% cut of ${req.user!.displayName}'s loot from ${lab.name}`,
          labyrinthId: lab.id,
          runId: run.id,
        });
      }
      for (const m of materialCut) {
        if (m.cut <= 0) continue;
        await addPendingEarning(tx, lab.id, "drop_share", m.key, m.cut);
        await writeLedger(tx, {
          userId: lab.ownerUserId,
          type: "owner_drop_share_credit",
          direction: "credit",
          amount: m.cut,
          currency: m.key,
          reason: `20% cut (${m.name}) of ${req.user!.displayName}'s loot`,
          labyrinthId: lab.id,
          runId: run.id,
        });
      }
      // Value aggregates for the owner dashboard + leaderboards (display only).
      await tx
        .update(labyrinthsTable)
        .set({
          pendingDropShareValue: lab.pendingDropShareValue + ownerDropShareValue,
          lifetimeDropShareValue: lab.lifetimeDropShareValue + ownerDropShareValue,
          dropShareToday: lab.dropShareToday + ownerDropShareValue,
        })
        .where(eq(labyrinthsTable.id, lab.id));
    }

    // Labyrinth run counters
    await tx
      .update(labyrinthsTable)
      .set({
        runsAllTime: lab.runsAllTime + 1,
        runsToday: lab.runsToday + 1,
        rewardValueToday: lab.rewardValueToday + totalValue,
        rewardValueAllTime: lab.rewardValueAllTime + totalValue,
      })
      .where(eq(labyrinthsTable.id, lab.id));

    const treasury = await ensureTreasury(tx);
    await tx
      .update(treasuryTable)
      .set({ totalRuns: treasury.totalRuns + 1 })
      .where(eq(treasuryTable.id, treasury.id));

    // Visitor reward ledger — one credit per currency/material actually gained.
    const visitorCredits: [string, number][] = [
      ["gold", visitorRewards.gold],
      ["ore", visitorRewards.ore],
      ["dust", visitorRewards.dust],
      ["keys", visitorRewards.keys],
    ];
    for (const [currency, amount] of visitorCredits) {
      if (amount <= 0) continue;
      await writeLedger(tx, {
        userId,
        type: "visitor_reward_credit",
        direction: "credit",
        amount,
        currency,
        reason: `Loot from ${lab.name}`,
        labyrinthId: lab.id,
        runId: run.id,
      });
    }
    for (const m of visitorRewards.materials) {
      if (m.amount <= 0) continue;
      await writeLedger(tx, {
        userId,
        type: "visitor_reward_credit",
        direction: "credit",
        amount: m.amount,
        currency: m.key,
        reason: `Loot (${m.name}) from ${lab.name}`,
        labyrinthId: lab.id,
        runId: run.id,
      });
    }
    await tx.insert(activityLogTable).values({
      type: "run",
      message: `${req.user!.displayName} ${cleared ? "cleared" : "explored"} ${lab.name} and gathered ${totalValue} in loot`,
      actorUserId: userId,
      labyrinthId: lab.id,
      value: totalValue,
    });

    const balances = await getBalancesDto(userId, tx);

    const summary = {
      cleared,
      visitorRewards: {
        gold: visitorRewards.gold,
        ore: visitorRewards.ore,
        dust: visitorRewards.dust,
        keys: visitorRewards.keys,
        materials: visitorRewards.materials,
        totalValue: rewards.totalValue - ownerDropShareValue,
      },
      itemDrops,
      ownerDropShareValue,
      ownerEntryShare: run.ownerEntryShare,
      treasuryEntryShare: run.treasuryEntryShare,
    };

    const updatedRun = await tx
      .update(runsTable)
      .set({
        status: "completed",
        cleared,
        enemiesDefeated,
        nodesHarvested,
        chestsOpened,
        bossDefeated,
        timeSeconds,
        damageTaken,
        rewardValue: totalValue,
        ownerDropShareValue,
        completedAt: new Date(),
        summary,
      })
      .where(eq(runsTable.id, id))
      .returning();

    return { run: updatedRun[0]!, balances, summary };
  });

  const runDto = await buildRunDto(result.run, { includeSummary: true });
  const response = {
    run: runDto,
    cleared,
    visitorRewards: result.summary.visitorRewards,
    itemDrops: result.summary.itemDrops,
    ownerDropShareValue,
    ownerEntryShare: run.ownerEntryShare,
    treasuryEntryShare: run.treasuryEntryShare,
    balances: result.balances,
  };
  await saveIdempotentResponse(idempotencyKey, userId, "complete_run", response);
  res.json(response);
});

// POST /runs/:id/rate
router.post("/runs/:id/rate", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const userId = req.user!.id;
  const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
  const stars = Number(req.body?.stars);
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    res.status(400).json({ error: "stars must be an integer 1-5" });
    return;
  }
  const cached = await getIdempotentResponse(idempotencyKey, userId, "rate_run");
  if (cached) {
    res.status(201).json(cached);
    return;
  }
  const runRows = await db.select().from(runsTable).where(eq(runsTable.id, id)).limit(1);
  const run = runRows[0];
  if (!run) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (run.visitorUserId !== userId) {
    res.status(403).json({ error: "This is not your run" });
    return;
  }
  if (run.isOwnerRun) {
    res.status(400).json({ error: "You cannot rate your own labyrinth" });
    return;
  }
  if (run.status !== "completed") {
    res.status(400).json({ error: "You can only rate a completed run" });
    return;
  }
  const existingRating = await db
    .select()
    .from(ratingsTable)
    .where(eq(ratingsTable.runId, run.id))
    .limit(1);
  if (existingRating[0]) {
    res.status(409).json({ error: "You have already rated this run" });
    return;
  }
  const comment = req.body?.comment != null ? String(req.body.comment) : null;
  const difficultyVote = req.body?.difficultyVote != null ? String(req.body.difficultyVote) : null;

  const inserted = await db
    .insert(ratingsTable)
    .values({
      labyrinthId: run.labyrinthId,
      runId: run.id,
      raterUserId: userId,
      stars,
      comment,
      difficultyVote,
    })
    .returning();
  await db.insert(activityLogTable).values({
    type: "rating",
    message: `${req.user!.displayName} rated a labyrinth ${stars}★`,
    actorUserId: userId,
    labyrinthId: run.labyrinthId,
    value: stars,
  });
  const dto = toRatingDto(inserted[0]!, req.user!);
  await saveIdempotentResponse(idempotencyKey, userId, "rate_run", dto);
  res.status(201).json(dto);
});

export default router;
