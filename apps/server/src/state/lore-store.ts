/**
 * LoreStore — in-memory chapter chain per token.
 *
 * Every persona that produces a lore chapter (Creator on `/launch`, Narrator on
 * `/lore`, Heartbeat on autonomous ticks) upserts the result here. The store
 * keeps the full chronological chain per token so subsequent narrator runs can
 * generate a real continuation instead of re-writing Chapter 1 from scratch.
 * The x402 `/lore/:tokenAddr` handler reads the latest chapter via
 * `getLatest(tokenAddr)`.
 *
 * Persona metadata (`tokenName`, `tokenSymbol`) travels on the entry itself so
 * consumers never need a parallel metadata store — the Narrator input resolver
 * can pull name/symbol straight off the latest entry.
 *
 * Address normalization: EVM addresses are case-insensitive on-chain but
 * sources hand us mixed-case strings (viem's checksum format, four.meme CLI
 * stdout, user input). The store normalises all keys to lowercase so a
 * Creator/Narrator upsert and a later x402 lookup cannot miss each other
 * because of casing drift. The normalised form is also what gets persisted in
 * the `tokenAddr` field of the returned entry — downstream consumers should
 * treat the stored value as the canonical form.
 */
export interface LoreEntry {
  /** 0x-prefixed lowercase EVM address. */
  tokenAddr: string;
  /** 1-based chapter index (1 = the Creator's opening chapter). */
  chapterNumber: number;
  /** Raw chapter prose. */
  chapterText: string;
  /** Pinata CID of the pinned chapter markdown. */
  ipfsHash: string;
  /** Public gateway URL for the pinned chapter file. */
  ipfsUri: string;
  /** Token display name (e.g. `HBNB2026-BAT`). */
  tokenName: string;
  /** Token ticker symbol (e.g. `HBNB2026-BAT`). */
  tokenSymbol: string;
  /** ISO 8601 timestamp assigned by the upserter at publish time. */
  publishedAt: string;
}

export class LoreStore {
  /**
   * Key: lowercase tokenAddr. Value: chapters in chronological order
   * (chapter 1 first, latest last). The array is the canonical source of
   * truth — `getLatest` just peeks the tail.
   */
  private readonly chapters = new Map<string, LoreEntry[]>();

  /**
   * Store `entry` in the chain for its token. If a chapter with the same
   * `chapterNumber` already exists for that token, it is replaced in place
   * (re-runs / retries overwrite rather than duplicate); otherwise the entry
   * is appended. The chain is kept sorted by `chapterNumber` ascending.
   */
  upsert(entry: LoreEntry): void {
    const key = normaliseAddr(entry.tokenAddr);
    const normalised: LoreEntry = { ...entry, tokenAddr: key };
    const existing = this.chapters.get(key);
    if (existing === undefined) {
      this.chapters.set(key, [normalised]);
      return;
    }
    const existingIdx = existing.findIndex((c) => c.chapterNumber === normalised.chapterNumber);
    if (existingIdx >= 0) {
      existing[existingIdx] = normalised;
    } else {
      existing.push(normalised);
    }
    existing.sort((a, b) => a.chapterNumber - b.chapterNumber);
  }

  /**
   * Return the most recent chapter for `tokenAddr` (highest chapterNumber), or
   * undefined if no chapter has been stored for that token yet. This is the
   * hot-path lookup for the x402 `/lore/:tokenAddr` handler and for the
   * Shiller's lore-snippet resolver.
   */
  getLatest(tokenAddr: string): LoreEntry | undefined {
    const chain = this.chapters.get(normaliseAddr(tokenAddr));
    if (chain === undefined || chain.length === 0) return undefined;
    return chain[chain.length - 1];
  }

  /**
   * Return the full chapter chain for `tokenAddr` in chronological order
   * (chapter 1 first). Returns a shallow clone so callers cannot mutate the
   * internal array. Empty array when the token is unknown.
   */
  getAllChapters(tokenAddr: string): LoreEntry[] {
    const chain = this.chapters.get(normaliseAddr(tokenAddr));
    if (chain === undefined) return [];
    return [...chain];
  }

  /** Number of distinct tokens with at least one stored chapter. */
  size(): number {
    return this.chapters.size;
  }

  /** Remove every entry. Used by tests and demo resets. */
  clear(): void {
    this.chapters.clear();
  }
}

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}
