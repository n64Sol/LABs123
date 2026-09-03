import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetDuel,
  useGetCurrentPlayer,
  useCompleteDuel,
  getGetDuelQueryKey,
} from "@workspace/api-client-react";
import type { Duel, DuelEvent, DuelParticipant } from "@workspace/api-client-react";
import { composeSpriteFromLayers, drawStillPose } from "@/lib/sprite";
import { Button } from "@/components/ui/button";
import { Swords, Trophy, Skull, Loader2, ArrowLeft } from "lucide-react";

// Playback runs slightly faster than the simulated clock so a long fight stays
// watchable without distorting the order or outcome of events.
const PLAYBACK_SPEED = 1.8;
const ARENA_W = 900;
const ARENA_H = 460;
const FIGHTER_SIZE = 150;
const LEFT_X = 210;
const RIGHT_X = ARENA_W - 210;
const GROUND_Y = 320;
// LPC walk-direction rows: 9 = facing left, 11 = facing right. The left fighter
// looks right, the right fighter looks left, so they square off.
const ROW_FACING_RIGHT = 11;
const ROW_FACING_LEFT = 9;

interface FloatNum {
  id: number;
  x: number;
  y: number;
  text: string;
  bornAt: number;
  crit: boolean;
  ability: boolean;
}

interface FighterVis {
  hpShown: number;
  lungeUntil: number;
  flashUntil: number;
  castUntil: number;
}

/**
 * Server-authoritative PvP duel arena. The fight was already resolved on the
 * server when the challenge was accepted; this page just fetches the immutable
 * timeline and plays it back in sync for both players, then shows a clear
 * win/loss. Nothing here can change the outcome.
 */
