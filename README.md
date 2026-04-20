# Memind

> **Every memecoin gets a brain. And a wallet.**
>
> _Memind = meme + mind. On Four.meme._

Every memecoin gets its own **Memind**: a runtime with persistent memory, pluggable personas, and on-chain-paid autonomy. Four personas + a Brain meta-agent, paid over [x402](https://github.com/coinbase/x402).

[![License](https://img.shields.io/badge/license-AGPL--3.0-emerald)](#license) [![Tests](https://img.shields.io/badge/tests-1168%20green-emerald)](#evidence)

## TL;DR

- **Thesis**: memecoins die in 48 hours because creators abandon them after mint. A Memind takes over the long-term narrative and trades services with other Meminds — **lifecycle extends from 48 hours to months**.
- **Loop**: Creator deploys a real BSC mainnet token in **67s** + writes lore chapter 1 → Narrator writes chapter 2 → Market-maker pays 0.01 USDC via x402 to read lore as alpha → Shiller posts on-voice tweets creators commission at 0.01 USDC each → Heartbeat ticks on its own.
- **Why a market, not a feature**: x402 settlement turns every inter-persona call into a USDC-priced trade. Same lore, multiple buyers. Same rail, multiple payers. `Persona<TInput, TOutput>` is the interface; the market is the economic primitive.
- **1 Memind, 4 personas + Brain meta-agent, 15 typed tools, 1168 green tests.** x402 settles real USDC every `pnpm test`.

## Problem

Four.meme saw [32k spam tokens land in a single day in October 2025](https://coinspot.io/en/cryptocurrencies/four-meme-increased-the-token-launch-fee-to-fight-spam-and-toxic-memes/), and across memecoins [97% eventually die](https://chainplay.gg/blog/state-of-memecoin-2024/) because launchers abandon them after mint. Minting is cheap; **discovery is not**.

Four.meme's [March 2026 AI Agent roadmap](https://phemex.com/news/article/fourmeme-reveals-ai-agent-roadmap-for-bnb-chain-integration-63946) lays out three phases: **Phase 1 — Agent Skill Framework** (live); **Phase 2 — Executable AI Agents with LLM Chat**; **Phase 3 — Agentic Mode** (on-chain AI identities). **Phase 2 has no public reference implementation. This repo is one.** Phase 3 (BAP-578 NFA + TEE wallet + ERC-8004 reputation) is roadmapped, not shipped — see the [wallet custody FAQ](#faq).

## How it works

Every Memind has a single conversational entry — the **Brain meta-agent**. Users talk to it through BrainPanel slash commands; Brain picks the right persona via an `invoke_*` tool call; the persona fires the right typed tools. Natural language in, on-chain action out.

```
┌────────────────────────────────────────────────────────────┐
│  User  —  BrainPanel chat (conversational, not config)     │
│                                                            │
│   /launch a cyberpunk cat coin                             │
│   /order 0x4E39…4444 drop some alpha about the next dip    │
│   /heartbeat 0x4E39…4444 60000 10                          │
└──────────────────────────────┬─────────────────────────────┘
                               ▼
          ┌──────────────────────────────────────────────┐
          │               Brain meta-agent               │
          │             (invoke_* dispatch)              │
          └────┬───────────┬───────────┬───────────┬─────┘
               │           │           │           │
               ▼           ▼           ▼           ▼
          ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
          │ Creator │ │Narrator │ │ Shiller │ │Heartbeat │
          │         │ │         │ │         │ │  (auto)  │
          └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘
               │           │           │           │
               └───────────┴─────┬─────┴───────────┘
                                 ▼
          ┌──────────────────────────────────────────────┐
          │  15 typed tools                              │
          │  • narrative + image generators              │
          │  • onchain_deployer  → BSC mainnet           │
          │  • lore_writer / extend_lore → IPFS          │
          │  • post_to_x / post_shill_for → X            │
          │  • x402_fetch_lore → Base Sepolia            │
          │  • check_token_status → BSC RPC              │
          └──────────────────────────────────────────────┘
```

Under the hood, those four personas collaborate around the **lore** — the AI-generated origin codex of the token, split into numbered chapters, pinned to IPFS, served from a paid x402 endpoint. That collaboration is a self-sustaining USDC-priced market:

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
                         │ posts on X      │  USDC │  /order)     │
                         └─────────────────┘       └──────────────┘
```

Three properties that make this a **primitive** rather than a one-off app:

1. **Same lore, multiple buyers.** Market-maker and Shiller both pay to read the identical chapter. New sell-side SKUs (Launch Boost, Community Ops, Alpha Feed) share the lore substrate — zero new infrastructure.
2. **Same rail, multiple payers.** x402 settles from agents or humans through the exact same EIP-3009 / Base Sepolia USDC flow.
3. **Same tweet, real click-through (opt-in).** Shiller tweets lead with `$SYMBOL` and can append `https://four.meme/token/0x...` for attribution, gated by a flag that defaults off during X's 7-day post-OAuth cooldown.

## What we built

- **Agent commerce loop, fully wired.** Creator + Narrator supply lore; Market-maker reads it as alpha (a2a) or switches to Shiller mode for creator-commissioned tweets; Heartbeat ticks autonomously. A **Brain meta-agent** dispatches to any of them when a human talks to the Memind through the BrainPanel.
- **Paid shilling (SKU 1, shipped).** `/order <tokenAddr>` from BrainPanel (or `pnpm demo:shill`) settles 0.01 USDC via x402 on Base Sepolia, enqueues the order, and Shiller posts a real tweet from an aged X account within ~6 seconds.
- **x402 server on `@x402/express` v2**, four paid endpoints (paths + prices in `apps/server/src/x402/config.ts`): `GET /lore/:addr` ($0.01, `LoreStore`-backed), `GET /alpha/:addr` ($0.01, mock), `GET /metadata/:addr` ($0.005, mock), `POST /shill/:tokenAddr` ($0.01, creator-paid).
- **Typed tool registry** (`AgentTool<TIn, TOut>`, 15 total): 9 domain tools (`narrative_generator`, `meme_image_creator`, `onchain_deployer`, `lore_writer`, `extend_lore`, `check_token_status`, `post_to_x`, `post_shill_for`, `x402_fetch_lore`) + 6 Brain meta-agent factories (`invoke_creator` / `invoke_narrator` / `invoke_shiller` / `invoke_heartbeat_tick` / `stop_heartbeat` / `list_heartbeats`).
- **Postgres-backed state**: `LoreStore` (per-token chapter chain, not just latest), `AnchorLedger`, `ShillOrderStore`, `HeartbeatSessionStore`, `ArtifactLogStore`. Counters survive restarts; `ensureSchema` resets ghost `running=true` rows at boot.
- **Live heartbeat loop**: `/heartbeat <addr> <ms> [maxTicks]` drives a real `setInterval` background session (default cap 5). Every tick fans out via SSE into a dedicated chat bubble with the tweet URL or IPFS CID.
- **Next.js 15 product surface**: 12-chapter sticky-stage scrollytelling + right-side `<BrainPanel>` with 10 slash commands (`/launch /order /lore /heartbeat /heartbeat-stop /heartbeat-list /status /help /reset /clear`). Evidence chapter hydrates from Postgres on page refresh. Engineering panels live in a `D`-to-open `<LogsDrawer>`.
- **CLI demos** sharing the orchestration path: `demo:creator`, `demo:a2a`, `demo:heartbeat`, `demo:shill`.

## Architecture

Full topology, per-flow diagrams, and module boundaries live in [`docs/architecture.md`](./docs/architecture.md).

## Evidence

Every row links to a real explorer page. Run #3 is a Base Sepolia settlement produced by `pnpm demo:a2a`; the Phase 1 probe is the hello-world settlement re-run against the real facilitator on every `pnpm test`.

| Artifact                                   | Network      | Hash / CID                                                                                                          |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| four.meme token                            | BSC mainnet  | [`0x4E39…4444`](https://bscscan.com/token/0x4E39d254c716D88Ae52D9cA136F0a029c5F74444)                               |
| Token deploy tx (Phase 2, 67s Creator run) | BSC mainnet  | [`0x760f…0c9b`](https://bscscan.com/tx/0x760ff53f84337c0c6b50c5036d9ac727e3d56fa4ad044b05ffed8e531d760c9b)          |
| Narrator lore CID (Run #3, IPFS v0)        | IPFS         | [`QmWoMk…TVX7`](https://gateway.pinata.cloud/ipfs/QmWoMkPuPekMXp4RwWKenADMi74mqaZRG3fcEuGovATVX7)                   |
| x402 settlement (Run #3, 0.01 USDC)        | Base Sepolia | [`0x62e4…c3df`](https://sepolia.basescan.org/tx/0x62e442cc9ccc7f57c843ebcfc52f777f3cd9188b9172583ee4cefa60e5a1c3df) |
| Phase 1 x402 probe settlement              | Base Sepolia | [`0x4331…000a`](https://sepolia.basescan.org/tx/0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a) |

**Run #3 note**: `from` and `to` both resolve to `0xaE2E51D0…D6d78` because a single agent EOA carries both x402 roles in the demo (Market-maker payer + Narrator `payTo`). EIP-3009, facilitator relay, and USDC movement are all real on-chain; wallet multiplexing is demo-only and splits into `AGENT_WALLET_*` + `NARRATOR_WALLET_*` in production.

**1168 green tests** (`packages/shared` 88 / `apps/server` 595 / `apps/web` 485) with real Base Sepolia x402 settle on every `pnpm test`. `tsc --noEmit` clean across the workspace.

## Tech stack

Next.js 15 / React 19 / Tailwind v4 / `motion@12` on the web; Node 22+ / Express / pnpm workspace on the server; TypeScript strict across both. Agent runtime is a shared LLM SDK + typed tool registry; model ids are env-configurable.

Payments: `@x402/*` v2.10 against Base Sepolia USDC via `x402.org/facilitator`. Wallets: `viem` v2 (BSC mainnet for Four.meme, Base Sepolia for x402). Deployment: `@four-meme/four-meme-ai@1.0.8` with TokenManager2 partial-ABI fallback. IPFS: `pinata` v2. X posting: API v2 over hand-written OAuth 1.0a (`node:crypto`). State: single Postgres pool. Quality gates: `zod`, `vitest`, `eslint` v9, `prettier` v3, `tsc --noEmit`, `husky` + `lint-staged`.

## Reproduce

### Prerequisites

- Node **22+** and `pnpm` 10+ (see [`docs/dev-commands.md`](./docs/dev-commands.md) for Node-25 pitfalls)
- Base Sepolia agent wallet with ≥ 0.1 USDC + dust ETH for gas
- LLM API key (`OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`), image-gen key, Pinata JWT, Postgres URL — see [`.env.example`](./.env.example)
- (Optional) BSC mainnet wallet with ≥ 0.01 BNB for the full Creator flow; X developer creds for live posting

### Install + run

```bash
cp .env.example .env.local
docker compose up -d postgres
pnpm install

# Terminal 1
pnpm --filter @hack-fourmeme/server dev      # http://localhost:4000
# Terminal 2
pnpm --filter @hack-fourmeme/web dev         # http://localhost:3000
```

Open `http://localhost:3000`, click the TopBar `<BrainIndicator>` to slide out the BrainPanel, and type `/launch <theme>` or `/order <tokenAddr>`. Evidence is Postgres-backed, so page refresh keeps every pill.

### CLI demos

```bash
pnpm --filter @hack-fourmeme/server demo:creator      # BSC deploy, ~$0.05 BNB gas
pnpm --filter @hack-fourmeme/server demo:a2a          # a2a flow
pnpm --filter @hack-fourmeme/server demo:heartbeat    # tick loop (needs TOKEN_ADDRESS env)
pnpm --filter @hack-fourmeme/server demo:shill        # shill market fulfilment
```

### Quality gates

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

## Known gaps

- **`/alpha/:addr` and `/metadata/:addr` return mocks.** They exercise the paid x402 path; `/lore/:addr` is real via `LoreStore`.

## FAQ

**Q: Why settlement on Base Sepolia but the token on BSC mainnet?**

Four.meme only runs on BSC mainnet. The production-grade x402 facilitator ships on Base Sepolia USDC (Coinbase CDP reference); the BSC-native path (x402b + Pieverse) is five months unmaintained. The split is transitional — when a BNB-native facilitator matures, only the chain constant changes.

**Q: Is the Memind an AGI?**

No. "Memind" names a runtime that (a) persists memory across ticks, (b) hosts multiple tool-use personas, (c) makes autonomous decisions on a heartbeat. All three are concrete and bounded. No AGI / sentience / self-improvement claim.

**Q: Does the Memind own its own keys?**

**Payments are on-chain; key custody is not — yet.** The agent wallet is a server-held `viem` EOA; it signs EIP-3009 without a human in the loop, but the keys themselves are operator-custodied. Sovereign path (BAP-578 NFA + TEE wallet + ERC-8004 reputation) is scoped for later.

**Q: Does a Memind trade memecoins on its own?**

No, by product design. Personas trade **services** (lore, tweets, curation) paid in USDC, not the underlying token. The persona tools include no token-swap capability; every inter-agent payment carries a service identifier, so trades are distinguishable from self-dealing.

**Q: Does Shiller posting violate X policy?**

The account is human-owned, OAuth 1.0a authorised, and pays per-usage through X's `Content: Create` endpoint. Posting cadence ≥ 60s, no cross-account coordination, no identical copy, no `@mention` to strangers — nothing is automation-evasive.

**Q: What does running a Memind cost?**

Published vendor rates only. A Creator run: ~**$0.05 BSC gas** + cents of LLM/image inference + optional $0.01 X post. A shill fulfilment: fractions of a cent + $0.01 X post. Base Sepolia USDC is effectively free.

**Q: Why the brand name "Memind" if the runtime is called Brain?**

"Memind" is the product surface; "Brain runtime" is the architectural primitive inside. Keeping the vocabulary separate avoided renaming 40+ files (`brain-panel.tsx`, `BrainIndicator`, etc. keep their in-code names).

## Links

- x402 protocol: https://github.com/coinbase/x402
- Four.meme: https://four.meme
- Architecture: [`docs/architecture.md`](./docs/architecture.md)
- Demo video: <!-- TODO: paste URL after recording -->

## License

AGPL-3.0. See [`LICENSE`](./LICENSE). Any derivative work or networked service built on this code must release its modified source under the same license. For proprietary use, contact the author. Built by [@mymaine](https://github.com/mymaine).
