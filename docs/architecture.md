---
summary: 'Four-agent swarm architecture, x402 data flow, and module boundaries'
read_when:
  - Before making cross-agent changes
  - Before adjusting x402 endpoints or the payment flow
  - Before adding a tool to the agent tool registry
status: active
---

# Architecture

## Top-Level Shape

pnpm workspace monorepo with three packages:

```
hack-bnb-fourmeme-agent-creator/
├── apps/
│   ├── web/              # Next.js 15 App Router dashboard (Phase 4 AC4 MVP)
│   │   └── src/
│   │       ├── app/      # layout + page (client component, useRun driven)
│   │       ├── components/ # theme-input / agent-status-bar / log-panel / tx-list
│   │       ├── hooks/    # useRun — POST /api/runs + EventSource lifecycle
│   │       └── lib/      # artifact-view (Artifact → pill display)
│   └── server/           # Express + x402 server + agent runtime
│       └── src/
│           ├── agents/   # Creator / Narrator / Market-maker / Heartbeat
│           ├── tools/    # narrative / image / deployer / lore / lore-extend /
│           │             # token-status / x-post / x-fetch-lore
│           ├── state/    # in-memory LoreStore (latest chapter per token)
│           ├── chain/    # viem client + TokenManager2 partial ABI
│           ├── x402/     # payment middleware + paid route handlers
│           ├── runs/     # RunStore + runA2ADemo + REST/SSE route handlers
│           └── demos/    # demo:creator / demo:a2a / demo:heartbeat
├── packages/
│   └── shared/           # shared types, zod schemas, and agent tool interface
├── docs/
└── scripts/              # hello-world probes and fallback test scripts
```

## Runtime Topology

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

## Main Data Flow

### Flow 1 — Creator Agent autonomous token launch (core acceptance)

```
User input (one-line theme)
  → Creator.plan()                               [Anthropic LLM via OpenRouter]
  → Creator.tool[narrative_generator]            [Anthropic]
  → Creator.tool[meme_image_creator]             [Google Gemini 2.5 Flash Image]
  → Creator.tool[onchain_deployer]               [shell-exec four-meme-ai → BSC mainnet]
  → Creator.tool[lore_writer]                    [Anthropic → Pinata]
  → return { tokenAddr, ipfsHash, loreUri }
```

### Flow 2 — Narrator publishes → LoreStore → x402 /lore serves paid reads

```
Narrator Agent triggered by demo/heartbeat
  → runAgentLoop + extend_lore tool
  → Anthropic generates the next chapter (context-defensive cap: 5 chapters / 12k chars)
  → Pinata upload → ipfsHash
  → LoreStore.upsert({ tokenAddr, chapterNumber, chapterText, ipfsHash, … })
  → /lore/:addr now serves the latest chapter from the store (falls back to mock
    payload when the store is empty, preserving Phase 2 compatibility)
```

### Flow 3 — Agent-to-agent x402 payment (demo climax, AC2)

```
Market-maker Agent (triggered by pnpm demo:a2a)
  → check_token_status reads BSC state (bonding curve / holder / marketcap)
  → soft policy decides buy-lore or skip (threshold violation still emits a warn LogEvent)
  → x402_fetch_lore GET http://localhost:4000/lore/<tokenAddr>
     → wrapFetchWithPayment handles the 402 automatically
     → ExactEvmScheme signs EIP-3009, pays 0.01 USDC on Base Sepolia
     → 200 + lore payload + PAYMENT-RESPONSE header
     → decodePaymentResponseHeader → settlement.transaction (tx hash)
  → returns { body, settlementTxHash, baseSepoliaExplorerUrl }
```

### Flow 4b — Dashboard-driven A2A run (AC4, Phase 4)

```
Browser
  → POST /api/runs { kind: 'a2a' }
  → server.RunStore.create('a2a') → runId
  → 201 { runId }
Browser (same response)
  → new EventSource(/api/runs/:runId/events)
  → subscribe 'log' / 'artifact' / 'status'
Server (fire-and-forget)
  → runA2ADemo({ runStore, runId, loreStore, ... })
     → emit pre-seed artifacts (bsc-token, optional deploy tx + creator CID)
     → run Narrator → emit lore-cid artifact (author:narrator)
     → run Market-maker → emit x402-tx artifact if settlement landed
  → runStore.setStatus(runId, 'done') | 'error'
Server SSE handler
  → on terminal status: write `event: status` + res.end()
  → browser receives terminal status, EventSource.close()
  → dashboard renders 5-pill summary + final agent statuses

Wire protocol: docs/decisions/2026-04-20-sse-and-runs-api.md.
```

### Flow 4 — Heartbeat autonomous tick (AC7)

