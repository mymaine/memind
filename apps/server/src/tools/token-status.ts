import { z } from 'zod';
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Log,
  type PublicClient,
} from 'viem';
import { bsc } from 'viem/chains';
import type { AgentTool } from '@hack-fourmeme/shared';
import {
  ERC20_MIN_ABI,
  ERC20_TRANSFER_EVENT,
  TOKEN_MANAGER2_READ_ABI,
} from '../chain/token-manager-abi.js';

/**
 * check_token_status tool
 * -----------------------
 * Reads on-chain state of a four.meme token on BSC mainnet and returns a
 * deterministic snapshot the Heartbeat / Narrator / Market-maker agents can
 * use to decide whether to post, extend lore, or buy services.
 *
 * Determinism strategy:
 *   - deployedOnChain + holderCount are computed from real chain state; they
 *     must never be null.
 *   - bondingCurveProgress / volume24hBnb / marketCapBnb are best-effort —
 *     both TokenManager2 and its implementation are unverified on BscScan
 *     (see chain/token-manager-abi.ts for the ABI decision). Every failure
 *     mode returns null plus a human-readable warning so the caller can
 *     include the diagnostic in a tweet or dashboard tile without surfacing
 *     a stack trace.
 *   - inspectedAtBlock is captured at the START of the read so callers can
 *     reason about staleness.
 *
 * All tests run against an injected PublicClient — no real RPC in unit
 * tests. See token-status.test.ts.
 */

// TokenManager2 proxy on BSC mainnet (chainId 56). Constant kept in the tool
// rather than config because it is a protocol fact, not a runtime setting.
const TOKEN_MANAGER2_BSC = '0x5c952063c7fc8610FFDB798152D69F0B9550762b' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ~28_800 blocks = ~24h at BSC's ~3s/block cadence. Used for volume scans.
const BLOCKS_PER_DAY_BSC = 28_800n;
// Default window for holder scans: 10_000 blocks ≈ ~8h. We internally split
// this into MAX_GETLOGS_CHUNK-sized pieces so public RPCs that cap the single
// `eth_getLogs` span at 5_000 blocks still answer reliably.
const DEFAULT_HOLDER_SCAN_RANGE = 10_000n;
// Public BSC RPCs (BSC official, ankr, publicnode, drpc) cap `eth_getLogs` at
// 5_000 blocks per request. This is the internal chunk size — callers never
// need to know about it.
const MAX_GETLOGS_CHUNK = 5_000n;

export const tokenStatusInputSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
export type TokenStatusInput = z.infer<typeof tokenStatusInputSchema>;

export const tokenStatusOutputSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  deployedOnChain: z.boolean(),
  holderCount: z.number().int().nonnegative(),
  bondingCurveProgress: z.number().min(0).max(100).nullable(),
  volume24hBnb: z.number().nonnegative().nullable(),
  marketCapBnb: z.number().nonnegative().nullable(),
  // bigint serialises poorly through JSON; callers that care about ordering
  // can Number() it back when safe. We keep it as a decimal string.
  inspectedAtBlock: z.string(),
  warnings: z.array(z.string()),
});
export type TokenStatusOutput = z.infer<typeof tokenStatusOutputSchema>;

export interface CheckTokenStatusToolConfig {
  /** BSC mainnet JSON-RPC URL. Only used when `publicClient` is not provided. */
  rpcUrl: string;
  /**
   * Injected viem client — test seam. Accepts the minimal read surface via
   * PublicClient so tests can supply a plain object that satisfies the
   * methods we actually call (`getBlockNumber`, `getCode`, `getLogs`,
   * `readContract`).
   */
  publicClient?: PublicClient;
  /** Number of blocks to scan for Transfer events when computing holder count. */
  holderScanBlockRange?: bigint;
}

/**
 * Factory returning an AgentTool that snapshots a token's on-chain state.
 */
