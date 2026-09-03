import { useEffect } from "react";

import pixelScene from "@/assets/styles/scene_pixel.png";
import grittyScene from "@/assets/styles/scene_gritty.png";
import hadesScene from "@/assets/styles/scene_hades.png";
import czepekuScene from "@/assets/styles/scene_czepeku.jpg";
import czepekuVideo from "@/assets/styles/scene_czepeku.mp4";

/**
 * Art-direction comparison for Labyrinths.
 * Three candidate looks, each shown as a live game viewport with a
 * style-matched HUD overlay so the same scene can be judged side by side.
 */

type Theme = {
  key: string;
  name: string;
  tagline: string;
  source: string;
  sourceTone: string;
  scene: string;
  video?: string;
  pixelated: boolean;
  font: string;
  accent: string;
  accent2: string;
  panelBg: string;
  panelBorder: string;
  text: string;
  hpFill: string;
  manaFill: string;
  frameRadius: number;
  frameBorder: string;
  notes: string[];
};

const THEMES: Theme[] = [
  {
    key: "hades",
    name: "Hades-style",
    tagline: "Hand-painted, ornate, jewel-toned",
    source: "AI concept art",
    sourceTone: "#c9a24b",
    scene: hadesScene,
    pixelated: false,
    font: "'Cinzel', Georgia, serif",
    accent: "#e9c46a",
    accent2: "#2a9d8f",
    panelBg: "linear-gradient(180deg, rgba(28,22,38,0.92), rgba(16,12,24,0.94))",
    panelBorder: "#c9a24b",
    text: "#f3e6c4",
    hpFill: "linear-gradient(90deg, #b5482f, #e76f51)",
    manaFill: "linear-gradient(90deg, #1d7d72, #2a9d8f)",
    frameRadius: 14,
    frameBorder: "2px solid rgba(201,162,75,0.55)",
    notes: [
      "Richest, most premium feel",
      "Needs paid / commissioned or AI art",
      "Hardest to keep consistent at scale",
    ],
  },
  {
    key: "czepeku",
    name: "Czepeku (your map)",
    tagline: "Painted top-down, animated water",
    source: "Licensed · Cze and Peku",
    sourceTone: "#7ec9b4",
    scene: czepekuScene,
    video: czepekuVideo,
    pixelated: false,
    font: "'Cinzel', Georgia, serif",
    accent: "#e9c46a",
    accent2: "#3fa796",
    panelBg: "linear-gradient(180deg, rgba(16,32,30,0.92), rgba(8,20,20,0.95))",
    panelBorder: "#3fa796",
    text: "#e9f3ee",
    hpFill: "linear-gradient(90deg, #b5482f, #e76f51)",
    manaFill: "linear-gradient(90deg, #2a7d72, #3fa796)",
    frameRadius: 12,
    frameBorder: "2px solid rgba(63,167,150,0.55)",
    notes: [
      "You own the license (paid)",
      "Real painted art + animated water",
      "Top-down whole-map, not tiled/procedural",
    ],
  },
  {
    key: "pixel",
    name: "Clean pixel",
    tagline: "Bright, readable, friendly",
    source: "Real CC0 assets · Kenney Tiny Dungeon",
    sourceTone: "#7bd88f",
    scene: pixelScene,
    pixelated: true,
    font: "'Press Start 2P', ui-monospace, monospace",
    accent: "#f4b942",
    accent2: "#5ab1ef",
    panelBg: "linear-gradient(180deg, rgba(38,30,48,0.92), rgba(24,18,34,0.95))",
    panelBorder: "#f4b942",
    text: "#fef3d0",
    hpFill: "linear-gradient(90deg, #d94a4a, #ff7a7a)",
    manaFill: "linear-gradient(90deg, #3a86ff, #5ab1ef)",
    frameRadius: 4,
    frameBorder: "3px solid #2b2238",
    notes: [
      "Free & ships today (CC0)",
      "Cohesive, fast to build levels",
      "Less cinematic than painted art",
    ],
  },
  {
    key: "gritty",
    name: "Dark gritty stone",
    tagline: "Moody, torch-lit, dangerous",
    source: "Real CC0 assets · Kenney Caves",
    sourceTone: "#7bd88f",
    scene: grittyScene,
    pixelated: true,
    font: "'IM Fell English', Georgia, serif",
    accent: "#e08a3c",
    accent2: "#a86b3c",
    panelBg: "linear-gradient(180deg, rgba(24,18,14,0.94), rgba(12,9,7,0.96))",
    panelBorder: "#7a5436",
    text: "#e8d3b5",
    hpFill: "linear-gradient(90deg, #7a1f1f, #c0392b)",
    manaFill: "linear-gradient(90deg, #5a4326, #e08a3c)",
    frameRadius: 6,
    frameBorder: "2px solid #3a2c1f",
    notes: [
      "Free & ships today (CC0)",
      "Atmosphere from lighting, not tiles",
      "Reads darker / harder to see props",
    ],
  },
];

