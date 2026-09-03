---
name: PvP duel lifecycle
description: Why resolved real-time sessions that navigate to a separate route need a terminal "completed" state plus a client navigate-once guard.
---

PvP duels reuse the trade/co-op polling session model, but unlike trade (a modal)
the duel sends both players to a separate arena route to watch playback.

**Rule:** any real-time session whose "active" phase navigates to its own page
must have an explicit terminal state the client transitions to on leaving, AND a
client-side navigate-once guard that survives component remounts.

**Why:** a resolved session that lingers in a non-terminal "active" state (kept
alive by its TTL so slow clients can still load it) creates two bugs at once:
1. the single-live-session guard keeps blocking new challenges for the whole TTL
   window ("you are already in a duel" right after finishing), and
2. when the player returns to the overworld, the panel still polls that active
   session and bounces them straight back into the just-finished arena.

**How to apply:** add a terminal status (duels use `completed`) + a participant
"leave" endpoint that flips active→completed (idempotent, frees the live guard
immediately while the immutable result stays briefly pollable). On the client,
keep module-level `Set`s (entered-arena, dismissed) outside the component so a
remount can't re-trigger navigation or re-show a dismissed terminal notice.
Navigation should fire for `active` OR `completed` *with a result* (a player who
hasn't watched yet must still be taken in even if the other already completed).

**Persisting the outcome:** the durable win/loss record is written at the
`accept` resolution point (where the server-authoritative result is produced),
NOT at `complete`. **Why:** `complete` is an optional, idempotent "I left the
arena" signal that may never fire (a player can just close the tab), so it is
the wrong hook for a one-time durable write. The record table is keyed by the
in-memory duel session id with a unique index + `onConflictDoNothing`, so a
retried accept never double-counts. It's a brand-new empty table, so it reaches
live DBs via `db push` in post-merge alone — no backfill needed.
