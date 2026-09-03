import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const outFile = path.resolve(artifactDir, "dist-seed/seed.mjs");
  await rm(path.resolve(artifactDir, "dist-seed"), { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/seed.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: outFile,
    logLevel: "info",
    external: ["*.node", "pg-native"],
    banner: {
      js: `import { createRequire as __cr } from 'node:module';
globalThis.require = __cr(import.meta.url);`,
    },
  });

  await import(pathToFileURL(outFile).href);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
