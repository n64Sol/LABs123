---
name: Running one-off TS scripts in api-server
description: How to run seeds/scripts that import @workspace/db when there's no tsx
---
The api-server has no `tsx` and `@workspace/db` exports `.ts` source (not built JS), so plain `node script.ts` or `node` importing the db package fails.

**Rule:** write the script as `src/<name>.ts`, then a sibling `<name>.mjs` runner that uses esbuild (already a devDep) to `bundle` it to ESM and dynamically `import()` the output. Mirror `build.mjs`: set `globalThis.require = createRequire(...)`, `platform: "node"`, `format: "esm"`, `external: ["*.node","pg-native"]`.

**Why:** project references resolve db types to `lib/db/dist/*.d.ts` but the runtime package main points at TS source; only a bundler resolves+compiles the whole graph for execution.

**How to apply:** the seed lives at `artifacts/api-server/src/seed.ts` + `seed.mjs` (script `pnpm --filter @workspace/api-server run seed`). `pool` and `db` are exported from `@workspace/db`; call `await pool.end()` before `process.exit` or the script hangs. The dev workflow builds once (no hot reload) — restart it after route changes.

**Stale db types after schema edits:** consumers (api-server typecheck) resolve `@workspace/db` via project references to `lib/db/dist/*.d.ts`, NOT the `.ts` source the exports map points at. After editing `lib/db/src/schema/*`, rebuild the declarations with `pnpm exec tsc --build lib/db/tsconfig.json --force` or typecheck reports phantom errors (missing new tables/columns, old nullability). `drizzle-kit push` reads source directly so it can succeed while typecheck still sees stale types.