export function createCheckTokenStatusTool(
  config: CheckTokenStatusToolConfig,
): AgentTool<TokenStatusInput, TokenStatusOutput> {
  const client: PublicClient =
    config.publicClient ??
    (createPublicClient({
      chain: bsc,
      transport: http(config.rpcUrl),
    }) as unknown as PublicClient);
  const holderScanRange = config.holderScanBlockRange ?? DEFAULT_HOLDER_SCAN_RANGE;

  return {
    name: 'check_token_status',
    description:
      'Snapshot the on-chain state of a four.meme token on BSC mainnet: whether it is ' +
      'deployed, unique holder count, best-effort bonding-curve progress (0-100), best-effort ' +
      '24h volume in BNB, and best-effort market cap in BNB. Non-deterministic metrics may ' +
      'return null with a human-readable warning. Call this before deciding whether to post ' +
      'on X or extend lore.',
    inputSchema: tokenStatusInputSchema,
    outputSchema: tokenStatusOutputSchema,
    async execute(input: TokenStatusInput): Promise<TokenStatusOutput> {
      const parsed = tokenStatusInputSchema.parse(input);
      const tokenAddr = getAddress(parsed.tokenAddr);
      const warnings: string[] = [];

      // Capture the reference block upfront so subsequent reads share the
      // same "as-of" anchor for reasoning purposes. Note: viem's getLogs uses
      // independent block args; we pass `inspectedAtBlock` as the explicit
      // `toBlock` to keep the scan consistent with the reported block.
      const inspectedAtBlock = await client.getBlockNumber();

      // --- deployedOnChain -------------------------------------------------
      const bytecode = await client.getCode({ address: tokenAddr });
      const deployedOnChain = Boolean(bytecode && bytecode !== '0x');

      if (!deployedOnChain) {
        // Short-circuit: no contract means every downstream read is
        // meaningless. Return a clean sentinel shape.
        warnings.push('token contract not deployed at the given address');
        return tokenStatusOutputSchema.parse({
          tokenAddr,
          deployedOnChain: false,
          holderCount: 0,
          bondingCurveProgress: null,
          volume24hBnb: null,
          marketCapBnb: null,
          inspectedAtBlock: inspectedAtBlock.toString(),
          warnings,
        });
      }

      // --- holderCount -----------------------------------------------------
      // Scan the last `holderScanRange` blocks of Transfer events on the
      // token. Unique non-zero `to` addresses approximate active holders.
      // This intentionally over-counts (never excludes addresses that later
      // burned everything) and under-counts addresses whose only receipt
      // was before the window — trade-off accepted for a bounded RPC cost.
      //
      // Chunking: public BSC RPCs reject single-call scans wider than
      // MAX_GETLOGS_CHUNK. We split the window into contiguous, non-
      // overlapping chunks and merge unique recipients across successful
      // chunks. One chunk failing degrades to a partial count + warning
      // instead of wiping the whole scan.
      const holderFromBlock =
        inspectedAtBlock > holderScanRange ? inspectedAtBlock - holderScanRange : 0n;
      const chunks = planGetLogsChunks(holderFromBlock, inspectedAtBlock, MAX_GETLOGS_CHUNK);
      const seenHolders = new Set<string>();
      let failedChunks = 0;
      for (const { fromBlock, toBlock } of chunks) {
        try {
          const logs = await client.getLogs({
            address: tokenAddr,
            event: ERC20_TRANSFER_EVENT,
            fromBlock,
            toBlock,
          });
          mergeUniqueRecipients(logs, seenHolders);
        } catch (err) {
          failedChunks += 1;
          if (chunks.length === 1) {
            // Single-chunk scan: preserve original warning shape so callers
            // relying on the legacy message still match.
            warnings.push(
              `holderCount scan failed (${summariseError(err)}); reporting 0. Consider lowering holderScanBlockRange.`,
            );
          }
        }
      }
      if (chunks.length > 1 && failedChunks > 0) {
        // Prefix with "holderCount scan failed" so both all-fail and partial
        // callers share a stable grep-key while the suffix carries the
        // specific N/M ratio for operators reading the dashboard.
        warnings.push(
          `holderCount scan failed — partial — ${failedChunks.toString()}/${chunks.length.toString()} chunks failed`,
        );
      }
      const holderCount = seenHolders.size;

      // --- bondingCurveProgress + marketCapBnb -----------------------------
      let bondingCurveProgress: number | null = null;
      let marketCapBnb: number | null = null;
      try {
        const info = await client.readContract({
          address: TOKEN_MANAGER2_BSC,
          abi: TOKEN_MANAGER2_READ_ABI,
          functionName: '_tokenInfos',
          args: [tokenAddr],
        });
        const decodeResult = decodeTokenInfos(info);
        if (decodeResult.kind === 'wrongLength') {
          warnings.push(
            `_tokenInfos tuple length mismatch (expected 13, got ${decodeResult.got.toString()})`,
          );
        } else if (decodeResult.kind === 'wrongTypes') {
          warnings.push('bondingCurveProgress unavailable: could not decode _tokenInfos');
        } else {
          const decoded = decodeResult.value;
          if (decoded.maxRaising > 0n) {
            // Progress = funds raised / target raise, capped to 100.
            const raw = Number((decoded.funds * 10_000n) / decoded.maxRaising) / 100;
            bondingCurveProgress = Math.max(0, Math.min(100, raw));
          } else {
            warnings.push('bondingCurveProgress unavailable: maxRaising is zero');
          }
          if (decoded.lastPrice > 0n && decoded.totalSupply > 0n) {
            // Price returned from _tokenInfos is wei-per-token (1e18-scaled).
            // marketCapBnb = price * totalSupply / 1e18 / 1e18. BigInt
            // division alone truncates sub-1 results to 0, which defeats the
            // metric for small-cap tokens. We drop 9 decimals of each factor
            // into BigInt space before converting to Number, preserving ~9
            // significant digits across the [0.001, 1e12] BNB range.
            const mc = computeMarketCapBnb(decoded.lastPrice, decoded.totalSupply);
            if (mc === null) {
              warnings.push('marketCapBnb out of safe numeric range');
            } else {
              marketCapBnb = mc;
            }
          }
        }
      } catch (err) {
        bondingCurveProgress = null;
        marketCapBnb = null;
        warnings.push(`bondingCurveProgress unavailable (${summariseError(err)})`);
      }

      // --- volume24hBnb ----------------------------------------------------
      // The TokenManager2 implementation is unverified so we cannot bind to
      // a specific Trade event ABI without risking misdecoding. Return null
      // + warning; this is the documented best-effort contract.
      const volume24hBnb: number | null = null;
      warnings.push(
        `volume24hBnb unavailable: Trade event ABI not in scope (approximate ${BLOCKS_PER_DAY_BSC.toString()}-block window would otherwise apply)`,
      );

      return tokenStatusOutputSchema.parse({
        tokenAddr,
        deployedOnChain: true,
        holderCount,
        bondingCurveProgress,
        volume24hBnb,
        marketCapBnb,
        inspectedAtBlock: inspectedAtBlock.toString(),
        warnings,
      });
    },
  };
}

