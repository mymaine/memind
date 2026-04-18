---
summary: '2026-04-18 decision — the Creator agent deploys the four.meme token on BSC mainnet rather than BSC testnet'
read_when:
  - When revisiting why AC1 specifies mainnet instead of testnet
  - Before the demo, to explain the choice to reviewers
  - If four.meme later ships testnet deployment and we reconsider
status: locked
---

# BSC Mainnet Pivot

**Decision date**: 2026-04-18
**Phase**: 1 Day 1
**Trigger**: the read-only validation in `probe-fourmeme` (see [scripts/probe-fourmeme.ts](../../scripts/probe-fourmeme.ts))

## Facts

1. **`four-meme-ai@1.0.0` CLI is mainnet-only**
   - Source `skills/four-meme-integration/scripts/create-token-api.ts` hard-codes `NETWORK_CODE = 'BSC'`.
   - Upstream API `https://four.meme/meme-api/v1` accepts only `networkCode: 'BSC'`.
   - `create-token-chain.ts` hard-imports `import { bsc } from 'viem/chains'` (chainId 56).
   - No testnet flag anywhere.

2. **TokenManager2 contract `0x5c952063c7fc8610FFDB798152D69F0B9550762b` has no testnet deployment**
   - BSC mainnet (chainId 56): `eth_getCode` returns 170 bytes (proxy stub exists).
   - BSC testnet (chainId 97): `eth_getCode` returns `0x` (empty bytecode, no contract).
   - The CLI's bundled `contract-addresses.md` explicitly states `"BSC only (chainId 56), no testnet row"`.

## Decision

- The Creator agent's `onchain_deployer` tool targets **BSC mainnet**.
- The user brings their own real BNB (~$1 covers many deploys; `deployCost=0` + ~$0.05 gas per deploy).
- Token name and symbol are uniformly prefixed with `HBNB2026-` to avoid misleading real users.

## Alternatives considered and rejected

1. **Downgrade to simulation only** (viem signs the tx but does not broadcast)
   - Rejected: a "simulated deployment" in the demo video scores worse with reviewers than a real token; Innovation and Practical Value take a hit.
2. **Swap the launchpad to another testnet token factory** (e.g. PancakeSwap testnet)
   - Rejected: the sponsor alignment is Four.Meme; switching launchpads forfeits the Four.meme main-prize opportunity entirely.

## Risks accepted

- Real tokens will be indexed by bscscan / dexscreener.
  - Mitigation: the `HBNB2026-` prefix + symbol make the demo intent obvious.
- A real private key sits in `.env.local`.
  - Mitigation: use a fresh wallet holding only a small BNB balance (<$5); `.env.local` is already gitignored.
- The hackathon rules do not prohibit mainnet — the earlier "no mainnet" note in the original idea doc was a conservative default from the assistant, not a hackathon rule.
- Expand-and-Contract: if the sponsor ships testnet later, we can contract back to it.

## Related updates

| File                              | Change                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (internal roadmap, not public)    | AC1/AC3 switched to mainnet; removed "mainnet deployment" from the out-of-scope list and added "BSC testnet four.meme"; added real-BNB and indexing risks to the risk section |
| (internal AGENTS doc, not public) | Startup tech-stack section + hard rule #4b (mainnet + `HBNB2026-` prefix)                                                                                                     |
| `docs/architecture.md`            | Flow 1 + Runtime Topology + External Dependencies + Security/Secrets synced to mainnet + `@x402/*` v2                                                                         |
| `.env.example`                    | `BSC_DEPLOYER_*` comments updated to mainnet; optional RPC override added                                                                                                     |

## Follow-up actions

- User fetches real BNB (see the faucet → onramp guidance in the conversation, or transfer $1 BNB from an existing wallet into `BSC_DEPLOYER`).
- Phase 2 Task 4 (the onchain_deployer tool implementation) assumes this decision.
- State in the demo video's opening frame: "BSC mainnet because the sponsor ships no testnet."
