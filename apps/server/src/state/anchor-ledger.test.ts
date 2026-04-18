import { describe, it, expect, beforeEach } from 'vitest';
import { keccak256, stringToHex } from 'viem';
import { AnchorLedger, computeAnchorId, computeContentHash } from './anchor-ledger.js';

/**
 * AnchorLedger is the layer-1 "structured log queue" that records one entry
 * per Narrator chapter upsert. It backs AC3's on-chain anchor fallback: even
 * if the BSC self-tx memo (layer 2) is not enabled, we still have a local
 * ordered ledger the dashboard can display as evidence of the commitment.
 *
 * Semantics mirror LoreStore:
 *   - in-memory Map, single process, no persistence
 *   - append by anchorId overwrites prior entry (chapter rewrite wins)
 *   - case-insensitive tokenAddr handling at the helper boundary
 */

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

describe('AnchorLedger', () => {
  let ledger: AnchorLedger;

  beforeEach(() => {
    ledger = new AnchorLedger();
  });

  it('append stores a new entry that get(anchorId) and list() can retrieve', () => {
    const entry = makeEntry();
    ledger.append(entry);

    const fetched = ledger.get(entry.anchorId);
    expect(fetched).toBeDefined();
    expect(fetched?.anchorId).toBe(entry.anchorId);
    expect(fetched?.contentHash).toBe(entry.contentHash);
    expect(fetched?.chapterNumber).toBe(1);
    expect(fetched?.tokenAddr).toBe(TOKEN_LOWER);

    expect(ledger.list()).toHaveLength(1);
  });

  it('append overwrites an entry with the same anchorId (chapter rewrite)', () => {
    ledger.append(makeEntry({ loreCid: 'first-cid' }));
    ledger.append(makeEntry({ loreCid: 'second-cid', ts: '2026-04-20T11:00:00.000Z' }));

    const fetched = ledger.get(computeAnchorId(TOKEN_ADDR, 1));
    expect(fetched?.loreCid).toBe('second-cid');
    expect(fetched?.ts).toBe('2026-04-20T11:00:00.000Z');
    // Still one row — same anchorId collapsed.
    expect(ledger.list()).toHaveLength(1);
  });

  it('list filters by tokenAddr (case-insensitive) when provided', () => {
    const other = '0x1111111111111111111111111111111111111111';
    ledger.append(makeEntry({ chapterNumber: 1 }));
    ledger.append(makeEntry({ chapterNumber: 2 }));
    ledger.append(makeEntry({ tokenAddr: other, chapterNumber: 1 }));

    expect(ledger.list()).toHaveLength(3);
    expect(ledger.list(TOKEN_ADDR)).toHaveLength(2);
    // Case-insensitive.
    expect(ledger.list(TOKEN_ADDR.toUpperCase())).toHaveLength(2);
    expect(ledger.list(other)).toHaveLength(1);
  });

  it('list returns entries in append order (latest last)', () => {
    ledger.append(makeEntry({ chapterNumber: 2, ts: '2026-04-20T10:02:00.000Z' }));
    ledger.append(makeEntry({ chapterNumber: 1, ts: '2026-04-20T10:00:00.000Z' }));
    ledger.append(makeEntry({ chapterNumber: 3, ts: '2026-04-20T10:03:00.000Z' }));

    const listed = ledger.list();
    expect(listed.map((e) => e.chapterNumber)).toEqual([2, 1, 3]);
  });

  it('get returns undefined for an unknown anchorId', () => {
    expect(ledger.get('0xdead-99')).toBeUndefined();
  });

  it('markOnChain attaches tx details to an existing entry', () => {
    const entry = makeEntry();
    ledger.append(entry);

    ledger.markOnChain(entry.anchorId, {
      onChainTxHash: `0x${'c'.repeat(64)}`,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/0x${'c'.repeat(64)}`,
    });

    const fetched = ledger.get(entry.anchorId);
    expect(fetched?.onChainTxHash).toBe(`0x${'c'.repeat(64)}`);
    expect(fetched?.chain).toBe('bsc-mainnet');
    expect(fetched?.explorerUrl).toBe(`https://bscscan.com/tx/0x${'c'.repeat(64)}`);
  });

  it('markOnChain is a no-op on unknown anchorId', () => {
    // Silent no-op keeps the layer-2 tx helper simple — it never has to branch
    // on "does this anchor still exist?" in the face of a cleared ledger (tests
    // or hot reload).
    expect(() =>
      ledger.markOnChain('0xdead-99', {
        onChainTxHash: `0x${'c'.repeat(64)}`,
        chain: 'bsc-mainnet',
        explorerUrl: 'https://bscscan.com/tx/0xccc',
      }),
    ).not.toThrow();
    expect(ledger.list()).toHaveLength(0);
  });

  it('clear empties the ledger', () => {
    ledger.append(makeEntry());
    ledger.append(makeEntry({ chapterNumber: 2 }));
    expect(ledger.list()).toHaveLength(2);

    ledger.clear();
    expect(ledger.list()).toHaveLength(0);
    expect(ledger.get(computeAnchorId(TOKEN_ADDR, 1))).toBeUndefined();
  });
});
