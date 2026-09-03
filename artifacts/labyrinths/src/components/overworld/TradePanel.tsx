import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetActiveTrade,
  useInviteTrade,
  useRespondTrade,
  useUpdateTradeOffer,
  useConfirmTrade,
  useCancelTrade,
  useListMyItems,
  useGetBalances,
  getGetActiveTradeQueryKey,
  getListMyItemsQueryKey,
  getGetBalancesQueryKey,
} from "@workspace/api-client-react";
import type {
  TradeSession,
  TradeCurrency,
  PlayerItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeftRight,
  Check,
  Loader2,
  X,
  CheckCircle2,
  Ban,
} from "lucide-react";

export interface NearbyPlayer {
  userId: number;
  displayName: string;
}

const CURRENCY_META: { key: keyof TradeCurrency; label: string; glyph: string }[] = [
  { key: "gold", label: "Gold", glyph: "🪙" },
  { key: "ore", label: "Ore", glyph: "⛏️" },
  { key: "dust", label: "Dust", glyph: "✨" },
  { key: "keys", label: "Keys", glyph: "🗝️" },
  { key: "labToken", label: "$LAB", glyph: "🔷" },
];

const emptyCurrency = (): TradeCurrency => ({
  gold: 0,
  ore: 0,
  dust: 0,
  keys: 0,
  labToken: 0,
});

const RARITY_COLOR: Record<string, string> = {
  common: "text-zinc-300",
  uncommon: "text-emerald-400",
  rare: "text-sky-400",
  epic: "text-violet-400",
  legendary: "text-amber-400",
};

/**
 * Self-contained peer-to-peer trade UI. Polls the caller's active trade once a
 * second and drives the full lifecycle: invite (initiator) / accept-decline
 * (recipient) / stage offer / confirm / cancel. The actual swap is settled
 * server-side; this only mirrors state and dispatches intents.
 */
export default function TradePanel({ nearby }: { nearby: NearbyPlayer | null }) {
  const queryClient = useQueryClient();
  const { data, refetch } = useGetActiveTrade({
    query: {
      queryKey: getGetActiveTradeQueryKey(),
      refetchInterval: 1000,
      refetchOnWindowFocus: true,
    },
  });
  const trade = data?.trade ?? null;

  const invite = useInviteTrade();
  const respond = useRespondTrade();
  const updateOffer = useUpdateTradeOffer();
  const confirm = useConfirmTrade();
  const cancel = useCancelTrade();

  // After a terminal outcome, refresh inventory + balances so the swap shows up.
  const status = trade?.status;
  useEffect(() => {
    if (status === "settled") {
      queryClient.invalidateQueries({ queryKey: getListMyItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetBalancesQueryKey() });
    }
  }, [status, queryClient]);

  const refreshActive = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetActiveTradeQueryKey() });
  }, [queryClient]);

  const doInvite = useCallback(() => {
    if (!nearby) return;
    invite.mutate(
      { data: { toUserId: nearby.userId } },
      { onSuccess: () => refetch() },
    );
  }, [nearby, invite, refetch]);

  // 'T' to invite the nearest player when not already trading.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key.toLowerCase() === "t" && nearby && !trade) {
        e.preventDefault();
        doInvite();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nearby, trade, doInvite]);

  // The floating "Trade" prompt only shows when idle and someone is near.
  const showInvitePrompt = !trade && nearby;

  return (
    <>
      {showInvitePrompt && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2">
          <Button
            onClick={doInvite}
            size="sm"
            className="gap-2 shadow-lg"
            disabled={invite.isPending}
          >
            {invite.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowLeftRight className="h-4 w-4" />
            )}
            Trade {nearby!.displayName} <span className="opacity-70">(T)</span>
          </Button>
        </div>
      )}

      {invite.isError && !trade && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-md bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground shadow-lg">
          {(invite.error as Error)?.message ?? "Could not start trade"}
        </div>
      )}

      {trade && (
        <TradeWindow
          trade={trade}
          onRespond={(accept) =>
            respond.mutate(
              { id: trade.id, data: { accept } },
              { onSuccess: () => refetch() },
            )
          }
          onOffer={(itemIds, currency) =>
            updateOffer.mutate(
              { id: trade.id, data: { itemIds, currency } },
              { onSuccess: () => refetch() },
            )
          }
          onConfirm={(confirmed) =>
            confirm.mutate(
              { id: trade.id, data: { confirmed } },
              { onSuccess: () => refetch() },
            )
          }
          onCancel={() =>
            cancel.mutate(
              { id: trade.id },
              { onSuccess: () => refetch() },
            )
          }
          onDismiss={refreshActive}
          busy={
            respond.isPending ||
            updateOffer.isPending ||
            confirm.isPending ||
            cancel.isPending
          }
        />
      )}
    </>
  );
}

