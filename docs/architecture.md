---
summary: '1 Memind per memecoin. Each Memind is internally a Brain runtime hosting pluggable personas. Product surface is a 12-chapter sticky-stage scrollytelling with a slide-in Brain conversational panel; the runtime substrate is the agent loop + x402 + shared memory. Code directory still calls them agents for historical continuity.'
read_when:
  - Before making cross-persona changes
  - Before adjusting x402 endpoints or the payment flow
  - Before adding a new persona (new SKU) or a tool to the registry
  - Before touching the sticky-stage scrollytelling, BrainPanel, or LogsDrawer
  - When deciding whether the Memind framing is a rename or a real architecture
status: active
---

# Architecture

## Memind / Brain-Persona Model

The product is framed as **one Memind per memecoin**. Each Memind is internally a **Brain runtime** hosting **pluggable personas** (Creator / Narrator / Market-maker / Shiller / Heartbeat). This is a naming layer over a real, already-shipped runtime — not a rename. Every claim below is anchored in code:

| Memind claim                  | Implementation fact                                                                                                                                | File                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| One Memind per Node process   | Single LLM client, single `ToolRegistry`, single event-emitter fan-out                                                                             | `apps/server/src/index.ts`, `apps/server/src/agents/runtime.ts`                |
| Shared memory across personas | `LoreStore` + `AnchorLedger` + `ShillOrderStore` all live in one `apps/server/src/state/` namespace, read/written by every persona                 | `apps/server/src/state/*.ts`                                                   |
| Each persona is pluggable     | Every persona is a thin `runAgentLoop` wrapper (`systemPrompt` + selected tool subset) — no persona-specific runtime                               | `apps/server/src/agents/{creator,narrator,market-maker,heartbeat,brain}.ts`    |
| Explicit pluggable contract   | `Persona<TInput, TOutput>` interface in shared package + `persona-adapters.ts` wrappers (creator / narrator / shiller / heartbeat)                 | `packages/shared/src/persona.ts`, `apps/server/src/agents/persona-adapters.ts` |
| Autonomous tick               | Heartbeat persona drives a `setInterval` loop that picks the next action (post / extend_lore / idle) every tick                                    | `apps/server/src/agents/heartbeat.ts`                                          |
| Meta-agent orchestration      | **Brain** persona wraps four `invoke_*` tool factories (creator / narrator / shiller / heartbeat_tick); routes slash-driven chat turns to personas | `apps/server/src/agents/brain.ts`, `apps/server/src/tools/invoke-persona.ts`   |

**Why the code directory still says `agents/`**: renaming buys zero runtime behaviour and churns imports across 40+ files. Pitch surface (narrative copy / chapter components / BrainIndicator / slash commands) uses Memind / persona vocabulary; code keeps `agent` for continuity. The `Persona` interface documents the mapping. The architectural primitive **Brain** is preserved as the runtime concept inside each Memind — i.e. _Memind = product brand; Brain = runtime substrate; persona = pluggable SKU_.

**Adding a new SKU = adding a new persona to the Memind**: each new SKU ships as ~50 lines — a new `systemPrompt`, a subset of existing tools (with at most one new `AgentTool`), and an adapter in `persona-adapters.ts` that satisfies `Persona<TInput, TOutput>`. The Brain meta-agent can invoke any new persona by adding one more `invoke_<persona>` tool factory to `tools/invoke-persona.ts`. No new x402 infrastructure, no new runtime, no new memory layer. The pluggability is the product.

## Top-Level Shape

pnpm workspace monorepo with three packages:

