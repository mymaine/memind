import { describe, it, expect, beforeEach } from 'vitest';
import { ShillOrderStore, type EnqueueInput, type ShillOrderEntry } from './shill-order-store.js';

/**
 * ShillOrderStore is the in-memory queue + state machine that sits between the
 * x402 `/shill/:tokenAddr` endpoint (producer) and the Shiller agent tick
 * (consumer). States flow queued → processing → (done | failed). The
 * `pullPending()` contract is atomic — callers must never see the same queued
 * order twice, otherwise the Shiller tick could post duplicate tweets for a
 * single paid order.
 *
 * Address normalization mirrors LoreStore: all writes lowercase
 * `targetTokenAddr`, all lookups lowercase the input before comparing. This
 * prevents producer/consumer casing drift from silently losing orders.
 */

function makeInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    orderId: 'order-1',
    targetTokenAddr: '0x1111111111111111111111111111111111111111',
    creatorBrief: 'hype the launch',
    paidTxHash: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca',
    paidAmountUsdc: '0.01',
    ts: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('ShillOrderStore', () => {
  let store: ShillOrderStore;

  beforeEach(() => {
    store = new ShillOrderStore();
  });

  it('enqueue creates a queued entry with lowercase targetTokenAddr', () => {
    const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    const entry = store.enqueue(makeInput({ orderId: 'o1', targetTokenAddr: mixed }));

    expect(entry.orderId).toBe('o1');
    expect(entry.status).toBe('queued');
    expect(entry.targetTokenAddr).toBe(mixed.toLowerCase());
    expect(store.size()).toBe(1);
  });

  it('enqueue with an already-used orderId throws an orderId conflict error', () => {
    store.enqueue(makeInput({ orderId: 'dup' }));
    expect(() => store.enqueue(makeInput({ orderId: 'dup' }))).toThrow(/orderId conflict/);
    // Still only one entry recorded.
    expect(store.size()).toBe(1);
  });

  it('pullPending returns all queued orders and atomically moves them to processing', () => {
    store.enqueue(makeInput({ orderId: 'a', ts: '2026-04-20T00:00:00.000Z' }));
    store.enqueue(makeInput({ orderId: 'b', ts: '2026-04-20T00:00:01.000Z' }));

    const first = store.pullPending();
    expect(first.map((o) => o.orderId)).toEqual(['a', 'b']);
    expect(first.every((o) => o.status === 'processing')).toBe(true);

    // Second pull must not re-return the same orders — pullPending is atomic.
    expect(store.pullPending()).toEqual([]);
  });

  it('pullPending returns queued orders sorted by ts ascending', () => {
    store.enqueue(makeInput({ orderId: 'late', ts: '2026-04-20T00:00:05.000Z' }));
    store.enqueue(makeInput({ orderId: 'early', ts: '2026-04-20T00:00:01.000Z' }));
    store.enqueue(makeInput({ orderId: 'mid', ts: '2026-04-20T00:00:03.000Z' }));

    const pulled = store.pullPending();
    expect(pulled.map((o) => o.orderId)).toEqual(['early', 'mid', 'late']);
  });

  it('markDone transitions a processing order to done and stores tweet metadata', () => {
    store.enqueue(makeInput({ orderId: 'o1' }));
    store.pullPending(); // move to processing

    const done = store.markDone('o1', {
      tweetId: '1234567890',
      tweetUrl: 'https://x.com/shiller/status/1234567890',
    });

    expect(done.status).toBe('done');
    expect(done.tweetId).toBe('1234567890');
    expect(done.tweetUrl).toBe('https://x.com/shiller/status/1234567890');

    const fetched = store.getById('o1');
    expect(fetched?.status).toBe('done');
    expect(fetched?.tweetId).toBe('1234567890');
  });

  it('markDone on a non-processing order throws with the current status in the message', () => {
    store.enqueue(makeInput({ orderId: 'o1' })); // still queued

    expect(() =>
      store.markDone('o1', { tweetId: '1', tweetUrl: 'https://x.com/a/status/1' }),
    ).toThrow(/cannot markDone: order o1 is queued, expected processing/);
  });

  it('markFailed transitions a processing order to failed and stores errorMessage', () => {
    store.enqueue(makeInput({ orderId: 'o1' }));
    store.pullPending();

    const failed = store.markFailed('o1', 'X API 401 unauthorized');

    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBe('X API 401 unauthorized');
    expect(store.getById('o1')?.status).toBe('failed');
  });

  it('findByTokenAddr is case-insensitive and isolates different tokens', () => {
    const tokenA = '0xAaAaaAaaAAaaaaAaAaaaAaAAAaaaAAaAaAaAaAaA';
    const tokenB = '0xBbBbBbbBbbBBBbbbbBbbBBbBbBBbbbBbbBBbbBBb';

    store.enqueue(
      makeInput({ orderId: 'a1', targetTokenAddr: tokenA, ts: '2026-04-20T00:00:01.000Z' }),
    );
    store.enqueue(
      makeInput({ orderId: 'a2', targetTokenAddr: tokenA, ts: '2026-04-20T00:00:03.000Z' }),
    );
    store.enqueue(
      makeInput({ orderId: 'b1', targetTokenAddr: tokenB, ts: '2026-04-20T00:00:02.000Z' }),
    );

    // Query with mixed/lower/upper variants all resolve to the same bucket.
    const foundA = store.findByTokenAddr(tokenA);
    expect(foundA.map((o: ShillOrderEntry) => o.orderId)).toEqual(['a1', 'a2']);

    const foundAUpper = store.findByTokenAddr(tokenA.toUpperCase());
    expect(foundAUpper.map((o: ShillOrderEntry) => o.orderId)).toEqual(['a1', 'a2']);

    const foundB = store.findByTokenAddr(tokenB);
    expect(foundB.map((o: ShillOrderEntry) => o.orderId)).toEqual(['b1']);

    // Unknown address yields empty array, not undefined.
    expect(
      store.findByTokenAddr('0xccccccccccccccccccccccccccccccccccccccccc'.slice(0, 42)),
    ).toEqual([]);
  });

  it('pullById flips only the specified queued order to processing and leaves others untouched', () => {
    // pullPending's bulk flip strands orphan orders when the orchestrator only
    // cares about a single payment.orderId. pullById is the targeted counterpart:
    // find one order, flip it atomically, leave every other queued entry queued.
    store.enqueue(makeInput({ orderId: 'target', ts: '2026-04-20T00:00:01.000Z' }));
    store.enqueue(makeInput({ orderId: 'orphan-a', ts: '2026-04-20T00:00:02.000Z' }));
    store.enqueue(makeInput({ orderId: 'orphan-b', ts: '2026-04-20T00:00:03.000Z' }));

    const pulled = store.pullById('target');
    expect(pulled?.orderId).toBe('target');
    expect(pulled?.status).toBe('processing');

    // Other orders must remain queued — no collateral state change.
    expect(store.getById('orphan-a')?.status).toBe('queued');
    expect(store.getById('orphan-b')?.status).toBe('queued');

    // A second pullById for the same id must NOT re-flip (already processing).
    expect(store.pullById('target')).toBeUndefined();
  });

  it('pullById returns undefined for unknown orderId', () => {
    store.enqueue(makeInput({ orderId: 'exists' }));
    expect(store.pullById('nope')).toBeUndefined();
    // Pre-existing order is untouched.
    expect(store.getById('exists')?.status).toBe('queued');
  });

  it('pullById returns undefined when order exists but is not queued', () => {
    // Contract: pullById only flips queued → processing. Any other current
    // status (processing / done / failed) yields undefined so callers can tell
    // "nothing to pick up" apart from "successfully claimed".
    store.enqueue(makeInput({ orderId: 'o1' }));
    store.pullPending(); // now processing

    expect(store.pullById('o1')).toBeUndefined();
    expect(store.getById('o1')?.status).toBe('processing');
  });

  it('size tracks total entries across all statuses and clear empties the store', () => {
    store.enqueue(makeInput({ orderId: 'o1' }));
    store.enqueue(makeInput({ orderId: 'o2' }));
    expect(store.size()).toBe(2);

    store.pullPending();
    // Processing orders still count toward size.
    expect(store.size()).toBe(2);

    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getById('o1')).toBeUndefined();
  });
});