function Bar({
  label,
  pct,
  fill,
  font,
  text,
}: {
  label: string;
  pct: number;
  fill: string;
  font: string;
  text: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontFamily: font,
          fontSize: 9,
          width: 26,
          color: text,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 12,
          background: "rgba(0,0,0,0.55)",
          borderRadius: 3,
          overflow: "hidden",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: fill,
            boxShadow: "0 0 6px rgba(255,255,255,0.25) inset",
          }}
        />
      </div>
    </div>
  );
}

function AbilityIcon({
  glyph,
  hot,
  theme,
  cooling,
}: {
  glyph: string;
  hot: string;
  theme: Theme;
  cooling?: number;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: 38,
        height: 38,
        borderRadius: theme.frameRadius,
        border: `1.5px solid ${theme.panelBorder}`,
        background:
          "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12), rgba(0,0,0,0.55))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 18, filter: "drop-shadow(0 1px 1px #000)" }}>
        {glyph}
      </span>
      {cooling ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: theme.font,
            fontSize: 11,
            color: "#fff",
          }}
        >
          {cooling}
        </div>
      ) : null}
      <span
        style={{
          position: "absolute",
          bottom: 1,
          right: 3,
          fontFamily: theme.font,
          fontSize: 7,
          color: theme.accent,
        }}
      >
        {hot}
      </span>
    </div>
  );
}