```
hack-bnb-fourmeme-agent-creator/
├── apps/
│   ├── web/              # Next.js 15 App Router — Memind scrollytelling surface
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx        # Inter + JetBrains Mono fonts, RunStateProvider
│   │       │   ├── page.tsx          # StickyStage shell + 12-chapter cross-fade
│   │       │   ├── market/page.tsx   # 307 redirect → /#order-shill (legacy URL kept)
│   │       │   └── demo/glyph/       # Internal QA surface for pixel-human moods
│   │       ├── components/
│   │       │   ├── chapters/         # Ch1-Ch12 real components (hero / problem /
│   │       │   │                     # solution / brain / launch / shill / saga /
│   │       │   │                     # heartbeat / take-rate / sku / phase / evidence)
│   │       │   ├── brain-panel.tsx   # Right-side slide-in conversational surface
│   │       │   ├── brain-chat*.tsx   # Chat UI, slash palette, message grouping
│   │       │   ├── brain-indicator.tsx  # TopBar IDLE/ONLINE/ERROR + persona label
│   │       │   ├── header.tsx        # Fixed TopBar: progress counter + BrainIndicator
│   │       │   ├── section-toc.tsx   # Fixed left chapter index
│   │       │   ├── sticky-stage.tsx  # Cross-fade engine (opacity/scale/blur)
│   │       │   ├── logs-drawer.tsx   # Left-side dev-tools drawer, 3 tabs
│   │       │   ├── footer-drawer-tabs/  # logs-tab / artifacts-tab / console-tab
│   │       │   ├── pixel-human-glyph/   # 14-mood pixel-art avatar
│   │       │   ├── scanlines-overlay.tsx + watermark.tsx + tweaks-panel.tsx
│   │       ├── hooks/    # useRun / useRunStateContext / useBrainChat /
│   │       │             # useActiveChapter / useScrollY / useReducedMotion /
│   │       │             # useSlashPalette / useTweakMode
│   │       └── lib/      # chapters.ts (CHAPTER_META / SLOT_VH /
│   │                     #   chapterScrollTarget / resolveChapterIndexFromHash)
│   │                     # + slash-commands.ts (/launch /order /lore /heartbeat
│   │                     #   /status /help /reset registry)
│   │                     # + artifact-view.ts (Artifact → pill display)
│   └── server/           # Express + x402 server + agent runtime
│       └── src/
│           ├── index.ts      # Mounts /health, x402 paid routes, /api/runs/*
│           ├── agents/       # brain / creator / narrator / market-maker / heartbeat
│           │                 # + runtime.ts (runAgentLoop) + _stream-map.ts
│           │                 # + persona-adapters.ts + _json.ts
│           ├── tools/        # registry / narrative / image / deployer / lore /
│           │                 # lore-extend / token-status / x-post / post-shill-for /
│           │                 # x-fetch-lore / invoke-persona (4 factories)
│           ├── state/        # LoreStore + AnchorLedger + ShillOrderStore
│           ├── chain/        # viem client, TokenManager2 partial ABI, anchor-tx
│           ├── x402/         # paymentMiddleware + 4 paid routes (shipped
│           │                 # handlers: /lore, /alpha, /metadata, /shill)
│           ├── runs/         # store (RunStore) + a2a + brain-chat + creator-phase +
│           │                 # heartbeat-runner + shill-market + routes
│           ├── routes/       # health.ts (GET /health)
│           └── demos/        # demo:creator / demo:a2a / demo:heartbeat / demo:shill
├── packages/
│   └── shared/           # zod schemas + types + Persona interface
│                         # (agentId / runKind / artifact union / SSE payloads)
└── scripts/              # hello-world probes and fallback test scripts
```

## Runtime Topology

