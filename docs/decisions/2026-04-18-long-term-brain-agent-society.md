---
summary: 'Post-hackathon long-term product direction — user-bound persistent brain agent society on Four.meme Agentic Mode Phase 3'
read_when:
  - After the hackathon submission, when deciding whether to keep maintaining this repo as a product
  - When pitching to investors, sponsors, or the Four.meme team about long-term vision
  - When prioritising M2+ feature work, to check whether a change advances the society layer or dilutes it
status: proposed
---

# Long-Term Direction — Brain Agent Society on Four.meme

**Decision date**: 2026-04-18 (during Phase 4.5, pre-submission)
**Scope**: Post-hackathon roadmap; **not in the 4-day MVP scope**. The hackathon deliverable is locked by `docs/decisions/2026-04-17-direction-lock.md`. This doc captures the long-term intent so it is not lost after submission.

## One-liner

> User-bound persistent brain agents that manage multiple X personas and multiple memecoins, pay each other in USDC over x402 for services (lore / shilling / curation), build on-chain reputation via ERC-8004 + BAP-578 NFA, and collectively form a real-economy AI social layer on BNB Chain — positioned as the community reference implementation for Four.meme Agentic Mode Phase 3 (economic loop).

## Why this direction (narrative landscape)

The brainstorm on 2026-04-18 mapped the current AI × crypto narrative axes and found the clean gap:

| Axis                       | Leading projects (2026-04)                         | Covered?             |
| -------------------------- | -------------------------------------------------- | -------------------- |
| Agent-to-agent commerce    | Virtuals ACP v2 + Revenue Network, x402 Foundation | Yes                  |
| AI-native memecoin         | Truth Terminal → GOAT → Zerebro → Lobstar Wilde    | Yes (but in fatigue) |
| Agent autonomy (own money) | Freysa, CLAWD, Pieverse TEE wallet                 | Yes                  |
| Digital society simulation | Moltbook (acquired by Meta), Stanford Smallville   | Yes (but unbacked)   |
| **All four composed**      | **Nobody**                                         | **No**               |

No shipping product today combines: (a) user-bound persistent brain agent, (b) multi-persona multi-coin management, (c) cross-brain persuasion with on-chain consequences, (d) real memecoin economy as the substrate. This doc stakes the claim to that composition.

## Non-goals for the hackathon submission

- **The hackathon demo does not ship this vision.** The 4-day MVP is locked as 3-agent one-shot swarm + service exchange (Phase 4.6 `brain-minimal` is the first concrete step toward this doc, but scope-capped to avoid breaking Hard Gate).
- Do not expand Phase 4.6 in response to this doc. If Phase 4.6 finishes early, do not start M2 work — freeze the repo and submit.
- This doc exists so intent survives the freeze; it is not a work order.

## Target architecture (5-year version)

### Brain agent runtime

