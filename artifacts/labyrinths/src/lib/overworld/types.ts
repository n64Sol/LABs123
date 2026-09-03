export const WORLD_W = 2400;
export const WORLD_H = 1600;

export const EMOTES = [
  { key: "wave", glyph: "👋", label: "Wave" },
  { key: "laugh", glyph: "😂", label: "Laugh" },
  { key: "love", glyph: "❤️", label: "Love" },
  { key: "wow", glyph: "😮", label: "Wow" },
  { key: "angry", glyph: "😠", label: "Angry" },
  { key: "party", glyph: "🎉", label: "Party" },
] as const;

export type EmoteKey = (typeof EMOTES)[number]["key"];

export function emoteGlyph(key: string): string {
  return EMOTES.find((e) => e.key === key)?.glyph ?? "❓";
}

export interface RemotePlayer {
  clientId: string;
  userId: number;
  displayName: string;
  avatarUrl: string;
  /** Flat `{ lpcLayerKey -> relativeAssetPath }` appearance, composed to a sprite. */
  spriteLayers?: Record<string, string>;
  /** Authoritative network target position. */
  x: number;
  y: number;
  facing: number;
  moving: boolean;
}

export type TransientEvent =
  | { t: "emote"; clientId: string; emote: string; at: number }
  | { t: "chat"; clientId: string; text: string; at: number };

export type Transport = "connecting" | "websocket" | "polling";
