/**
 * AnchorLedger — in-memory append log of Narrator lore anchor commitments.
 *
 * The AC3 on-chain anchor fallback records one entry per chapter the Narrator
 * publishes. Each entry binds a (tokenAddr, chapterNumber) pair to a
 * deterministic keccak256 `contentHash` over the tuple
 * `${tokenAddr-lowercased}:${chapterNumber}:${loreCid}`. The commitment lives
 * in layer 1 unconditionally so the demo UI has visible evidence even when
 * the optional layer-2 BSC self-tx memo is disabled.
 *
 * Overwrite semantics: `append` is keyed by `anchorId`, not by arrival order.
 * Rewriting a chapter for the same token collapses on the same anchorId and
 * replaces the entry in-place. This mirrors LoreStore's "latest chapter wins"
 * contract and keeps the ledger compact across demo re-runs.
 *
 * Address normalisation: `tokenAddr` is stored lowercased so downstream
 * consumers (dashboard filter, layer-2 tx builder, x402 body inclusion) can
 * treat it as a canonical key. Accepts mixed-case input at the append /
 * list / computeAnchorId / computeContentHash boundaries.
 */
import { keccak256, stringToHex } from 'viem';

export interface AnchorLedgerEntry {
  /** Stable unique key `${tokenAddr-lowercased}-${chapterNumber}`. */
  anchorId: string;
  /** Lowercased EVM address of the token the chapter belongs to. */
  tokenAddr: string;
  /** 1-based chapter index. */
  chapterNumber: number;
  /** Pinata CID of the chapter body. */
  loreCid: string;
  /** 32-byte keccak256 commitment, 0x-prefixed lowercase hex. */
  contentHash: `0x${string}`;
  /** ISO 8601 timestamp of the layer-1 append. */
  ts: string;
  /** Layer-2: populated after `markOnChain` succeeds. All three or none. */
  onChainTxHash?: `0x${string}`;
  chain?: 'bsc-mainnet';
  explorerUrl?: string;
}

/** Append input (anchorId + contentHash are caller-computed via helpers). */
export interface AnchorLedgerAppendInput {
  anchorId: string;
  tokenAddr: string;
  chapterNumber: number;
  loreCid: string;
  contentHash: `0x${string}`;
  ts: string;
}

/**
 * Layer-2 tx metadata stamped onto an anchor once the zero-value self-tx
 * memo settles. All three fields must be provided together; the schema on
 * the wire enforces the same contract via `superRefine`.
 */
export interface OnChainStamp {
  onChainTxHash: `0x${string}`;
  chain: 'bsc-mainnet';
  explorerUrl: string;
}

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}

/**
 * Deterministic anchor identifier. Collisions are impossible across
 * (tokenAddr, chapterNumber) pairs, and a rewrite of the same chapter lands
 * on the same id so `append` acts as upsert.
 */
export function computeAnchorId(tokenAddr: string, chapterNumber: number): string {
  return `${normaliseAddr(tokenAddr)}-${chapterNumber.toString()}`;
}

/**
 * keccak256 commitment over the tuple (tokenAddr, chapterNumber, loreCid).
 * Address case is normalised first so the commitment is stable regardless of
 * how the caller spells the token.
 */
export function computeContentHash(
  tokenAddr: string,
  chapterNumber: number,
  loreCid: string,
): `0x${string}` {
  const preimage = `${normaliseAddr(tokenAddr)}:${chapterNumber.toString()}:${loreCid}`;
  return keccak256(stringToHex(preimage));
}

export class AnchorLedger {
  // Map preserves insertion order; Node Map.set on an existing key retains the
  // original position, which matches "rewrite keeps the same ledger slot"
  // behaviour we want for chapter re-publish.
  private readonly entries = new Map<string, AnchorLedgerEntry>();

  /**
   * Append an entry. Overwrites any existing row with the same `anchorId`
   * while preserving the original insertion position (chapter rewrites keep
   * their chronological slot in the ledger).
   */
  append(input: AnchorLedgerAppendInput): AnchorLedgerEntry {
    const entry: AnchorLedgerEntry = {
      anchorId: input.anchorId,
      tokenAddr: normaliseAddr(input.tokenAddr),
      chapterNumber: input.chapterNumber,
      loreCid: input.loreCid,
      contentHash: input.contentHash,
      ts: input.ts,
    };
    this.entries.set(entry.anchorId, entry);
    return entry;
  }

  /**
   * Stamp layer-2 on-chain metadata onto an existing entry. Silent no-op for
   * unknown anchorId so a cleared ledger or late-arriving tx does not break
   * the Narrator happy path.
   */
  markOnChain(anchorId: string, stamp: OnChainStamp): void {
    const existing = this.entries.get(anchorId);
    if (!existing) return;
    existing.onChainTxHash = stamp.onChainTxHash;
    existing.chain = stamp.chain;
    existing.explorerUrl = stamp.explorerUrl;
  }

  /**
   * Look up a single entry. Returns undefined when unknown so callers can
   * decide whether to treat it as "not yet anchored" or as an error.
   */
  get(anchorId: string): AnchorLedgerEntry | undefined {
    return this.entries.get(anchorId);
  }

  /**
   * List all entries in insertion order. When `tokenAddr` is supplied, only
   * entries whose normalised address matches are returned. Address
   * comparison is case-insensitive.
   */
  list(tokenAddr?: string): AnchorLedgerEntry[] {
    const all = Array.from(this.entries.values());
    if (tokenAddr === undefined) return all;
    const needle = normaliseAddr(tokenAddr);
    return all.filter((e) => e.tokenAddr === needle);
  }

  /** Drop every entry. Intended for test isolation and demo resets. */
  clear(): void {
    this.entries.clear();
  }

  /** Distinct anchor count — one per (tokenAddr, chapterNumber) pair. */
  size(): number {
    return this.entries.size;
  }
}
