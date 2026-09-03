# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Robinhood Chain is the launch network: mainnet chain ID 4663, testnet chain ID 46630, and ETH is the native gas token.
- Wallet sign-in uses EIP-191 personal signatures over a single-use, five-minute challenge. The server recovers the signer and atomically consumes the challenge before creating a session.
- Gameplay currency remains integer-based and server-authoritative. Until audited token contracts are configured, Robinhood settlement is represented by a custodial ledger rather than fabricated on-chain hashes.
- The legacy settlement table is retained during the first schema migration so existing transaction history remains readable; publish-time schema migration can rename it after review.

## Product

Labyrinths is a fantasy overworld and dungeon game where players connect an EVM wallet, build labyrinths, run one another's dungeons, and earn integer-accounted game currency.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Robinhood Chain mainnet is the default in every environment. Set `ROBINHOOD_CHAIN_ENV=testnet` only for explicit testnet testing. Configure audited token and treasury addresses with `ROBINHOOD_LAB_TOKEN_ADDRESS`, `ROBINHOOD_USDC_ADDRESS`, and `ROBINHOOD_TREASURY_ADDRESS` only when they are approved.
- Existing player rows and balances are not rewritten by wallet sign-in. A reversible migration is to export the legacy users/balances, link each verified EVM wallet through an explicit account-linking flow, and restore the export if a link is rejected; no automatic address guessing is performed.
- `ALLOW_MOCK_WALLET_AUTH=true` is development-only and is ignored in production. It is the only mode in which fixture wallets can be exposed.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
