import React, { useEffect } from "react";
import { Compass, Map as MapIcon, Shield, BookOpen, Hammer, Store, Wallet, LogOut } from "lucide-react";

import obsidianBattle from "@/assets/artdirections/obsidian_battle.png";
import obsidianOverworld from "@/assets/artdirections/obsidian_overworld.png";
import arcaneBattle from "@/assets/artdirections/arcane_battle.png";
import arcaneOverworld from "@/assets/artdirections/arcane_overworld.png";
import gildedBattle from "@/assets/artdirections/gilded_battle.png";
import gildedOverworld from "@/assets/artdirections/gilded_overworld.png";
import stormveilBattle from "@/assets/artdirections/stormveil_battle.png";
import stormveilOverworld from "@/assets/artdirections/stormveil_overworld.png";

type DirectionDef = {
  id: string;
  name: string;
  pitch: string;
  images: { battle: string; overworld: string };
  colors: {
    bg: string;
    panel: string;
    border: string;
    accent1: string;
    accent2: string;
    text: string;
    muted: string;
    hp: string;
    mp: string;
  };
  fonts: {
    heading: string;
    body: string;
    ui: string;
  };
  styles: {
    radius: number;
    panelShadow: string;
    panelBorder: string;
    panelBg: string;
    buttonPrimary: React.CSSProperties;
    buttonSecondary: React.CSSProperties;
    hudFilter: string;
  };
};

