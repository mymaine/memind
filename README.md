# hack-bnb-fourmeme-agent-creator

Four autonomous agents — Creator, Narrator, Market-maker, Heartbeat — cooperate on Four.Meme and settle real USDC between each other over [x402](https://github.com/coinbase/x402) on Base Sepolia. Built for Four.Meme AI Sprint, submitted before the 2026-04-22 deadline.

- **Hackathon**: [Four.Meme AI Sprint](https://dorahacks.io/hackathon/fourmemeaisprint)
- **Submission deadline**: 2026-04-22 UTC 15:59
- **Runtime topology**: [`docs/architecture.md`](./docs/architecture.md)
- **Design system**: [`docs/design.md`](./docs/design.md)
- **Decision log**: [`docs/decisions/`](./docs/decisions/)

## Problem

Four.meme saw 32k spam tokens land in a single October 2025 day, drowning legitimate creators; across the wider memecoin space 97% of tokens are dead inside 48 hours because launchers abandon them after the mint. Four.meme's March 2026 [Agentic Mode](https://four.meme) roadmap answers this with three phases — Agent Skill Framework (Phase 1, shipped), on-chain identity (Phase 2), and an agent economic loop (Phase 3) — but Phase 2 and Phase 3 have no public reference implementation, and nothing on the BNB side shows agent-to-agent commerce working end to end. This repo is the gap-filler: a runnable Phase 1-to-2 reference where agents deploy tokens, write lore, and pay each other with real USDC for real content.

## What we built

- Four agents sharing one Anthropic SDK tool-use runtime: Creator (launches a Four.meme token), Narrator (writes lore chapters and upserts `LoreStore`), Market-maker (pays to read lore), Heartbeat (setInterval-driven autonomous tick loop).
- Eight tools on a typed registry: `narrative_generator`, `meme_image_creator`, `onchain_deployer`, `lore_writer`, `extend_lore`, `check_token_status`, `post_to_x`, `x402_fetch_lore`.
- x402 server on `@x402/express` v2 exposing three paid endpoints: `/lore/:addr` (0.01 USDC, `LoreStore`-backed when a chapter is hot), `/alpha/:addr` (0.01 USDC), `/metadata/:addr` (0.005 USDC).
- In-memory `LoreStore` bridging Narrator publishes to the x402 `/lore` endpoint so the same chapter the Narrator writes is the chapter the Market-maker buys.
- Next.js 15 dashboard (Terminal Cyber theme, Tailwind v4) with Runs REST + SSE wire contract, three live agent log columns, and five artifact pills that link directly to BscScan / Base Sepolia / Pinata.
- CLI demos that share the same orchestration path as the dashboard: `demo:creator`, `demo:a2a`, `demo:heartbeat`.
- Full architectural writeup in [`docs/architecture.md`](./docs/architecture.md).

## Architecture

```
┌─────────────────┐    HTTP    ┌──────────────────────────────────────┐
│ Browser         │◄──────────►│ Next.js web (port 3000)               │
│ (dashboard UI)  │            │ - ThemeInput → POST /api/runs         │
│                 │            │ - EventSource /api/runs/:id/events    │
└─────────────────┘            │   consumes SSE log/artifact/status    │
                               │ - same-origin rewrites → :4000        │
                               └───────────────┬──────────────────────┘
                                               │ REST / SSE
                                               ▼
                 ┌──────────────────────────────────────────────────┐
                 │ server (port 4000)                               │
                 │                                                  │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ Agent Runtime (runAgentLoop + ToolRegistry)  │ │
                 │ │                                              │ │
                 │ │ ┌──────┐ ┌──────┐ ┌────────┐ ┌────────────┐ │ │
                 │ │ │Creat-│ │Narra-│ │Market- │ │ Heartbeat  │ │ │
                 │ │ │or    │ │tor   │ │maker   │ │ (tick loop)│ │ │
                 │ │ └──┬───┘ └──┬───┘ └────┬───┘ └─────┬──────┘ │ │
                 │ └────┼────────┼──────────┼───────────┼────────┘ │
                 │      │        │          │           │          │
                 │ ┌────▼────────▼──────────▼───────────▼────────┐ │
                 │ │ Tool Registry                                │ │
                 │ │ - narrative_generator   (Anthropic)          │ │
                 │ │ - meme_image_creator    (Gemini 2.5 Flash)   │ │
                 │ │ - onchain_deployer      (four-meme-ai CLI)   │ │
                 │ │ - lore_writer           (Anthropic + Pinata) │ │
                 │ │ - lore_extend           (Anthropic + Pinata) │ │
                 │ │ - check_token_status    (viem / BSC RPC)     │ │
                 │ │ - post_to_x             (OAuth 1.0a + fetch) │ │
                 │ │ - x402_fetch_lore       (wrapFetchWithPayment)│ │
                 │ └──────────────────────────────────────────────┘ │
                 │                                                  │
                 │ ┌────────────────┐   ┌─────────────────────────┐ │
                 │ │ LoreStore      │◄──┤ Narrator.upsert         │ │
                 │ │ (in-memory map)│──►┤ handleLore(store hit)   │ │
                 │ └────────────────┘   └─────────────────────────┘ │
                 │                                                  │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ x402 Server (express)                        │ │
                 │ │ /lore/:addr (paid, store-backed when hot)    │ │
                 │ │ /alpha/:addr (paid, mock until Phase 4)      │ │
                 │ │ /metadata/:addr (paid, mock)                 │ │
                 │ └──────────────────────────────────────────────┘ │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ Runs API (Phase 4, dashboard-facing)         │ │
                 │ │ POST /api/runs  →  fire-and-forget a2a       │ │
                 │ │ GET  /api/runs/:id                           │ │
                 │ │ GET  /api/runs/:id/events  (SSE)             │ │
                 │ │ in-memory RunStore + per-run EventEmitter    │ │
                 │ └──────────────────────────────────────────────┘ │
                 └───────┬───────────┬──────────────┬───────────────┘
                         │           │              │
     BSC mainnet (four.meme)  │     │X API v2      │Base Sepolia (USDC)
         TokenManager2        │     │POST /2/tweets │x402 facilitator
      ◄────────────────────── ┘     │OAuth 1.0a     │@x402/* v2.10
                                    ▼               ▼
                                  api.x.com     Pinata IPFS
```

The server exposes three HTTP surfaces on port 4000: the x402 paid endpoints (priced in USDC, settled on Base Sepolia via the `@x402/express` middleware), the Runs API (`/api/runs`, `/api/runs/:id`, `/api/runs/:id/events`) that the dashboard drives over SSE, and the Anthropic-compatible LLM path through the OpenRouter gateway used by every agent. For per-flow detail (Flow 1 Creator mint, Flow 2 Narrator publish, Flow 3 agent-to-agent settle, Flow 4 Heartbeat tick, Flow 4b Dashboard-driven a2a) see [`docs/architecture.md`](./docs/architecture.md).

## Evidence (on-chain + in-repo)

Every row links to a real explorer page. The x402 Run #3 hash reproduces a Base Sepolia settlement from the dashboard; the earlier Phase 1 probe is the independent hello-world settlement.

| Artifact                                   | Network      | Hash / CID                                                           | Explorer                                                                                                       |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| four.meme token                            | BSC mainnet  | `0x4E39d254c716D88Ae52D9cA136F0a029c5F74444`                         | [bscscan](https://bscscan.com/token/0x4E39d254c716D88Ae52D9cA136F0a029c5F74444)                                |
| Token deploy tx (Phase 2, 67s Creator run) | BSC mainnet  | `0x760ff53f84337c0c6b50c5036d9ac727e3d56fa4ad044b05ffed8e531d760c9b` | [bscscan](https://bscscan.com/tx/0x760ff53f84337c0c6b50c5036d9ac727e3d56fa4ad044b05ffed8e531d760c9b)           |
| Narrator lore CID (Run #3, IPFS v0)        | IPFS         | `QmWoMkPuPekMXp4RwWKenADMi74mqaZRG3fcEuGovATVX7`                     | [Pinata gateway](https://gateway.pinata.cloud/ipfs/QmWoMkPuPekMXp4RwWKenADMi74mqaZRG3fcEuGovATVX7)             |
| x402 settlement (Run #3, 0.01 USDC)        | Base Sepolia | `0x62e442cc9ccc7f57c843ebcfc52f777f3cd9188b9172583ee4cefa60e5a1c3df` | [basescan](https://sepolia.basescan.org/tx/0x62e442cc9ccc7f57c843ebcfc52f777f3cd9188b9172583ee4cefa60e5a1c3df) |
| Phase 1 x402 probe settlement              | Base Sepolia | `0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a` | [basescan](https://sepolia.basescan.org/tx/0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a) |

**Note on the Run #3 settlement**: `from` and `to` are both `0xaE2E51D0…D6d78` because a single agent EOA carries both x402 roles in the current demo wiring — Market-maker as payer and the Narrator's `/lore/:addr` paid endpoint as `payTo`. The EIP-3009 `transferWithAuthorization` handshake, facilitator relay, and 0.01 USDC movement are all real on-chain; wallet multiplexing is demo-only and would split into distinct EOAs (`AGENT_WALLET_*` and a future `NARRATOR_WALLET_*`) in production.

In-repo evidence:

| Check                                                    | Result                                                                                                                       | Source                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Tests (shared + server)                                  | **209 green**: `packages/shared` 21 / `apps/server` 188 across 19 files, including real Base Sepolia x402 settle integration | [`docs/testing.md`](./docs/testing.md)                            |
| Typecheck                                                | `tsc --noEmit` clean across the workspace                                                                                    | [`docs/dev-commands.md`](./docs/dev-commands.md) `pnpm typecheck` |
| Phase 1 gate (Day 1 probes)                              | `7c06cf0` probes + BSC mainnet pivot                                                                                         | `git log 7c06cf0`                                                 |
| Phase 2 gate (Creator demo, 67s)                         | `1a088dd` → `e0c4233`                                                                                                        | `git log 1a088dd..e0c4233`                                        |
| Phase 3 gate (Narrator + Market-maker + Heartbeat + a2a) | `ec936b9` → `8d2591e`                                                                                                        | `git log ec936b9..8d2591e`                                        |
| Phase 4 gate (Dashboard AC4 Run #3)                      | `2429f70` → `a04b849`                                                                                                        | `git log 2429f70..a04b849`                                        |

## Sponsor alignment

### Four.Meme AI Sprint (main pool)

Four.meme's Agentic Mode roadmap names three phases; this submission is a working reference for Phase 1 (Skill Framework) and Phase 2 (on-chain identity / commerce).

- **Phase 1 mapping**: the `apps/server/src/tools/` registry behind the shared `AgentTool<TIn,TOut>` interface is a concrete Skill Framework — every tool is a typed, zod-validated unit the runtime discovers and calls through Anthropic native tool use. New skills drop in without touching agent code.
- **Phase 2 mapping**: Creator deploys a real BSC mainnet `TokenManager2` token through the `@four-meme/four-meme-ai@1.0.8` CLI (see [`docs/decisions/2026-04-18-bsc-mainnet-pivot.md`](./docs/decisions/2026-04-18-bsc-mainnet-pivot.md)); the token is the anchor for every downstream on-chain identity (Narrator chapters, Market-maker queries, Heartbeat posts).
- **Agentic economic loop preview**: Market-maker paying Narrator 0.01 USDC per lore chapter, settled on Base Sepolia, is the smallest credible instance of the Phase 3 economic loop Four.meme targets. The same wire format is ready to swap to BNB-side USDC once a comparable facilitator exists.

### Pieverse bounty

- **x402 spec reference**: server uses `@x402/express` v2.10 and the client uses `@x402/fetch`'s `wrapFetchWithPayment` (see the x402 protocol at [coinbase/x402](https://github.com/coinbase/x402)); paid endpoint pricing and facilitator URL are centralised in `apps/server/src/x402/config.ts`.
- **Skill Store hook point**: each tool under `apps/server/src/tools/` is self-contained with a zod input/output schema — a `SKILL.md` manifest drops in at the file level, and the shared `packages/shared/src/tool.ts` `AgentTool` interface is the publish contract.
- **Pieverse TEE wallet + x402b facilitator evaluated, not used**: Round 1 probes found the Pieverse facilitator rejected external traffic and x402b had been untouched for five months. Rationale and the fallback to Base Sepolia + `@x402/*` v2 are in [`docs/decisions/2026-04-17-direction-lock.md`](./docs/decisions/2026-04-17-direction-lock.md).

## Rubric alignment

### Innovation

- First agent-to-agent x402 commerce reference implementation wired to Four.meme on the BNB side — Market-maker pays Narrator real USDC every run, not a mock.
- Soft policy gating (`deployedOnChain === true` green-lights the purchase) pairs with transparent warn-level `LogEvent`s when policy is violated, so the judge can see both the guardrail and the override path — see `a04b849`.

### Technical

- 209 tests green (21 shared + 188 server, across 19 server test files). The x402 integration test pays a real 0.01 USDC on Base Sepolia every `pnpm test` run; it is not mocked.
- Discriminated-union artifact schema (`bsc-token` / `token-deploy-tx` / `lore-cid` / `x402-tx` / `tweet-url`) surfaced through native SSE `event:` types, exhaustively switched in `apps/web/src/lib/artifact-view.ts`. Wire contract in [`docs/decisions/2026-04-20-sse-and-runs-api.md`](./docs/decisions/2026-04-20-sse-and-runs-api.md).
- Hand-written OAuth 1.0a on `node:crypto` for `post_to_x` — no third-party OAuth library, signing and nonce logic auditable in `apps/server/src/tools/`.
- Hand-assembled `TokenManager2` partial ABI in `apps/server/src/chain/` — both the proxy and implementation are unverified on BscScan, so the ABI subset is reconstructed by hand to read bonding curve progress, holder count, and marketcap.

### Practical

- One-command dashboard dev loop (two terminals, `pnpm --filter @hack-fourmeme/{server,web} dev`), one click to run a full a2a flow that ends in a real USDC settlement.
- Pre-seed artifact mechanism (`DEMO_TOKEN_ADDR` / `DEMO_TOKEN_DEPLOY_TX` / `DEMO_CREATOR_LORE_CID`) lets evaluators replay all five pills without spending BNB on a fresh deploy — see [`docs/dev-commands.md`](./docs/dev-commands.md).
- Terminal Cyber design system built on Tailwind v4 tokens + a few CSS keyframes, accessibility-first focus states, no shadcn/ui dependency.

### Presentation

- Dense technical documentation: runtime topology in [`docs/architecture.md`](./docs/architecture.md), visual system in [`docs/design.md`](./docs/design.md), five locked decision records under [`docs/decisions/`](./docs/decisions/).
- Dashboard renders per-row log-line-in animation across three agent columns driven by SSE, ending in the five-pill TxList — live rendering, not recorded mock.
- Terminal Cyber visual identity deliberately avoids marketing aesthetic; the artifact is engineered, not pitched.

## Reproduce the demo

### a2a end-to-end (recommended, cheap)

Cost: ~$0.02 OpenRouter credit + 0.01 USDC on Base Sepolia.

```bash
# Node 25 on macOS can break native libs; always use Node 22.
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

pnpm install
cp .env.example .env.local
# fill in: OPENROUTER_API_KEY, AGENT_WALLET_PRIVATE_KEY,
#          PINATA_JWT, BSC_DEPLOYER_PRIVATE_KEY,
#          X_API_KEY / X_API_KEY_SECRET / X_ACCESS_TOKEN /
#            X_ACCESS_TOKEN_SECRET / X_BEARER_TOKEN
# optional pre-seed: DEMO_TOKEN_ADDR / DEMO_TOKEN_DEPLOY_TX / DEMO_CREATOR_LORE_CID

# Terminal 1
pnpm --filter @hack-fourmeme/server dev      # http://localhost:4000

# Terminal 2
pnpm --filter @hack-fourmeme/web dev         # http://localhost:3000
```

Open `http://localhost:3000`, click **Run swarm**. The dashboard POSTs `/api/runs`, subscribes to the SSE stream, and lights four pills plus the real Base Sepolia settlement. The fifth pill lights when `DEMO_CREATOR_LORE_CID` is set.

### Full Creator flow (expensive, optional)

Deploys a brand new BSC mainnet token via the `@four-meme/four-meme-ai` CLI. Cost: ~$0.02 OpenRouter + ~$0.05 BNB gas.

```bash
pnpm --filter @hack-fourmeme/server demo:creator
```

Full command reference: [`docs/dev-commands.md`](./docs/dev-commands.md).

## Acceptance criteria status

| AC                                   | Status      | Evidence / rationale                                                                                                                                                                                               |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 — Creator autonomous launch flow | [x]         | Phase 2 Task 7 real run at 67s: token `0x4E39d254…74444`, tx `0x760ff53f…760c9b`, lore CID `bafkrei…peq4`.                                                                                                         |
| AC2 — Agent-to-agent x402 settle     | [x]         | Phase 3 Task 7 `demo:a2a`; Market-maker pays Narrator; `apps/server/src/x402/*.integration.test.ts` settles real USDC every `pnpm test`.                                                                           |
| AC3 — Narrator on-chain anchor       | [ ] partial | Narrator lore + Pinata CID shipped; BSC event-log anchor not implemented. Fallback runbook (log queue screenshot) deferred to Day 5.                                                                               |
| AC4 — Dashboard integration          | [x]         | Run #3 on 2026-04-20; four pills light via SSE (`QmWoMk…TVX7`, `0x62e4442c…725`); fifth pill lights with `DEMO_CREATOR_LORE_CID`. Fix chain: `fb30259` (server dotenv) + `a04b849` (JSON robustness, policy gate). |
| AC5 — Demo video                     | [ ]         | Phase 5 item; recording runbook pending.                                                                                                                                                                           |
| AC6 — README aligned to rubric       | [ ]         | This document.                                                                                                                                                                                                     |
| AC7 — Heartbeat + X posting          | [ ] partial | Heartbeat runtime + 3 tools + dry-run green (`4a36454`); live X posts blocked on $5 credit top-up.                                                                                                                 |

## Key decisions

One line per decision record; no inlined content.

- [`2026-04-17-direction-lock.md`](./docs/decisions/2026-04-17-direction-lock.md) — lock Agent-as-Creator + x402 Service Exchange over 10 alternatives; Pieverse facilitator + x402b testnet disproved in probe Round 1.
- [`2026-04-18-anthropic-native-tool-use.md`](./docs/decisions/2026-04-18-anthropic-native-tool-use.md) — Anthropic SDK native tool use + self-built tool registry over any third-party agent framework; saves hours and stays self-contained.
- [`2026-04-18-bsc-mainnet-pivot.md`](./docs/decisions/2026-04-18-bsc-mainnet-pivot.md) — `TokenManager2` exists only on BSC mainnet (testnet bytecode is empty); Creator deploys real tokens with the `HBNB2026-` prefix to avoid misleading end users.
- [`2026-04-19-x-posting-agent.md`](./docs/decisions/2026-04-19-x-posting-agent.md) — X API reopened under tight scope after 2026 pay-per-usage pricing made ~$3.70 of credit cover the hackathon; hand-rolled OAuth 1.0a, aged account only, no mention broadcast.
- [`2026-04-20-sse-and-runs-api.md`](./docs/decisions/2026-04-20-sse-and-runs-api.md) — dashboard wire contract; native SSE `event:` types, discriminated-union artifacts, in-memory `RunStore`.

## Known gaps

- **AC3 — on-chain anchor not implemented.** Moving chapter CIDs through `LoreStore` + SSE was cheaper than subscribing to a BSC event log; the anchor was intentionally deferred, and the log-queue screenshot fallback is on the Day 5 runbook but not produced yet.
- **AC7 — live X posts blocked on $5 credit top-up.** Heartbeat runtime, `post_to_x`, `check_token_status`, and `extend_lore` tools are implemented and tested; a `--dry-run` path proves the wiring end-to-end without spending credit.
- **Dashboard creator column intentionally quiet on a2a runs.** The a2a orchestrator does not invoke the Creator agent (token is already deployed); pre-seed artifacts still render in the TxList so the pill evidence stays whole.
- **`/alpha/:addr` and `/metadata/:addr` remain mocks.** They exercise the paid path but return canned payloads until Phase 4 wiring; `/lore/:addr` is real via `LoreStore`.

## Project layout

```
apps/
  web/        Next.js 15 + Tailwind v4 dashboard (Terminal Cyber theme)
    src/
      app/          layout + page (client component, useRun driven)
      components/   theme-input / agent-status-bar / log-panel / tx-list
      hooks/        useRun — POST /api/runs + EventSource lifecycle
      lib/          artifact-view (Artifact → pill display)
  server/     Express + x402 server + agent runtime
    src/
      agents/       Creator / Narrator / Market-maker / Heartbeat + _json parser
      tools/        8 tools: narrative / image / deployer / lore / lore-extend /
                    token-status / x-post / x-fetch-lore
      state/        in-memory LoreStore (latest chapter per token)
      chain/        viem client + TokenManager2 partial ABI
      x402/         payment middleware + paid route handlers
      runs/         RunStore + runA2ADemo + REST/SSE route handlers
      routes/       Express route mounting
      demos/        demo:creator / demo:a2a / demo:heartbeat
      config.ts     env schema (zod) + agent id enum
      index.ts      module-scope stores + app bootstrap
packages/
  shared/     zod schemas + types + agent tool interface
                (Artifact union, RunSnapshot, SSE payload, chain schema)
scripts/      probe-x402 / probe-fourmeme / probe-pinata (Phase 1 hello world)
docs/         architecture / design / dev-commands / testing / decisions
```
