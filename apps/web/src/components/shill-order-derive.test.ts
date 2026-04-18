import { describe, it, expect } from 'vitest';
import type { Artifact } from '@hack-fourmeme/shared';
import { collectShillOrderRows } from './shill-order-derive';

/**
 * Pure helper backing the ShillOrderPanel (AC-P4.6-4). We verify the three
 * invariants the panel relies on:
 *   1. noisy non-shill artifacts are ignored
 *   2. the LATEST shill-order wins when the same orderId appears twice
 *      (status transitions queued → processing → done/failed)
 *   3. shill-tweet entries are merged by orderId into the matching row
 */

const TOKEN_A = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const TOKEN_B = '0xAbCdEf0123456789aBcDEf0123456789abcdef01';
const PAID_TX = `0x${'6'.repeat(64)}` as `0x${string}`;

function queued(overrides?: Partial<Extract<Artifact, { kind: 'shill-order' }>>): Artifact {
  return {
    kind: 'shill-order',
    orderId: 'order_abc123',
    targetTokenAddr: TOKEN_A,
    paidTxHash: PAID_TX,
    paidAmountUsdc: '0.01',
    status: 'queued',
    ts: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('collectShillOrderRows', () => {
  it('returns an empty array when no artifacts are present', () => {
    expect(collectShillOrderRows([])).toEqual([]);
  });

  it('returns a single queued row when one shill-order artifact exists', () => {
    const rows = collectShillOrderRows([queued()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orderId).toBe('order_abc123');
    expect(rows[0]?.status).toBe('queued');
    expect(rows[0]?.tweet).toBeUndefined();
  });

  it('prefers the latest shill-order status for the same orderId (queued → done)', () => {
    const rows = collectShillOrderRows([
      queued({ status: 'queued', ts: '2026-04-20T10:00:00.000Z' }),
      queued({ status: 'processing', ts: '2026-04-20T10:00:05.000Z' }),
      queued({ status: 'done', ts: '2026-04-20T10:00:10.000Z' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('done');
    // The row ts tracks the latest shill-order emission so downstream
    // sorting reflects the most recent update.
    expect(rows[0]?.ts).toBe('2026-04-20T10:00:10.000Z');
  });

  it('merges a matching shill-tweet into the row it belongs to', () => {
    const rows = collectShillOrderRows([
      queued({ status: 'done', ts: '2026-04-20T10:00:10.000Z' }),
      {
        kind: 'shill-tweet',
        orderId: 'order_abc123',
        targetTokenAddr: TOKEN_A,
        tweetId: '1780000000000000001',
        tweetUrl: 'https://x.com/shiller/status/1780000000000000001',
        tweetText: '$MEMEA — curious find, lore reads like a dream',
        ts: '2026-04-20T10:00:11.000Z',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('done');
    expect(rows[0]?.tweet).toEqual({
      tweetId: '1780000000000000001',
      tweetUrl: 'https://x.com/shiller/status/1780000000000000001',
      tweetText: '$MEMEA — curious find, lore reads like a dream',
      ts: '2026-04-20T10:00:11.000Z',
    });
  });

  it('returns one row per orderId sorted by ts ascending (earlier orders first)', () => {
    const rows = collectShillOrderRows([
      queued({
        orderId: 'order_late',
        targetTokenAddr: TOKEN_B,
        ts: '2026-04-20T10:05:00.000Z',
        status: 'queued',
      }),
      queued({
        orderId: 'order_early',
        targetTokenAddr: TOKEN_A,
        ts: '2026-04-20T10:00:00.000Z',
        status: 'processing',
      }),
    ]);
    expect(rows.map((r) => r.orderId)).toEqual(['order_early', 'order_late']);
  });

  it('surfaces status=failed and leaves tweet undefined', () => {
    const rows = collectShillOrderRows([
      queued({ status: 'queued', ts: '2026-04-20T10:00:00.000Z' }),
      queued({ status: 'failed', ts: '2026-04-20T10:00:30.000Z' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.tweet).toBeUndefined();
  });

  it('ignores unrelated artifact kinds in the stream', () => {
    const rows = collectShillOrderRows([
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: `0x${'d'.repeat(40)}`,
        explorerUrl: `https://bscscan.com/token/0x${'d'.repeat(40)}`,
      },
      queued(),
      {
        kind: 'lore-cid',
        cid: 'bafy',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
        author: 'narrator',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orderId).toBe('order_abc123');
  });
});