/**
 * Collapse a batch of decoded Transfer logs into a unique-recipient count.
 * Zero address recipients (mint destination or burn reversal) are excluded
 * because they aren't real holders. The `from` side is intentionally
 * ignored — presence as a sender doesn't confirm continued holding.
 */
export function countUniqueRecipients(logs: readonly Log[]): number {
  const seen = new Set<string>();
  mergeUniqueRecipients(logs, seen);
  return seen.size;
}

/**
 * Merge a batch of decoded Transfer logs' non-zero `to` addresses into an
 * existing set. Exported-free helper used by the chunked scan path so each
 * chunk's successful logs can contribute to the same recipient set without
 * re-decoding.
 */
function mergeUniqueRecipients(logs: readonly Log[], seen: Set<string>): void {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: ERC20_MIN_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'Transfer') continue;
      const args = decoded.args as unknown as { to?: string };
      if (!args.to) continue;
      const to = args.to.toLowerCase();
      if (to === ZERO_ADDRESS) continue;
      seen.add(to);
    } catch {
      // Skip logs that don't match the ERC-20 Transfer shape (e.g. a
      // non-standard 4-topic Transfer or a collision with another event).
      continue;
    }
  }
}

/**
 * Split a [fromBlock..toBlock] range into contiguous, non-overlapping chunks
 * whose individual span (`toBlock - fromBlock`) never exceeds `maxSpan`. BSC
 * public RPCs measure the `eth_getLogs` cap as `toBlock - fromBlock` rather
 * than a block count, so a 10_000-span window with `maxSpan=5_000` yields
 * exactly two chunks (span 5_000 + span 5_000 = covers 10_001 blocks).
 *
 * The first chunk starts at `fromBlock`; subsequent chunks begin at the
 * previous chunk's `toBlock + 1` to avoid double-counting a Transfer emitted
 * on a chunk boundary.
 */
