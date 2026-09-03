import React, { useEffect } from "react";

import obsidianFloor from "@/assets/inengine/obsidian/floor.png";
import obsidianWall from "@/assets/inengine/obsidian/wall.png";
import obsidianHero from "@/assets/inengine/obsidian/hero.png";
import obsidianGrunt from "@/assets/inengine/obsidian/grunt.png";
import obsidianCaster from "@/assets/inengine/obsidian/caster.png";
import obsidianBoss from "@/assets/inengine/obsidian/boss.png";
import obsidianPortal from "@/assets/inengine/obsidian/portal.png";
import obsidianProp from "@/assets/inengine/obsidian/prop.png";
import obsidianLoot from "@/assets/inengine/obsidian/loot.png";

import arcaneFloor from "@/assets/inengine/arcane/floor.png";
import arcaneHero from "@/assets/inengine/arcane/hero.png";
import arcaneGrunt from "@/assets/inengine/arcane/grunt.png";
import arcaneCaster from "@/assets/inengine/arcane/caster.png";
import arcaneBoss from "@/assets/inengine/arcane/boss.png";
import arcanePortal from "@/assets/inengine/arcane/portal.png";
import arcaneProp from "@/assets/inengine/arcane/prop.png";
import arcaneLoot from "@/assets/inengine/arcane/loot.png";

import stormveilFloor from "@/assets/inengine/stormveil/floor.png";
import stormveilHero from "@/assets/inengine/stormveil/hero.png";
import stormveilGrunt from "@/assets/inengine/stormveil/grunt.png";
import stormveilCaster from "@/assets/inengine/stormveil/caster.png";
import stormveilBoss from "@/assets/inengine/stormveil/boss.png";
import stormveilPortal from "@/assets/inengine/stormveil/portal.png";
import stormveilProp from "@/assets/inengine/stormveil/prop.png";

function injectFonts() {
  const id = "inengine-directions-fonts";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=Orbitron:wght@400;600;800&family=Rajdhani:wght@400;500;600;700&family=Syncopate:wght@400;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=Space+Grotesk:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap";
  document.head.appendChild(link);
}

type Spr = {
  src: string;
  /** percent-based positioning within the scene */
  left: string;
  top: string;
  w: number;
  z?: number;
  flip?: boolean;
  filter?: string;
  opacity?: number;
};

function Sprite({ src, left, top, w, z = 1, flip, filter, opacity }: Spr) {
  return (
    <img
      src={src}
      alt=""
      className="absolute object-contain pointer-events-none -translate-x-1/2 -translate-y-1/2"
      style={{
        left,
        top,
        width: w,
        zIndex: z,
        opacity,
        transform: `translate(-50%,-50%)${flip ? " scaleX(-1)" : ""}`,
        filter,
      }}
    />
  );
}

function floorBg(src: string, size: number): React.CSSProperties {
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: `${size}px ${size}px`,
    backgroundRepeat: "repeat",
  };
}

/* ============================================================= */
/* PAGE                                                          */
/* ============================================================= */

export default function InEngineDirections() {
  useEffect(() => {
    injectFonts();
  }, []);

  return (
    <div className="min-h-screen bg-[#070708] text-white p-5 md:p-10 overflow-x-hidden">
      <div className="max-w-[1400px] mx-auto">
        <header className="text-center space-y-3 max-w-3xl mx-auto mb-14">
          <p className="text-[#a3c2c2] text-[11px] font-bold tracking-[0.35em] uppercase">
            Labyrinths · Art Direction Study
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Three Distinct Games</h1>
          <p className="text-gray-400 text-sm md:text-base leading-relaxed">
            Not one template with three palettes. Each direction is its own{" "}
            <strong className="text-gray-200">camera scale</strong>,{" "}
            <strong className="text-gray-200">HUD architecture</strong>, and{" "}
            <strong className="text-gray-200">framing</strong> — yet all are built from the same honest
            engine primitives: a repeating tiled floor, individual transparent sprites, and CSS lighting.
            Pick the <em>game</em>, not the color.
          </p>
        </header>

        <div className="flex flex-col gap-20">
          <ObsidianForge />
          <ArcaneCircuit />
          <Stormveil />
        </div>
      </div>
    </div>
  );
}