function Viewport({ theme }: { theme: Theme }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "4 / 3",
        borderRadius: theme.frameRadius,
        overflow: "hidden",
        border: theme.frameBorder,
        boxShadow:
          "0 18px 40px rgba(0,0,0,0.55), inset 0 0 60px rgba(0,0,0,0.35)",
      }}
    >
      {theme.video ? (
        <video
          src={theme.video}
          poster={theme.scene}
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <img
          src={theme.scene}
          alt={`${theme.name} dungeon scene`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            imageRendering: theme.pixelated ? "pixelated" : "auto",
          }}
        />
      )}

      {/* top-left: portrait + vitals */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          display: "flex",
          gap: 8,
          padding: 8,
          minWidth: 188,
          borderRadius: theme.frameRadius,
          background: theme.panelBg,
          border: `1.5px solid ${theme.panelBorder}`,
          backdropFilter: "blur(2px)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: theme.frameRadius,
            border: `1.5px solid ${theme.panelBorder}`,
            background:
              "radial-gradient(circle at 35% 30%, #6b5a8a, #241a30)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          🛡️
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontFamily: theme.font,
              fontSize: 9,
              color: theme.text,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>WARDEN</span>
            <span style={{ color: theme.accent }}>Lv 7</span>
          </div>
          <Bar label="HP" pct={72} fill={theme.hpFill} font={theme.font} text={theme.text} />
          <Bar label="MP" pct={45} fill={theme.manaFill} font={theme.font} text={theme.text} />
        </div>
      </div>

      {/* top-right: run stats */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          padding: "6px 10px",
          borderRadius: theme.frameRadius,
          background: theme.panelBg,
          border: `1.5px solid ${theme.panelBorder}`,
          fontFamily: theme.font,
          fontSize: 9,
          color: theme.text,
          textAlign: "right",
          lineHeight: 1.7,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      >
        <div>
          <span style={{ color: theme.accent }}>◆</span> 1,240 $LAB
        </div>
        <div>
          ☠ 14 &nbsp; <span style={{ color: theme.accent2 }}>⌛ 03:18</span>
        </div>
      </div>

      {/* bottom-center: ability bar */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 6,
          padding: 6,
          borderRadius: theme.frameRadius,
          background: theme.panelBg,
          border: `1.5px solid ${theme.panelBorder}`,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      >
        <AbilityIcon glyph="⚔️" hot="LMB" theme={theme} />
        <AbilityIcon glyph="🌀" hot="SPC" theme={theme} />
        <AbilityIcon glyph="🔥" hot="Q" theme={theme} cooling={4} />
        <AbilityIcon glyph="✦" hot="E" theme={theme} />
      </div>

      {/* center-top: objective hint */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "4px 12px",
          borderRadius: 999,
          background: theme.panelBg,
          border: `1px solid ${theme.panelBorder}`,
          fontFamily: theme.font,
          fontSize: 8,
          lineHeight: 1.5,
          color: theme.text,
          whiteSpace: "nowrap",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      >
        <span style={{ color: theme.accent }}>◈</span> Clear the chamber
      </div>
    </div>
  );
}

function Panel({ theme }: { theme: Theme }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minHeight: 78,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2
            style={{
              fontFamily: theme.font,
              fontSize: theme.pixelated && theme.key === "pixel" ? 15 : 19,
              margin: 0,
              color: theme.text,
              letterSpacing: 0.5,
              lineHeight: 1.1,
            }}
          >
            {theme.name}
          </h2>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 999,
              color: "#0b0b0e",
              background: theme.sourceTone,
              whiteSpace: "nowrap",
            }}
          >
            {theme.source}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#a9a4b8" }}>{theme.tagline}</p>
      </div>

      <Viewport theme={theme} />

      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 12.5,
          color: "#c4bfd4",
          lineHeight: 1.7,
        }}
      >
        {theme.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

export default function StyleCompare() {
  useEffect(() => {
    const id = "style-compare-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Press+Start+2P&family=IM+Fell+English:ital@0;1&display=swap";
    document.head.appendChild(link);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 700px at 50% -10%, #241c34, #0c0a12 60%)",
        color: "#fff",
        padding: "32px 28px 48px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1560, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#8a84a0",
              marginBottom: 8,
            }}
          >
            Labyrinths · Art Direction
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 700,
              background: "linear-gradient(90deg,#e9c46a,#e76f51,#2a9d8f)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Same game, four looks
          </h1>
          <p
            style={{
              margin: "10px auto 0",
              maxWidth: 620,
              fontSize: 14,
              color: "#b3aec4",
              lineHeight: 1.6,
            }}
          >
            Each viewport shows the game's HUD over a candidate look. Two use
            free CC0 art (Kenney), one is an AI concept, and one is your own
            licensed Czepeku map — the real animated asset. Pick a direction.
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 22,
          }}
        >
          {THEMES.map((t) => (
            <Panel key={t.key} theme={t} />
          ))}
        </div>

        <footer
          style={{
            marginTop: 36,
            paddingTop: 18,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            textAlign: "center",
            fontSize: 12,
            color: "#7d7892",
          }}
        >
          Pixel & gritty scenes built from Kenney CC0 packs (free to ship) ·
          Hades-style panel is AI concept art · Czepeku panel uses your licensed
          map (Cartography by Cze and Peku) · Visual comparison only — the live
          game is unchanged.
        </footer>
      </div>
    </div>
  );
}
