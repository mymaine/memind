/**
 * LoreStore — per-token chapter chain backed by Postgres.
 *
 * Every persona that produces a lore chapter (Creator on `/launch`, Narrator
 * on `/lore`, Heartbeat on autonomous ticks) upserts the result here. The
 * store keeps the full chronological chain per token so subsequent narrator
 * runs can generate a real continuation instead of re-writing Chapter 1 from
 * scratch. The x402 `/lore/:tokenAddr` handler reads the latest chapter via
 * `getLatest(tokenAddr)`.
 *
 * Persona metadata (`tokenName`, `tokenSymbol`) travels on the entry itself
 * so consumers never need a parallel metadata store — the Narrator input
 * resolver can pull name/symbol straight off the latest entry.
 *
 * Address normalization: EVM addresses are case-insensitive on-chain but
 * sources hand us mixed-case strings (viem's checksum format, four.meme CLI
 * stdout, user input). The store normalises all keys to lowercase so a
 * Creator/Narrator upsert and a later x402 lookup cannot miss each other
 * because of casing drift. The normalised form is also what gets persisted
 * in the `tokenAddr` field of the returned entry — downstream consumers
 * should treat the stored value as the canonical form.
 *
 * Backend: jsonb `payload` per (token_addr, chapter_number). Upserts via
 * `ON CONFLICT (token_addr, chapter_number) DO UPDATE SET payload = ...`.
 *
 * Test seam: when constructed without a pool, the store falls back to a
 * per-instance in-memory Map. This path is NOT exposed at runtime — boot
 * refuses to start without `DATABASE_URL` — so the fallback is only ever
 * reached by unit tests that need a zero-setup `new LoreStore()`.
 */
import type { Pool } from 'pg';

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

export interface LoreStoreOptions {
  /** Optional pg pool. Omit only from unit tests that need a zero-setup store. */
  pool?: Pool | undefined;
}

export class LoreStore {
  private readonly pool: Pool | undefined;
  /** In-memory fallback for the unit-test seam only — never hit at runtime. */
  private readonly chapters = new Map<string, LoreEntry[]>();

  constructor(options: LoreStoreOptions = {}) {
    this.pool = options.pool;
  }

  /**
   * Store `entry` in the chain for its token. If a chapter with the same
   * `chapterNumber` already exists for that token, it is replaced in place
   * (re-runs / retries overwrite rather than duplicate); otherwise the
   * entry is appended.
   */
  async upsert(entry: LoreEntry): Promise<void> {
    const key = normaliseAddr(entry.tokenAddr);
    const normalised: LoreEntry = { ...entry, tokenAddr: key };
    if (this.pool !== undefined) {
      await this.pool.query(
        `INSERT INTO lore_chapters (token_addr, chapter_number, payload, published_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, now())
         ON CONFLICT (token_addr, chapter_number)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [key, normalised.chapterNumber, JSON.stringify(normalised), normalised.publishedAt],
      );
      return;
    }
    const existing = this.chapters.get(key);
    if (existing === undefined) {
      this.chapters.set(key, [normalised]);
      return;
    }
    const idx = existing.findIndex((c) => c.chapterNumber === normalised.chapterNumber);
    if (idx >= 0) {
      existing[idx] = normalised;
    } else {
      existing.push(normalised);
    }
    existing.sort((a, b) => a.chapterNumber - b.chapterNumber);
  }

  /**
   * Return the most recent chapter for `tokenAddr` (highest chapterNumber),
   * or undefined if no chapter has been stored for that token yet.
   */
  async getLatest(tokenAddr: string): Promise<LoreEntry | undefined> {
    const key = normaliseAddr(tokenAddr);
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: LoreEntry }>(
        `SELECT payload FROM lore_chapters
         WHERE token_addr = $1
         ORDER BY chapter_number DESC
         LIMIT 1`,
        [key],
      );
      return rows[0]?.payload;
    }
    const chain = this.chapters.get(key);
    if (chain === undefined || chain.length === 0) return undefined;
    return chain[chain.length - 1];
  }

  /** Return the full chapter chain for `tokenAddr` in chronological order. */
  async getAllChapters(tokenAddr: string): Promise<LoreEntry[]> {
    const key = normaliseAddr(tokenAddr);
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ payload: LoreEntry }>(
        `SELECT payload FROM lore_chapters
         WHERE token_addr = $1
         ORDER BY chapter_number ASC`,
        [key],
      );
      return rows.map((r) => r.payload);
    }
    const chain = this.chapters.get(key);
    if (chain === undefined) return [];
    return [...chain];
  }

  /** Number of distinct tokens with at least one stored chapter. */
  async size(): Promise<number> {
    if (this.pool !== undefined) {
      const { rows } = await this.pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT token_addr)::text AS count FROM lore_chapters`,
      );
      return Number.parseInt(rows[0]?.count ?? '0', 10);
    }
    return this.chapters.size;
  }

  /** Remove every entry. Used by tests and demo resets. */
  async clear(): Promise<void> {
    if (this.pool !== undefined) {
      await this.pool.query(`TRUNCATE lore_chapters`);
      return;
    }
    this.chapters.clear();
  }
}

function normaliseAddr(addr: string): string {
  return addr.toLowerCase();
}
