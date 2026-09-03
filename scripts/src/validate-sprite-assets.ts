/**
 * CI-style validation for layered character art.
 *
 * For every item in the generated gear catalog, this confirms that each
 * `spriteLayers` overlay:
 *   1. resolves to a real file under artifacts/labyrinths/public/game/lpc
 *   2. has the expected LPC geometry (832x1344, 64px cells)
 *   3. is present in generated_manifest.json (the approved allowlist)
 *
 * Fails loudly (exit code 1) listing every missing or mismatched asset so a
 * typo'd path, a missing PNG, or a wrong-size sheet is caught before it ships
 * as a silently broken character in-game.
 *
 * Run with: pnpm --filter @workspace/scripts run validate:sprites
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";

/** Minimal shape of a catalog template — only the fields this check reads. */
interface SpriteTemplate {
  key: string;
  spriteLayers?: Record<string, string>;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const LABYRINTHS_PUBLIC = join(REPO_ROOT, "artifacts", "labyrinths", "public");
const LPC_ROOT = join(LABYRINTHS_PUBLIC, "game", "lpc");
const MANIFEST_PATH = join(LPC_ROOT, "generated_manifest.json");

// Expected LPC universal sheet geometry.
const EXPECTED_WIDTH = 832;
const EXPECTED_HEIGHT = 1344;
const CELL = 64;

interface ManifestEntry {
  file: string;
}

interface Problem {
  itemKey: string;
  layerKey: string;
  path: string;
  reason: string;
}

/** Read a PNG's pixel dimensions from its IHDR header without any image lib. */
function readPngSize(absPath: string): { width: number; height: number } {
  const buf = readFileSync(absPath);
  // PNG signature (8 bytes) + 4-byte length + 4-byte "IHDR" type, then width/height.
  const sig = "\x89PNG\r\n\x1a\n";
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig.charCodeAt(i)) {
      throw new Error("not a valid PNG (bad signature)");
    }
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a valid PNG (missing IHDR)");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Decode a non-interlaced 8-bit RGBA (PNG color type 6) sheet's alpha channel.
 * Returns a `width*height` Uint8Array of alpha bytes. Only the formats the
 * project's committed sheets actually use are supported; anything else throws so
 * a surprise re-export can't slip past unchecked.
 */
function decodeRgbaAlpha(absPath: string): {
  width: number;
  height: number;
  alpha: Uint8Array;
} {
  const buf = readFileSync(absPath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}); expected 8-bit RGBA, non-interlaced`,
    );
  }

  // Concatenate every IDAT chunk's data, then inflate.
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const dataStart = off + 8;
    if (type === "IDAT") idat.push(buf.subarray(dataStart, dataStart + len));
    if (type === "IEND") break;
    off = dataStart + len + 4; // skip data + CRC
  }
  const raw = inflateSync(Buffer.concat(idat));

  const bpp = 4; // RGBA
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0; // left
      const b = y > 0 ? out[prevStart + x] : 0; // up
      const c = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0; // up-left
      let val: number;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          val = rawByte + pred;
          break;
        }
        default: throw new Error(`unknown PNG row filter ${filter}`);
      }
      out[rowStart + x] = val & 0xff;
    }
  }

  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = out[i * bpp + 3];
  return { width, height, alpha };
}

/**
 * Validate the runtime weapon overlay sheets (the hand-curated `weapon_fg`
 * sprites under game/lpc/weapon/). Beyond geometry, every weapon must carry
 * non-empty pixels in EACH of the four walk rows (8=up, 9=left, 10=down,
 * 11=right) and EACH of the four slash rows (12-15), so an equipped weapon is
 * visible facing every direction while walking AND swings during the slash
 * attack instead of vanishing. Checking per-direction (not just per-band)
 * catches the case where a sheet only filled one facing. Both walk and slash
 * rows are produced/filled by `tools/sprite-pipeline/gen_weapon_slash.py`; this
 * guards against shipping a weapon that disappears for some facing.
 */
function checkWeaponOverlays(problems: Problem[]): number {
  const weaponDir = join(LPC_ROOT, "weapon");
  let files: string[];
  try {
    files = readdirSync(weaponDir).filter((f) => f.endsWith(".png"));
  } catch {
    return 0; // no weapon overlays in this project — nothing to check
  }
  const rowHasAlpha = (
    alpha: Uint8Array,
    width: number,
    row: number,
  ): boolean => {
    const from = row * CELL * width;
    const to = Math.min(alpha.length, (row + 1) * CELL * width);
    for (let i = from; i < to; i++) if (alpha[i] !== 0) return true;
    return false;
  };
  const DIRS = ["up", "left", "down", "right"] as const;
  const WALK_ROW = { up: 8, left: 9, down: 10, right: 11 } as const;
  const SLASH_ROW = { up: 12, left: 13, down: 14, right: 15 } as const;

  for (const file of files) {
    const rel = `game/lpc/weapon/${file}`;
    const abs = join(weaponDir, file);
    const add = (reason: string) =>
      problems.push({ itemKey: "weapon-overlay", layerKey: file, path: rel, reason });

    let size: { width: number; height: number };
    try {
      size = readPngSize(abs);
    } catch (err) {
      add(`file unreadable (${(err as Error).message})`);
      continue;
    }
    if (size.width !== EXPECTED_WIDTH || size.height !== EXPECTED_HEIGHT) {
      add(`wrong geometry ${size.width}x${size.height}, expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`);
      continue;
    }

    let decoded: { width: number; height: number; alpha: Uint8Array };
    try {
      decoded = decodeRgbaAlpha(abs);
    } catch (err) {
      add(`could not decode pixels (${(err as Error).message})`);
      continue;
    }
    const { width, alpha } = decoded;
    const missingWalk = DIRS.filter((d) => !rowHasAlpha(alpha, width, WALK_ROW[d]));
    const missingSlash = DIRS.filter((d) => !rowHasAlpha(alpha, width, SLASH_ROW[d]));
    if (missingWalk.length > 0) {
      add(
        `walk row(s) empty for facing ${missingWalk.join(", ")} — weapon ` +
          "invisible while facing those directions; run " +
          "tools/sprite-pipeline/gen_weapon_slash.py",
      );
    }
    if (missingSlash.length > 0) {
      add(
        `slash row(s) empty for facing ${missingSlash.join(", ")} — weapon ` +
          "vanishes during the attack; run " +
          "tools/sprite-pipeline/gen_weapon_slash.py",
      );
    }
  }
  return files.length;
}

async function loadTemplates(): Promise<SpriteTemplate[]> {
  // Computed specifier so tsc doesn't statically resolve the cross-package .ts
  // file; tsx loads it fine at runtime.
  const catalogUrl = new URL(
    "../../artifacts/api-server/src/data/generatedCatalog.ts",
    import.meta.url,
  ).href;
  const mod = (await import(catalogUrl)) as {
    GENERATED_TEMPLATES: SpriteTemplate[];
  };
  return mod.GENERATED_TEMPLATES;
}

async function main(): Promise<void> {
  const GENERATED_TEMPLATES = await loadTemplates();
  const manifest: ManifestEntry[] = JSON.parse(
    readFileSync(MANIFEST_PATH, "utf8"),
  );
  const allowlist = new Set(manifest.map((e) => e.file));

  const problems: Problem[] = [];
  let layersChecked = 0;
  let itemsWithLayers = 0;

  for (const item of GENERATED_TEMPLATES) {
    if (!item.spriteLayers) continue;
    itemsWithLayers++;

    for (const [layerKey, relPath] of Object.entries(item.spriteLayers)) {
      layersChecked++;
      const add = (reason: string) =>
        problems.push({ itemKey: item.key, layerKey, path: relPath, reason });

      // 1. allowlist membership
      if (!allowlist.has(relPath)) {
        add("not present in generated_manifest.json (approved allowlist)");
      }

      // 2. path must live under game/lpc
      if (!relPath.startsWith("game/lpc/")) {
        add("path is not under game/lpc/");
        continue;
      }

      // 3. file must exist + 4. geometry must match
      const absPath = join(LABYRINTHS_PUBLIC, relPath);
      let size: { width: number; height: number };
      try {
        size = readPngSize(absPath);
      } catch (err) {
        add(`file missing or unreadable (${(err as Error).message})`);
        continue;
      }

      if (size.width !== EXPECTED_WIDTH || size.height !== EXPECTED_HEIGHT) {
        add(
          `wrong geometry ${size.width}x${size.height}, expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`,
        );
      } else if (size.width % CELL !== 0 || size.height % CELL !== 0) {
        add(`sheet not divisible into ${CELL}px cells`);
      }
    }
  }

  const weaponsChecked = checkWeaponOverlays(problems);

  console.log(
    `Checked ${layersChecked} sprite layer(s) across ${itemsWithLayers} catalog item(s) ` +
      `against ${allowlist.size} allowlisted asset(s); ` +
      `verified ${weaponsChecked} weapon overlay sheet(s) carry walk + slash rows.`,
  );

  if (problems.length > 0) {
    console.error(
      `\n\u2717 Sprite asset validation FAILED — ${problems.length} problem(s):\n`,
    );
    for (const p of problems) {
      console.error(
        `  [${p.itemKey} :: ${p.layerKey}] ${p.path}\n      -> ${p.reason}`,
      );
    }
    console.error(
      "\nFix the catalog paths or regenerate the assets/manifest, then re-run.",
    );
    process.exit(1);
  }

  console.log("\u2713 All character art resolves, matches LPC geometry, and is allowlisted.");
}

main().catch((err) => {
  console.error("Sprite asset validation crashed:", err);
  process.exit(1);
});