- **Claude Agent SDK + Managed Agents (multi-session)** for 24/7 persistence
- **Memory tiers**: Anthropic Memory Tool (hot) → filesystem with auto-compaction (warm) → Membase / Unibase decentralized zk-memory (cold). Rationale: a brain needs persona + relational graph + portfolio state + past dialogue outcomes, which a pure vector DB cannot serve.
- **Per-brain spending cap** (Vitalik's $100/day guidance) enforced at the runtime layer, not at the tool layer — an agent cannot bypass it by composing tools.

### Agent-to-agent communication

- **A2A Protocol** (Linux Foundation, 150+ orgs) for horizontal agent communication
- **MCP** for vertical agent-to-tool communication
- **x402 headers** for payment settlement across both planes; `@x402/*` v2 on Base Sepolia for demo, later BSC mainnet when Pieverse facilitator matures or BNB-native facilitator ships
- **Bridge to Virtuals ACP** via Composable Agent Calls when inter-ecosystem service discovery becomes necessary

### On-chain identity

- **ERC-8004 Trustless Agents** on BSC mainnet (Identity + Reputation + Validation registries) — BNB Chain has first-mover status with 44K+ agents deployed
- **BAP-578 Non-Fungible Agent** as the agent-as-asset wrapper — makes the brain inheritable, tradable, rentable; the wallet is bound to the NFT, not the user's EOA
- **No self-built identity registry.** Community will not adopt a proprietary registry; fate of every 2024–2025 attempt confirms this.

### Persuasion / belief layer (the original mechanism)

This is where the project's non-obvious IP lives. Three composable sub-mechanisms:

1. **On-chain reputation (ERC-8004 reputation registry)** — every persuasion success/failure is written on chain; becomes queryable "does this agent lie" history.
2. **Stake-to-persuade** — an agent that wants to convince others to buy its token must stake that token as collateral; if buyers suffer >X% drawdown within Y days, the stake is slashed and distributed to affected buyers. Converts cheap talk into a costly signal. This is the mechanism Truth-Terminal-era AI memecoins lacked, and Lobstar Wilde's $250K social-engineering loss directly motivates it.
3. **Private belief score** — each brain maintains a non-public Bayesian belief score for every other brain it has interacted with. Deception discounts future signal weight.

### Agent-as-canvas framing

The memecoin is the canvas, not the trading target. This framing serves three purposes:

1. Complies with every jurisdiction that treats speculative autonomous trading as a regulated activity.
2. Sidesteps the "your agent trades are indistinguishable from wash trading" rebuttal — the agents trade services (lore, shilling, curation), not tokens.
3. Keeps the long-term pitch honest: the value is the behavioral dataset and the societal structure that emerges, not token price action.

### Textual architecture diagram

```
USER (human, minimal input: "launch a meme for <theme>")
   │
   ▼
BRAIN AGENT (persistent, 24/7)
 ┌─────────────────────────────────────────────┐
 │ Claude Opus + Managed Agents (multi-session)│
 │ Memory: Anthropic tool / FS / Membase       │
 │ Identity: BAP-578 NFA on BSC + ERC-8004     │
 ├──────────────────┬──────────────────────────┤
 │ Persona Manager  │ Portfolio Manager        │
 │ (multi X accts)  │ (multi token holdings)   │
 └─────┬────────────┴──────────┬───────────────┘
       │                       │
  ┌────▼─────────┐      ┌──────▼──────────────┐
  │ Four.meme    │      │ x402 settlement     │
  │ Agentic Mode │      │ + Virtuals ACP      │
  │ (BSC)        │      │                     │
  └──────────────┘      └─────────────────────┘
        ▲                      ▲
        │                      │
 ┌──────┴──────────────────────┴──────────┐
 │ A2A (horizontal) + MCP (tools)         │
 └──────┬──────────────────────┬──────────┘
        │                      │
 ┌──────▼──────┐        ┌──────▼──────┐
 │ Other user  │        │ Other user  │
 │ Brain A     │  ...   │ Brain N     │
 └─────────────┘        └─────────────┘
        │
        ▼
 Persuasion layer: stake-to-persuade + ERC-8004 rep
 + private Bayesian belief score
```

## Roadmap (post-hackathon, 6–12 months)

| Milestone | Window     | Scope                                                                                                                                | Gate                                                                         |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **M1**    | T+0–T+4d   | Hackathon submission (current scope, locked)                                                                                         | Submitted to DoraHacks before 2026-04-22 UTC 15:59                           |
| **M2**    | T+1m–T+3m  | Brain Agent v0.1 public alpha: 1 user = 1 brain = 1 X = 1 token; Managed Agents multi-session; Memory Tool + FS; BAP-578 identity    | 5–10 alpha brains run 30 days unattended without failure                     |
| **M3**    | T+3m–T+6m  | Social Layer: A2A protocol, multi-X multi-token per brain, Membase cold memory, v0 persuasion (prompt + reputation, no stake)        | Leaderboard live; first documented emergent behaviour                        |
| **M4**    | T+6m–T+9m  | Economic Layer: stake-to-persuade contract on BSC, ERC-8004 reputation on chain, optional public belief score, Virtuals ACP bridge   | Stake-to-persuade slashed at least once in prod, showing the mechanism works |
| **M5**    | T+9m–T+12m | Narrative: publish one-year behavioural dataset; pitch Four.meme as Agentic Mode Phase 3 community reference; Series A conversations | External (a16z crypto / Paradigm / Variant) engagement                       |

## Known risks and the mitigations they force

| Risk                                                         | Evidence (from brainstorm 2026-04-18)                                                                        | Mitigation baked into architecture                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lobstar Wilde-style prompt-injection loss of funds           | $250K drained from a live autonomous agent in 2026-02                                                        | Per-brain daily spending cap + TEE wallet (Pieverse / Phala) + explicit prompt-injection red-team before any economic feature ships                                                                       |
| Wash-trading reclassification                                | Artemis data: ~50% of x402 daily volume looks like self-dealing / wash                                       | Brains trade services, not tokens; all inter-brain payments carry an `X-SERVICE-KIND` header and a signed receipt that a reviewer can audit                                                               |
| X coordinated-inauthentic-behavior ban                       | 2026-03 ban wave on cross-account coordination                                                               | Every X account is OAuth'd by the real human user (one user = N real accounts they own), never a farmed pool; brains never cross-post identical copy; posting cadence must pass a human-plausibility test |
| AI memecoin narrative fatigue                                | GOAT −93%, AIXBT $19M, PIPPIN −49.7% single day, Pump.fun + Virtuals activity new lows                       | Story pivots from "another AI memecoin project" to "first real-economy AI society" — token price is not the headline, behavioural data + social structure is                                              |
| LLM cost explosion                                           | Reflexion-style multi-turn loops run 50× single-pass cost; $5K→$15K monthly creep observed in agent fintechs | Per-brain hourly post quota, tick interval ≥ 60s in production, Memory Tool auto-compaction instead of unbounded vector growth, hard budget caps per user                                                 |
| Regulatory classification as unregistered investment adviser | CFTC Innovation Task Force launched 2026-04-10 targeting autonomous financial systems                        | Brain is framed and coded as the user's tool; the user signs the launch transaction; agent never holds discretionary custody over third-party funds                                                       |

## What changes in the repo if we pursue this

Post-submission, the direction lock in `docs/decisions/2026-04-17-direction-lock.md` needs superseding. A new decision record should:

- flip hard rule #2 ("no DeFi / LP / speculative trading") into a **conditional allow** for the M4 stake-to-persuade contract, under strict spending-cap + TEE-wallet guard rails
- retire the 3-agent swarm as the product surface (it becomes an internal implementation detail of the brain)
- add ERC-8004 + BAP-578 integration to the tech stack

This is **not** a pre-submission change. Submit first, then consider.

## Strategic position vs. Four.meme ecosystem

Four.meme announced Agentic Mode in 2026-03 with a three-phase roadmap. Phase 1 (Agent Skill Framework) is live, Phase 2 (on-chain identity) is partial, **Phase 3 (economic loop) is the open gap**. This direction fills Phase 3 with a consumer-level showcase, not a B2B infrastructure layer. BNB Chain's ERC-8004 leadership (44K+ agents), the BAP-578 NFA standard, and Four.meme's 812K DAU are the three tailwinds that make "BNB Chain as the agent-native chain" a credible foundation, not a sponsor-alignment excuse.

## Supersedes / related

- Extends: `docs/decisions/2026-04-17-direction-lock.md` (does not supersede pre-submission)
- Complements: `docs/decisions/2026-04-19-x-posting-agent.md` (X posting discipline carries into M2+)
- First concrete step: `docs/features/brain-minimal.md` (Phase 4.6 hackathon deliverable, scope-capped)
