/**
 * Minimal ABIs used by the `check_token_status` tool.
 *
 * Why hand-authored instead of fetched: on 2026-04-18 both the TokenManager2
 * proxy `0x5c952063c7fc8610FFDB798152D69F0B9550762b` and its current
 * implementation `0xeCD0807e3bb87963d54Ea0f5752C2889dB441103` are UNVERIFIED
 * on BscScan. The BscScan V1 `getabi` endpoint now returns a deprecation
 * notice; V2 requires an API key. Because we cannot harvest a verified ABI
 * anonymously, we ship a tight hand-authored subset covering exactly what the
 * tool needs — the ERC-20 Transfer event on the token contract (for holder
 * counting) plus a best-effort `_tokenInfos(address)` signature on the
 * TokenManager2 proxy (based on the community-known bonding-curve
 * interface). If the view reverts at runtime — for example because the
 * on-chain implementation expects a different signature — the tool returns
 * null for the curve-derived metrics and pushes a diagnostic warning.
 *
 * No other functions or events are re-exported from here; tools should add
 * members only when they actually consume them.
 */

// ERC-20 Transfer event — canonical and present on every four.meme token
// regardless of TokenManager2 version. Used to count unique non-zero
// recipients over a configurable block window.
export const ERC20_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
  anonymous: false,
} as const;

// Minimal ERC-20 read surface we use: totalSupply for best-effort market cap.
export const ERC20_TOTAL_SUPPLY = {
  type: 'function',
  name: 'totalSupply',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'uint256' }],
} as const;

export const ERC20_MIN_ABI = [ERC20_TRANSFER_EVENT, ERC20_TOTAL_SUPPLY] as const;

/**
 * Best-effort TokenManager2 bonding-curve read. Known community signature —
 * we call it through `viem.readContract` and catch any revert / decode error,
 * so passing a wrong signature simply degrades `bondingCurveProgress` and
 * `marketCapBnb` to null instead of crashing the tool.
 *
 * Field ordering follows the commonly decompiled shape:
 *   [ base, quote, template, totalSupply, maxOffers, maxRaising, launchTime,
 *     offers, funds, lastPrice, K, T, status ]
 * Only a subset matters for our metrics; we name the remainder with `_N` so
 * we can still decode the tuple without binding to exact upstream names.
 */
export const TOKEN_MANAGER2_READ_ABI = [
  {
    type: 'function',
    name: '_tokenInfos',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'base', type: 'address' },
      { name: 'quote', type: 'address' },
      { name: 'template', type: 'address' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'maxOffers', type: 'uint256' },
      { name: 'maxRaising', type: 'uint256' },
      { name: 'launchTime', type: 'uint256' },
      { name: 'offers', type: 'uint256' },
      { name: 'funds', type: 'uint256' },
      { name: 'lastPrice', type: 'uint256' },
      { name: '_K', type: 'uint256' },
      { name: '_T', type: 'uint256' },
      { name: 'status', type: 'uint256' },
    ],
  },
] as const;

/**
 * Decoded shape of `_tokenInfos` that we care about. Using a loose index-based
 * type lets the tool survive minor reordering in future implementations — we
 * only ever read named accessors through viem's decoded tuple.
 */
export interface TokenInfos {
  base: `0x${string}`;
  quote: `0x${string}`;
  template: `0x${string}`;
  totalSupply: bigint;
  maxOffers: bigint;
  maxRaising: bigint;
  launchTime: bigint;
  offers: bigint;
  funds: bigint;
  lastPrice: bigint;
  status: bigint;
}