export default function DuelPage() {
  const params = useParams();
  const id = params.id ?? "";
  const [, setLocation] = useLocation();
  const { data: me } = useGetCurrentPlayer();
  const myUserId = me?.id ?? null;
  const complete = useCompleteDuel();

  // Leaving the arena: mark the duel finished server-side so both players are
  // freed to duel again immediately, then head back to the overworld.
  const leaveArena = () => {
    if (id) complete.mutate({ id });
    setLocation("/");
  };

  const { data } = useGetDuel(id, {
    query: {
      queryKey: getGetDuelQueryKey(id),
      // Keep polling until the fight is resolved, then stop.
      refetchInterval: (q) =>
        (q.state.data as { duel: Duel | null } | undefined)?.duel?.result ? false : 1200,
    },
  });
  const duel = data?.duel ?? null;
  const result = duel?.result ?? null;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spritesRef = useRef<{ left: CanvasImageSource | null; right: CanvasImageSource | null }>({
    left: null,
    right: null,
  });
  const [spritesReady, setSpritesReady] = useState(false);
  const [finished, setFinished] = useState(false);

  // Compose both fighters' sprites from their captured appearances.
  useEffect(() => {
    if (!duel) return;
    let cancelled = false;
    const base = import.meta.env.BASE_URL;
    Promise.all([
      composeSpriteFromLayers(duel.challenger.spriteLayers, base),
      composeSpriteFromLayers(duel.opponent.spriteLayers, base),
    ]).then(([left, right]) => {
      if (cancelled) return;
      spritesRef.current = { left, right };
      setSpritesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [duel]);

  // Orient the canvas so the local player is always on the LEFT, facing their
  // opponent. This keeps "my side" consistent for both participants.
  const layout = useMemo(() => {
    if (!duel) return null;
    const iAmChallenger = duel.role === "challenger";
    const left = iAmChallenger ? duel.challenger : duel.opponent;
    const right = iAmChallenger ? duel.opponent : duel.challenger;
    return { left, right, iAmChallenger };
  }, [duel]);

  // The playback loop.
  useEffect(() => {
    if (!result || !layout || !spritesReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { left, right } = layout;
    const events = result.events;
    const vis: Record<number, FighterVis> = {
      [left.userId]: { hpShown: left.maxHp, lungeUntil: 0, flashUntil: 0, castUntil: 0 },
      [right.userId]: { hpShown: right.maxHp, lungeUntil: 0, flashUntil: 0, castUntil: 0 },
    };
    const targetHp: Record<number, number> = {
      [left.userId]: left.maxHp,
      [right.userId]: right.maxHp,
    };
    const floats: FloatNum[] = [];
    let floatId = 1;
    let pointer = 0;
    const start = performance.now();
    let raf = 0;
    let done = false;

    const sideOf = (userId: number): "left" | "right" => (userId === left.userId ? "left" : "right");
    const fighterX = (side: "left" | "right"): number => (side === "left" ? LEFT_X : RIGHT_X);

    const draw = (now: number) => {
      const elapsed = (now - start) * PLAYBACK_SPEED;

      // Apply any events whose time has arrived.
      while (pointer < events.length && events[pointer]!.tMs <= elapsed) {
        const ev: DuelEvent = events[pointer]!;
        const actor = vis[ev.actorUserId];
        if (actor) {
          actor.lungeUntil = now + 180;
          if (ev.kind === "ability" && ev.targetUserId === ev.actorUserId) {
            actor.castUntil = now + 420;
          }
        }
        if (ev.targetUserId !== ev.actorUserId || ev.damage > 0) {
          targetHp[ev.targetUserId] = ev.targetHp;
          const tv = vis[ev.targetUserId];
          if (tv && ev.damage > 0) tv.flashUntil = now + 140;
        }
        if (ev.damage > 0 || ev.abilityName) {
          const tSide = sideOf(ev.targetUserId);
          floats.push({
            id: floatId++,
            x: fighterX(tSide) + (Math.random() * 36 - 18),
            y: GROUND_Y - FIGHTER_SIZE * 0.55,
            text: ev.abilityName && ev.damage === 0 ? ev.abilityName : `-${ev.damage}`,
            bornAt: now,
            crit: ev.kind === "crit",
            ability: ev.kind === "ability",
          });
        }
        pointer++;
      }

      // Ease shown HP toward the authoritative target.
      for (const uid of [left.userId, right.userId]) {
        const v = vis[uid]!;
        v.hpShown += (targetHp[uid]! - v.hpShown) * 0.25;
        if (Math.abs(targetHp[uid]! - v.hpShown) < 0.5) v.hpShown = targetHp[uid]!;
      }

      render(ctx, now);

      const playbackOver = pointer >= events.length && elapsed >= result.durationMs;
      if (playbackOver && !done) {
        done = true;
        // Let the final hit settle visually before the banner.
        window.setTimeout(() => setFinished(true), 650);
      }
      raf = requestAnimationFrame(draw);
    };

    const render = (c: CanvasRenderingContext2D, now: number) => {
      // Backdrop.
      const g = c.createLinearGradient(0, 0, 0, ARENA_H);
      g.addColorStop(0, "#1a1326");
      g.addColorStop(0.6, "#241a33");
      g.addColorStop(1, "#0e0a16");
      c.fillStyle = g;
      c.fillRect(0, 0, ARENA_W, ARENA_H);

      // Ground.
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(0, GROUND_Y + FIGHTER_SIZE * 0.08, ARENA_W, ARENA_H);
      c.strokeStyle = "rgba(255,255,255,0.06)";
      c.beginPath();
      c.moveTo(0, GROUND_Y + FIGHTER_SIZE * 0.08);
      c.lineTo(ARENA_W, GROUND_Y + FIGHTER_SIZE * 0.08);
      c.stroke();

      drawFighter(c, "left", left, ROW_FACING_RIGHT, now);
      drawFighter(c, "right", right, ROW_FACING_LEFT, now);

      // Floating numbers.
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i]!;
        const age = now - f.bornAt;
        if (age > 1100) {
          floats.splice(i, 1);
          continue;
        }
        const t = age / 1100;
        c.globalAlpha = 1 - t;
        c.font = `${f.ability ? "bold 20px" : f.crit ? "bold 30px" : "bold 22px"} ui-sans-serif, system-ui`;
        c.textAlign = "center";
        c.fillStyle = f.ability ? "#a78bfa" : f.crit ? "#f59e0b" : "#fca5a5";
        c.fillText(f.text, f.x, f.y - t * 46);
        c.globalAlpha = 1;
      }
    };

    const drawFighter = (
      c: CanvasRenderingContext2D,
      side: "left" | "right",
      p: DuelParticipant,
      row: number,
      now: number,
    ) => {
      const v = vis[p.userId]!;
      const baseX = fighterX(side);
      const lunge = now < v.lungeUntil ? (side === "left" ? 26 : -26) : 0;
      const x = baseX + lunge - FIGHTER_SIZE / 2;
      const y = GROUND_Y - FIGHTER_SIZE * 0.62;
      const src = side === "left" ? spritesRef.current.left : spritesRef.current.right;

      // Shadow.
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.beginPath();
      c.ellipse(baseX + lunge, GROUND_Y + FIGHTER_SIZE * 0.06, FIGHTER_SIZE * 0.28, FIGHTER_SIZE * 0.09, 0, 0, Math.PI * 2);
      c.fill();

      // Cast ring.
      if (now < v.castUntil) {
        c.strokeStyle = "rgba(167,139,250,0.7)";
        c.lineWidth = 3;
        c.beginPath();
        c.arc(baseX + lunge, GROUND_Y - FIGHTER_SIZE * 0.25, FIGHTER_SIZE * 0.42, 0, Math.PI * 2);
        c.stroke();
        c.lineWidth = 1;
      }

      if (src) {
        if (now < v.flashUntil) {
          c.save();
          c.globalAlpha = 0.9;
          drawStillPose(c, src, x, y, FIGHTER_SIZE, row, 0);
          // Red hurt tint.
          c.globalCompositeOperation = "source-atop";
          c.fillStyle = "rgba(239,68,68,0.45)";
          c.fillRect(x, y, FIGHTER_SIZE, FIGHTER_SIZE);
          c.restore();
        } else {
          drawStillPose(c, src, x, y, FIGHTER_SIZE, row, 0);
        }
      } else {
        c.fillStyle = side === "left" ? "#60a5fa" : "#f87171";
        c.beginPath();
        c.arc(baseX + lunge, GROUND_Y - FIGHTER_SIZE * 0.25, FIGHTER_SIZE * 0.3, 0, Math.PI * 2);
        c.fill();
      }

      // HP bar + name.
      const hpFrac = Math.max(0, Math.min(1, v.hpShown / Math.max(1, p.maxHp)));
      const barW = 190;
      const barX = baseX - barW / 2;
      const barY = 40;
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(barX - 2, barY - 2, barW + 4, 16);
      c.fillStyle = "#3f3f46";
      c.fillRect(barX, barY, barW, 12);
      c.fillStyle = hpFrac > 0.5 ? "#22c55e" : hpFrac > 0.22 ? "#eab308" : "#ef4444";
      c.fillRect(barX, barY, barW * hpFrac, 12);
      c.font = "600 13px ui-sans-serif, system-ui";
      c.textAlign = "center";
      c.fillStyle = "#e5e7eb";
      c.fillText(p.displayName, baseX, barY - 8);
      c.font = "11px ui-sans-serif, system-ui";
      c.fillStyle = "#cbd5e1";
      c.fillText(`${Math.ceil(v.hpShown)} / ${p.maxHp}`, baseX, barY + 26);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [result, layout, spritesReady]);

  // --- Render ---------------------------------------------------------------

  if (!duel) {
    return (
      <ArenaShell>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin" />
          Loading duel…
        </div>
      </ArenaShell>
    );
  }

  if (!result) {
    return (
      <ArenaShell>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Swords className="h-8 w-8 animate-pulse text-primary" />
          Preparing the arena…
        </div>
      </ArenaShell>
    );
  }

  const iWon = result.winnerUserId === myUserId;
  const winner =
    result.winnerUserId === duel.challengerUserId ? duel.challenger : duel.opponent;
  const loser =
    result.loserUserId === duel.challengerUserId ? duel.challenger : duel.opponent;

  return (
    <ArenaShell>
      <div className="flex w-full max-w-[940px] flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Swords className="h-4 w-4 text-primary" />
          {duel.challenger.displayName} vs {duel.opponent.displayName}
        </div>

        <div className="relative w-full overflow-hidden rounded-xl border border-border shadow-2xl">
          <canvas
            ref={canvasRef}
            width={ARENA_W}
            height={ARENA_H}
            className="block h-auto w-full"
          />

          {finished && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/65 backdrop-blur-sm">
              {iWon ? (
                <>
                  <Trophy className="h-16 w-16 text-amber-400 drop-shadow" />
                  <div className="text-4xl font-black tracking-wide text-amber-300">VICTORY</div>
                  <p className="text-sm text-muted-foreground">
                    You defeated {loser.displayName} in the arena.
                  </p>
                </>
              ) : (
                <>
                  <Skull className="h-16 w-16 text-rose-400 drop-shadow" />
                  <div className="text-4xl font-black tracking-wide text-rose-300">DEFEAT</div>
                  <p className="text-sm text-muted-foreground">
                    {winner.displayName} bested you in the arena.
                  </p>
                </>
              )}
              <Button onClick={leaveArena} className="mt-2 gap-2">
                <ArrowLeft className="h-4 w-4" /> Return to the overworld
              </Button>
            </div>
          )}
        </div>

        {!finished && (
          <p className="text-xs text-muted-foreground">
            The outcome was decided by your gear and abilities the moment the duel began.
          </p>
        )}
      </div>
    </ArenaShell>
  );
}

function ArenaShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center p-4">
      {children}
    </div>
  );
}