function TradeWindow({
  trade,
  onRespond,
  onOffer,
  onConfirm,
  onCancel,
  onDismiss,
  busy,
}: {
  trade: TradeSession;
  onRespond: (accept: boolean) => void;
  onOffer: (itemIds: number[], currency: TradeCurrency) => void;
  onConfirm: (confirmed: boolean) => void;
  onCancel: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  // Pending invite the recipient must answer.
  if (trade.status === "pending" && trade.role === "recipient") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 shadow-2xl">
          <div className="mb-1 flex items-center gap-2 text-base font-semibold">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            Trade request
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{trade.them.displayName}</span>{" "}
            wants to trade with you.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => onRespond(true)} disabled={busy}>
              <Check className="mr-1 h-4 w-4" /> Accept
            </Button>
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => onRespond(false)}
              disabled={busy}
            >
              <X className="mr-1 h-4 w-4" /> Decline
            </Button>
          </div>
        </div>
      </Backdrop>
    );
  }

  // Pending invite the initiator is waiting on.
  if (trade.status === "pending" && trade.role === "initiator") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 text-center shadow-2xl">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
          <p className="mb-4 text-sm text-muted-foreground">
            Waiting for{" "}
            <span className="font-medium text-foreground">{trade.them.displayName}</span>{" "}
            to accept…
          </p>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </Backdrop>
    );
  }

  // Terminal notices.
  if (trade.status === "settled") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 text-center shadow-2xl">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <p className="mb-1 text-base font-semibold">Trade complete</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Your items and currency have been exchanged with {trade.them.displayName}.
          </p>
          <Button size="sm" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </Backdrop>
    );
  }
  if (trade.status === "cancelled" || trade.status === "declined") {
    return (
      <Backdrop>
        <div className="w-[340px] rounded-xl border border-border bg-background p-5 text-center shadow-2xl">
          <Ban className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="mb-1 text-base font-semibold">
            Trade {trade.status === "declined" ? "declined" : "cancelled"}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {trade.note ?? "Nothing was exchanged."}
          </p>
          <Button size="sm" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </Backdrop>
    );
  }

  // Active staging window.
  return (
    <Backdrop>
      <ActiveTrade
        trade={trade}
        onOffer={onOffer}
        onConfirm={onConfirm}
        onCancel={onCancel}
        busy={busy}
      />
    </Backdrop>
  );
}

