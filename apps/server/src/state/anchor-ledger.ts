/**
 * AnchorLedger — append log of Narrator lore anchor commitments, backed by
 * Postgres with an in-memory fallback for `STATE_BACKEND=memory`.
 *
 * The AC3 on-chain anchor fallback records one entry per chapter the
 * Narrator publishes. Each entry binds a (tokenAddr, chapterNumber) pair to
 * a deterministic keccak256 `contentHash` over the tuple
 * `${tokenAddr-lowercased}:${chapterNumber}:${loreCid}`. The commitment
 * lives in layer 1 unconditionally so the demo UI has visible evidence even
 * when the optional layer-2 BSC self-tx memo is disabled.
 *
 * Overwrite semantics: `append` is keyed by `anchorId`, not by arrival
 * order. Rewriting a chapter for the same token collapses on the same
 * anchorId and replaces the entry in-place. `inserted_at` is preserved on
 * rewrite so the ledger's chronological slot stays stable — listing by
 * `inserted_at ASC` keeps chapter rewrites in their original position.
 *
 * Address normalisation mirrors `LoreStore`: `tokenAddr` is stored
 * lowercased so downstream consumers (dashboard filter, layer-2 tx builder,
 * x402 body inclusion) can treat it as a canonical key.
 */
import type { Pool } from 'pg';
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

export interface AnchorLedgerOptions {
  /** Optional pg pool. When omitted the ledger runs on an in-memory Map. */
  pool?: Pool | undefined;
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
 * Address case is normalised first so the commitment is stable regardless
 * of how the caller spells the token.
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
  private readonly pool: Pool | undefined;
  // Memory fallback. Map preserves insertion order; Map.set on an existing
  // key retains the original position, which matches "rewrite keeps the
  // same ledger slot" behaviour we want for chapter re-publish.
  private readonly entries = new Map<string, AnchorLedgerEntry>();

  constructor(options: AnchorLedgerOptions = {}) {
    this.pool = options.pool;
  }

  /**
   * Append an entry. Overwrites any existing row with the same `anchorId`
   * while preserving the original insertion position (chapter rewrites
   * keep their chronological slot in the ledger).
   */
  async append(input: AnchorLedgerAppendInput): Promise<AnchorLedgerEntry> {
    const entry: AnchorLedgerEntry = {
      anchorId: input.anchorId,
      tokenAddr: normaliseAddr(input.tokenAddr),
      chapterNumber: input.chapterNumber,
      loreCid: input.loreCid,
      contentHash: input.contentHash,
      ts: input.ts,
    };
    if (this.pool !== undefined) {
      await this.pool.query(
        `INSERT INTO anchor_ledger (anchor_id, token_addr, chapter_number, payload, inserted_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now(), now())
         ON CONFLICT (anchor_id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [entry.anchorId, entry.tokenAddr, entry.chapterNumber, JSON.stringify(entry)],
      );
      return entry;
    }
    this.entries.set(entry.anchorId, entry);
    return entry;
  }

  /**
   * Stamp layer-2 on-chain metadata onto an existing entry. Silent no-op
   * for unknown anchorId so a cleared ledger or late-arriving tx does not
   * break the Narrator happy path.
   */
  async markOnChain(anchorId: string, stamp: OnChainStamp): Promise<void> {
    if (this.pool !== undefined) {
      // `jsonb_set` merges the three trio fields into the existing payload
      // without rewriting the anchor body. Three sequential sets keep the
      // SQL tidy; all three happen in one query plan regardless.
      await this.pool.query(
        `UPDATE anchor_ledger
           SET payload = jsonb_set(
                  jsonb_set(
                    jsonb_set(payload, '{onChainTxHash}', to_jsonb($2::text)),
                    '{chain}', to_jsonb($3::text)
                  ),
                  '{explorerUrl}', to_jsonb($4::text)
                ),
               updated_at = now()
         WHERE anchor_id = $1`,
        [anchorId, stamp.onChainTxHash, stamp.chain, stamp.explorerUrl],
      );
      return;
    }
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
  async get(anchorId: string): Promise<AnchorLedgerEntry | undefined> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: AnchorLedgerEntry }>(
        `SELECT payload FROM anchor_ledger WHERE anchor_id = $1`,
        [anchorId],
      );
      return rows[0]?.payload;
    }
    return this.entries.get(anchorId);
  }

  /**
   * List all entries in insertion order. When `tokenAddr` is supplied, only
   * entries whose normalised address matches are returned. Address
   * comparison is case-insensitive.
   */
  async list(tokenAddr?: string): Promise<AnchorLedgerEntry[]> {
    if (this.pool !== undefined) {
      if (tokenAddr === undefined) {
        const { rows } = await this.pool.query<{ payload: AnchorLedgerEntry }>(
          `SELECT payload FROM anchor_ledger ORDER BY inserted_at ASC`,
        );
        return rows.map((r) => r.payload);
      }
      const needle = normaliseAddr(tokenAddr);
      const { rows } = await this.pool.query<{ payload: AnchorLedgerEntry }>(
        `SELECT payload FROM anchor_ledger
         WHERE token_addr = $1
         ORDER BY inserted_at ASC`,
        [needle],
      );
      return rows.map((r) => r.payload);
    }
    const all = Array.from(this.entries.values());
    if (tokenAddr === undefined) return all;
    const needle = normaliseAddr(tokenAddr);
    return all.filter((e) => e.tokenAddr === needle);
  }

  /** Drop every entry. Intended for test isolation and demo resets. */
  async clear(): Promise<void> {
    if (this.pool !== undefined) {
      await this.pool.query(`TRUNCATE anchor_ledger`);
      return;
    }
    this.entries.clear();
  }

  /** Distinct anchor count — one per (tokenAddr, chapterNumber) pair. */
  async size(): Promise<number> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM anchor_ledger`,
      );
      return Number.parseInt(rows[0]?.count ?? '0', 10);
    }
    return this.entries.size;
  }
}
