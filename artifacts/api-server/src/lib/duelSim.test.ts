import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemStatsData } from "@workspace/db";
import { simulateDuel, type DuelCombatantInput } from "./duelSim.ts";

// ---------------------------------------------------------------------------
// These tests lock in the two guarantees the duel system depends on:
//   1. Determinism — given the same duel id + the same two combatants, the
//      server must always produce the SAME winner and the EXACT same event
//      timeline. Both clients fetch and replay that timeline, so any drift
//      would mean the two players watch different fights.
//   2. Gear matters — a fully geared fighter must beat an ungeared one, and a
//      balanced matchup must still resolve to a single, stable winner.
//
// If the combat math in duelSim.ts (or the stats it consumes) changes in a way
// that breaks determinism or inverts a lopsided matchup, these tests fail.
// ---------------------------------------------------------------------------

function combatant(userId: number, stats: ItemStatsData, abilityKeys: string[] = []): DuelCombatantInput {
  return { userId, stats, abilityKeys };
}

const GEARED: ItemStatsData = {
  attack: 60,
  defense: 40,
  health: 220,
  attackSpeed: 30,
  critChance: 25,
  cooldownReduction: 20,
};

const UNGEARED: ItemStatsData = {};

const BALANCED_A: ItemStatsData = {
  attack: 24,
  defense: 12,
  health: 80,
  attackSpeed: 10,
  critChance: 8,
};

const BALANCED_B: ItemStatsData = {
  attack: 24,
  defense: 12,
  health: 80,
  attackSpeed: 10,
  critChance: 8,
};

test("simulateDuel is deterministic for a fixed duel id + inputs", () => {
  const a = combatant(1, GEARED, ["flame_arc", "quickstep"]);
  const b = combatant(2, BALANCED_B, ["bulwark"]);

  const first = simulateDuel("duel-fixed-seed", a, b);
  const second = simulateDuel("duel-fixed-seed", a, b);

  // Same winner, same fight length, and a byte-for-byte identical timeline.
  assert.equal(first.winnerUserId, second.winnerUserId);
  assert.equal(first.loserUserId, second.loserUserId);
  assert.equal(first.durationMs, second.durationMs);
  assert.deepEqual(first.maxHpByUser, second.maxHpByUser);
  assert.deepEqual(first.events, second.events);

  // The timeline must actually contain events (a non-trivial fight).
  assert.ok(first.events.length > 0, "expected a non-empty event timeline");
});

test("the duel id seeds the fight: a different id can change the timeline", () => {
  // Same combatants, different duel id => different RNG stream. The winner may
  // or may not change, but the timeline should not be assumed identical; what
  // matters is that each id is internally reproducible.
  const a = combatant(1, BALANCED_A, []);
  const b = combatant(2, BALANCED_B, []);

  const runA1 = simulateDuel("duel-A", a, b);
  const runA2 = simulateDuel("duel-A", a, b);
  const runB1 = simulateDuel("duel-B", a, b);
  const runB2 = simulateDuel("duel-B", a, b);

  // Each id is reproducible.
  assert.deepEqual(runA1.events, runA2.events);
  assert.deepEqual(runB1.events, runB2.events);
});

test("lopsided matchup: a fully geared fighter beats an ungeared one decisively", () => {
  const geared = combatant(10, GEARED, ["flame_arc", "seismic_slam"]);
  const ungeared = combatant(20, UNGEARED, []);

  // Order of arguments must not flip the outcome of an overwhelming advantage.
  const r1 = simulateDuel("lopsided-1", geared, ungeared);
  assert.equal(r1.winnerUserId, 10, "geared fighter should win as combatant A");
  assert.equal(r1.loserUserId, 20);

  const r2 = simulateDuel("lopsided-2", ungeared, geared);
  assert.equal(r2.winnerUserId, 10, "geared fighter should win as combatant B");
  assert.equal(r2.loserUserId, 20);

  // A decisive win ends with the loser actually dropping to 0 HP (not a timeout
  // tie-break), and well inside the duel time cap.
  const finalBlow = r1.events[r1.events.length - 1];
  assert.equal(finalBlow.targetUserId, 20);
  assert.equal(finalBlow.targetHp, 0, "loser should be reduced to 0 HP");
  assert.ok(r1.durationMs < 40_000, "decisive fight should not hit the timeout");
});

test("balanced matchup: resolves to a single, stable winner", () => {
  const a = combatant(101, BALANCED_A, ["crescent_sweep"]);
  const b = combatant(202, BALANCED_B, ["chain_shot"]);

  const result = simulateDuel("balanced-duel", a, b);

  // Exactly one of the two is the winner, and winner/loser are consistent.
  assert.ok(
    result.winnerUserId === 101 || result.winnerUserId === 202,
    "winner must be one of the two combatants",
  );
  assert.notEqual(result.winnerUserId, result.loserUserId);
  assert.equal(
    result.loserUserId,
    result.winnerUserId === 101 ? 202 : 101,
  );

  // Replaying the same balanced duel yields the identical outcome + timeline.
  const replay = simulateDuel("balanced-duel", a, b);
  assert.equal(replay.winnerUserId, result.winnerUserId);
  assert.deepEqual(replay.events, result.events);
});

test("output is bounded: events and duration stay within the simulator caps", () => {
  // Two tanky, low-damage fighters are the worst case for runtime length.
  const tankA = combatant(1, { health: 600, defense: 80, attack: 0 }, []);
  const tankB = combatant(2, { health: 600, defense: 80, attack: 0 }, []);

  const result = simulateDuel("stalemate", tankA, tankB);

  assert.ok(result.events.length <= 600, "event timeline must respect MAX_EVENTS");
  assert.ok(result.durationMs <= 40_000, "duration must respect MAX_DURATION_MS");
  // Even a stalemate must name a winner (deterministic timeout tie-break).
  assert.ok(result.winnerUserId === 1 || result.winnerUserId === 2);
});
