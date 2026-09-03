---
name: Labyrinths tile rooms & assembler
description: How handcrafted tile-grid dungeon rooms coexist with legacy rect chambers, and the rules the seeded assembler must respect.
---

# Tile rooms vs legacy rect chambers
Chambers can be EITHER legacy (rect obstacles only) OR tile-grid (authored ASCII room). They are mutually exclusive on the client: the tile renderer + `hitsSolid()` collision activate only when `chamber.tiles` is present; the legacy obstacle render/collision path is gated to `!tiles`. Never mix — a tile chamber must carry its own walls/doors as tiles+derived rects, not legacy obstacles.

**Why:** all new tile fields (`tiles`,`hazardZones`,`doors`,`role`,`sizeClass`) are additive/nullable so old runs keep working; the gate is what preserves backward compatibility.

# Authoring rooms (rooms.ts)
ASCII alphabet: `.`floor `#`wall `^`hazard `~`water `o`decor-wall `+`door `,`decor. Glyphs S=player start, E=portal/exit, A/L/B/N/C/P=enemy variants. Every authored room MUST have exactly one S and one E or runs break. Rows must be equal width — ragged rows get padded with `#`, which can silently wall off spawns. Walls = `#`+`o` merged into collision rects via mergeRuns; doors/hazards merged separately.

# Assembler (chambers.ts)
Deterministic mulberry32 seeded by `lab.id` → same lab always yields the same run; different labs differ. Role arc = entry → body(combat/gauntlet/hazard) → treasure → finale(boss only if bossActive). Non-repeating within a run. Depth gates max size rank (shallow labs can't roll large rooms). Difficulty ramps per chamber index.

**How to apply:** when adding rooms, set role+sizeClass so the arc builder can place them; re-run seed after edits. When changing the assembler, keep it seeded by lab.id or per-lab distinctness/determinism breaks.
