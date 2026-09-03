import { useEffect, useRef } from "react";
import {
  useGetCoopParty,
  useCreateCoopParty,
  useInviteToCoopParty,
  useAcceptCoopInvite,
  useDeclineCoopInvite,
  useSetCoopReady,
  useStartCoopRun,
  useLeaveCoopParty,
  getGetCoopPartyQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Users, UserPlus, Crown, Check, LogOut, Swords, Loader2 } from "lucide-react";

interface NearbyAlly {
  userId: number;
  displayName: string;
}

interface Props {
  /** Entrance the local player is standing at (target labyrinth for a new party). */
  nearbyId: number | null;
  nearbyName: string | null;
  /** Nearest other overworld player, eligible for an invite. */
  nearbyAlly: NearbyAlly | null;
  myUserId: number | undefined;
  /** Navigate the local client into its own co-op run row once the host launches. */
  onEnterRun: (runId: number) => void;
}

// CoopPanel — overworld party UI. Polls GET /coop/party (which also returns
// invitations addressed to us) so it works without a live socket, then exposes
// form / invite / accept / ready / launch / leave actions via the generated
// mutation hooks. When the host launches, every member's poll observes
// status === "in_run" with their own runId and is routed into the shared run.
export default function CoopPanel({ nearbyId, nearbyName, nearbyAlly, myUserId, onEnterRun }: Props) {
  const { data, refetch } = useGetCoopParty({ query: { queryKey: getGetCoopPartyQueryKey(), refetchInterval: 1500 } });
  const party = data?.party ?? null;
  const invitations = data?.invitations ?? [];

  const create = useCreateCoopParty();
  const invite = useInviteToCoopParty();
  const accept = useAcceptCoopInvite();
  const decline = useDeclineCoopInvite();
  const ready = useSetCoopReady();
  const start = useStartCoopRun();
  const leave = useLeaveCoopParty();

  const refresh = () => void refetch();
  const launchedRef = useRef(false);

  // Route into the run as soon as our membership flips to in_run with a runId.
  useEffect(() => {
    if (!party || party.status !== "in_run" || myUserId == null) return;
    const me = party.members.find((m) => m.userId === myUserId);
    if (me?.runId != null && !launchedRef.current) {
      launchedRef.current = true;
      onEnterRun(me.runId);
    }
  }, [party, myUserId, onEnterRun]);

  const isHost = party != null && myUserId != null && party.hostUserId === myUserId;
  const me = party?.members.find((m) => m.userId === myUserId);
  const allReady = party != null && party.members.length >= 1 && party.members.every((m) => m.ready || m.userId === party.hostUserId);
  const canInviteAlly =
    party != null &&
    isHost &&
    party.status === "forming" &&
    nearbyAlly != null &&
    party.members.length + party.invites.length < 4 &&
    !party.members.some((m) => m.userId === nearbyAlly.userId) &&
    !party.invites.some((i) => i.userId === nearbyAlly.userId);

  const busy =
    create.isPending || invite.isPending || accept.isPending || decline.isPending || start.isPending || leave.isPending;

  // --- No party: show invitations, or a form-party affordance near an entrance.
  if (!party) {
    return (
      <div className="w-56 rounded-lg border border-border bg-background/80 p-2.5 text-xs shadow-lg backdrop-blur-sm">
        <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
          <Users className="h-3.5 w-3.5" /> Co-op
        </div>

        {invitations.length > 0 ? (
          <div className="flex flex-col gap-2">
            {invitations.map((inv) => (
              <div key={inv.partyId} className="rounded-md bg-muted/60 p-2">
                <div className="text-foreground">
                  <span className="font-semibold">{inv.hostName}</span> invited you
                </div>
                <div className="text-muted-foreground">
                  {inv.labyrinthName} · {inv.memberCount}/4
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={busy}
                    onClick={() => accept.mutate({ id: inv.partyId }, { onSuccess: refresh })}
                  >
                    Join
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() => decline.mutate({ id: inv.partyId }, { onSuccess: refresh })}
                  >
                    No
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : nearbyId != null ? (
          <Button
            size="sm"
            className="h-8 w-full gap-1.5 text-xs"
            disabled={busy}
            onClick={() => create.mutate({ data: { labyrinthId: nearbyId } }, { onSuccess: refresh })}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Form party{nearbyName ? `: ${nearbyName}` : ""}
          </Button>
        ) : (
          <p className="text-muted-foreground">Stand at a labyrinth entrance to form a party.</p>
        )}
      </div>
    );
  }

  // --- In a party.
  return (
    <div className="w-56 rounded-lg border border-border bg-background/80 p-2.5 text-xs shadow-lg backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Users className="h-3.5 w-3.5" /> Party {party.members.length}/4
        </div>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-col gap-1">
        {party.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-1.5">
            {m.userId === party.hostUserId ? (
              <Crown className="h-3 w-3 shrink-0 text-amber-400" />
            ) : m.ready ? (
              <Check className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <span className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate text-foreground">
              {m.displayName}
              {m.userId === myUserId ? " (you)" : ""}
            </span>
          </div>
        ))}
        {party.invites.map((i) => (
          <div key={i.userId} className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            <span className="truncate italic">{i.displayName} (invited)</span>
          </div>
        ))}
      </div>

      {party.status === "forming" && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {isHost && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 w-full gap-1.5 text-xs"
              disabled={busy || !canInviteAlly}
              onClick={() =>
                nearbyAlly &&
                invite.mutate(
                  { id: party.partyId, data: { targetUserId: nearbyAlly.userId } },
                  { onSuccess: refresh },
                )
              }
            >
              <UserPlus className="h-3.5 w-3.5" />
              {nearbyAlly ? `Invite ${nearbyAlly.displayName}` : "Walk near a player"}
            </Button>
          )}

          {!isHost && me && (
            <Button
              size="sm"
              variant={me.ready ? "default" : "secondary"}
              className="h-7 w-full gap-1.5 text-xs"
              disabled={busy}
              onClick={() =>
                ready.mutate({ id: party.partyId, data: { ready: !me.ready } }, { onSuccess: refresh })
              }
            >
              <Check className="h-3.5 w-3.5" />
              {me.ready ? "Ready ✓" : "Mark ready"}
            </Button>
          )}

          {isHost && (
            <Button
              size="sm"
              className="h-8 w-full gap-1.5 text-xs"
              disabled={busy || !allReady}
              onClick={() => start.mutate({ id: party.partyId }, { onSuccess: refresh })}
            >
              <Swords className="h-3.5 w-3.5" />
              Launch run
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-full gap-1.5 text-xs text-muted-foreground"
            disabled={busy}
            onClick={() => leave.mutate(undefined, { onSuccess: refresh })}
          >
            <LogOut className="h-3.5 w-3.5" />
            {isHost ? "Disband / leave" : "Leave party"}
          </Button>
        </div>
      )}

      {party.status === "in_run" && (
        <div className="mt-2.5 flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Entering run…
        </div>
      )}
    </div>
  );
}