```
┌───────────────────┐    HTTP    ┌────────────────────────────────────────┐
│ Browser           │◄──────────►│ Next.js web (port 3000)                 │
│ Memind            │            │ - StickyStage 12-chapter cross-fade     │
│ scrollytelling +  │            │ - Header BrainIndicator (IDLE/ONLINE)   │
│ BrainPanel chat   │            │ - BrainPanel: POST /api/runs            │
│                   │            │     {kind:'brain-chat', messages:[…]}   │
│                   │            │   + EventSource /api/runs/:id/events    │
│                   │            │ - Ch5/Ch6: POST /api/runs {a2a|shill}   │
│                   │            │   + SSE; Ch11 dispatches memind:        │
│                   │            │     open-brain CustomEvent              │
│                   │            │ - LogsDrawer mirrors SSE via            │
│                   │            │   useRunStateContext                    │
│                   │            │ - same-origin rewrites → :4000          │
└───────────────────┘            └──────────────┬─────────────────────────┘
                                                │ REST / SSE
                                                ▼
                 ┌──────────────────────────────────────────────────┐
                 │ server (port 4000)                               │
                 │                                                  │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ Agent Runtime (runAgentLoop + ToolRegistry)  │ │
                 │ │  messages.stream → _stream-map → tool_use:   │ │
                 │ │  start / tool_use:end / assistant:delta      │ │
                 │ │                                              │ │
                 │ │ ┌─────┐ ┌─────┐ ┌──────┐ ┌────────┐ ┌──────┐ │ │
                 │ │ │Crea-│ │Narr-│ │Market│ │Heartbeat│ │Brain │ │ │
                 │ │ │tor  │ │ator │ │-maker│ │(tick)  │ │(meta)│ │ │
                 │ │ │     │ │     │ │/Pitch│ │        │ │      │ │ │
                 │ │ └──┬──┘ └──┬──┘ └───┬──┘ └───┬────┘ └──┬───┘ │ │
                 │ └────┼───────┼────────┼────────┼─────────┼─────┘ │
                 │      │       │        │        │         │       │
                 │ ┌────▼───────▼────────▼────────▼─────────▼─────┐ │
                 │ │ Tool Registry                                │ │
                 │ │ - narrative_generator   (LLM)                │ │
                 │ │ - meme_image_creator    (image model)        │ │
                 │ │ - onchain_deployer      (four-meme-ai CLI)   │ │
                 │ │ - lore_writer           (LLM + Pinata)       │ │
                 │ │ - extend_lore           (LLM + Pinata)       │ │
                 │ │ - check_token_status    (viem / BSC RPC)     │ │
                 │ │ - post_to_x             (OAuth 1.0a + fetch) │ │
                 │ │ - post_shill_for        (paid-shill tweet)   │ │
                 │ │ - x402_fetch_lore       (wrapFetchWithPayment)│ │
                 │ │ - invoke_{creator,narrator,shiller,          │ │
                 │ │   heartbeat_tick}       (Brain meta-agent)   │ │
                 │ └──────────────────────────────────────────────┘ │
                 │                                                  │
                 │ ┌────────────────┐   ┌─────────────────────────┐ │
                 │ │ LoreStore      │◄──┤ Narrator.upsert         │ │
                 │ │ AnchorLedger   │◄──┤ narrator AnchorLedger   │ │
                 │ │                │   │   append (keccak256)    │ │
                 │ │ ShillOrderStore│◄──┤ x402 /shill/ enqueue    │ │
                 │ │ (in-memory)    │──►┤ handleLore(store hit)   │ │
                 │ └────────────────┘   └─────────────────────────┘ │
                 │                                                  │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ x402 Server (express) — 4 paid endpoints     │ │
                 │ │ GET  /lore/:addr       ($0.01, store-backed) │ │
                 │ │ GET  /alpha/:addr      ($0.01, mock payload) │ │
                 │ │ GET  /metadata/:addr   ($0.005, mock)        │ │
                 │ │ POST /shill/:tokenAddr ($0.01, creator-paid; │ │
                 │ │   enqueues ShillOrderStore)                  │ │
                 │ │ Prices + paths live in x402/config.ts        │ │
                 │ └──────────────────────────────────────────────┘ │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ Runs API (/api/runs)                         │ │
                 │ │ POST  /api/runs                              │ │
                 │ │   kind ∈ creator | a2a | heartbeat |         │ │
                 │ │          shill-market | brain-chat           │ │
                 │ │ GET   /api/runs/:id                          │ │
                 │ │ GET   /api/runs/:id/events  (SSE)            │ │
                 │ │ in-memory RunStore + per-run EventEmitter    │ │
                 │ └──────────────────────────────────────────────┘ │
                 │ ┌──────────────────────────────────────────────┐ │
                 │ │ /health → { status:'ok', ts:<ISO8601> }      │ │
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

### Flow 1 — Creator Agent autonomous token launch

```
User input (one-line theme, typed into BrainPanel or Ch5 LaunchPanel)
  → Creator.plan()                               [LLM]
  → Creator.tool[narrative_generator]            [LLM]
  → Creator.tool[meme_image_creator]             [image model]
  → Creator.tool[onchain_deployer]               [shell-exec four-meme-ai → BSC mainnet]
  → Creator.tool[lore_writer]                    [LLM → Pinata]
  → emit artifacts: bsc-token, token-deploy-tx, meme-image, lore-cid
  → return { tokenAddr, ipfsHash, loreUri }
