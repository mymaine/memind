/**
 * TokenIdentityReader — authoritative ERC-20 identity lookup for a BSC token.
 *
 * Why: Shiller / Narrator / Heartbeat historically inferred a token's symbol
 * from the LoreStore entry (or, worse, the lore prose itself). When a run
 * surfaced a token the Brain had not seen before, the LLM invented a plausible
 * ticker ("$BONIN") while the real symbol on chain was something else
 * ("HBNB2026-HKAT"). This reader is the single on-chain source of truth the
 * new `get_token_info` tool exposes so every persona has a structured way to
 * ground a tweet / chapter in real identity data.
 *
 * Scope of this module (SOLID — single responsibility):
 *   - read ERC-20 `name()` / `symbol()` / `decimals()` / `totalSupply()` via
 *     viem's `readContract`
 *   - check `getCode` for a non-empty bytecode so the caller can skip
 *     downstream work when the contract does not exist
 *   - cache the resolved identity in a small LRU (ERC-20 name/symbol are
 *     immutable after deploy, so a 10-minute TTL is a cost/latency saver
 *     not a correctness concession)
 *
 * What this module intentionally does NOT do:
 *   - market state (curve progress, holder count, 24h volume) — that belongs
 *     to `readMarketState` in `tools/token-status.ts`
 *   - narrative / lore — `LoreStore` is the IPFS cache source of truth
 *   - hallucination fallback — every read failure throws so the caller can
 *     decide whether to degrade gracefully; we never return fabricated data
 */
import {
  createPublicClient,
  getAddress,
  http,
  type Chain,
  type PublicClient,
  type Transport,
} from 'viem';
import { bsc } from 'viem/chains';

// ERC-20 read surface — minimal ABI for name / symbol / decimals / totalSupply.
// Hand-authored rather than importing from `chain/token-manager-abi.ts` because
// `ERC20_MIN_ABI` there only exposes Transfer + totalSupply; we need the full
// identity quartet here and adding unused members to the token-manager ABI
// would blur the module's scope.
const ERC20_IDENTITY_ABI = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface TokenIdentity {
  /** Checksummed 0x-prefixed EVM address. */
  tokenAddr: string;
  /** ERC-20 `symbol()` (e.g. `HBNB2026-HKAT`). Empty string never surfaces — reads throw on decode error. */
  symbol: string;
  /** ERC-20 `name()` (e.g. `HBNB2026-Hackathon Kat`). */
  name: string;
  /** ERC-20 `decimals()` — virtually always 18 on four.meme, but never assumed. */
  decimals: number;
  /** ERC-20 `totalSupply()` as a decimal string; BigInt serialises poorly through JSON. */
  totalSupply: string;
  /** `true` iff `getCode` returned non-empty bytecode at `tokenAddr`. */
  deployedOnChain: boolean;
}

export interface TokenIdentityReaderOptions {
  /** BSC mainnet JSON-RPC URL. Used only when `publicClient` is not provided. */
  rpcUrl?: string;
  /** Injected viem public client — test seam. */
  publicClient?: PublicClient;
  /** LRU TTL in milliseconds. Defaults to 10 minutes. */
  cacheTtlMs?: number;
  /** LRU capacity. Defaults to 200 distinct tokens. */
  cacheMaxEntries?: number;
  /** Test seam for a deterministic clock. Defaults to `Date.now`. */
  now?: () => number;
}

interface CacheEntry {
  identity: TokenIdentity;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_CACHE_MAX_ENTRIES = 200;

/**
 * On-chain ERC-20 identity reader with a small LRU in front. Every read
 * failure (missing contract, RPC error, decode error) throws — the caller
 * decides whether to degrade the surrounding flow. This class never returns a
 * fabricated identity.
 */
export class TokenIdentityReader {
  private readonly client: PublicClient;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly now: () => number;

  constructor(options: TokenIdentityReaderOptions = {}) {
    if (options.publicClient !== undefined) {
      this.client = options.publicClient;
    } else if (options.rpcUrl !== undefined) {
      // Cast mirrors `createCheckTokenStatusTool` — viem's generic
      // PublicClient type narrows to the transport; we only consume
      // `getCode` + `readContract` so the widened shape is safe.
      this.client = createPublicClient({
        chain: bsc satisfies Chain,
        transport: http(options.rpcUrl) satisfies Transport,
      }) as unknown as PublicClient;
    } else {
      throw new Error('TokenIdentityReader: one of `publicClient` or `rpcUrl` must be supplied');
    }
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Resolve the ERC-20 identity of `tokenAddr`. Throws on any RPC or decode
   * error — the caller must decide whether to degrade. Guaranteed to return
   * the same checksum-normalised address on the output as the one callers
   * should cache downstream against.
   */
  async readIdentity(tokenAddr: string): Promise<TokenIdentity> {
    const normalised = getAddress(tokenAddr);
    const cached = this.readCache(normalised);
    if (cached !== undefined) return cached;

    // bytecode short-circuit: when the contract is not deployed there is
    // nothing to call. We still return a well-typed record with the flag
    // flipped so callers can surface "token does not exist" without a try /
    // catch dance. Cache the negative result too — retrying in 10 minutes is
    // the same protection a deployment would need anyway.
    const bytecode = await this.client.getCode({ address: normalised as `0x${string}` });
    const deployedOnChain = Boolean(bytecode && bytecode !== '0x');
    if (!deployedOnChain) {
      const identity: TokenIdentity = {
        tokenAddr: normalised,
        symbol: '',
        name: '',
        decimals: 0,
        totalSupply: '0',
        deployedOnChain: false,
      };
      this.writeCache(normalised, identity);
      return identity;
    }

    // Fire the four reads in parallel — they are independent view calls so
    // RPC round trips compress to one overall wait. viem surfaces any
    // per-call revert as a rejection, which Promise.all propagates.
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.client.readContract({
        address: normalised as `0x${string}`,
        abi: ERC20_IDENTITY_ABI,
        functionName: 'name',
      }) as Promise<string>,
      this.client.readContract({
        address: normalised as `0x${string}`,
        abi: ERC20_IDENTITY_ABI,
        functionName: 'symbol',
      }) as Promise<string>,
      this.client.readContract({
        address: normalised as `0x${string}`,
        abi: ERC20_IDENTITY_ABI,
        functionName: 'decimals',
      }) as Promise<number>,
      this.client.readContract({
        address: normalised as `0x${string}`,
        abi: ERC20_IDENTITY_ABI,
        functionName: 'totalSupply',
      }) as Promise<bigint>,
    ]);

    const identity: TokenIdentity = {
      tokenAddr: normalised,
      symbol,
      name,
      // viem decodes uint8 as a number; defensive narrow keeps the output
      // contract honest if a future viem release hands us a bigint.
      decimals: Number(decimals),
      totalSupply: totalSupply.toString(),
      deployedOnChain: true,
    };
    this.writeCache(normalised, identity);
    return identity;
  }

  /** Drop every cache entry. Used by tests and demo-reset hooks. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Cache size for test introspection. */
  cacheSize(): number {
    return this.cache.size;
  }

  private readCache(key: string): TokenIdentity | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key);
      return undefined;
    }
    // LRU: re-insert to push this entry to the most-recently-used tail so
    // capacity eviction drops the oldest key.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.identity;
  }

  private writeCache(key: string, identity: TokenIdentity): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, {
      identity,
      expiresAt: this.now() + this.cacheTtlMs,
    });
    // Evict oldest entry when over capacity. Map iteration order is
    // insertion order in JS, so the first key is the least-recently-used.
    while (this.cache.size > this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
