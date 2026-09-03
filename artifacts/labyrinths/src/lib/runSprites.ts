// Sprite sheet / texture names a run needs. Shared so the entrance chamber can warm
// the browser image cache before Run.tsx mounts, making the descent seamless.
export const RUN_SPRITE_NAMES = [
  "player", "enemy_grunt", "enemy_ranged", "enemy_elite", "enemy_boss",
  "chest", "node", "rock", "portal", "slash",
  "floor_sunlit_ruins", "floor_verdant_grove", "floor_emberforge",
  "floor_crystal_caverns", "floor_astral_spire", "floor_tidecaller",
  "player_sheet", "player_sheet_up", "player_sheet_down",
];