```

### Flow 2 — Narrator publishes → LoreStore → x402 /lore serves paid reads

```
Narrator Agent triggered by demo / heartbeat / a2a / brain-chat
  → runAgentLoop + extend_lore tool
  → LLM generates the next chapter (context-defensive cap: 5 chapters / 12k chars)
  → Pinata upload → ipfsHash
  → LoreStore.upsert({ tokenAddr, chapterNumber, chapterText, ipfsHash, … })
  → AnchorLedger.append({ tokenAddr, chapterNumber, loreCid,
                           contentHash = keccak256(`${addr}:${ch}:${cid}`) })
  → emit artifacts: lore-cid (author:'narrator'), lore-anchor (layer-1)
  → /lore/:addr now serves the latest chapter from the store; when the store
    is empty the handler returns a mock payload so the x402 contract stays
    non-empty for the paid demo.
```

### Flow 3 — Agent-to-agent x402 payment

```
Market-maker Agent (triggered by pnpm demo:a2a, Ch5→Ch6 run, or brain-chat /order)
  → check_token_status reads BSC state (bonding curve / holder / marketcap)
  → soft policy decides buy-lore or skip (threshold violation still emits warn LogEvent)
  → x402_fetch_lore GET http://localhost:4000/lore/<tokenAddr>
     → wrapFetchWithPayment handles the 402 automatically
     → ExactEvmScheme signs EIP-3009, pays 0.01 USDC on Base Sepolia
     → 200 + lore payload + PAYMENT-RESPONSE header
     → decodePaymentResponseHeader → settlement.transaction (tx hash)
  → emit artifact: x402-tx (chain: base-sepolia)
  → returns { body, settlementTxHash, baseSepoliaExplorerUrl }
```

### Flow 4 — On-chain lore anchor (layer 1 always, layer 2 env-gated)

```
Narrator emits lore-cid
  → AnchorLedger append (keccak256 commitment, always on — layer 1)
  → if ANCHOR_ON_CHAIN=true && BSC_DEPLOYER_PRIVATE_KEY set:
      chain/anchor-tx.ts sends zero-value self-tx on BSC mainnet,
      data field = contentHash (~$0.01 gas)
      markOnChain() + emit second lore-anchor artifact with BscScan url
```

### Flow 5 — Dashboard-driven A2A / Shill-market run

```
Browser (Ch5 LaunchPanel or Ch6 OrderPanel or BrainPanel slash /order)
  → POST /api/runs { kind: 'a2a' | 'shill-market', ... }
  → server.RunStore.create(kind) → runId
  → 201 { runId }
Browser
  → new EventSource(/api/runs/:runId/events)
  → subscribe 'log' / 'artifact' / 'status' / 'tool_use:start' /
              'tool_use:end' / 'assistant:delta'
Server (fire-and-forget)
  → runA2ADemo | runShillMarketDemo ({ runStore, runId, loreStore, ... })
     → emit pre-seed artifacts (optional) + per-persona LogEvents
     → run Narrator → emit lore-cid artifact (author:narrator)
     → run Market-maker → emit x402-tx artifact if settlement landed
  → runStore.setStatus(runId, 'done') | 'error'
Server SSE handler
  → on terminal status: write `event: status` + res.end()
  → browser receives terminal status, EventSource.close()
  → dashboard renders evidence pills (BSC token / deploy tx / lore CIDs / x402 tx / tweet url)
```

### Flow 6 — Heartbeat autonomous tick

```
HeartbeatAgent (triggered by pnpm demo:heartbeat or
                POST /api/runs {kind:'heartbeat', tokenAddress})
  every HEARTBEAT_INTERVAL_MS milliseconds (production default 60s;
  dashboard run default 10s):
  → isTickRunning lock (overlapping ticks are skipped, skippedCount++)
  → runAgentLoop (agentId='heartbeat', maxTurns=4)
     → check_token_status
     → autonomous decision: post_to_x / extend_lore / idle
     → emit artifacts: heartbeat-tick, heartbeat-decision, tweet-url (if posted)
     → (optional) --dry-run replaces real posting with a stub
  → error isolation (tick-level try/catch never escapes to the interval)
  → SIGINT/SIGTERM triggers graceful shutdown
