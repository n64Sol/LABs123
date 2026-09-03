import { useSyncExternalStore } from "react";

/**
 * Player-chosen combat control scheme for single-player runs.
 *  - "auto":   attacks fire on their own toward the nearest enemy; the player
 *              only moves and triggers abilities (the historical default feel).
 *  - "manual": the player aims with the mouse and triggers each attack
 *              themselves (click or the F key); nothing fires automatically.
 *
 * This is a device-local preference (no server/cross-device sync) so existing
 * players keep the same behaviour unless they opt in — Auto stays the default.
 */
export type CombatMode = "auto" | "manual";

const KEY = "labyrinths.combatMode";
const listeners = new Set<() => void>();

export function getCombatMode(): CombatMode {
  if (typeof window === "undefined") return "auto";
  return window.localStorage.getItem(KEY) === "manual" ? "manual" : "auto";
}

export function setCombatMode(mode: CombatMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, mode);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reactive accessor: re-renders on change in this tab or another tab. */
export function useCombatMode(): [CombatMode, (m: CombatMode) => void] {
  const mode = useSyncExternalStore(subscribe, getCombatMode, () => "auto" as CombatMode);
  return [mode, setCombatMode];
}
