---
name: Labyrinths economy splits
description: How the owner cut, entry-fee split, $LAB, and integer money conservation work in the Labyrinths run economy.
---

## Owner drop-share is a CUT TAKEN OUT of the visitor's loot, not minted on top
On a non-owner completed run, the owner's 20% is subtracted from the visitor's
fungible loot (gold/ore/dust/keys + crafting materials), per currency, as
`ownerCut = floor(amount * 0.20)`; the visitor receives `amount - ownerCut`.
Owner pending earnings + visitor credit must add up to exactly the gross rolled
loot — zero net minting.
**Why:** an earlier model minted the owner's 20% ON TOP (visitor kept 100%, owner
got an extra newly-created 20%), which inflated the currency supply. The user
explicitly reversed this.
**How to apply:** lives in `POST /runs/:id/complete` in `routes/runs.ts`. Credit
the visitor net amounts everywhere (balances, visitor_reward_credit ledger, run
summary.visitorRewards) and credit the owner the exact cut. `ownerDropShareValue`
is only the gold-equivalent of the cut for display aggregates. Never re-introduce
a "value-on-top" owner credit.

## Item drops go 100% to the visitor — no owner cut on items
Dropped gear is entirely the visitor's; do NOT add an item gold-equivalent to the
owner's share (the old `itemGoldEquiv` was removed).
**Why:** explicit user decision for this economy.

## $LAB (labToken) is transaction-only, never a loot drop
`rollRewards` does not generate labToken. $LAB only moves via entry fees, treasury,
and Collect Earnings. `RewardBundle` (openapi) has no labToken; but `Balances`
keeps labToken (wallet balances still hold $LAB) and `WALLET_CURRENCIES` keeps it.
**How to apply:** if adding loot, never add $LAB. The entry-fee 80/20 split
(`floor(fee*0.8)` owner, remainder treasury) is a transfer of an existing fee, not
minting — leave it as-is.

## Bulk dispose: sell → gold, scrap → materials; never $LAB
`POST /items/bulk-dispose` (mode sell|scrap) sells unequipped gear for gold
(`floor(itemValue * 0.4)`, min 1) or scraps it into crafting materials (primary
material picked deterministically by hashing the template key; amount scales with
rarity rank + level; epic+ sheds a bonus prism_shard).
**Why:** the task spec mentioned "$LAB transaction" but minting $LAB for junk would
violate the $LAB-never-a-drop rule, so gold is the sell payout instead.
**How to apply:** equipped items (anything in a loadout slot) are always excluded
server-side; credits are recorded as `bulk_sell_credit` / `bulk_scrap_credit`
ledger entries; idempotency scope is `bulk_dispose`.

## Gating: owner self-runs and capacity-reached runs take no cut
`takeCut = !run.isOwnerRun && !(runsToday >= dailyRunCapacity)`. When false, the
cut is 0 and the visitor keeps 100%. Whole-only currencies (keys) floor the cut to
0 even on cut runs.