```

### Flow 7 — Brain conversational chat (BrainPanel → persona dispatch)

```
Browser (BrainPanel open via TopBar click, memind:open-brain CustomEvent,
         or Ch5/Ch6 inline chat entry)
  → slash command resolved client-side via useSlashPalette:
       /launch <theme>          → routes to creator persona
       /order <tokenAddr>       → routes to market-maker persona
       /lore <tokenAddr>        → routes to narrator persona
       /heartbeat <tokenAddr>   → routes to heartbeat persona
       /status                  → queries current RunState
       /help | /reset           → client-only
  → POST /api/runs { kind:'brain-chat', messages:[{role, content}, …] }
  → EventSource /api/runs/:runId/events
Server
  → runBrainChat (runs/brain-chat.ts)
     → runAgentLoop with BRAIN_SYSTEM_PROMPT + invoke_* tool factories
     → Brain picks invoke_creator | invoke_narrator | invoke_shiller |
         invoke_heartbeat_tick → runs the target persona inline
     → every persona tool emits its own LogEvents + artifacts onto the run
  → runStore.setStatus → terminal
Client
  → useBrainChat accumulates assistant:delta into streaming chat bubbles
  → useRunStateContext mirrors artifacts into LogsDrawer
```

## Module Boundaries

| Module                | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Out of scope                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `apps/web`            | 12-chapter sticky-stage scrollytelling (`Ch1Hero` → `Ch12Evidence`, with `Ch7Saga` covering the Narrator persona's think→write→pin cycle) hosted by `<StickyStage>`; shared sticky `<Header>` with progress + BrainIndicator; `<SectionToc>` left nav; `<Watermark>` chapter stamp; `<LogsDrawer>` 3-tab dev drawer (logs / artifacts / console) bound to RunStateContext; `<BrainPanel>` right-side slide-in conversational surface; `/market` kept as 307 redirect to `#order-shill` | Agent logic, on-chain calls, server state |
| `apps/server/agents/` | Creator / Narrator / Market-maker (dual persona: a2a lore buyer or Shiller persona) / Heartbeat / **Brain (meta-agent)** plan/execute logic; shared `_json.ts` fence-tolerant JSON parser; `_stream-map.ts` streaming-event mapper; `persona-adapters.ts` `Persona<T,T>` wrappers                                                                                                                                                                                                      | HTTP routing, direct shell calls          |
| `apps/server/tools/`  | Ten+ tools: narrative / image / deployer / lore / lore-extend / token-status / x-post / post-shill-for / x-fetch-lore + four `invoke_*` persona tool factories (Brain meta-agent); `registry.ts` collects them                                                                                                                                                                                                                                                                         | Agent decision logic                      |
| `apps/server/state/`  | In-memory LoreStore (latest chapter per token, lowercase-normalized key) + AnchorLedger (keccak256 commitment log, upsert by anchorId) + ShillOrderStore (paid-shill queue shared between `/shill/:tokenAddr` producer and Shiller persona consumer)                                                                                                                                                                                                                                   | Persistence, multi-instance sync          |
| `apps/server/x402/`   | `paymentMiddleware` (Base Sepolia USDC) + four paid-endpoint handlers mounted at startup. `/lore/:addr` is store-backed (falls back to a mock payload when the store is empty). `/alpha/:addr` and `/metadata/:addr` return mock payloads today; paths + prices live in `x402/config.ts`. `/shill/:tokenAddr` is creator-paid and enqueues a ShillOrderStore entry for the Shiller persona to consume.                                                                                 | Agent runtime, wallet signing             |
| `apps/server/chain/`  | viem client and the TokenManager2 partial ABI (both proxy and implementation are unverified on-chain, so the subset is hand-authored); `anchor-tx.ts` builds the zero-value self-tx memo for the optional on-chain anchor layer                                                                                                                                                                                                                                                        | Agent business logic                      |
| `apps/server/runs/`   | `RunStore` (Map + per-run EventEmitter + replay); `runA2ADemo` / `runBrainChat` / `runHeartbeatDemo` / `runShillMarketDemo` / `runCreatorPhase` pure orchestrators; POST/GET/SSE route handlers; CLI and HTTP share the same orchestration code path                                                                                                                                                                                                                                   | Agent business logic, persistence         |
| `apps/server/routes/` | Tiny health route (`GET /health` → `{ status:'ok', ts }`)                                                                                                                                                                                                                                                                                                                                                                                                                              | Run orchestration, x402 handlers          |
| `apps/server/demos/`  | Runnable end-to-end CLI scripts: demo-creator-run / demo-a2a-run / demo-heartbeat-run / demo-shill-run                                                                                                                                                                                                                                                                                                                                                                                 | Unit tests, framework dependencies        |
| `packages/shared`     | zod schemas, TS types, Persona interface; `AgentId` (creator/narrator/market-maker/heartbeat/brain/shiller), `RunKind` (creator/a2a/heartbeat/shill-market/brain-chat), Artifact discriminated union (11 kinds), RunSnapshot, SSE payloads (log / artifact / status / tool_use:start / tool_use:end / assistant:delta), `ChatMessage`                                                                                                                                                  | Any runtime dependency                    |

