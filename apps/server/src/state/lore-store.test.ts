import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool, resolveDatabaseUrl } from '../db/pool.js';
import { ensureSchema } from '../db/schema.js';
import { resetDb } from '../db/reset.js';
import { LoreStore, type LoreEntry } from './lore-store.js';

/**
 * LoreStore integration tests — chapter chain semantics, chapter-number
 * replace vs append, address normalisation, shallow-clone isolation, retry
 * safety. Every assertion runs twice: once on the in-memory fallback (so
 * contributors without docker still see behaviour proofs), once on the
 * real Postgres backend when `DATABASE_URL` / `TEST_DATABASE_URL` is
 * reachable.
 */

const hasDatabaseUrl = resolveDatabaseUrl() !== undefined;

function makeEntry(overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    tokenAddr: '0x1111111111111111111111111111111111111111',
    chapterNumber: 1,
    chapterText: 'opening vignette',
    ipfsHash: 'bafkreiabc',
    ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreiabc',
    tokenName: 'HBNB2026-Alpha',
    tokenSymbol: 'HBNB2026-ALP',
    publishedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}

function runBehaviouralSuite(label: string, makeStore: () => Promise<LoreStore>): void {
  describe(`LoreStore (${label})`, () => {
    let store: LoreStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    it('upsert stores a new entry that getLatest can retrieve', async () => {
      const entry = makeEntry();
      await store.upsert(entry);

      const fetched = await store.getLatest(entry.tokenAddr);
      expect(fetched).toEqual(entry);
      expect(await store.size()).toBe(1);
    });

    it('upsert replaces a chapter with the same chapterNumber (retry semantics)', async () => {
      const first = makeEntry({ chapterNumber: 1, chapterText: 'first attempt' });
      const retry = makeEntry({
        chapterNumber: 1,
        chapterText: 'retry attempt',
        ipfsHash: 'bafkreidef',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreidef',
      });

      await store.upsert(first);
      await store.upsert(retry);

      const fetched = await store.getLatest(first.tokenAddr);
      expect(fetched?.chapterNumber).toBe(1);
      expect(fetched?.chapterText).toBe('retry attempt');
      expect(fetched?.ipfsHash).toBe('bafkreidef');
      expect(await store.getAllChapters(first.tokenAddr)).toHaveLength(1);
      expect(await store.size()).toBe(1);
    });

    it('upsert appends when chapterNumber is new for the token', async () => {
      const ch1 = makeEntry({ chapterNumber: 1, chapterText: 'first' });
      const ch2 = makeEntry({
        chapterNumber: 2,
        chapterText: 'second',
        ipfsHash: 'bafkreidef',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreidef',
      });

      await store.upsert(ch1);
      await store.upsert(ch2);

      const all = await store.getAllChapters(ch1.tokenAddr);
      expect(all.map((c) => c.chapterNumber)).toEqual([1, 2]);
      expect((await store.getLatest(ch1.tokenAddr))?.chapterNumber).toBe(2);
      expect(await store.size()).toBe(1);
    });

    it('getAllChapters returns chapters in ascending order and getLatest returns the tail', async () => {
      await store.upsert(makeEntry({ chapterNumber: 1, chapterText: 'first' }));
      await store.upsert(makeEntry({ chapterNumber: 3, chapterText: 'third' }));
      await store.upsert(makeEntry({ chapterNumber: 2, chapterText: 'second' }));

      const all = await store.getAllChapters('0x1111111111111111111111111111111111111111');
      expect(all.map((c) => c.chapterNumber)).toEqual([1, 2, 3]);
      expect(all.map((c) => c.chapterText)).toEqual(['first', 'second', 'third']);

      expect(
        (await store.getLatest('0x1111111111111111111111111111111111111111'))?.chapterNumber,
      ).toBe(3);
    });

    it('getAllChapters returns an empty array for an unknown token', async () => {
      expect(await store.getAllChapters('0x2222222222222222222222222222222222222222')).toEqual([]);
    });

    it('getAllChapters returns a shallow clone so callers cannot mutate internal state', async () => {
      await store.upsert(makeEntry({ chapterNumber: 1 }));
      const firstRead = await store.getAllChapters('0x1111111111111111111111111111111111111111');
      firstRead.push(makeEntry({ chapterNumber: 99 }));

      const secondRead = await store.getAllChapters('0x1111111111111111111111111111111111111111');
      expect(secondRead.map((c) => c.chapterNumber)).toEqual([1]);
    });

    it('getLatest returns undefined when no entry exists for the address', async () => {
      expect(await store.getLatest('0x2222222222222222222222222222222222222222')).toBeUndefined();
    });

    it('normalises mixed-case addresses so case does not create separate buckets', async () => {
      const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
      const lower = mixed.toLowerCase();

      await store.upsert(makeEntry({ tokenAddr: mixed, chapterText: 'mixed-case write' }));

      expect((await store.getLatest(mixed))?.chapterText).toBe('mixed-case write');
      expect((await store.getLatest(lower))?.chapterText).toBe('mixed-case write');
      expect((await store.getLatest(mixed))?.tokenAddr).toBe(lower);
      expect(await store.getAllChapters(mixed)).toHaveLength(1);
      expect(await store.size()).toBe(1);
    });

    it('size reflects the number of distinct tokens and clear empties the store', async () => {
      await store.upsert(makeEntry({ tokenAddr: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
      await store.upsert(makeEntry({ tokenAddr: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }));
      expect(await store.size()).toBe(2);

      await store.clear();
      expect(await store.size()).toBe(0);
      expect(await store.getLatest('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeUndefined();
      expect(await store.getAllChapters('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual([]);
    });
  });
}

runBehaviouralSuite('memory backend', () => Promise.resolve(new LoreStore()));

// pg-backed integration tests run only when a real database is reachable
// so contributors without docker still see the memory suite go green.
if (hasDatabaseUrl) {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool();
    await ensureSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  runBehaviouralSuite('pg backend', async () => {
    await resetDb(pool, { ...process.env, NODE_ENV: 'test' });
    return new LoreStore({ pool });
  });
}
