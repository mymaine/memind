import { describe, it, expect, beforeEach } from 'vitest';
import { LoreStore, type LoreEntry } from './lore-store.js';

/**
 * LoreStore is an in-memory chapter chain per token. It glues together every
 * persona that produces lore (Creator's Chapter 1, Narrator's Chapter N,
 * Heartbeat's autonomous extensions) with the x402 `/lore/:tokenAddr`
 * endpoint and the Narrator's previous-chapter resolver.
 *
 * Retention semantics: the store keeps the full chronological chain per token
 * in memory so subsequent narrator runs can stitch a real continuation;
 * callers that only need the hot tail call `getLatest`. Older chapters can
 * also be refetched from Pinata via their persisted `ipfsHash`.
 */

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

describe('LoreStore', () => {
  let store: LoreStore;

  beforeEach(() => {
    store = new LoreStore();
  });

  it('upsert stores a new entry that getLatest can retrieve', () => {
    const entry = makeEntry();
    store.upsert(entry);

    const fetched = store.getLatest(entry.tokenAddr);
    expect(fetched).toEqual(entry);
    expect(store.size()).toBe(1);
  });

  it('upsert replaces a chapter with the same chapterNumber (retry semantics)', () => {
    const first = makeEntry({ chapterNumber: 1, chapterText: 'first attempt' });
    const retry = makeEntry({
      chapterNumber: 1,
      chapterText: 'retry attempt',
      ipfsHash: 'bafkreidef',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreidef',
    });

    store.upsert(first);
    store.upsert(retry);

    const fetched = store.getLatest(first.tokenAddr);
    expect(fetched?.chapterNumber).toBe(1);
    expect(fetched?.chapterText).toBe('retry attempt');
    expect(fetched?.ipfsHash).toBe('bafkreidef');
    // Still a single chapter for this token — replacement, not append.
    expect(store.getAllChapters(first.tokenAddr)).toHaveLength(1);
    expect(store.size()).toBe(1);
  });

  it('upsert appends when chapterNumber is new for the token', () => {
    const ch1 = makeEntry({ chapterNumber: 1, chapterText: 'first' });
    const ch2 = makeEntry({
      chapterNumber: 2,
      chapterText: 'second',
      ipfsHash: 'bafkreidef',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreidef',
    });

    store.upsert(ch1);
    store.upsert(ch2);

    const all = store.getAllChapters(ch1.tokenAddr);
    expect(all.map((c) => c.chapterNumber)).toEqual([1, 2]);
    expect(store.getLatest(ch1.tokenAddr)?.chapterNumber).toBe(2);
    expect(store.size()).toBe(1);
  });

  it('getAllChapters returns chapters in ascending chapterNumber order and getLatest returns the tail', () => {
    store.upsert(makeEntry({ chapterNumber: 1, chapterText: 'first' }));
    // Insert out of order to confirm the store keeps the chain sorted.
    store.upsert(makeEntry({ chapterNumber: 3, chapterText: 'third' }));
    store.upsert(makeEntry({ chapterNumber: 2, chapterText: 'second' }));

    const all = store.getAllChapters('0x1111111111111111111111111111111111111111');
    expect(all.map((c) => c.chapterNumber)).toEqual([1, 2, 3]);
    expect(all.map((c) => c.chapterText)).toEqual(['first', 'second', 'third']);

    expect(store.getLatest('0x1111111111111111111111111111111111111111')?.chapterNumber).toBe(3);
  });

  it('getAllChapters returns an empty array for an unknown token', () => {
    expect(store.getAllChapters('0x2222222222222222222222222222222222222222')).toEqual([]);
  });

  it('getAllChapters returns a shallow clone so callers cannot mutate internal state', () => {
    store.upsert(makeEntry({ chapterNumber: 1 }));
    const firstRead = store.getAllChapters('0x1111111111111111111111111111111111111111');
    firstRead.push(makeEntry({ chapterNumber: 99 }));

    // Internal chain unaffected by the external mutation.
    const secondRead = store.getAllChapters('0x1111111111111111111111111111111111111111');
    expect(secondRead.map((c) => c.chapterNumber)).toEqual([1]);
  });

  it('getLatest returns undefined when no entry exists for the address', () => {
    expect(store.getLatest('0x2222222222222222222222222222222222222222')).toBeUndefined();
  });

  it('normalizes mixed-case addresses so case does not create separate buckets', () => {
    const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    const lower = mixed.toLowerCase();

    store.upsert(makeEntry({ tokenAddr: mixed, chapterText: 'mixed-case write' }));

    // Lookups with either casing resolve to the same entry.
    expect(store.getLatest(mixed)?.chapterText).toBe('mixed-case write');
    expect(store.getLatest(lower)?.chapterText).toBe('mixed-case write');
    // Stored tokenAddr is the normalized lowercase form.
    expect(store.getLatest(mixed)?.tokenAddr).toBe(lower);
    expect(store.getAllChapters(mixed)).toHaveLength(1);
    expect(store.size()).toBe(1);
  });

  it('size reflects the number of distinct tokens and clear empties the store', () => {
    store.upsert(makeEntry({ tokenAddr: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    store.upsert(makeEntry({ tokenAddr: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }));
    expect(store.size()).toBe(2);

    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getLatest('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeUndefined();
    expect(store.getAllChapters('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual([]);
  });
});
