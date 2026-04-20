---
summary: 'Install, develop, test, build, and demo-recording commands'
read_when:
  - When bootstrapping the project
  - When running tests or probes
  - Before recording the demo
status: active
---

# Dev Commands

## Install

```bash
# First clone or after pulling new dependencies
pnpm install

# First-time husky setup
pnpm run prepare
```

## Env

Required `.env.local` (not committed; template at `.env.example`):

```dotenv
# LLM — OpenRouter Anthropic-compatible gateway (preferred), or native Anthropic key
OPENROUTER_API_KEY=sk-or-...
# ANTHROPIC_API_KEY=sk-ant-...   # fallback name, same secret

# Image gen (Google Gemini 2.5 Flash Image)
GOOGLE_GENERATIVE_AI_API_KEY=...

# IPFS pinning
PINATA_JWT=...

# Agent wallet (Base Sepolia, holds test USDC for x402 payments)
AGENT_WALLET_PRIVATE_KEY=0x...
AGENT_WALLET_ADDRESS=0x...

# BSC mainnet wallet (holds REAL BNB for four.meme token deploy, ~$1 dust)
BSC_DEPLOYER_PRIVATE_KEY=0x...
BSC_DEPLOYER_ADDRESS=0x...

# X API v2 (Phase 3+ agent auto-posting; OAuth 1.0a User Context)
X_API_KEY=...
X_API_KEY_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_TOKEN_SECRET=...
X_BEARER_TOKEN=...

# x402 (Base Sepolia facilitator default)
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_NETWORK=eip155:84532

# Dashboard demo pre-seed (optional — fills AC4's 5 pills)
DEMO_TOKEN_ADDR=0x4E39d254c716D88Ae52D9cA136F0a029c5F74444
DEMO_TOKEN_DEPLOY_TX=0x<64 hex>
DEMO_CREATOR_LORE_CID=bafkrei<rest>
```

Node 25 on the dev machine is broken (libsimdjson missing); always use Node 22:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

The same export is required before `git commit` because the pre-commit hook walks PATH.

## Dev

```bash
# 0. Start the local Postgres first — every store persists through it.
docker compose up -d postgres
# Sanity-check: `docker compose ps` should show `memind-postgres` healthy.

# AC4 dashboard mode (two terminals, web + server running in parallel)
# Terminal 1:
pnpm --filter @hack-fourmeme/server dev      # http://localhost:4000
# Terminal 2:
pnpm --filter @hack-fourmeme/web dev         # http://localhost:3000
# open http://localhost:3000 and hit "Run swarm" — POSTs /api/runs and
# streams SSE events from the server-side a2a orchestrator.
```

## Postgres (persistence layer)

```bash
# Start / stop the container
docker compose up -d postgres
docker compose stop postgres
docker compose down -v postgres        # wipes the volume (schema + data)

# Ad-hoc psql shell
docker compose exec postgres psql -U memind -d memind

# The server runs CREATE TABLE IF NOT EXISTS at boot; no migration tool.
# Tests require the same container running — `pnpm test` against a cold
# Postgres fails fast with a clear connection error.
```

Set `DATABASE_URL=postgres://memind:memind@localhost:5432/memind` in
`.env.local` (template at `.env.example`). The server refuses to boot
without a reachable database — there is no in-memory fallback.

## Test

```bash
# Full unit + integration sweep
pnpm test

# Watch mode
pnpm test:watch

# Single file
pnpm vitest run apps/server/agents/creator.test.ts
```

## Probes (Day 1 read-only diagnostics, Phase 1 hard gate)

```bash
# x402: server returns 402 → client pays USDC → fetches resource (Base Sepolia real settle)
pnpm probe:x402

# four-meme: read-only chain probe (TokenManager2 proxy + impl bytecode check
# on BSC mainnet; the testnet-disproved history is in decisions/2026-04-18-bsc-mainnet-pivot.md)
pnpm probe:fourmeme

# Pinata: upload a .md file, round-trip via the public gateway
pnpm probe:pinata
```

All three probes went green during Phase 1 (2026-04-18). Kept for regression checks.

## Demos (Phase 2+ end-to-end orchestrators)

```bash
# Creator — one-shot: theme → four.meme BSC mainnet token + IPFS lore + meme PNG.
# Cost: ~$0.02 OpenRouter + ~$0.05 BNB gas. Runs real deploy.
pnpm --filter @hack-fourmeme/server demo:creator

# A2A — Narrator writes new chapter, Market-maker auto-pays 0.01 USDC on
# Base Sepolia to fetch it. Targets an already-deployed token (DEMO_TOKEN_ADDR
# default or --token flag). Cost: ~$0.02 OpenRouter + 0.01 USDC real settle.
pnpm --filter @hack-fourmeme/server demo:a2a

# Heartbeat — accelerated 15s tick loop; optional --dry-run skips real X posts.
pnpm --filter @hack-fourmeme/server demo:heartbeat -- --dry-run
pnpm --filter @hack-fourmeme/server demo:heartbeat           # real X posts; see docs/decisions/2026-04-19-x-posting-agent.md for current pricing (re-verify before demo; avoid URLs in post body)
```

## Quality

```bash
pnpm lint           # eslint src/ --ext .ts,.tsx
pnpm lint:fix       # eslint --fix
pnpm format         # prettier --write
pnpm format:check   # prettier --check
pnpm typecheck      # tsc --noEmit (every package)
```

## Build

```bash
pnpm build                         # full build of web + server
pnpm --filter web build
pnpm --filter server build
```

## Demo

```bash
# Day 5 pre-recording reset: kill stale processes, clear caches, restart
pnpm clean && pnpm install && pnpm dev

# Recording: macOS built-in QuickTime / OBS
# Recording runbook: docs/runbooks/demo-recording.md (to be written)
```

## Deploy

- This hackathon submission does **not** ship a mainnet deployment or release token.
- The deliverable is the GitHub repo plus a demo video (YouTube / Loom); no public URL is required.
- For an ad-hoc external demo: deploy `web` on Vercel, keep `server` local.