/* ============================================================= */
/* SECTION HEADER                                                */
/* ============================================================= */

function SectionHead({
  name,
  pitch,
  paradigm,
  feasibility,
  font,
  accent,
}: {
  name: string;
  pitch: string;
  paradigm: string;
  feasibility: string;
  font: string;
  accent: string;
}) {
  return (
    <div className="space-y-2 mb-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-3xl" style={{ fontFamily: font, color: accent }}>
          {name}
        </h2>
        <span className="text-[11px] uppercase tracking-[0.25em] text-gray-400">{paradigm}</span>
      </div>
      <p className="text-sm text-gray-400 italic">{pitch}</p>
      <p className="text-[11px] text-gray-500">
        <span className="text-gray-300 font-semibold not-italic">In-engine:</span> {feasibility}
      </p>
    </div>
  );
}

/* ============================================================= */
/* 1. OBSIDIAN FORGE — ARPG (Diablo-style)                        */
/*    Tight camera · ornate framed HUD · HP/MP orbs + skill belt  */
/* ============================================================= */

function ObsidianForge() {
  const accent = "#e25822";
  const gold = "#d4af37";
  const heading = "'Cinzel Decorative', serif";
  const ui = "'Cinzel', serif";

  return (
    <section>
      <SectionHead
        name="Obsidian Forge"
        pitch="Forged in fire and shadow — brutal, weighty, dangerous loot-hunting."
        paradigm="ARPG · loot crawler"
        feasibility="Tight top-down camera with large sprites. Ornate frame art is a 9-slice border image; orbs and belt are CSS. Fully shippable."
        font={heading}
        accent={accent}
      />

      <div
        className="relative overflow-hidden"
        style={{
          border: "2px solid #3a2a24",
          borderRadius: 4,
          boxShadow: "0 20px 50px rgba(0,0,0,0.7)",
          background: "#0a0807",
        }}
      >
        {/* SCENE — tight camera, big sprites */}
        <div className="relative w-full aspect-[16/9]" style={floorBg(obsidianFloor, 150)}>
          {/* stone wall frame */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ border: "26px solid transparent", borderImage: `url(${obsidianWall}) 34 round` }}
          />
          {/* torch light pools */}
          <div
            className="absolute inset-0 pointer-events-none mix-blend-screen"
            style={{
              background:
                "radial-gradient(circle at 22% 38%, rgba(226,88,34,0.30), transparent 22%), radial-gradient(circle at 80% 34%, rgba(226,88,34,0.28), transparent 22%), radial-gradient(circle at 50% 78%, rgba(255,150,60,0.22), transparent 35%)",
            }}
          />
          {/* vignette */}
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_60%,transparent_18%,rgba(0,0,0,0.9)_95%)]" />

          {/* sprites — few, large, dramatic */}
          <Sprite src={obsidianBoss} left="50%" top="30%" w={230} z={4} filter="drop-shadow(0 12px 18px rgba(0,0,0,0.8))" />
          <Sprite src={obsidianPortal} left="16%" top="26%" w={92} z={2} filter={`drop-shadow(0 0 16px ${accent})`} />
          <Sprite src={obsidianProp} left="83%" top="60%" w={60} z={2} />
          <Sprite src={obsidianCaster} left="72%" top="50%" w={96} z={3} flip />
          <Sprite src={obsidianGrunt} left="36%" top="56%" w={104} z={3} />
          <Sprite src={obsidianHero} left="50%" top="72%" w={128} z={6} filter="drop-shadow(0 8px 10px rgba(0,0,0,0.7))" />
          <Sprite src={obsidianLoot} left="26%" top="82%" w={46} z={3} filter={`drop-shadow(0 0 10px ${gold})`} />

          {/* floating damage numbers */}
          <span className="absolute font-bold text-2xl" style={{ left: "46%", top: "44%", color: "#ffd36b", fontFamily: ui, textShadow: "0 2px 4px #000", zIndex: 7 }}>
            1,284
          </span>
          <span className="absolute font-bold text-lg" style={{ left: "64%", top: "52%", color: "#ff6a4a", fontFamily: ui, textShadow: "0 2px 4px #000", zIndex: 7 }}>
            452
          </span>

          {/* slash fx */}
          <svg className="absolute pointer-events-none" style={{ left: "40%", top: "60%", width: 150, height: 150, transform: "translate(-50%,-50%)", zIndex: 5 }} viewBox="0 0 100 100">
            <path d="M8,88 Q52,38 92,12" fill="none" stroke={accent} strokeWidth="3" style={{ filter: `drop-shadow(0 0 5px ${accent})` }} />
            <path d="M14,93 Q56,45 96,18" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.85" />
          </svg>

          {/* ---- ORNATE HUD ---- */}
          {/* top-left portrait plate */}
          <div className="absolute top-4 left-5 flex items-center gap-2 px-2.5 py-1.5" style={{ background: "linear-gradient(180deg,#241c18,#120d0b)", border: "2px solid #4a352a", borderRadius: 3, fontFamily: ui, zIndex: 10 }}>
            <div className="w-10 h-10 flex items-center justify-center text-sm font-bold" style={{ background: "#000", border: `1px solid ${gold}`, color: accent }}>W</div>
            <div className="leading-tight">
              <div className="text-[11px] tracking-wide text-[#e8dcc8]">WARDEN</div>
              <div className="text-[9px]" style={{ color: gold }}>LEVEL 32 · WARLORD</div>
            </div>
          </div>

          {/* top-right resources */}
          <div className="absolute top-4 right-5 text-right px-3 py-1.5 text-[11px] leading-snug" style={{ background: "linear-gradient(180deg,#241c18,#120d0b)", border: "2px solid #4a352a", borderRadius: 3, fontFamily: ui, color: "#e8dcc8", zIndex: 10 }}>
            <div><span style={{ color: gold }}>◈ 4,520</span> $LAB</div>
            <div className="text-[#caa15a]">⚔ 14 KILLS · 04:12</div>
          </div>

          {/* bottom-right ornate minimap */}
          <div className="absolute bottom-4 right-5 w-28 h-24 p-1.5" style={{ background: "rgba(10,8,7,0.85)", border: "2px solid #4a352a", borderRadius: 3, zIndex: 10 }}>
            <div className="w-full h-full relative" style={{ ...floorBg(obsidianFloor, 40), filter: "brightness(0.5) sepia(0.4)" }}>
              <span className="absolute w-1.5 h-1.5 rounded-full" style={{ left: "50%", top: "55%", background: accent, boxShadow: `0 0 5px ${accent}` }} />
              <span className="absolute w-1.5 h-1.5 rounded-full" style={{ left: "48%", top: "25%", background: "#c41e3a" }} />
            </div>
          </div>

          {/* bottom HUD: HP orb | skill belt | MP orb */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-end gap-3" style={{ zIndex: 10 }}>
            {/* HP orb */}
            <Orb fill="72%" inner="radial-gradient(circle at 50% 22%, #ff5a48, #8b0000)" label="HP" />
            {/* skill belt */}
            <div className="flex gap-1.5 p-1.5" style={{ background: "linear-gradient(180deg,#2a201b,#100b09)", border: "2px solid #4a352a", borderRadius: 3 }}>
              {[
                { k: "LMB", ready: true },
                { k: "SPC", ready: true },
                { k: "Q", ready: false, cd: "2.4" },
                { k: "E", ready: true },
                { k: "R", ready: false, cd: "9" },
              ].map((s, i) => (
                <div key={i} className="relative w-11 h-11 flex items-center justify-center" style={{ background: "#06040399", border: `1px solid ${s.ready ? gold : "#5a4a3a"}`, borderRadius: 2 }}>
                  <div className="w-4 h-4 rounded-full" style={{ background: s.ready ? accent : "#5a4a3a", boxShadow: s.ready ? `0 0 6px ${accent}` : "none" }} />
                  <span className="absolute bottom-0 right-1 text-[8px]" style={{ color: gold, fontFamily: ui }}>{s.k}</span>
                  {!s.ready && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-sm font-bold" style={{ color: "#e8dcc8", fontFamily: ui }}>{s.cd}</div>
                  )}
                </div>
              ))}
            </div>
            {/* MP orb */}
            <Orb fill="48%" inner="radial-gradient(circle at 50% 22%, #ffb24a, #b8480f)" label="MP" />
          </div>
        </div>

        {/* MENU TREATMENT — ornate inventory / forge drawer */}
        <div className="px-5 py-4 flex flex-wrap items-center gap-4" style={{ borderTop: "2px solid #3a2a24", background: "linear-gradient(180deg,#16100d,#0a0706)", fontFamily: ui }}>
          <span className="text-[11px] uppercase tracking-[0.3em]" style={{ color: gold }}>The Forge</span>
          <div className="flex gap-1.5">
            {[gold, "#7a6a55", accent, "#5a4a3a", "#7a6a55", gold].map((c, i) => (
              <div key={i} className="w-11 h-11 flex items-center justify-center" style={{ background: "#0c0807", border: `1px solid ${c}`, borderRadius: 2 }}>
                <img src={i % 2 === 0 ? obsidianLoot : obsidianProp} alt="" className="w-7 h-7 object-contain" />
              </div>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button className="px-4 py-2 text-[11px] uppercase tracking-widest" style={{ background: "#181210", border: "1px solid #4a352a", color: "#a49b91", borderRadius: 2 }}>Salvage</button>
            <button className="px-4 py-2 text-[11px] uppercase tracking-widest" style={{ background: "linear-gradient(180deg,#8a2b0d,#521805)", border: `1px solid ${accent}`, color: "#f4e0c4", borderRadius: 2 }}>Reforge Item</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Orb({ fill, inner, label }: { fill: string; inner: string; label: string }) {
  return (
    <div className="relative w-[72px] h-[72px] rounded-full overflow-hidden" style={{ border: "3px solid #4a352a", boxShadow: "inset 0 0 14px rgba(0,0,0,0.85), 0 4px 10px rgba(0,0,0,0.6)" }}>
      <div className="absolute left-0 right-0 bottom-0" style={{ height: fill, background: inner }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 34% 28%, rgba(255,255,255,0.4), transparent 50%)" }} />
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tracking-widest text-white/80" style={{ fontFamily: "'Cinzel', serif", textShadow: "0 1px 2px #000" }}>{label}</span>
    </div>
  );
}

/* ============================================================= */
/* 2. ARCANE CIRCUIT — competitive MOBA / esports                */
/*    Zoomed-out tactical camera · scorebar · leaderboard        */
/* ============================================================= */

function ArcaneCircuit() {
  const cyan = "#00f0ff";
  const magenta = "#ff2bd6";
  const heading = "'Syncopate', sans-serif";
  const ui = "'Rajdhani', sans-serif";
  const mono = "'Space Mono', monospace";

  const gridOverlay =
    "linear-gradient(rgba(0,240,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.10) 1px, transparent 1px)";

  return (
    <section>
      <SectionHead
        name="Arcane Circuit"
        pitch="Occult tech and rune-light — sleek, readable, competitive at a glance."
        paradigm="MOBA · esports arena"
        feasibility="Zoomed-out tactical camera (small sprites, more of them). Grid + targeting reticles are CSS/SVG drawn on the floor. Cheapest to make pop. Shippable."
        font={heading}
        accent={cyan}
      />

      <div className="relative overflow-hidden" style={{ border: `1px solid ${cyan}55`, boxShadow: `0 0 40px ${cyan}18`, background: "#04020c" }}>
        {/* top scorebar — full width, diegetic */}
        <div className="flex items-center justify-center gap-6 px-4 py-2" style={{ background: "linear-gradient(180deg,#0a0820,#05030f)", borderBottom: `1px solid ${cyan}33`, fontFamily: ui }}>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: cyan }}>
            <span className="w-2.5 h-2.5" style={{ background: cyan, boxShadow: `0 0 8px ${cyan}` }} /> BLUE
          </div>
          <div className="text-2xl font-bold tracking-widest" style={{ fontFamily: mono }}>
            <span style={{ color: cyan }}>12</span>
            <span className="text-gray-600 mx-2">:</span>
            <span style={{ color: magenta }}>09</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: magenta }}>
            VOID <span className="w-2.5 h-2.5" style={{ background: magenta, boxShadow: `0 0 8px ${magenta}` }} />
          </div>
          <div className="mx-4 px-3 py-0.5 text-[11px] tracking-[0.25em] uppercase" style={{ border: `1px solid ${cyan}44`, color: "#bfefff" }}>
            ◆ Hold the Core · 04:12
          </div>
        </div>

        <div className="flex">
          {/* SCENE — wide tactical view */}
          <div className="relative flex-1 aspect-[16/10]" style={floorBg(arcaneFloor, 84)}>
            {/* rune grid overlay */}
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: gridOverlay, backgroundSize: "42px 42px" }} />
            {/* ambient glow + scanline vignette */}
            <div className="absolute inset-0 pointer-events-none mix-blend-screen" style={{ background: `radial-gradient(circle at 50% 40%, ${cyan}22, transparent 55%)` }} />
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_30%,rgba(2,1,8,0.85)_100%)]" />

            {/* ground targeting reticle (AoE) */}
            <svg className="absolute pointer-events-none" style={{ left: "58%", top: "62%", width: 150, height: 75, transform: "translate(-50%,-50%)", zIndex: 2 }} viewBox="0 0 100 50">
              <ellipse cx="50" cy="25" rx="46" ry="20" fill={`${magenta}1a`} stroke={magenta} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            {/* hero range indicator */}
            <svg className="absolute pointer-events-none" style={{ left: "40%", top: "70%", width: 170, height: 85, transform: "translate(-50%,-50%)", zIndex: 2 }} viewBox="0 0 100 50">
              <ellipse cx="50" cy="25" rx="48" ry="22" fill="none" stroke={`${cyan}66`} strokeWidth="1" />
            </svg>

            {/* many small units — tactical density */}
            <Sprite src={arcaneBoss} left="58%" top="30%" w={120} z={4} filter={`drop-shadow(0 0 12px ${magenta})`} />
            <Sprite src={arcanePortal} left="16%" top="22%" w={62} z={2} filter={`drop-shadow(0 0 10px ${cyan})`} />
            <Sprite src={arcanePortal} left="86%" top="24%" w={54} z={2} filter={`drop-shadow(0 0 10px ${magenta})`} opacity={0.9} />
            <Sprite src={arcaneProp} left="30%" top="40%" w={40} z={2} />
            <Sprite src={arcaneProp} left="74%" top="48%" w={40} z={2} />
            <Sprite src={arcaneGrunt} left="46%" top="46%" w={58} z={3} />
            <Sprite src={arcaneGrunt} left="64%" top="52%" w={58} z={3} flip />
            <Sprite src={arcaneGrunt} left="52%" top="58%" w={58} z={3} />
            <Sprite src={arcaneCaster} left="78%" top="40%" w={64} z={3} flip />
            <Sprite src={arcaneHero} left="40%" top="70%" w={70} z={6} filter={`drop-shadow(0 0 10px ${cyan})`} />
            <Sprite src={arcaneLoot} left="24%" top="78%" w={34} z={3} />

            {/* damage / ping */}
            <span className="absolute text-base font-bold" style={{ left: "55%", top: "44%", color: cyan, fontFamily: mono, textShadow: `0 0 6px ${cyan}`, zIndex: 7 }}>-318</span>

            {/* compact player chip (top-left, no rail) */}
            <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1" style={{ background: "rgba(8,6,24,0.7)", border: `1px solid ${cyan}44`, backdropFilter: "blur(4px)", fontFamily: ui, zIndex: 10 }}>
              <div className="w-8 h-8 flex items-center justify-center text-xs font-bold" style={{ background: "#000", border: `1px solid ${cyan}`, color: cyan }}>W</div>
              <div className="leading-tight">
                <div className="text-[11px] text-[#bfefff]">WARDEN <span style={{ color: cyan }}>9/2/14</span></div>
                <div className="w-28 h-1 mt-1 bg-black/60"><div className="h-full" style={{ width: "75%", background: cyan }} /></div>
                <div className="w-28 h-0.5 mt-0.5 bg-black/60"><div className="h-full" style={{ width: "40%", background: magenta }} /></div>
              </div>
            </div>

            {/* bottom-center cooldown skill bar */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5" style={{ zIndex: 10 }}>
              {[
                { k: "Q", cd: 0 },
                { k: "W", cd: 0 },
                { k: "E", cd: 220 },
                { k: "R", cd: 300 },
                { k: "D", cd: 0 },
              ].map((s, i) => (
                <div key={i} className="relative w-11 h-11 flex items-center justify-center" style={{ background: "rgba(8,6,24,0.8)", border: `1px solid ${cyan}66`, backdropFilter: "blur(4px)" }}>
                  <div className="w-4 h-4" style={{ background: s.cd ? "#33405a" : cyan, boxShadow: s.cd ? "none" : `0 0 8px ${cyan}` }} />
                  {s.cd > 0 && <div className="absolute inset-0" style={{ background: `conic-gradient(rgba(0,0,0,0.78) ${s.cd}deg, transparent 0)` }} />}
                  <span className="absolute bottom-0 right-1 text-[8px]" style={{ color: cyan, fontFamily: mono }}>{s.k}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT leaderboard rail (esports) */}
          <div className="w-52 shrink-0 p-3" style={{ background: "linear-gradient(180deg,#0a0820,#05030f)", borderLeft: `1px solid ${cyan}33`, fontFamily: ui }}>
            <div className="text-[10px] tracking-[0.3em] uppercase mb-3" style={{ color: cyan }}>Scoreboard</div>
            {[
              { n: "WARDEN", k: "9/2/14", you: true, t: cyan },
              { n: "Hexbane", k: "6/4/11", t: cyan },
              { n: "Nullspire", k: "4/5/8", t: cyan },
              { n: "Voidcaller", k: "8/3/6", t: magenta },
              { n: "Glasswing", k: "5/6/9", t: magenta },
            ].map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 mb-1" style={{ background: p.you ? `${cyan}12` : "transparent", borderLeft: `2px solid ${p.t}` }}>
                <span className="text-[12px]" style={{ color: p.you ? "#fff" : "#9fb6c9" }}>{p.n}</span>
                <span className="text-[11px]" style={{ color: p.t, fontFamily: mono }}>{p.k}</span>
              </div>
            ))}
            <div className="mt-4 text-[10px] tracking-[0.3em] uppercase mb-2" style={{ color: magenta }}>Shop</div>
            <div className="grid grid-cols-3 gap-1.5">
              {[arcaneLoot, arcaneProp, arcaneLoot, arcaneProp, arcaneLoot, arcaneProp].map((s, i) => (
                <div key={i} className="aspect-square flex items-center justify-center" style={{ background: "#06040f", border: `1px solid ${cyan}33` }}>
                  <img src={s} alt="" className="w-6 h-6 object-contain" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================= */
/* 3. STORMVEIL — cinematic Soulslike                            */
/*    Letterboxed · near-zero HUD · boss bar · fog               */
/* ============================================================= */

function Stormveil() {
  const ice = "#a3c2c2";
  const bone = "#e8e2d4";
  const heading = "'Cormorant Garamond', serif";
  const ui = "'Space Grotesk', sans-serif";

  return (
    <section>
      <SectionHead
        name="Stormveil"
        pitch="Cold, cinematic, restrained — fog, stone, and the weight of silence."
        paradigm="Soulslike · cinematic"
        feasibility="3/4 implied camera, immersive. Letterbox + fog are overlays; the only persistent HUD is thin bars + a boss bar. Most atmospheric, fewest assets. Shippable."
        font={heading}
        accent={ice}
      />

      <div className="relative overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "#0c0e12" }}>
        <div className="relative w-full aspect-[21/9]" style={floorBg(stormveilFloor, 130)}>
          {/* desaturate + cold grade */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(20,28,38,0.45)", mixBlendMode: "multiply" }} />
          {/* rolling fog layers */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(160,180,190,0.18) 0%, transparent 30%, transparent 60%, rgba(120,140,150,0.28) 100%)" }} />
          <div className="absolute inset-0 pointer-events-none mix-blend-screen" style={{ background: "radial-gradient(ellipse at 50% 35%, rgba(200,220,230,0.16), transparent 55%)" }} />
          {/* heavy cinematic vignette */}
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(0,0,0,0.92)_100%)]" />

          {/* sparse, dramatic sprites */}
          <Sprite src={stormveilPortal} left="50%" top="34%" w={86} z={2} filter={`drop-shadow(0 0 22px ${ice})`} opacity={0.85} />
          <Sprite src={stormveilBoss} left="50%" top="40%" w={210} z={4} filter="drop-shadow(0 14px 22px rgba(0,0,0,0.85)) saturate(0.7)" />
          <Sprite src={stormveilCaster} left="76%" top="58%" w={92} z={3} flip filter="saturate(0.7)" opacity={0.92} />
          <Sprite src={stormveilGrunt} left="26%" top="60%" w={96} z={3} filter="saturate(0.7)" opacity={0.92} />
          <Sprite src={stormveilHero} left="44%" top="76%" w={120} z={6} filter="drop-shadow(0 8px 12px rgba(0,0,0,0.8))" />

          {/* cinematic letterbox bars */}
          <div className="absolute top-0 left-0 right-0 h-10 bg-black pointer-events-none z-20" />
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-black pointer-events-none z-20" />

          {/* minimal HUD: thin HP + stamina (top-left, no frame) */}
          <div className="absolute top-14 left-8 space-y-1.5 z-30" style={{ fontFamily: ui }}>
            <div className="w-56 h-2" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <div className="h-full" style={{ width: "68%", background: "linear-gradient(90deg,#6e2630,#a23b46)" }} />
            </div>
            <div className="w-44 h-1.5" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.10)" }}>
              <div className="h-full" style={{ width: "52%", background: `linear-gradient(90deg,#4a6a72,${ice})` }} />
            </div>
            <div className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(232,226,212,0.5)" }}>Warden · Lv 32</div>
          </div>

          {/* faint currency, top-right */}
          <div className="absolute top-14 right-8 text-right z-30" style={{ fontFamily: ui }}>
            <div className="text-[11px] tracking-[0.2em]" style={{ color: "rgba(232,226,212,0.6)" }}>4,520 $LAB</div>
          </div>

          {/* boss healthbar — centered, restrained */}
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 w-[58%] z-30 text-center" style={{ fontFamily: heading }}>
            <div className="text-[13px] tracking-[0.35em] uppercase mb-1.5" style={{ color: bone, textShadow: "0 2px 4px #000" }}>
              The Stormveil Warden
            </div>
            <div className="h-1.5 w-full" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(232,226,212,0.25)" }}>
              <div className="h-full" style={{ width: "82%", background: "linear-gradient(90deg,#7a8a8a,#c8d4d4)" }} />
            </div>
          </div>

          {/* subtle interaction prompt */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 text-[10px] tracking-[0.3em] uppercase" style={{ color: "rgba(232,226,212,0.45)", fontFamily: ui }}>
            ✦ Press <span style={{ color: ice }}>E</span> to commune at the veil
          </div>
        </div>

        {/* MENU TREATMENT — pause screen, sparse and centered */}
        <div className="py-10 flex flex-col items-center gap-4" style={{ background: "linear-gradient(180deg,#0c0e12,#070809)" }}>
          <div className="text-[11px] tracking-[0.5em] uppercase" style={{ color: "rgba(232,226,212,0.4)", fontFamily: ui }}>Paused</div>
          <nav className="flex flex-col items-center gap-3" style={{ fontFamily: heading }}>
            {["Resume", "Loadout", "Codex", "The Forge", "Marketplace", "Abandon Run"].map((item, i) => (
              <button
                key={i}
                className="text-xl tracking-wide transition-colors"
                style={{ color: i === 0 ? bone : "rgba(232,226,212,0.45)" }}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
