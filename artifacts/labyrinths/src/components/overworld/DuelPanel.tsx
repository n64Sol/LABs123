import { useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetActiveDuel,
  useChallengeDuel,
  useAcceptDuel,
  useDeclineDuel,
  useCancelDuel,
  getGetActiveDuelQueryKey,
} from "@workspace/api-client-react";
import type { Duel } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Swords, Loader2, Check, X, Ban } from "lucide-react";
import type { NearbyPlayer } from "@/components/overworld/TradePanel";

// Module-level memory that survives this component remounting (e.g. when the
// player returns from the arena to the overworld). Without it, a resolved duel
// still surfacing from /duels/active would bounce the player back into the
// just-finished fight, and a dismissed terminal notice would reappear.
const enteredArena = new Set<string>();
const dismissedDuels = new Set<string>();

/**
 * Self-contained PvP duel handshake UI. Polls the caller's active duel once a
 * second and drives the lifecycle: challenge (challenger) / accept-decline
 * (opponent) / cancel. The fight itself is resolved server-side on accept; once
 * the duel is "active" both participants are sent to the arena page to watch the
 * synchronized playback.
 */
export default function DuelPanel({
  nearby,
  myLayers,
}: {
  nearby: NearbyPlayer | null;
  myLayers: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data, refetch } = useGetActiveDuel({
    query: {
      queryKey: getGetActiveDuelQueryKey(),
      refetchInterval: 1000,
      refetchOnWindowFocus: true,
    },
  });
  const duel = data?.duel ?? null;

  const challenge = useChallengeDuel();
  const accept = useAcceptDuel();
  const decline = useDeclineDuel();
  const cancel = useCancelDuel();

  // Once the duel is resolved (status active, or completed before we got to it),
  // send the player to the arena exactly once. A "completed" duel still carries
  // the immutable result, so a player who hasn't watched yet is still taken in.
  useEffect(() => {
    if (
      duel &&
      duel.result &&
      (duel.status === "active" || duel.status === "completed") &&
      !enteredArena.has(duel.id)
    ) {
      enteredArena.add(duel.id);
      setLocation(`/duel/${duel.id}`);
    }
  }, [duel, setLocation]);

  // A duel we've already watched (or a terminal notice we've dismissed) should
  // no longer drive any UI here, freeing the challenge prompt to return.
  const activeDuel =
    duel &&
    !dismissedDuels.has(duel.id) &&
    !(enteredArena.has(duel.id) && (duel.status === "active" || duel.status === "completed"))
      ? duel
      : null;

  const refreshActive = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetActiveDuelQueryKey() });
  }, [queryClient]);

  const doChallenge = useCallback(() => {
    if (!nearby) return;
    challenge.mutate(
      { data: { targetUserId: nearby.userId, spriteLayers: myLayers } },
      { onSuccess: () => refetch() },
    );
  }, [nearby, myLayers, challenge, refetch]);

  // 'F' to challenge the nearest player when not already in a duel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key.toLowerCase() === "f" && nearby && !activeDuel) {
        e.preventDefault();
        doChallenge();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nearby, activeDuel, doChallenge]);

  const showChallengePrompt = !activeDuel && nearby;

  return (
    <>
      {showChallengePrompt && (
        <div className="absolute left-1/2 top-28 -translate-x-1/2">
          <Button
            onClick={doChallenge}
            size="sm"
            variant="destructive"
            className="gap-2 shadow-lg"
            disabled={challenge.isPending}
          >
            {challenge.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Swords className="h-4 w-4" />
            )}
            Duel {nearby!.displayName} <span className="opacity-70">(F)</span>
          </Button>
        </div>
      )}

      {challenge.isError && !activeDuel && (
        <div className="absolute left-1/2 top-28 -translate-x-1/2 rounded-md bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground shadow-lg">
          {(challenge.error as Error)?.message ?? "Could not start duel"}
        </div>
      )}

      {activeDuel && activeDuel.status !== "active" && activeDuel.status !== "completed" && (
        <DuelModal
          duel={activeDuel}
          onAccept={() =>
            accept.mutate(
              { id: activeDuel.id, data: { spriteLayers: myLayers } },
              { onSuccess: () => refetch() },
            )
          }
          onDecline={() =>
            decline.mutate({ id: activeDuel.id }, { onSuccess: () => refetch() })
          }
          onCancel={() =>
            cancel.mutate({ id: activeDuel.id }, { onSuccess: () => refetch() })
          }
          onDismiss={() => {
            dismissedDuels.add(activeDuel.id);
            refreshActive();
          }}
          busy={accept.isPending || decline.isPending || cancel.isPending}
        />
      )}
    </>
  );
}

function DuelModal({
  duel,
  onAccept,
  onDecline,
  onCancel,
  onDismiss,
  busy,
}: {
  duel: Duel;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const them = duel.role === "challenger" ? duel.opponent : duel.challenger;

  // Opponent must answer a pending challenge.
  if (duel.status === "pending" && duel.role === "opponent") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 shadow-2xl">
          <div className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Swords className="h-4 w-4 text-destructive" />
            Duel challenge
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{them.displayName}</span>{" "}
            challenges you to a duel. Your equipped gear and abilities decide the fight.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onAccept} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              Accept
            </Button>
            <Button className="flex-1" variant="secondary" onClick={onDecline} disabled={busy}>
              <X className="mr-1 h-4 w-4" /> Decline
            </Button>
          </div>
        </div>
      </Backdrop>
    );
  }

  // Challenger waiting on a pending response.
  if (duel.status === "pending" && duel.role === "challenger") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 text-center shadow-2xl">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-destructive" />
          <p className="mb-4 text-sm text-muted-foreground">
            Waiting for{" "}
            <span className="font-medium text-foreground">{them.displayName}</span>{" "}
            to accept your challenge…
          </p>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Backdrop>
    );
  }

  // Terminal notices (declined / cancelled / expired).
  if (duel.status === "declined" || duel.status === "cancelled") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 text-center shadow-2xl">
          <Ban className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="mb-1 text-base font-semibold">
            Duel {duel.status === "declined" ? "declined" : "cancelled"}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {duel.note ?? "The challenge did not go ahead."}
          </p>
          <Button size="sm" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </Backdrop>
    );
  }

  return null;
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      {children}
    </div>
  );
}
