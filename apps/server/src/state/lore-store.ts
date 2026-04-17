/**
 * LoreStore — in-memory "latest lore chapter per token" cache.
 *
 * The Narrator agent writes each newly produced chapter here; the x402
 * `/lore/:tokenAddr` handler reads it to serve paying callers. We intentionally
 * do NOT track chapter history in memory — older chapters remain fetchable
 * from Pinata via their persisted `ipfsHash`, and memoising every past chapter
 * would grow unboundedly across a long-running demo.
 *
 * Address normalization: EVM addresses are case-insensitive on-chain but
 * sources hand us mixed-case strings (viem's checksum format, four.meme CLI
 * stdout, user input). The store normalises all keys to lowercase so a
 * Narrator upsert and a later x402 lookup cannot miss each other because of
 * casing drift. The normalised form is also what gets persisted in the
 * `tokenAddr` field of the returned entry — downstream consumers should treat
 * the stored value as the canonical form.
 */
export interface LoreEntry {
  /** 0x-prefixed lowercase EVM address. */
  tokenAddr: string;
  /** 1-based chapter index produced by the Narrator agent. */
  chapterNumber: number;
  /** Raw chapter prose as written by the Narrator. */
  chapterText: string;
  /** Pinata CID returned by `extend_lore`. */
  ipfsHash: string;
  /** Public gateway URL for the pinned chapter file. */
  ipfsUri: string;
  /** ISO 8601 timestamp assigned by the Narrator at publish time. */
  publishedAt: string;
}

export class LoreStore {
  private readonly latest = new Map<string, LoreEntry>();

  /**
   * Store `entry` as the latest chapter for its token. Any previous entry for
   * the same (normalised) address is replaced; the old one is discarded.
   */
  upsert(entry: LoreEntry): void {
    const key = normaliseAddr(entry.tokenAddr);
    this.latest.set(key, { ...entry, tokenAddr: key });
  }

  /**
   * Return the most recent chapter for `tokenAddr`, or undefined if the
   * Narrator has not yet published anything for that token.
   */
  getLatest(tokenAddr: string): LoreEntry | undefined {
    return this.latest.get(normaliseAddr(tokenAddr));
  }

  /** Number of distinct tokens with at least one stored chapter. */
  size(): number {
    return this.latest.size;
  }

  /** Remove every entry. Used by tests and demo resets. */
  clear(): void {
    this.latest.clear();
  }
}

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}
