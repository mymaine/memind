import { describe, it, expect, beforeEach } from 'vitest';
import { LoreStore, type LoreEntry } from './lore-store.js';

/**
 * LoreStore is an in-memory "latest chapter per token" cache. It is the glue
 * between the Narrator agent (which produces chapters) and the x402 `/lore`
 * endpoint (which serves them to paying callers).
 *
 * Overwrite semantics: we don't track chapter history in memory — callers can
 * always refetch older chapters from Pinata via the persisted ipfsHash. The
 * store's job is to give the x402 handler a zero-latency "what is the most
 * recent lore for this token?" lookup.
 */

function makeEntry(overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    tokenAddr: '0x1111111111111111111111111111111111111111',
    chapterNumber: 1,
    chapterText: 'opening vignette',
    ipfsHash: 'bafkreiabc',
    ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreiabc',
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

  it('upsert replaces the existing entry for the same token address', () => {
    const first = makeEntry({ chapterNumber: 1, chapterText: 'first' });
    const second = makeEntry({
      chapterNumber: 2,
      chapterText: 'second',
      ipfsHash: 'bafkreidef',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreidef',
    });

    store.upsert(first);
    store.upsert(second);

    const fetched = store.getLatest(first.tokenAddr);
    expect(fetched?.chapterNumber).toBe(2);
    expect(fetched?.chapterText).toBe('second');
    expect(store.size()).toBe(1);
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
    expect(store.size()).toBe(1);
  });

  it('size reflects the number of distinct tokens and clear empties the store', () => {
    store.upsert(makeEntry({ tokenAddr: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    store.upsert(makeEntry({ tokenAddr: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }));
    expect(store.size()).toBe(2);

    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getLatest('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeUndefined();
  });
});
