---
name: Labyrinths world search
description: How "find/jump to a labyrinth" works in the streaming overworld.
---
# World search & camera focus

Search is a dedicated server lookup (`/overworld/search?q=`), NOT a scan of streamed
chunks — the camera only streams plots near the viewport, so a far labyrinth must be
found server-side. It matches name OR owner displayName (case-insensitive), reuses
`ensureAllPlots()` for coordinates, and ranks name-hits before owner-only hits.

**Why:** the world is unbounded/streaming; you cannot rely on `ChunkStreamer.entrances`
to contain anything outside the current view.

**How to apply:** to "jump to" any plot, set a camera-focus override
(`focusRef` in OverworldMap) that eases the camera toward a world point INSTEAD of
tracking the player. The render loop normally does `cam.x = s.px`; the focus branch
overrides that. Manual movement (WASD/click) and closing the popup clear the focus so
the camera hands back to the player. Search input must set `chatFocusedRef` on focus
so movement keys aren't swallowed as gameplay input.
