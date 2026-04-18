---
summary: Four.Meme AI Sprint direction lock — Agent-as-Creator + x402 Service Exchange
read_when:
  - Checking "what am I building" during development
  - Before the daily hard-gate review
  - When choosing a fallback path
status: locked
---

# idea.md — Four.meme Agent-as-Creator with x402 Service Exchange

> **Decision date**: 2026-04-17
> **Lock-in process**: scanned 11 directions → 4 brainstorm rounds to disprove (A/B/C, D+, X1, V3') → Agent-as-Creator won
> **Current phase**: Phase 7 pending (repo init + Day 1 development)

## Direction one-liner

> **The first Four.meme Agentic Mode reference implementation — a Creator Agent launches the token autonomously, a Narrator Agent generates lore, and a Market-maker Agent makes a market; the three agents pay each other for services over x402.**

## Only-Four.meme hook

Every other direction failed the third interrogation axis (narrative-product fit): none could answer "why Four.meme and not Pump.fun / Raydium". **This direction has the only real hook**:

- Four.meme officially announced the **Agentic Mode** three-phase roadmap in 2026-03: AI agents autonomously create and operate meme tokens.
- Phase 1 (Agent Skill Framework) is underway; Phase 2/3 (on-chain identity, economic loop) have not landed.
- **This direction = the reference implementation of Agentic Mode Phases 1–2.**
- It lands the sponsor's thesis, which favorably affects both Innovation (30%) and Practical Value (20%) in the rubric.

## Delta over prior art in the sponsor ecosystem (alenfour/four-meme-agent)

`alenfour/four-meme-agent` is an existing community agent that launches tokens autonomously. We must be at least **two layers deeper** to answer "why not just use alenfour":

1. **x402 agent-to-agent commerce layer**: alenfour only launches tokens; **our agents pay each other in USDC for services over x402**.
   - Creator agent → pays Narrator agent USDC for a lore bible
   - Market-maker agent → pays Creator agent USDC for token metadata
   - This is the Virtuals ACP thesis, but first-mover on the BNB side.
2. **Multi-agent swarm** (native to the internal agent runtime architecture): alenfour is a single agent; **we ship a three-agent swarm**.
   - The existing dynamic sub-agent + tool registry pattern transfers directly and saves ~80% of Day 1 scaffolding.

If a reviewer asks about the sponsor building it themselves:

- Short term (during the hackathon): the sponsor has not finished Phase 1; **our demo is an early Phase 1–2 sample**.
- Mid term (1–3 months): the sponsor may fork or invite collaboration — a positive flywheel.
- Long term: if we tried to turn it into a product we would be outpaced by the official team, but **the first objective is submission and reputation, not productization**.

## Tech stack (validated runnable)

| Layer                | Choice                                                                                    | Validation status                          |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| Agent framework      | **In-house agent runtime fork** (dynamic sub-agent + tool registry)                       | Owned, in-house toolkit                    |
| x402                 | **@coinbase/x402-express v1.2.0 + @coinbase/x402-fetch v1.2.0** + **Base Sepolia + USDC** | Probe hello world went green               |
| Four.meme operations | **four-meme-ai CLI shell-exec** + TokenManager2 ABI fallback                              | Probe confirmed the CLI is headless-usable |
| Content storage      | **Pinata IPFS** (1 GB free tier is enough for the demo)                                   | Minimal SDK                                |
| Wallet               | EOA + viem (Pieverse TEE wallet as stretch)                                               | No API provisioning wait                   |
| Frontend             | Next.js + shadcn/ui (no UI brainstorm — polish post-submission)                           | —                                          |

**Fallback plan**: the Round 1 probe disproved the x402b + BSC + pieUSD path (Pieverse facilitator rejected external access; x402b had been untouched for five months). **Day 1 switches straight to Base Sepolia + Coinbase x402 v1**. The BSC hook is weaker, but the Agent-as-Creator-on-BNB narrative still holds because the four.meme token is launched on BSC (agent commerce running on Base Sepolia does not undermine the core thesis).

## Four-day day-by-day MVP path

### Day 1 (2026-04-18 Sat, 10h) — scaffold + three component hello worlds

- repo init: `hack-bnb-fourmeme-agent-creator` (matches the `hack-<event>-<topic>` naming convention)
- Fork the in-house agent runtime and extract the dynamic sub-agent + tool registry.
- Three hello worlds running **in parallel** (all must go green before entering Day 2):
  - x402 server on Base Sepolia returns 402 → client pays USDC → fetches resource (probe-verified)
  - `four-meme-ai` CLI `purr fourmeme create-token` deploys a test token on BSC testnet
  - Pinata `pinFileToIPFS` uploads a .md file and returns an IPFS hash
- **Day 1 EOD Hard Gate**: all three hello worlds green → proceed to Day 2; any red → trigger the component's fallback path (see below).

### Day 2 (4/19 Sun, 10h) — Creator Agent + infrastructure

- Creator Agent implementation (on the in-house runtime):
  - tool 1: `narrative_generator` (Claude + trend-seeded token name/symbol/concept)
  - tool 2: `meme_image_creator` (Flux / SD API)
  - tool 3: `onchain_deployer` (four-meme-ai CLI)
  - tool 4: `lore_writer` (generate a lore bible, store on IPFS)
- x402 server skeleton: expose three endpoints (`/lore/:tokenAddr`, `/alpha/:tokenAddr`, `/metadata/:tokenAddr`), each wrapped by the x402 middleware.
- Demo a Creator agent run: a single-line input deploys the token + uploads lore + produces three x402 endpoints.

### Day 3 (4/20 Mon, 10h) — Narrator + Market-maker agents + A2A

- Narrator Agent: dedicated to lore chapters, community narrative updates, and derivative content.
- Market-maker Agent: reads bonding curve progress and pays the Creator / Narrator for resources.
- **Agent-to-agent x402 payment demo** (the dramatic highlight):
  - Market-maker agent calls `/lore/0xABCD` via `x402-fetch` → auto-pays USDC → fetches lore
  - All transactions are verifiable on Base Sepolia.
- Sub-agent bridge on the in-house runtime completed.

### Day 4 (4/21 Tue, 10h) — Four.meme integration + Hard Gate

- Read BSC `TokenManager2` events (`getLogs`) to bind the Creator agent's four.meme token address to the x402 endpoints.
- **Day 4 EOD Hard Gate** (three full end-to-end flows must pass):
  - Flow 1: Creator agent autonomously generates + deploys the token + uploads lore to IPFS
  - Flow 2: Market-maker agent pays USDC to the Narrator agent to buy a lore chapter
  - Flow 3: Narrator agent generates a lore fragment for the token; the hash is anchored on chain (event log)
- Three flows green → Day 5; any broken flow → cut the most complex and keep two demo-able ones.

### Day 5 (4/22 Wed, 6–8h before UTC 15:59) — demo + submission

- Demo video (2–3 minutes):
  - Single take: open the UI → input "launch a meme for BNB Chain 2026 growth"
  - 30s: Creator agent generates + deploys a four.meme testnet token (show tx link)
  - 45s: Narrator agent writes lore (IPFS hash + on-chain anchor)
  - 60s: Market-maker agent auto-pays USDC for lore (x402 tx link)
  - 90s: UI displays the three-agent interaction log
  - Close: "First agent-to-agent commerce demo on Four.meme Agentic Mode"
- English README (AI-assisted writing + optional AI TTS voiceover): architecture diagram + sponsor-match statements + per-item rubric alignment.
- Submit to Dorahacks before 4/22 15:59 UTC.

## Sponsor match matrix

| Sponsor                       | Match path                                                                         | Priority | Notes                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| **Four.meme main prize pool** | Agentic Mode Phase 1–2 reference implementation                                    | P0       | Targets Innovation 30% + Practical Value 20%      |
| **Pieverse $2K bounty**       | x402 cites the x402b spec + optional SKILL.md publish to the Skill Store (stretch) | P1       | Zero-wait API registration; citation alone scores |
| **Unibase**                   | Membase stores three-agent shared lore memory (stretch)                            | P2       | Integrate if Day 3 has slack                      |
| **TagAI**                     | X reply tip triggers the Market-maker agent to buy lore (stretch)                  | P3       | Only if Day 4 has slack                           |
| MYX                           | Skip                                                                               | —        | $20K TVL gate is infeasible solo                  |
| DGrid                         | Skip                                                                               | —        | Closed beta, no public docs                       |

**Realistic goal**: top-5 attempt on the main pool + Pieverse bounty (citation gives a fair shot).

## Risks and fallback plans

| Risk                                                               | Fallback plan                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Day 1 x402 hello world fails                                       | Near impossible (probe-verified)                                                         |
| Day 1 four-meme-ai CLI fails                                       | Call the TokenManager2 ABI directly (probe already reconciled events and functions)      |
| Day 1 Pinata fails                                                 | Fall back to centralized storage (AWS S3 / localhost file) + fake IPFS hash for the demo |
| Day 3 swarm complexity blows up                                    | Drop to two agents (creator + narrator) and cut market-maker                             |
| Day 4 Hard Gate breaks 3 flows                                     | Cut the most complex flow (likely flow 2); keep flow 1 + flow 3                          |
| Virtuals ACP ships to BNB in Q2 2026 and the sponsor notices       | Not a five-day risk; accepted                                                            |
| Community Vote 30% disadvantage (English A2 + no Chinese-sphere X) | Accept; commit fully to Expert 70%                                                       |
| Clash with ETHGlobal LP Agent mental model                         | This direction avoids DeFi/LP entirely; cognitively decoupled                            |
| Sponsor does it themselves                                         | Time advantage favors us; see one-liner analysis                                         |
| In-house runtime copy has hidden dependencies                      | Day 1 hard check: fork into an empty project → hello world must run in < 1h              |

## Golden demo path (2–3 minute video)

1. Intro title: "First Agent-to-Agent Commerce on Four.meme Agentic Mode"
2. Architecture diagram (10s): three agents interacting via x402; token on BSC
3. User action: input "create a meme about BNB 2026" (single input)
4. Creator agent working: show the four-step progress (concept → image → token deploy → lore) + BSC tx link
5. x402 agent-to-agent transaction (climax): Market-maker agent scans → sends HTTP to the Narrator agent → receives 402 → auto-signs EIP-3009, pays USDC → receives lore + Base Sepolia tx link
6. UI shows the three-agent log: real interaction history + five on-chain transactions
7. Close: cite the four.meme Agentic Mode Phase 2 roadmap verbatim → "this is that"

## Hard rules (non-negotiable)

- **No DeFi / LP / speculative trading** (memecoin buy-side is off-limits per the internal spec).
- **No X API** (2026-02 paywall made it a dead zone; probe already flagged).
- **Do not bet on x402b testnet + Pieverse facilitator** (Round 1 probe disproved it).
- **Day 4 EOD Hard Gate is mandatory** — any broken flow auto-triggers the fallback path.
- **Each sponsor gets at most two bounty attempts** (main pool + Pieverse; no chasing multiple).
- **Freeze the repo the moment submission lands** (Dorahacks review window is 4/23–4/28; every edit can move the timestamp).

## Immediate follow-up actions

1. Update the current-event section of the roadmap: add "Four.meme AI Sprint"; mark Phase 7 as pending.
2. User decision: use `/project-init` to create the repo or manually scaffold a minimal repo.
3. Start Day 1 (the UI/UX brainstorm is skipped this round — time pressure; default to shadcn/ui + a standard dashboard template).
