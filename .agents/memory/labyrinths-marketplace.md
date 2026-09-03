---
name: USDC marketplace & escrow
description: Durable design decisions for player-to-player item trading settled in USDC.
---

# USDC marketplace & escrow

## USDC is mocked on purpose
USDC is stored as **integer cents** on the player balance, and the Solana layer is intentionally mocked (synthetic transaction rows, a mock deposit/on-ramp that mints test funds). This was a scoped decision, not an oversight — the layer is shaped so a real on-chain USDC transfer can be swapped in later without reworking the marketplace logic. Do not treat the mock as a bug to "fix" inside marketplace work; it is its own follow-up.

## Escrow = active-listing status, not a moved/locked row
An item is "escrowed" purely by having an **active** listing; ownership only moves at buy time.
**Why:** cancel then just flips the listing to cancelled and the item is instantly usable again — no separate un-escrow/lock bookkeeping to keep consistent.
**How to apply:** every place that consumes an item (equip, upgrade, dispose) must check for an active listing. equip/upgrade reject (409); bulk-dispose silently excludes. Only owned + unequipped + unlisted items may be listed.

## Money mutations must be race-safe at the DB level
Buy and cancel lock the listing row (`SELECT ... FOR UPDATE`) and do a **conditional** status transition (`WHERE id=? AND status='active'`) with an affected-row assertion; if zero rows changed, abort. Listing uniqueness is enforced by a **partial unique index** on `(player_item_id) WHERE status='active'` (the in-transaction check is only a friendly fast-path), and a `23505` from it is mapped to a 409.
**Why:** without the lock + conditional update, two concurrent buyers can both pass the status read and double-settle (double-charge / double-credit); without the partial index, concurrent lists can create duplicate active listings.
**How to apply:** any new state-changing money/ownership flow on listings must follow the same lock + conditional-transition + affected-row-check pattern, never read-then-write.

## Validation-order gotcha
In equip, basic input validation (e.g. "Invalid slot" for non-equippable slots like `relic`) runs before the escrow check, so a listed relic returns 400 (slot), not 409. A 400 there does not mean escrow is unenforced — test escrow with an actually-equippable slot.