const DIRECTIONS: DirectionDef[] = [
  {
    id: "obsidian",
    name: "Obsidian Forge",
    pitch: "Forged in fire and shadow — brutal, weighty, dangerous.",
    images: { battle: obsidianBattle, overworld: obsidianOverworld },
    colors: {
      bg: "#0a0a0c",
      panel: "#141416",
      border: "#3a2a24",
      accent1: "#e25822",
      accent2: "#d4af37",
      text: "#dcd0c0",
      muted: "#887b73",
      hp: "linear-gradient(90deg, #8b0000, #c41e3a)",
      mp: "linear-gradient(90deg, #cc5500, #e25822)",
    },
    fonts: {
      heading: "'Cinzel Decorative', serif",
      body: "'EB Garamond', serif",
      ui: "'Cinzel', serif",
    },
    styles: {
      radius: 2,
      panelShadow: "0 10px 30px rgba(0,0,0,0.8), inset 0 2px 4px rgba(255,255,255,0.05)",
      panelBorder: "2px solid #3a2a24",
      panelBg: "linear-gradient(180deg, #1f1b1a 0%, #110f0e 100%)",
      buttonPrimary: {
        background: "linear-gradient(180deg, #8a2b0d 0%, #521805 100%)",
        border: "1px solid #c85a32",
        color: "#f4e0c4",
        textTransform: "uppercase",
        letterSpacing: "1px",
        boxShadow: "0 4px 10px rgba(226, 88, 34, 0.2)",
      },
      buttonSecondary: {
        background: "#181615",
        border: "1px solid #3a2a24",
        color: "#a49b91",
        textTransform: "uppercase",
        letterSpacing: "1px",
      },
      hudFilter: "drop-shadow(0 4px 6px rgba(0,0,0,0.8))",
    },
  },
  {
    id: "arcane",
    name: "Arcane Circuit",
    pitch: "Occult tech and rune-light — sleek, competitive, electric.",
    images: { battle: arcaneBattle, overworld: arcaneOverworld },
    colors: {
      bg: "#050212",
      panel: "rgba(18, 12, 36, 0.65)",
      border: "rgba(0, 255, 255, 0.4)",
      accent1: "#00ffff",
      accent2: "#ff00ff",
      text: "#e0f8ff",
      muted: "#667a99",
      hp: "linear-gradient(90deg, #ff00ff, #ff66ff)",
      mp: "linear-gradient(90deg, #0088ff, #00ffff)",
    },
    fonts: {
      heading: "'Syncopate', sans-serif",
      body: "'Rajdhani', sans-serif",
      ui: "'Orbitron', sans-serif",
    },
    styles: {
      radius: 0,
      panelShadow: "0 0 20px rgba(0, 255, 255, 0.1), inset 0 0 15px rgba(255, 0, 255, 0.05)",
      panelBorder: "1px solid rgba(0, 255, 255, 0.3)",
      panelBg: "linear-gradient(135deg, rgba(20, 10, 40, 0.8) 0%, rgba(5, 5, 15, 0.9) 100%)",
      buttonPrimary: {
        background: "rgba(0, 255, 255, 0.1)",
        border: "1px solid #00ffff",
        color: "#00ffff",
        textTransform: "uppercase",
        letterSpacing: "2px",
        boxShadow: "0 0 10px rgba(0, 255, 255, 0.3), inset 0 0 5px rgba(0, 255, 255, 0.2)",
        backdropFilter: "blur(4px)",
      },
      buttonSecondary: {
        background: "rgba(255, 0, 255, 0.05)",
        border: "1px solid rgba(255, 0, 255, 0.3)",
        color: "#ff88ff",
        textTransform: "uppercase",
        letterSpacing: "2px",
        backdropFilter: "blur(4px)",
      },
      hudFilter: "drop-shadow(0 0 8px rgba(0,255,255,0.4))",
    },
  },
  {
    id: "gilded",
    name: "Gilded Myth",
    pitch: "Hand-painted opulence — ornate, jewel-toned, premium.",
    images: { battle: gildedBattle, overworld: gildedOverworld },
    colors: {
      bg: "#101614",
      panel: "#1a2421",
      border: "#b89947",
      accent1: "#d4af37",
      accent2: "#e63946",
      text: "#fdfbf7",
      muted: "#9a9a8a",
      hp: "linear-gradient(90deg, #780000, #c1121f)",
      mp: "linear-gradient(90deg, #005f73, #0a9396)",
    },
    fonts: {
      heading: "'Playfair Display', serif",
      body: "'Lora', serif",
      ui: "'Cormorant SC', serif",
    },
    styles: {
      radius: 8,
      panelShadow: "0 12px 24px rgba(0,0,0,0.6)",
      panelBorder: "2px solid #b89947",
      panelBg: "linear-gradient(to bottom right, #202c28, #121816)",
      buttonPrimary: {
        background: "linear-gradient(180deg, #cca33f 0%, #a67c00 100%)",
        border: "1px solid #e0c879",
        color: "#2a1e04",
        fontWeight: "bold",
        textTransform: "uppercase",
        letterSpacing: "1.5px",
        borderRadius: "4px",
      },
      buttonSecondary: {
        background: "transparent",
        border: "1px solid #b89947",
        color: "#d4af37",
        textTransform: "uppercase",
        letterSpacing: "1.5px",
        borderRadius: "4px",
      },
      hudFilter: "drop-shadow(0 2px 10px rgba(0,0,0,0.5))",
    },
  },
  {
    id: "stormveil",
    name: "Stormveil",
    pitch: "Cold, cinematic, restrained — fog, stone, and silence.",
    images: { battle: stormveilBattle, overworld: stormveilOverworld },
    colors: {
      bg: "#1a1c23",
      panel: "rgba(32, 36, 45, 0.7)",
      border: "rgba(255, 255, 255, 0.15)",
      accent1: "#a3c2c2",
      accent2: "#d9d0b8",
      text: "#eef1f4",
      muted: "#848f9f",
      hp: "linear-gradient(90deg, #5c6b73, #93a8ac)",
      mp: "linear-gradient(90deg, #4a6a7a, #a3c2c2)",
    },
    fonts: {
      heading: "'Space Grotesk', sans-serif",
      body: "'Inter', sans-serif",
      ui: "'Space Mono', monospace",
    },
    styles: {
      radius: 12,
      panelShadow: "0 8px 32px rgba(0,0,0,0.2)",
      panelBorder: "1px solid rgba(255,255,255,0.1)",
      panelBg: "rgba(22, 25, 33, 0.8)",
      buttonPrimary: {
        background: "#eef1f4",
        border: "none",
        color: "#1a1c23",
        fontWeight: "500",
        letterSpacing: "0.5px",
        borderRadius: "8px",
        backdropFilter: "blur(10px)",
      },
      buttonSecondary: {
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "#eef1f4",
        letterSpacing: "0.5px",
        borderRadius: "8px",
        backdropFilter: "blur(10px)",
      },
      hudFilter: "none",
    },
  },
];

