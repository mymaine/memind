# hack-bnb-fourmeme-agent-creator

First agent-to-agent commerce demo on Four.Meme Agentic Mode — Creator / Narrator / Market-maker agents cooperate and trade services via [x402](https://github.com/coinbase/x402) on Base Sepolia.

- **Hackathon**: [Four.Meme AI Sprint](https://dorahacks.io/hackathon/fourmemeaisprint)
- **Submission deadline**: 2026-04-22 UTC 15:59
- **Must-read for AI agents**: [`AGENTS.md`](./AGENTS.md)
- **Full spec + roadmap**: [`docs/spec.md`](./docs/spec.md)
- **Design system**: [`docs/design.md`](./docs/design.md)

## Day 1 Hard Gate — ACHIEVED (2026-04-18)

| Probe                   | Result       | Evidence                                                                                                                               |
| ----------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| x402 on Base Sepolia    | ✅ PASS      | real settlement tx [`0x4331…000a`](https://sepolia.basescan.org/tx/0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a) |
| Pinata IPFS upload      | ✅ PASS      | public-gateway round-trip verified                                                                                                     |
| four-meme TokenManager2 | ✅ diagnosed | testnet has no contract → pivoted to BSC mainnet ([decision](./docs/decisions/2026-04-18-bsc-mainnet-pivot.md))                        |

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in keys
pnpm dev                     # run web (3000) + server (4000) in parallel
```

For the full command reference see [`docs/dev-commands.md`](./docs/dev-commands.md).

## Repo layout

```
apps/
  web/        Next.js 15 + Tailwind v4 dashboard (terminal cyber theme)
  server/     Express + x402 server + 3-agent runtime
packages/
  shared/     zod schemas + types + agent tool interface
scripts/      probe-x402 / probe-fourmeme / probe-pinata (Phase 1 hello world)
docs/         spec / design / architecture / decisions / archive
```