function ActiveTrade({
  trade,
  onOffer,
  onConfirm,
  onCancel,
  busy,
}: {
  trade: TradeSession;
  onOffer: (itemIds: number[], currency: TradeCurrency) => void;
  onConfirm: (confirmed: boolean) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { data: items } = useListMyItems();
  const { data: balances } = useGetBalances();

  // Local draft of my offer. Server-confirmed values flow back via `trade.me`.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [currency, setCurrency] = useState<TradeCurrency>(emptyCurrency());
  const iConfirmed = trade.me.confirmed;

  // Keep the local draft in sync with the authoritative server offer. This makes
  // the picker reflect a confirmation-reset and keeps both tabs honest.
  const serverItemIds = useMemo(
    () => trade.me.items.map((i) => i.playerItemId).sort().join(","),
    [trade.me.items],
  );
  const serverCurrency = useMemo(
    () => CURRENCY_META.map((c) => trade.me.currency[c.key]).join(","),
    [trade.me.currency],
  );
  useEffect(() => {
    setSelected(new Set(trade.me.items.map((i) => i.playerItemId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverItemIds]);
  useEffect(() => {
    setCurrency({ ...trade.me.currency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCurrency]);

  const pushOffer = useCallback(
    (ids: Set<number>, cur: TradeCurrency) => {
      onOffer(Array.from(ids), cur);
    },
    [onOffer],
  );

  const toggleItem = (item: PlayerItem) => {
    if (iConfirmed) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      pushOffer(next, currency);
      return next;
    });
  };

  const setCur = (key: keyof TradeCurrency, raw: string) => {
    if (iConfirmed) return;
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    const cap = balances ? (balances[key] as number) : n;
    const value = Math.min(n, cap);
    setCurrency((prev) => {
      const next = { ...prev, [key]: value };
      pushOffer(selected, next);
      return next;
    });
  };

  const myItems = items ?? [];
  // Items already promised elsewhere can't be re-offered, but in practice the
  // server is the gate; here we just render what the player owns.
  return (
    <div className="flex w-[680px] max-w-[94vw] flex-col rounded-xl border border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          Trading with {trade.them.displayName}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel} disabled={busy}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border">
        {/* My side */}
        <div className="flex flex-col p-3">
          <SideHeader
            title="Your offer"
            confirmed={trade.me.confirmed}
          />
          <ScrollArea className="h-[230px] pr-2">
            <div className="grid grid-cols-3 gap-1.5">
              {myItems.length === 0 && (
                <p className="col-span-3 py-6 text-center text-xs text-muted-foreground">
                  You have no items.
                </p>
              )}
              {myItems.map((it) => {
                const on = selected.has(it.id);
                return (
                  <button
                    key={it.id}
                    onClick={() => toggleItem(it)}
                    disabled={iConfirmed}
                    title={`${it.template.name} · Lv ${it.level}`}
                    className={`relative flex flex-col items-center gap-0.5 rounded-md border p-1.5 text-center transition-colors disabled:opacity-60 ${
                      on
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/30 hover:bg-muted"
                    }`}
                  >
                    <span className="text-lg leading-none">{it.template.icon || "📦"}</span>
                    <span
                      className={`line-clamp-1 text-[10px] font-medium ${
                        RARITY_COLOR[it.template.rarity] ?? "text-foreground"
                      }`}
                    >
                      {it.template.name}
                    </span>
                    <span className="text-[9px] text-muted-foreground">Lv {it.level}</span>
                    {on && (
                      <Check className="absolute right-0.5 top-0.5 h-3 w-3 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
          <CurrencyEditor
            currency={currency}
            balances={balances}
            disabled={iConfirmed}
            onChange={setCur}
          />
        </div>

        {/* Their side (read-only mirror) */}
        <div className="flex flex-col bg-muted/10 p-3">
          <SideHeader title={`${trade.them.displayName}'s offer`} confirmed={trade.them.confirmed} />
          <ScrollArea className="h-[230px] pr-2">
            <div className="grid grid-cols-3 gap-1.5">
              {trade.them.items.length === 0 && (
                <p className="col-span-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing offered yet.
                </p>
              )}
              {trade.them.items.map((it) => (
                <div
                  key={it.playerItemId}
                  title={`${it.name} · Lv ${it.level}`}
                  className="flex flex-col items-center gap-0.5 rounded-md border border-border bg-muted/30 p-1.5 text-center"
                >
                  <span className="text-lg leading-none">{it.icon || "📦"}</span>
                  <span
                    className={`line-clamp-1 text-[10px] font-medium ${
                      RARITY_COLOR[it.rarity] ?? "text-foreground"
                    }`}
                  >
                    {it.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground">Lv {it.level}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
          <TheirCurrency currency={trade.them.currency} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel trade
        </Button>
        <div className="flex items-center gap-2">
          {trade.bothConfirmed && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Settling…
            </span>
          )}
          <Button
            onClick={() => onConfirm(!iConfirmed)}
            disabled={busy}
            variant={iConfirmed ? "secondary" : "default"}
            size="sm"
            className="gap-1.5"
          >
            {iConfirmed ? (
              <>
                <X className="h-4 w-4" /> Unconfirm
              </>
            ) : (
              <>
                <Check className="h-4 w-4" /> Confirm offer
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SideHeader({ title, confirmed }: { title: string; confirmed: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs font-semibold text-muted-foreground">{title}</span>
      {confirmed ? (
        <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
          <Check className="h-3 w-3" /> Confirmed
        </Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Editing
        </Badge>
      )}
    </div>
  );
}

function CurrencyEditor({
  currency,
  balances,
  disabled,
  onChange,
}: {
  currency: TradeCurrency;
  balances: { gold: number; ore: number; dust: number; keys: number; labToken: number } | undefined;
  disabled: boolean;
  onChange: (key: keyof TradeCurrency, raw: string) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-5 gap-1.5">
      {CURRENCY_META.map((c) => (
        <label key={c.key} className="flex flex-col items-center gap-0.5">
          <span className="text-sm" title={c.label}>
            {c.glyph}
          </span>
          <Input
            type="number"
            min={0}
            max={balances ? (balances[c.key] as number) : undefined}
            value={currency[c.key] || ""}
            placeholder="0"
            disabled={disabled}
            onChange={(e) => onChange(c.key, e.target.value)}
            className="h-7 px-1 text-center text-xs"
          />
          {balances && (
            <span className="text-[9px] text-muted-foreground">
              /{balances[c.key] as number}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

function TheirCurrency({ currency }: { currency: TradeCurrency }) {
  return (
    <div className="mt-2 grid grid-cols-5 gap-1.5">
      {CURRENCY_META.map((c) => (
        <div key={c.key} className="flex flex-col items-center gap-0.5">
          <span className="text-sm" title={c.label}>
            {c.glyph}
          </span>
          <span className="flex h-7 w-full items-center justify-center rounded-md border border-border bg-muted/40 text-xs">
            {currency[c.key] ?? 0}
          </span>
        </div>
      ))}
    </div>
  );
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      {children}
    </div>
  );
}