function injectFonts() {
  const id = "art-directions-fonts";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=Orbitron:wght@400;600;800&family=Rajdhani:wght@400;600;700&family=Syncopate:wght@400;700&family=Cormorant+SC:wght@400;600;700&family=Lora:ital,wght@0,400;0,600;1,400&family=Playfair+Display:ital,wght@0,400;0,600;0,800;1,400&family=Inter:wght@400;500;600&family=Space+Grotesk:wght@300;400;600&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap";
  document.head.appendChild(link);
}

export default function ArtDirections() {
  useEffect(() => {
    injectFonts();
  }, []);

  return (
    <div className="min-h-screen bg-[#08080a] text-white p-6 md:p-12 overflow-x-hidden">
      <div className="max-w-[1800px] mx-auto space-y-12">
        
        {/* Header */}
        <header className="text-center space-y-4 max-w-2xl mx-auto mb-16">
          <p className="text-[#a3c2c2] text-xs font-bold tracking-[0.3em] uppercase">Labyrinths · Art Direction</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">Choose Your Path</h1>
          <p className="text-gray-400 text-sm md:text-base leading-relaxed">
            Review the four premium visual directions below. Each direction applies to the entire game ecosystem—from in-dungeon combat to the overworld and the navigation chrome.
          </p>
        </header>

        {/* Directions Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-12 lg:gap-16">
          {DIRECTIONS.map(dir => (
            <DirectionCard key={dir.id} dir={dir} />
          ))}
        </div>

      </div>
    </div>
  );
}

function DirectionCard({ dir }: { dir: DirectionDef }) {
  const { colors, fonts, styles, images } = dir;

  return (
    <div 
      className="flex flex-col gap-6"
      style={{ fontFamily: fonts.body }}
    >
      {/* Title & Pitch */}
      <div className="space-y-2">
        <h2 
          className="text-3xl"
          style={{ fontFamily: fonts.heading, color: colors.accent1 }}
        >
          {dir.name}
        </h2>
        <p className="text-sm italic" style={{ color: colors.muted }}>
          {dir.pitch}
        </p>
      </div>

      {/* Main Preview Block */}
      <div 
        className="relative flex flex-col md:flex-row overflow-hidden"
        style={{
          backgroundColor: colors.panel,
          borderRadius: styles.radius,
          border: styles.panelBorder,
          boxShadow: styles.panelShadow,
          backgroundImage: styles.panelBg,
        }}
      >
        
        {/* LEFT NAV SHELL */}
        <div 
          className="w-full md:w-56 shrink-0 flex flex-col p-4 border-b md:border-b-0 md:border-r"
          style={{ 
            borderColor: colors.border,
            fontFamily: fonts.ui 
          }}
        >
          {/* Logo mock */}
          <div className="flex items-center gap-3 mb-8 px-2">
            <div 
              className="w-8 h-8 flex items-center justify-center font-bold text-lg"
              style={{ backgroundColor: colors.accent1, color: colors.bg, borderRadius: Math.min(styles.radius, 4) }}
            >
              L
            </div>
            <span className="text-lg tracking-widest font-bold" style={{ color: colors.text }}>LABYRINTHS</span>
          </div>

          {/* Nav Items */}
          <div className="space-y-1 flex-1">
            {[
              { icon: Compass, label: "Overworld", active: false },
              { icon: MapIcon, label: "My Labyrinth", active: true },
              { icon: Shield, label: "Loadout", active: false },
              { icon: BookOpen, label: "Codex", active: false },
              { icon: Hammer, label: "Forge", active: false },
              { icon: Store, label: "Marketplace", active: false },
              { icon: Wallet, label: "Economy", active: false },
            ].map((item, i) => (
              <div 
                key={i} 
                className="flex items-center gap-3 px-3 py-2.5 text-sm transition-all"
                style={{
                  color: item.active ? colors.accent1 : colors.muted,
                  backgroundColor: item.active ? `${colors.accent1}15` : "transparent",
                  borderLeft: item.active ? `2px solid ${colors.accent1}` : "2px solid transparent",
                  fontWeight: item.active ? "bold" : "normal"
                }}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          {/* Player Card */}
          <div className="mt-8 pt-4 border-t space-y-4" style={{ borderColor: colors.border }}>
            <div className="flex items-center gap-3 px-2">
              <div 
                className="w-10 h-10 bg-gray-800 flex-shrink-0"
                style={{ borderRadius: styles.radius, border: `1px solid ${colors.accent1}` }}
              />
              <div className="flex flex-col">
                <span className="text-sm font-bold" style={{ color: colors.text }}>WARDEN</span>
                <div className="flex gap-2 text-xs" style={{ color: colors.accent2 }}>
                  <span>● 1.2k Gold</span>
                  <span className="text-green-400">● 45 USDC</span>
                </div>
              </div>
            </div>
            
            <button 
              className="w-full flex items-center justify-center gap-2 py-2 text-xs transition-opacity hover:opacity-80"
              style={{ ...styles.buttonSecondary }}
            >
              <LogOut size={14} /> Disconnect
            </button>
          </div>
        </div>

        {/* RIGHT CONTENT AREA */}
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* HERO BATTLE SCENE */}
          <div className="relative w-full aspect-video border-b overflow-hidden" style={{ borderColor: colors.border }}>
            <img 
              src={images.battle} 
              alt={`${dir.name} Battle Scene`} 
              className="absolute inset-0 w-full h-full object-cover"
            />
            
            {/* OVERLAY: Combat HUD */}
            <div className="absolute inset-0 p-4 pointer-events-none" style={{ filter: styles.hudFilter, fontFamily: fonts.ui }}>
              
              {/* Top Left: Player Status */}
              <div 
                className="absolute top-3 left-3 p-2 flex gap-2 items-center"
                style={{
                  backgroundColor: styles.panelBg,
                  border: styles.panelBorder,
                  borderRadius: styles.radius,
                  backdropFilter: "blur(4px)"
                }}
              >
                <div 
                  className="w-9 h-9 flex items-center justify-center border font-bold text-sm"
                  style={{ backgroundColor: "#000", borderColor: colors.border, borderRadius: styles.radius, color: colors.accent1 }}
                >
                  W
                </div>
                <div className="flex flex-col gap-1 w-24">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] tracking-wider" style={{ color: colors.text }}>WARDEN</span>
                    <span className="text-[9px]" style={{ color: colors.accent2 }}>LV 32</span>
                  </div>
                  <div className="h-1.5 w-full bg-black overflow-hidden" style={{ borderRadius: styles.radius }}>
                    <div className="h-full w-[75%]" style={{ background: colors.hp }} />
                  </div>
                  <div className="h-1 w-full bg-black overflow-hidden" style={{ borderRadius: styles.radius }}>
                    <div className="h-full w-[40%]" style={{ background: colors.mp }} />
                  </div>
                </div>
              </div>

              {/* Top Center: Objective */}
              <div 
                className="absolute top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 text-[9px] tracking-widest uppercase flex items-center gap-1.5 whitespace-nowrap"
                style={{
                  backgroundColor: styles.panelBg,
                  border: styles.panelBorder,
                  borderRadius: Math.max(styles.radius, 4),
                  color: colors.text,
                  backdropFilter: "blur(4px)"
                }}
              >
                <span style={{ color: colors.accent1 }}>◆</span> Clear the Chamber
              </div>

              {/* Top Right: Stats */}
              <div 
                className="absolute top-4 right-4 p-2 text-[10px] flex flex-col items-end gap-1"
                style={{
                  backgroundColor: styles.panelBg,
                  border: styles.panelBorder,
                  borderRadius: styles.radius,
                  color: colors.text,
                  backdropFilter: "blur(4px)"
                }}
              >
                <div><span style={{ color: colors.accent2 }}>$LAB</span> 4,520</div>
                <div>KILLS: 14</div>
                <div style={{ color: colors.muted }}>04:12</div>
              </div>

              {/* Bottom Center: Ability Bar */}
              <div 
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2"
                style={{
                  backgroundColor: styles.panelBg,
                  border: styles.panelBorder,
                  borderRadius: styles.radius,
                  backdropFilter: "blur(4px)"
                }}
              >
                {[
                  { hot: "LMB", ready: true },
                  { hot: "SPC", ready: true },
                  { hot: "Q", ready: false, cd: "2.4" },
                  { hot: "E", ready: true },
                  { hot: "R", ready: true },
                ].map((ab, i) => (
                  <div 
                    key={i}
                    className="w-10 h-10 relative flex items-center justify-center bg-black/50"
                    style={{
                      border: `1px solid ${ab.ready ? colors.border : colors.muted}`,
                      borderRadius: Math.min(styles.radius, 4),
                      opacity: ab.ready ? 1 : 0.6
                    }}
                  >
                    <div className="w-4 h-4" style={{ backgroundColor: colors.muted, borderRadius: '50%' }} />
                    <span className="absolute bottom-0 right-1 text-[8px]" style={{ color: colors.accent1 }}>{ab.hot}</span>
                    {!ab.ready && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] font-bold" style={{ color: colors.text }}>
                        {ab.cd}
                      </div>
                    )}
                  </div>
                ))}
              </div>

            </div>
          </div>

          {/* SECONDARY OVERWORLD STRIP */}
          <div className="relative w-full h-24 overflow-hidden border-b flex-shrink-0" style={{ borderColor: colors.border }}>
            <img 
              src={images.overworld} 
              alt={`${dir.name} Overworld Scene`} 
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Overlay Minimap */}
            <div className="absolute top-2 right-2 p-1 bg-black/60 border border-white/10" style={{ borderRadius: styles.radius, backdropFilter: "blur(2px)" }}>
              <div className="w-16 h-16 border border-white/20 relative overflow-hidden" style={{ borderRadius: Math.max(0, styles.radius - 2) }}>
                 <div className="absolute inset-0 bg-white/5 opacity-50" />
                 <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: colors.accent1, borderRadius: '50%' }} />
                 <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-white/50 rounded-full" />
                 <div className="absolute bottom-1/3 right-1/4 w-2 h-2" style={{ border: `1px solid ${colors.accent2}`, borderRadius: '50%' }} />
              </div>
            </div>
            <div className="absolute bottom-2 left-3 text-[9px] uppercase tracking-widest bg-black/60 px-2 py-0.5" style={{ color: colors.text, borderRadius: styles.radius }}>
              Overworld · Realm 1
            </div>
          </div>

          {/* SWATCHES & BUTTONS */}
          <div className="p-4 flex flex-col md:flex-row items-center justify-between gap-4 bg-black/20">
            
            <div className="flex gap-2">
              {[colors.bg, colors.panel, colors.border, colors.accent1, colors.accent2, colors.text].map((c, i) => (
                <div 
                  key={i} 
                  className="w-6 h-6 border shadow-sm"
                  style={{ backgroundColor: c, borderColor: 'rgba(255,255,255,0.1)', borderRadius: Math.min(styles.radius, 4) }}
                  title={c}
                />
              ))}
            </div>

            <div className="flex gap-3 text-xs" style={{ fontFamily: fonts.ui }}>
              <button 
                className="px-6 py-2 transition-transform active:scale-95"
                style={{ ...styles.buttonSecondary }}
              >
                Cancel
              </button>
              <button 
                className="px-6 py-2 transition-transform active:scale-95"
                style={{ ...styles.buttonPrimary }}
              >
                Deploy Labyrinth
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}