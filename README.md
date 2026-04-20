# Memind

> **Every memecoin gets a brain. And a wallet.**
>
> _Memind = meme + mind. On Four.meme._

> **Every memecoin gets its own Memind: a runtime with persistent memory, pluggable personas, and on-chain-paid autonomy.** One Memind (each Memind is internally a **Brain runtime**), five personas plus a Brain meta-agent, paid over [x402](https://github.com/coinbase/x402). The **Creator persona** deploys a real BSC mainnet token and writes chapter 1 of its **lore** (the token's AI-generated origin codex). The **Narrator persona** reads chapter 1 and continues to chapter 2. Every chapter is served from an x402-paid endpoint so other personas (and other Meminds) pay 0.01 USDC to read it as alpha. The **Market-maker persona** pays for lore to drive its decisions; the **Shiller persona** uses the same lore to draft on-voice tweets creators commission at 0.01 USDC each, posted from a real aged X account. The **Heartbeat persona** ticks every 60s, deciding on its own when to extend lore, post, or idle. The **Brain meta-agent** sits on top and dispatches to any of the above when a human talks to the Memind through the BrainPanel. **Paid shilling is the first shipped SKU; Launch Boost, Community Ops, Alpha Feed (all sell-side) plug into the same Memind next. No new runtime, just new personas.**

[![Hackathon](https://img.shields.io/badge/Four.Meme-AI%20Sprint-f0b000)](https://dorahacks.io/hackathon/fourmemeaisprint) [![License](https://img.shields.io/badge/license-AGPL--3.0-emerald)](#license) [![Tests](https://img.shields.io/badge/tests-970%20green-emerald)](#evidence-on-chain--in-repo)

## TL;DR

- **The thesis**: memecoins have a discovery problem, not a minting problem. Launchers abandon their tokens at hour 0 because post-launch ops is more work than the mint. We give every token its own **Memind** that takes over: writes the lore, posts the tweets, reads the chain, decides what to do next. The creator only mints.
- **The loop**: the Memind's Creator persona deploys a real BSC mainnet token in **67s** and writes lore chapter 1 → Narrator persona continues chapter 2 → Market-maker persona pays 0.01 USDC on Base Sepolia via x402 to read lore as alpha → Shiller persona reads the same lore to post an on-voice tweet from a real aged X account when the creator commissions one → Heartbeat persona ticks on its own and decides what the Memind does next.
- **Why this is a primitive, not a feature**: paid shilling is SKU 1, shipped. Every future SKU (Launch Boost, Community Ops, Alpha Feed, all sell-side) is a **new persona plugged into the same Memind**, not a new product. `Persona<TInput, TOutput>` is an explicit interface; new SKUs ship as ~50 lines of systemPrompt + tool subset.
- **1 Memind (Brain runtime), 5 personas + Brain meta-agent, 15 typed tools, 970 green tests.** x402 integration settles real USDC every `pnpm test`. Shiller tweets support a toggleable four.meme click-through URL (default off during X's 7-day post-OAuth cooldown; toggle on post-cooldown for attribution).
- **Product-grade surface**: 11-chapter sticky-stage scrollytelling (Hero → Problem → Solution → Brain Architecture → Launch Demo → Shill Demo → Heartbeat → Take Rate → SKU Matrix → Phase Map → Evidence). TopBar `BrainIndicator` streams the live run state; a right-side `<BrainPanel>` slides in a conversational surface with slash commands (`/launch /order /lore /heartbeat [intervalMs] [maxTicks] /heartbeat-stop /heartbeat-list /clear`). Background heartbeat ticks push live into the chat as dedicated bubbles via a dedicated SSE stream (`/api/heartbeats/:addr/events`) so the autonomous loop is visible, not silent. Engineering detail (logs / artifacts / console) lives in a `D`-to-open `<LogsDrawer>`. Product-first up-front, engineer-deep on demand.
- Hackathon: [Four.Meme AI Sprint](https://dorahacks.io/hackathon/fourmemeaisprint)
- Architecture: [`docs/architecture.md`](./docs/architecture.md)

## Problem

Four.meme saw 32k spam tokens land in a single October 2025 day, and across memecoins 97% of tokens die inside 48 hours because launchers abandon them after the mint. Minting is cheap; **discovery is not**. Four.meme's March 2026 [Agentic Mode](https://four.meme) roadmap answers with three phases: Phase 1 (Agent Skill Framework) is live; Phase 2 (agent-to-agent commerce) and Phase 3 (autonomous economic loop) have no public reference implementation. This repo fills that gap.

## How it works: the agent commerce loop

Every memecoin should have a **soul**, not just a contract address. We give each token a **Memind**; inside that Memind, four personas trade services around the lore.

**Lore** = the AI-generated origin codex of a token. Think of it as Pokémon card back-story, NFT collection world-building, or MMO world-codex, but for a memecoin: split into numbered chapters, pinned to IPFS, and served from a paid x402 endpoint.

```
┌──────────────┐  writes  ┌──────────────┐  extends  ┌──────────────┐
│ Creator      │ ───ch1──►│  LoreStore   │◄───ch2──── │ Narrator     │
│ (supply)     │          │  (IPFS CIDs) │            │ (supply)     │
└──────┬───────┘          └──────┬───────┘            └──────────────┘
       │ deploys                 │ served by
       ▼                         ▼
┌──────────────┐          ┌─────────────────┐      ┌──────────────┐
│ BSC mainnet  │          │ x402 /lore/:addr│◄─pays│ Market-maker │
│ four.meme    │          │ 0.01 USDC       │  USDC│ (demand)     │
│ TokenManager │          └─────────────────┘  via └──────────────┘
└──────────────┘                  ▲            x402
                                  │ reads same lore
                         ┌────────┴────────┐       ┌──────────────┐
                         │ Shiller persona │◄─pays─│ Creator      │
                         │ (demand, $SKU1) │  0.01 │ (human via   │
                         │ posts on X      │  USDC │  /market)    │
                         └─────────────────┘       └──────────────┘
```

Three observations that make this a **primitive** rather than a one-off app:

1. **Same lore, multiple buyers.** Market-maker and Shiller both pay to read the identical chapter. Add more sell-side SKUs (Launch Boost, Community Ops, Alpha Feed) and they all share the lore substrate. Zero new infrastructure.
2. **Same rail, multiple payers.** x402 settles from agents (Market-maker paying Narrator) or from humans (Creator paying the Shiller) through the exact same EIP-3009 / Base Sepolia USDC flow.
3. **Same tweet, real click-through.** Shiller tweets lead with `$SYMBOL` and end with `https://four.meme/token/0x...`. Every demo tweet is a live backlink to four.meme.

## What we built

- **Agent commerce primitive**: the four-persona loop above, fully wired inside one Memind. `Creator` + `Narrator` sit on the supply side (write + extend lore); `Market-maker` + `Shiller` sit on the demand side (pay to consume lore, each for their own downstream purpose). A **Brain meta-agent** dispatches to any of the four via `invoke_*` tool factories when the user talks to the Memind through the BrainPanel.
- **Paid shilling (SKU 1, shipped).** Creator UI takes tokenAddr + optional brief, pays 0.01 USDC via x402, and the Shiller persona posts a real tweet from an aged X account within ~6 seconds. Click-through back to `four.meme/token/<addr>`.
- **5 personas + Brain meta-agent on one tool-use runtime (one Memind = one Brain runtime per memecoin)**: Creator / Narrator / Market-maker (dual-mode: a2a lore buyer or creator-paid Shiller) / Heartbeat (`setInterval` autonomous tick) / Brain (meta-agent that dispatches to the others).
- **Typed tool registry** (`AgentTool<TIn, TOut>`): `narrative_generator`, `meme_image_creator`, `onchain_deployer`, `lore_writer`, `extend_lore`, `check_token_status`, `post_to_x`, `post_shill_for`, `x402_fetch_lore`, plus six Brain meta-agent factories (`invoke_creator`, `invoke_narrator`, `invoke_shiller`, `invoke_heartbeat_tick`, `stop_heartbeat`, `list_heartbeats`).
- **x402 server on `@x402/express` v2**, four paid endpoints (paths + prices in `apps/server/src/x402/config.ts`): `GET /lore/:addr` ($0.01, `LoreStore`-backed), `GET /alpha/:addr` ($0.01, mock payload), `GET /metadata/:addr` ($0.005, mock payload), `POST /shill/:tokenAddr` ($0.01, creator-paid; enqueues a Shiller order).
- **Postgres-backed state**: `LoreStore` (per-token chapter chain, not just latest), `AnchorLedger`, `ShillOrderStore`, `HeartbeatSessionStore`, and `ArtifactLogStore` all persist through a shared pg pool. Counters survive process restarts; `ensureSchema` resets any ghost `running=true` heartbeat rows at boot so the UI never shows phantom loops.
- **Live heartbeat loop**: `/heartbeat <addr> <ms> [maxTicks]` starts a real `setInterval`-driven background session (default cap 5 ticks to keep a production demo from farming API budget); `/heartbeat-list` reports which tokens are still pulsing, `/heartbeat-stop` kills one. Every tick fans out through an in-process event bus → SSE endpoint → dedicated `heartbeat` chat bubble with the tweet URL or IPFS CID the persona produced.
- **Next.js 15 product surface** (Terminal Cyber on Tailwind v4 + `motion@12`): a single sticky viewport cross-fades between 11 chapters (Hero → Problem → Solution → Brain Architecture → Launch Demo → Shill Demo → Heartbeat → Take Rate → SKU Matrix → Phase Map → Evidence). TopBar exposes chapter progress + a `<BrainIndicator>` that opens a right-side `<BrainPanel>`; slash commands (`/launch /order /lore /heartbeat /status /help /reset`) dispatch to the Brain meta-agent. All engineering panels (logs / artifacts / brain console) live inside a collapsible `<LogsDrawer>` (`D` to open, `Esc` to close, `prefers-reduced-motion` fully respected).
- **CLI demos** sharing the orchestration path: `demo:creator`, `demo:a2a`, `demo:heartbeat`, `demo:shill`.

## Architecture

```mermaid
flowchart TB
  subgraph Browser["Browser (Next.js 11-chapter surface)"]
    UI[StickyStage scrollytelling + BrainPanel slash commands]
    SSE[EventSource /api/runs/:id/events]
    UI --> SSE
  end

  subgraph Server["Node server (port 4000)"]
    direction TB
    RunsAPI["Runs API<br/>POST /api/runs · GET /api/runs/:id · GET /api/runs/:id/events (SSE)"]
    RunStore[[RunStore<br/>Map + per-run EventEmitter<br/>+ replay buffer]]
    subgraph Runtime["Agent Runtime (runAgentLoop + ToolRegistry)"]
      Creator[Creator]
      Narrator[Narrator]
      Market[Market-maker / Shiller]
      Heart[Heartbeat tick loop]
      BrainMeta[Brain meta-agent]
    end
    subgraph Tools["Tool Registry (10+)"]
      T1[narrative_generator]
      T2[meme_image_creator]
      T3[onchain_deployer]
      T4[lore_writer · extend_lore]
      T5[check_token_status]
      T6[post_to_x · post_shill_for]
      T7[x402_fetch_lore]
      T8[invoke_* persona factories x4]
    end
    State[[LoreStore · AnchorLedger · ShillOrderStore]]
    X402Server["x402 Server<br/>/lore /alpha /metadata /shill (paid)"]
    RunsAPI <--> RunStore
    RunStore --> Runtime
    Runtime --> Tools
    BrainMeta -. invokes .-> Creator
    BrainMeta -. invokes .-> Narrator
    BrainMeta -. invokes .-> Market
    BrainMeta -. invokes .-> Heart
    Narrator -. upsert .-> State
    State -. read .-> X402Server
  end

  subgraph External["External networks"]
    BSC[(BSC mainnet<br/>Four.meme TokenManager2)]
    Pinata[(Pinata IPFS)]
    LLM[(LLM gateway)]
    ImageGen[(Image model)]
    XAPI[(X API v2)]
    BaseSep[(Base Sepolia<br/>x402 facilitator + USDC)]
  end

  SSE <-->|REST + SSE<br/>same-origin rewrite| RunsAPI
  T3 --> BSC
  T4 --> Pinata
  T2 --> ImageGen
  T6 --> XAPI
  Runtime --> LLM
  Market -- pays 0.01 USDC --> X402Server
  X402Server -- 402 / settle --> BaseSep
```

Per-flow detail (Creator mint / Narrator publish / a2a settle / Heartbeat tick / Dashboard a2a) lives in [`docs/architecture.md`](./docs/architecture.md).

## Evidence (on-chain + in-repo)

Every row links to a real explorer page. Run #3 hash reproduces a Base Sepolia settlement from the dashboard; the Phase 1 probe is the independent hello-world settlement.

| Artifact                                   | Network      | Hash / CID                                                                                                          |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| four.meme token                            | BSC mainnet  | [`0x4E39…4444`](https://bscscan.com/token/0x4E39d254c716D88Ae52D9cA136F0a029c5F74444)                               |
| Token deploy tx (Phase 2, 67s Creator run) | BSC mainnet  | [`0x760f…0c9b`](https://bscscan.com/tx/0x760ff53f84337c0c6b50c5036d9ac727e3d56fa4ad044b05ffed8e531d760c9b)          |
| Narrator lore CID (Run #3, IPFS v0)        | IPFS         | [`QmWoMk…TVX7`](https://gateway.pinata.cloud/ipfs/QmWoMkPuPekMXp4RwWKenADMi74mqaZRG3fcEuGovATVX7)                   |
| x402 settlement (Run #3, 0.01 USDC)        | Base Sepolia | [`0x62e4…c3df`](https://sepolia.basescan.org/tx/0x62e442cc9ccc7f57c843ebcfc52f777f3cd9188b9172583ee4cefa60e5a1c3df) |
| Phase 1 x402 probe settlement              | Base Sepolia | [`0x4331…000a`](https://sepolia.basescan.org/tx/0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a) |

**Run #3 note**: `from` and `to` both resolve to `0xaE2E51D0…D6d78` because a single agent EOA carries both x402 roles in the demo: Market-maker as payer, Narrator's `/lore/:addr` as `payTo`. EIP-3009 `transferWithAuthorization`, facilitator relay, and 0.01 USDC movement are all real on-chain; wallet multiplexing is demo-only and would split into `AGENT_WALLET_*` and a future `NARRATOR_WALLET_*` in production.

In-repo evidence: **970 green tests** (`packages/shared` 84 / `apps/server` 459 / `apps/web` 427) including real Base Sepolia x402 settle integration on every `pnpm test`; `tsc --noEmit` clean across the workspace.

## Tech stack

- **Frontend**: Next.js 15 App Router, React 19, Tailwind v4, `motion@12`, TypeScript strict, native `EventSource`. **Backend**: Node 22+, Express, TypeScript strict, pnpm workspace.
- **Agent runtime**: shared LLM SDK + typed tool registry; persona model id configurable via env. **Image**: env-configurable image model.
- **Payments**: `@x402/express` / `@x402/fetch` / `@x402/evm` / `@x402/core` v2.10; Base Sepolia USDC + `x402.org/facilitator`. **Wallet**: `viem` v2 (BSC mainnet for Four.meme, Base Sepolia for x402).
- **Four.meme ops**: `@four-meme/four-meme-ai@1.0.8` CLI + TokenManager2 partial ABI fallback. **IPFS**: `pinata` v2 (JWT). **X posting**: API v2 `POST /2/tweets`, hand-written OAuth 1.0a via `node:crypto`.
- **Validation**: `zod` shared schemas. **Testing**: `vitest`. **Quality**: `eslint` v9, `prettier` v3, `tsc --noEmit`, `husky` + `lint-staged`.

## Reproduce the demo

### Prerequisites

- Node **22+** (Node 25 on macOS can break native libs; pin via `nvm` or `brew install node@22`)
- `pnpm` 10+
- Base Sepolia agent wallet with ≥ 0.1 USDC + dust ETH for gas
- (Optional, full Creator flow) BSC mainnet wallet with ≥ 0.01 BNB (`deployCost=0` + ~$0.05 gas)
- LLM API key (either `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`), image-generation key, Pinata JWT — see [.env.example](./.env.example) for the full list
- (Optional, live X posting) X developer app creds + ~$5 credit

### `.env.local` template

Copy [`.env.example`](./.env.example) to `.env.local` and fill:

```bash
cp .env.example .env.local
```

- **a2a demo**: `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`), `AGENT_WALLET_PRIVATE_KEY` + `AGENT_WALLET_ADDRESS`, `PINATA_JWT`, image-generation key.
- **Full Creator flow**: `BSC_DEPLOYER_PRIVATE_KEY` + `BSC_DEPLOYER_ADDRESS`.
- **Heartbeat live posting** (else dry-run stub): `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `X_BEARER_TOKEN`.
- **Pre-seed** (lights all 5 pills without re-deploy): `DEMO_TOKEN_ADDR`, `DEMO_TOKEN_DEPLOY_TX`, `DEMO_CREATOR_LORE_CID`.

### Install + run

```bash
# Node 25 on macOS can break native libs; always use Node 22.
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

pnpm install

# Terminal 1
pnpm --filter @hack-fourmeme/server dev      # http://localhost:4000

# Terminal 2
pnpm --filter @hack-fourmeme/web dev         # http://localhost:3000
```

Open `http://localhost:3000`, scroll through the 11 chapters, and either: (a) trigger a run from the inline Launch / Shill demo chapters, or (b) click the TopBar `<BrainIndicator>` to slide out the BrainPanel and type `/launch <theme>` or `/order <tokenAddr>`. The server POSTs `/api/runs`, the browser subscribes to SSE, and Ch11 Evidence lights its on-chain pills (plus a real Base Sepolia settlement). The fifth pill lights when `DEMO_CREATOR_LORE_CID` is set.

### Full Creator flow (optional, ~$0.05 BNB gas for the BSC deploy)

```bash
pnpm --filter @hack-fourmeme/server demo:creator
```

### Other CLI demos

```bash
pnpm --filter @hack-fourmeme/server demo:a2a          # a2a flow, no browser
pnpm --filter @hack-fourmeme/server demo:heartbeat    # tick loop (needs TOKEN_ADDRESS env)
pnpm --filter @hack-fourmeme/server demo:shill        # shill market fulfilment
```

### Tests + quality gates

```bash
pnpm typecheck         # tsc --noEmit across the workspace
pnpm lint              # eslint
pnpm format:check      # prettier --check
pnpm test              # vitest; 970 tests; x402 settles real USDC once
pnpm --filter @hack-fourmeme/web build   # Next.js production build sanity
```

## Known gaps

Hackathon credibility comes from honesty about deferred items.

- **AC3 · on-chain anchor not implemented.** Moving chapter CIDs through `LoreStore` + SSE was cheaper than subscribing to a BSC event log; the log-queue screenshot fallback is a Day 5 task.
- **AC5 · demo video not yet recorded.**
- **AC7 · live X posts blocked on $5 credit top-up.** Heartbeat runtime, `post_to_x`, `check_token_status`, `extend_lore` are implemented and tested; `--dry-run` proves the wiring end-to-end.
- **`/alpha/:addr` and `/metadata/:addr` remain mocks.** They exercise the paid path but return canned payloads; `/lore/:addr` is real via `LoreStore`.
- **Single-EOA x402 settlement in the demo.** Market-maker payer and Narrator `payTo` both resolve to `AGENT_WALLET_*`. The EIP-3009 handshake and USDC movement are real; splitting wallets is a documented production upgrade.

## FAQ

**Q: Why is settlement on Base Sepolia but the token on BSC mainnet?**
A: Four.meme only runs on BSC mainnet. That's a sponsor constraint, not a choice. The production-grade x402 facilitator ships on Base Sepolia USDC (Coinbase CDP reference implementation); the BSC-native path (x402b testnet + Pieverse facilitator) was probed dead on Day 1: five months unmaintained, no public endpoint. The split is transitional. When a BNB-native x402 facilitator matures, the application layer doesn't change, only the chain constant. Every settlement is on-chain verifiable on its own explorer (BscScan + Base Sepolia BaseScan).

**Q: Is the Memind an AGI or autonomous AI?**
A: **No.** "Memind" names a runtime that (a) persists memory across ticks, (b) hosts multiple tool-use personas, (c) makes autonomous decisions on a heartbeat. All three are concrete, shipped, and bounded. We deliberately avoid AGI / sentient / self-improving language. The Memind is a product primitive, not a consciousness claim.

**Q: Does a Memind trade memecoins on its own?**
A: **No, by product design.** Memind personas trade **services** (lore authorship, promotional tweets, curation) paid in USDC, not the underlying token. The four persona tools (`invoke_creator` / `invoke_narrator` / `invoke_shiller` / `invoke_heartbeat_tick`) include no token-swap capability; no persona holds discretionary custody over user funds. Every inter-agent payment carries a service identifier on the x402 request, so service trades are distinguishable from self-dealing. This framing aligns with Four.meme's post-2025-10 creator-protection posture and sidesteps the wash-trading reclassification risk that haunts roughly half of x402 volume today (Artemis public data).

**Q: Does the Shiller persona's X posting violate platform policy?**
A: The persona's X account is human-owned, OAuth 1.0a authorised, and pays per-usage through X's `Content: Create` endpoint (~$0.01/post). Posting cadence passes a human-plausibility test: tick interval ≥ 60s in production, no cross-account coordination, no identical copy across tweets, no `@mention` to strangers. Nothing about the integration is automation-evasive.

**Q: Why do x402 payments show the same EOA as both payer and payee in the demo?**
A: Demo-only wallet multiplexing. A single `AGENT_WALLET_*` plays both Market-maker (payer) and Narrator endpoint owner (payTo) to simplify the submission. The EIP-3009 `transferWithAuthorization`, facilitator relay, and USDC movement are all real on-chain. Production splits into distinct `AGENT_WALLET_*` and `NARRATOR_WALLET_*`. That's a one-env-var upgrade documented in `## Known gaps`.

**Q: What does running a Memind cost?**
A: Published vendor rates only; no custom pricing. A Creator run lands a real four.meme token for roughly **$0.05 BSC gas** (plus a few cents of LLM + image-generation inference, both env-configurable so the exact cents depend on the model you wire up) plus the optional $0.01 X post. A shill-order fulfilment run is a fraction of a cent on the LLM side plus the $0.01 X post. A Base Sepolia x402 settlement on testnet USDC is effectively free. Every unit-economics line is auditable from the underlying provider's public rate card.

**Q: Why wouldn't Four.meme build this themselves?**
A: They may, eventually. Short term: this is an early Phase 1–2 reference implementation of their own Agentic Mode roadmap. Mid term (1–3 months): Four.meme may fork or extend this. Long term: the official team will outrun a hackathon build on productisation. The goal of this repo is **narrative alignment with the roadmap and a working commerce primitive**, not to compete on productisation.

**Q: Why the brand name "Memind" if the runtime is called a Brain?**
A: "Memind" is the product surface: _every memecoin gets a brain. And a wallet._ "Brain runtime" is the architectural primitive inside. Separating brand vocabulary from code identifiers lets us ship the new brand without renaming 40+ files (`brain-panel.tsx`, `BrainIndicator`, `brainPersona`, etc. all keep their in-code names for continuity).

## Links

- Hackathon: https://dorahacks.io/hackathon/fourmemeaisprint
- x402 protocol: https://github.com/coinbase/x402
- Four.meme: https://four.meme
- Architecture: [`docs/architecture.md`](./docs/architecture.md)
- Demo video: <!-- TODO: paste URL after recording -->

## License

AGPL-3.0. See [`LICENSE`](./LICENSE). Any derivative work or networked service built on this code must release its modified source under the same license. For proprietary or closed-source use, contact the author for a commercial license. Built by [@mymaine](https://github.com/mymaine) for the 2026-04 Four.Meme AI Sprint.
