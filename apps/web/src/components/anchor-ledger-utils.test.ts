import { describe, it, expect } from 'vitest';
import type { Artifact } from '@hack-fourmeme/shared';
import { collectAnchorArtifacts, describeAnchorRow, dedupeByAnchorId } from './anchor-ledger-utils';

/**
 * Pure helpers backing the AnchorLedgerPanel (AC3). Keeping these outside the
 * React component makes them trivially unit-testable and means the component
 * stays dumb — it just renders whatever the selectors produce.
 */

const TOKEN = '0x4e39d254c716d88ae52d9ca136f0a029c5f74444';
const HASH_A = `0x${'a'.repeat(64)}`;
const HASH_B = `0x${'b'.repeat(64)}`;
const TX_HASH = `0x${'c'.repeat(64)}`;

function baseAnchor(
  overrides?: Partial<Extract<Artifact, { kind: 'lore-anchor' }>>,
): Extract<Artifact, { kind: 'lore-anchor' }> {
  return {
    kind: 'lore-anchor',
    anchorId: `${TOKEN}-1`,
    tokenAddr: TOKEN,
    chapterNumber: 1,
    loreCid: 'bafkreibxxxxx',
    contentHash: HASH_A as `0x${string}`,
    ts: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('collectAnchorArtifacts', () => {
  it('returns only lore-anchor kinds in insertion order', () => {
    const mixed: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: `0x${'d'.repeat(40)}`,
        explorerUrl: 'https://bscscan.com/token/0x' + 'd'.repeat(40),
      },
      baseAnchor({ chapterNumber: 1 }),
      {
        kind: 'lore-cid',
        cid: 'bafy',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
        author: 'narrator',
      },
      baseAnchor({
        chapterNumber: 2,
        anchorId: `${TOKEN}-2`,
        contentHash: HASH_B as `0x${string}`,
      }),
    ];
    const anchors = collectAnchorArtifacts(mixed);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.chapterNumber).toBe(1);
    expect(anchors[1]?.chapterNumber).toBe(2);
  });

  it('returns an empty array when no anchors present', () => {
    expect(collectAnchorArtifacts([])).toEqual([]);
  });
});

describe('dedupeByAnchorId', () => {
  it('keeps the last occurrence when the same anchorId is emitted twice (layer-2 upgrade)', () => {
    // Layer-1 emission: no on-chain fields.
    const layer1 = baseAnchor();
    // Layer-2 emission: same anchorId, now carrying tx details.
    const layer2 = baseAnchor({
      onChainTxHash: TX_HASH as `0x${string}`,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/${TX_HASH}`,
    });
    const deduped = dedupeByAnchorId([layer1, layer2]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.onChainTxHash).toBe(TX_HASH);
  });

  it('preserves order of the last occurrence for each anchorId', () => {
    const a1 = baseAnchor({ chapterNumber: 1, anchorId: `${TOKEN}-1` });
    const b1 = baseAnchor({
      chapterNumber: 2,
      anchorId: `${TOKEN}-2`,
      contentHash: HASH_B as `0x${string}`,
    });
    const a2 = baseAnchor({ chapterNumber: 1, anchorId: `${TOKEN}-1`, loreCid: 'bafkrei-rewrite' });
    const deduped = dedupeByAnchorId([a1, b1, a2]);
    expect(deduped.map((e) => e.anchorId)).toEqual([`${TOKEN}-2`, `${TOKEN}-1`]);
    expect(deduped[1]?.loreCid).toBe('bafkrei-rewrite');
  });
});

describe('describeAnchorRow', () => {
  it('formats a layer-1 only row with truncated hash and no explorer link', () => {
    const row = describeAnchorRow(baseAnchor());
    expect(row.chapterLabel).toBe('ch 1');
    // Short form: first 10 chars of the 0x-prefixed hash, followed by …tail.
    expect(row.hashShort).toMatch(/^0xaaaaaaaa…/);
    expect(row.hashShort.length).toBeLessThan(HASH_A.length);
    expect(row.onChainTxUrl).toBeNull();
    expect(row.onChainLabel).toBe('layer-1 only');
  });

  it('formats a layer-2 row with explorer URL and on-chain label', () => {
    const anchor = baseAnchor({
      onChainTxHash: TX_HASH as `0x${string}`,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/${TX_HASH}`,
    });
    const row = describeAnchorRow(anchor);
    expect(row.onChainTxUrl).toBe(`https://bscscan.com/tx/${TX_HASH}`);
    expect(row.onChainLabel).toMatch(/bsc-mainnet/i);
  });

  it('includes a human-readable timestamp fragment', () => {
    const row = describeAnchorRow(baseAnchor({ ts: '2026-04-20T10:00:00.000Z' }));
    // The display strips the millisecond + Z for UI readability; test both
    // shapes since Date.prototype.toISOString drops .000 on some runtimes.
    expect(row.ts).toMatch(/2026-04-20/);
  });
});