export function planGetLogsChunks(
  fromBlock: bigint,
  toBlock: bigint,
  maxSpan: bigint,
): { fromBlock: bigint; toBlock: bigint }[] {
  if (toBlock < fromBlock) return [];
  const chunks: { fromBlock: bigint; toBlock: bigint }[] = [];
  let cursor = fromBlock;
  let first = true;
  while (cursor <= toBlock) {
    // First chunk consumes the full `maxSpan` window; later chunks need to
    // skip over the previous chunk's already-covered boundary block, so they
    // consume `maxSpan - 1n` extra blocks on top of their starting cursor.
    const end = first ? cursor + maxSpan : cursor + maxSpan - 1n;
    const chunkEnd = end > toBlock ? toBlock : end;
    chunks.push({ fromBlock: cursor, toBlock: chunkEnd });
    if (chunkEnd === toBlock) break;
    cursor = chunkEnd + 1n;
    first = false;
  }
  return chunks;
}

/**
 * Convert (lastPrice * totalSupply) / 1e36 to a finite Number while
 * preserving sub-1-BNB precision. We split the 1e18 scale in half so each
 * BigInt-to-Number conversion stays well inside IEEE-754 safe range for
 * sensible on-chain values.
 *
 * Returns `null` if the result is Infinity or NaN — caller must surface a
 * warning rather than publish a poisoned metric.
 */
export function computeMarketCapBnb(lastPrice: bigint, totalSupply: bigint): number | null {
  // Pre-divide each factor by 1e9 in BigInt space to drop 9 decimals of
  // integer precision, then do the remaining divide in Number space. This
  // keeps ~9 significant digits across [0.001, 1e12] BNB without clobbering
  // small caps to zero.
  const priceScaled = Number(lastPrice) / 1e18;
  const supplyScaled = Number(totalSupply) / 1e18;
  const mc = priceScaled * supplyScaled;
  if (!Number.isFinite(mc)) return null;
  return mc;
}

/**
 * Shape of the `_tokenInfos` return we consume. viem returns an array
 * indexed by position when the ABI has unnamed or all-named outputs — we
 * normalise to a typed object and bail (return null) if the tuple is the
 * wrong size.
 */
interface DecodedTokenInfos {
  totalSupply: bigint;
  maxRaising: bigint;
  funds: bigint;
  lastPrice: bigint;
}

type DecodeResult =
  | { kind: 'ok'; value: DecodedTokenInfos }
  | { kind: 'wrongLength'; got: number }
  | { kind: 'wrongTypes' };

/**
 * Decode the `_tokenInfos` tuple into the field subset we consume. Pins the
 * tuple length at exactly 13 so a future contract revision that reorders or
 * resizes fields surfaces an explicit warning instead of silently decoding
 * wrong semantics at the right-looking positions.
 */
function decodeTokenInfos(raw: unknown): DecodeResult {
  if (!Array.isArray(raw)) return { kind: 'wrongLength', got: 0 };
  if (raw.length !== 13) return { kind: 'wrongLength', got: raw.length };
  const [, , , totalSupply, , maxRaising, , , funds, lastPrice] = raw as unknown[];
  if (
    typeof totalSupply !== 'bigint' ||
    typeof maxRaising !== 'bigint' ||
    typeof funds !== 'bigint' ||
    typeof lastPrice !== 'bigint'
  ) {
    return { kind: 'wrongTypes' };
  }
  return { kind: 'ok', value: { totalSupply, maxRaising, funds, lastPrice } };
}

function summariseError(err: unknown): string {
  if (err instanceof Error) {
    // Keep the first line only; viem errors can be 20+ lines long.
    return err.message.split('\n')[0]!.slice(0, 160);
  }
  return String(err).slice(0, 160);
}