```
HeartbeatAgent (triggered by pnpm demo:heartbeat)
  every HEARTBEAT_INTERVAL_MS milliseconds (demo accelerated to 15s / production 60s):
  → isTickRunning lock (overlapping ticks are skipped, skippedCount++)
  → runAgentLoop (agentId='heartbeat', maxTurns=4)
     → check_token_status
     → autonomous decision: post_to_x / extend_lore / idle
     → (optional) --dry-run replaces real posting with a stub
  → error isolation (tick-level try/catch never escapes to the interval)
  → SIGINT/SIGTERM triggers graceful shutdown
```

## Module Boundaries

| Module                | Responsibility                                                                                                                                                                           | Out of scope                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `apps/web`            | ThemeInput, SSE subscription via EventSource, three live log columns, five-pill TxList; `useRun` hook owns the run lifecycle; `artifact-view` maps the Artifact union to pill renderings | Agent logic, on-chain calls, server state |
| `apps/server/agents/` | Creator / Narrator / Market-maker / Heartbeat plan/execute logic plus the shared `_json.ts` JSON parser                                                                                  | HTTP routing, direct shell calls          |
| `apps/server/tools/`  | Eight tools: narrative / image / deployer / lore / lore-extend / token-status / x-post / x-fetch-lore                                                                                    | Agent decision logic                      |
| `apps/server/state/`  | In-memory LoreStore (latest chapter per token, lowercase-normalized key)                                                                                                                 | Persistence, multi-instance sync          |
| `apps/server/x402/`   | paymentMiddleware plus three paid-endpoint handlers; `handleLore` is store-backed                                                                                                        | Agent runtime, wallet signing             |
| `apps/server/chain/`  | viem client and the TokenManager2 partial ABI (both proxy and implementation are unverified on-chain, so the subset is hand-authored)                                                    | Agent business logic                      |
| `apps/server/runs/`   | `RunStore` (Map + per-run EventEmitter); `runA2ADemo` as a pure function; POST/GET/SSE route handlers; CLI and HTTP share the same orchestration code path                               | Agent business logic, persistence         |
| `apps/server/demos/`  | Runnable end-to-end scripts: demo-creator-run / demo-a2a-run / demo-heartbeat-run                                                                                                        | Unit tests, framework dependencies        |
| `packages/shared`     | zod schemas, TS types, agent tool interface; Artifact discriminated union, RunSnapshot, SSE payloads                                                                                     | Any runtime dependency                    |

## External Dependencies

| Dependency                                                         | Purpose                                                                                | Fallback plan                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `@x402/express` v2.10+                                             | x402 server middleware (paymentMiddleware + x402ResourceServer)                        | No fallback (2026-04-18 probe proved real Base Sepolia settlement end-to-end) |
| `@x402/fetch` v2.10+                                               | Market-maker client auto-payment (wrapFetchWithPayment + ExactEvmScheme)               | Hand-assemble HTTP + EIP-3009                                                 |
| `@x402/evm` + `@x402/core` v2.10+                                  | EVM scheme implementation + decodePaymentResponseHeader                                | No fallback                                                                   |
| `@four-meme/four-meme-ai@1.0.8` CLI (invoked via `npx` shell-exec) | four.meme token deployment (**BSC mainnet only**; official scoped package)             | viem direct call against the TokenManager2 ABI (`0x5c95...762b`, mainnet)     |
| `pinata` v2.5+                                                     | IPFS pinning (official new SDK, JWT-authenticated; shared by lore and lore-extend)     | AWS S3 + fake hash (demo fallback)                                            |
| `@anthropic-ai/sdk` via OpenRouter gateway                         | LLM backend for every agent (OPENROUTER_API_KEY preferred, ANTHROPIC_API_KEY fallback) | No fallback                                                                   |
| `@google/genai` (Gemini 2.5 Flash Image)                           | meme image generation (Phase 2 migration from Replicate)                               | No fallback                                                                   |
| X API v2 (`api.x.com/2/tweets`)                                    | post_to_x posting (hand-written OAuth 1.0a User Context; no third-party OAuth library) | Before credit top-up, dry-run stub; real posts cost ~$0.01/post               |
| `viem` v2                                                          | EOA wallet, event-log reads, BSC RPC and Base Sepolia RPC                              | No fallback                                                                   |
| Base Sepolia USDC                                                  | x402 settlement asset                                                                  | No fallback                                                                   |
| Pieverse TEE wallet                                                | Stretch goal (bounty)                                                                  | Skipped by default                                                            |

## Security / Secrets

- **All private keys live in `.env.local`**, guarded by `.gitignore`. They must never land in the repo.
- **Wallet separation**: the agent runtime wallet (Base Sepolia test USDC, x402 payments) and the four.meme deployment wallet (**BSC mainnet real BNB**, ~$1 covers many deploys) are distinct EOAs.
- **x402 facilitator URL and scheme** default to `@x402/*` v2 Base Sepolia (`eip155:84532`); we do not self-host. Facilitator: `https://x402.org/facilitator`.
