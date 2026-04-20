import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { keccak256, stringToHex } from 'viem';
import { createPool, resolveDatabaseUrl } from '../db/pool.js';
import { ensureSchema } from '../db/schema.js';
import { resetDb } from '../db/reset.js';
import { AnchorLedger, computeAnchorId, computeContentHash } from './anchor-ledger.js';

const hasDatabaseUrl = resolveDatabaseUrl() !== undefined;

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const TOKEN_LOWER = TOKEN_ADDR.toLowerCase();

function makeEntry(overrides?: Partial<Parameters<AnchorLedger['append']>[0]>) {
  const defaults = {
    tokenAddr: TOKEN_ADDR,
    chapterNumber: 1,
    loreCid: 'bafkreibxxxxx',
    ts: '2026-04-20T10:00:00.000Z',
  };
  const merged = { ...defaults, ...overrides };
  return {
    ...merged,
    anchorId: computeAnchorId(merged.tokenAddr, merged.chapterNumber),
    contentHash: computeContentHash(merged.tokenAddr, merged.chapterNumber, merged.loreCid),
  };
}

describe('computeContentHash', () => {
  it('is keccak256 over `${tokenAddr-lowercased}:${chapterNumber}:${loreCid}`', () => {
    const hash = computeContentHash(TOKEN_ADDR, 1, 'bafkreibxxxxx');
    const expected = keccak256(stringToHex(`${TOKEN_LOWER}:1:bafkreibxxxxx`));
    expect(hash).toBe(expected);
  });

  it('is address-case invariant', () => {
    const lower = computeContentHash(TOKEN_LOWER, 2, 'cid');
    const upper = computeContentHash(TOKEN_ADDR.toUpperCase(), 2, 'cid');
    expect(lower).toBe(upper);
  });

  it('changes when any field changes', () => {
    const base = computeContentHash(TOKEN_ADDR, 1, 'cid');
    expect(computeContentHash(TOKEN_ADDR, 2, 'cid')).not.toBe(base);
    expect(computeContentHash(TOKEN_ADDR, 1, 'other')).not.toBe(base);
  });
});

describe('computeAnchorId', () => {
  it('normalises the token address to lowercase and joins by dash', () => {
    expect(computeAnchorId(TOKEN_ADDR, 1)).toBe(`${TOKEN_LOWER}-1`);
  });

  it('is stable across chapter numbers', () => {
    expect(computeAnchorId(TOKEN_ADDR, 7)).toBe(`${TOKEN_LOWER}-7`);
  });
});

function runBehaviouralSuite(label: string, makeLedger: () => Promise<AnchorLedger>): void {
  describe(`AnchorLedger (${label})`, () => {
    let ledger: AnchorLedger;

    beforeEach(async () => {
      ledger = await makeLedger();
    });

    it('append stores a new entry that get(anchorId) and list() can retrieve', async () => {
      const entry = makeEntry();
      await ledger.append(entry);

      const fetched = await ledger.get(entry.anchorId);
      expect(fetched).toBeDefined();
      expect(fetched?.anchorId).toBe(entry.anchorId);
      expect(fetched?.contentHash).toBe(entry.contentHash);
      expect(fetched?.chapterNumber).toBe(1);
      expect(fetched?.tokenAddr).toBe(TOKEN_LOWER);

      expect(await ledger.list()).toHaveLength(1);
    });

    it('append overwrites an entry with the same anchorId (chapter rewrite) and keeps its slot', async () => {
      await ledger.append(makeEntry({ loreCid: 'first-cid' }));
      await ledger.append(makeEntry({ loreCid: 'second-cid', ts: '2026-04-20T11:00:00.000Z' }));

      const fetched = await ledger.get(computeAnchorId(TOKEN_ADDR, 1));
      expect(fetched?.loreCid).toBe('second-cid');
      expect(fetched?.ts).toBe('2026-04-20T11:00:00.000Z');
      // Still one row — same anchorId collapsed.
      expect(await ledger.list()).toHaveLength(1);
    });

    it('list filters by tokenAddr (case-insensitive) when provided', async () => {
      const other = '0x1111111111111111111111111111111111111111';
      await ledger.append(makeEntry({ chapterNumber: 1 }));
      await ledger.append(makeEntry({ chapterNumber: 2 }));
      await ledger.append(makeEntry({ tokenAddr: other, chapterNumber: 1 }));

      expect(await ledger.list()).toHaveLength(3);
      expect(await ledger.list(TOKEN_ADDR)).toHaveLength(2);
      expect(await ledger.list(TOKEN_ADDR.toUpperCase())).toHaveLength(2);
      expect(await ledger.list(other)).toHaveLength(1);
    });

    it('list returns entries in insertion order (rewrite keeps slot)', async () => {
      await ledger.append(makeEntry({ chapterNumber: 2, ts: '2026-04-20T10:02:00.000Z' }));
      await ledger.append(makeEntry({ chapterNumber: 1, ts: '2026-04-20T10:00:00.000Z' }));
      await ledger.append(makeEntry({ chapterNumber: 3, ts: '2026-04-20T10:03:00.000Z' }));

      const listed = await ledger.list();
      expect(listed.map((e) => e.chapterNumber)).toEqual([2, 1, 3]);

      // Rewrite chapter 2 — its ledger slot (index 0) must be preserved.
      await ledger.append(makeEntry({ chapterNumber: 2, loreCid: 'rewritten' }));
      const after = await ledger.list();
      expect(after.map((e) => e.chapterNumber)).toEqual([2, 1, 3]);
      expect(after[0]?.loreCid).toBe('rewritten');
    });

    it('get returns undefined for an unknown anchorId', async () => {
      expect(await ledger.get('0xdead-99')).toBeUndefined();
    });

    it('markOnChain attaches tx details to an existing entry', async () => {
      const entry = makeEntry();
      await ledger.append(entry);

      await ledger.markOnChain(entry.anchorId, {
        onChainTxHash: `0x${'c'.repeat(64)}`,
        chain: 'bsc-mainnet',
        explorerUrl: `https://bscscan.com/tx/0x${'c'.repeat(64)}`,
      });

      const fetched = await ledger.get(entry.anchorId);
      expect(fetched?.onChainTxHash).toBe(`0x${'c'.repeat(64)}`);
      expect(fetched?.chain).toBe('bsc-mainnet');
      expect(fetched?.explorerUrl).toBe(`https://bscscan.com/tx/0x${'c'.repeat(64)}`);
    });

    it('markOnChain is a no-op on unknown anchorId', async () => {
      await expect(
        ledger.markOnChain('0xdead-99', {
          onChainTxHash: `0x${'c'.repeat(64)}`,
          chain: 'bsc-mainnet',
          explorerUrl: 'https://bscscan.com/tx/0xccc',
        }),
      ).resolves.toBeUndefined();
      expect(await ledger.list()).toHaveLength(0);
    });

    it('clear empties the ledger', async () => {
      await ledger.append(makeEntry());
      await ledger.append(makeEntry({ chapterNumber: 2 }));
      expect(await ledger.list()).toHaveLength(2);

      await ledger.clear();
      expect(await ledger.list()).toHaveLength(0);
      expect(await ledger.get(computeAnchorId(TOKEN_ADDR, 1))).toBeUndefined();
    });
  });
}

runBehaviouralSuite('memory backend', () => Promise.resolve(new AnchorLedger()));

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
    return new AnchorLedger({ pool });
  });
}