## Shared Schema Surface

Canonical contract — both client and server import from `@hack-fourmeme/shared`.

| Schema                    | Values / Shape                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentIdSchema`           | `creator` \| `narrator` \| `market-maker` \| `heartbeat` \| `brain` \| `shiller`                                                                                                          |
| `runKindSchema`           | `creator` \| `a2a` \| `heartbeat` \| `shill-market` \| `brain-chat`                                                                                                                       |
| `runStatusSchema`         | `pending` \| `running` \| `done` \| `error`                                                                                                                                               |
| `chainSchema`             | `bsc-mainnet` \| `base-sepolia` \| `ipfs` (BSC testnet deliberately absent — four.meme's TokenManager2 is only deployed on BSC mainnet)                                                   |
| `artifactSchema` (`kind`) | `bsc-token` \| `token-deploy-tx` \| `lore-cid` \| `x402-tx` \| `tweet-url` \| `heartbeat-tick` \| `heartbeat-decision` \| `meme-image` \| `lore-anchor` \| `shill-order` \| `shill-tweet` |
| SSE payloads              | `LogEventPayload`, `ArtifactEventPayload`, `StatusEventPayload`, `ToolUseStartEventPayload`, `ToolUseEndEventPayload`, `AssistantDeltaEventPayload`                                       |
| `chatMessageSchema`       | `{ role: 'user' \| 'assistant', content: string }` (used in BrainChat `messages[]`)                                                                                                       |
| `Persona<TInput,TOutput>` | `{ id: PersonaId, run(input, ctx): Promise<TOutput> }` — satisfied by every `persona-adapters.ts` wrapper                                                                                 |

## Web Surface — Sticky-Stage Scrollytelling

`apps/web/src/app/page.tsx` renders **one** sticky viewport (`position: sticky; top: 56px`) that hosts all 12 chapters as absolutely positioned tiles. Scroll progress — measured by `useScrollY()` + `useActiveChapter()` — drives per-chapter `opacity / scale / blur` cross-fades inside `<StickyStage>`. No `translateY` anywhere; the scroll never pushes chapters off-screen.

| #   | Chapter id           | Role                                                                           | Runtime coupling              |
| --- | -------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| 1   | `hero`               | Title card, `PAY USDC. GET TWEETS.` hook, CTA can pre-fill BrainPanel composer | None                          |
| 2   | `problem`            | Graveyard ticker + grid + IntersectionObserver play/pause                      | None                          |
| 3   | `solution`           | Three-card fix with x402 micro-animation pill                                  | None                          |
| 4   | `brain-architecture` | Brain-runtime / persona pluggability diagram                                   | None                          |
| 5   | `launch-demo`        | Inline Creator demo — LaunchPanel typing + run trigger                         | `useRun` + `useBrainChat`     |
| 6   | `order-shill`        | Inline Shiller demo — OrderPanel + shill tweet feed                            | `useRun` + `useBrainChat`     |
| 7   | `heartbeat-demo`     | Heartbeat pulse animation + tick feed                                          | Reads shared RunState context |
| 8   | `take-rate`          | Revenue-mix bar chart: 1 live SKU (shill at $0.01) + 3 planned                 | None                          |
| 9   | `sku-matrix`         | SKU grid: SHILL.ORDER (live) vs three planned SKUs                             | None                          |
| 10  | `phase-map`          | Phase 1 / Phase 2 / Phase 3 roadmap with shipped-vs-future chips               | None                          |
| 11  | `evidence`           | Five on-chain evidence pills + CTA that fires `memind:open-brain` CustomEvent  | Dispatches BrainPanel open    |

**Why sticky-stage over per-section layout**: one viewport-sized sticky container cross-fades between 12 chapter components, so the active chapter is always vertically centred and the scroll feels deterministic. Chapter meta + scroll-target math (`CHAPTER_META`, `SLOT_VH`, `chapterScrollTarget`, `resolveChapterIndexFromHash`) live in `lib/chapters.ts`. Reduced motion is honoured through both the OS media query (`useReducedMotion`) and the in-page `<TweaksPanel>` — either source short-circuits the cross-fade to the final state.

## Brain Conversational Surface

`<BrainPanel>` (right-side slide-in) mounts `<BrainChat>`, which streams `brain-chat` runs. Open paths:

- TopBar `<BrainIndicator>` click (always available)
- `Ch12Evidence` CTA dispatches `memind:open-brain` CustomEvent with optional draft
- Hero / Ch5 / Ch6 inline CTAs pre-fill the composer via `openBrain(draft?)`

Slash commands (`lib/slash-commands.ts`) are resolved client-side; server-kind ones (`/launch /order /lore /heartbeat`) are sent as `messages[0].content` to `POST /api/runs {kind:'brain-chat'}`. Client-only (`/help /reset /status`) never hit the server. `useSlashPalette` filters the registry by scope + prefix; `useBrainChat-state` reduces `assistant:delta` + `tool_use:*` + status SSE events into grouped chat bubbles; `useRunStateContext` mirrors the same events into `<LogsDrawer>` so Logs / Artifacts / Console tabs show the live run regardless of which surface triggered it.

## External Dependencies

| Dependency                                                         | Purpose                                                                          | Fallback plan                                                                                                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@x402/express` v2.10+                                             | x402 server middleware (paymentMiddleware + x402ResourceServer)                  | No fallback (real Base Sepolia settlement proven end-to-end via probe)                                                                                               |
| `@x402/fetch` v2.10+                                               | Market-maker client auto-payment (wrapFetchWithPayment + ExactEvmScheme)         | Hand-assemble HTTP + EIP-3009                                                                                                                                        |
| `@x402/evm` + `@x402/core` v2.10+                                  | EVM scheme implementation + decodePaymentResponseHeader                          | No fallback                                                                                                                                                          |
| `@four-meme/four-meme-ai@1.0.8` CLI (invoked via `npx` shell-exec) | four.meme token deployment (**BSC mainnet only**; official scoped package)       | viem direct call against the TokenManager2 ABI (`0x5c95...762b`, mainnet)                                                                                            |
| `pinata` v2.5+                                                     | IPFS pinning (JWT-authenticated; shared by lore and lore-extend)                 | AWS S3 + fake hash (demo fallback)                                                                                                                                   |
| LLM SDK                                                            | Backs every agent loop; configurable via env                                     | No fallback                                                                                                                                                          |
| Image-generation SDK                                               | Meme image generation for the Creator persona                                    | No fallback                                                                                                                                                          |
| X API v2 (`api.x.com/2/tweets`)                                    | `post_to_x` posting — hand-written OAuth 1.0a User Context; no third-party OAuth | Before credit top-up, dry-run stub. Real posts are pay-per-usage — re-verify pricing before a live demo. Do not embed URLs in post bodies (URL-post surcharge risk). |
| `viem` v2                                                          | EOA wallet, event-log reads, BSC RPC and Base Sepolia RPC                        | No fallback                                                                                                                                                          |
| `motion@12` (web only)                                             | BrainPanel slide + chapter micro-animations                                      | CSS transitions                                                                                                                                                      |
| Base Sepolia USDC                                                  | x402 settlement asset                                                            | No fallback                                                                                                                                                          |

## Security / Secrets

- **All private keys live in `.env.local`**, guarded by `.gitignore`. They must never land in the repo.
- **Wallet separation**: the agent runtime wallet (Base Sepolia test USDC, x402 payments) and the four.meme deployment wallet (**BSC mainnet real BNB**, ~$1 covers many deploys) are distinct EOAs.
- **x402 facilitator URL and scheme** default to `@x402/*` v2 on Base Sepolia (`eip155:84532`); we do not self-host. Facilitator: `https://x402.org/facilitator`.
- **X API credentials** (5 OAuth 1.0a fields) are shared between `heartbeat.post_to_x` and `shiller.post_shill_for`; the same aged account is used for both to preserve trust score.
