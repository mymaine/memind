import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool, resolveDatabaseUrl } from '../db/pool.js';
import { ensureSchema } from '../db/schema.js';
import { resetDb } from '../db/reset.js';
import {
  PENDING_PAID_TX_HASH,
  ShillOrderStore,
  type EnqueueInput,
  type ShillOrderEntry,
} from './shill-order-store.js';

const hasDatabaseUrl = resolveDatabaseUrl() !== undefined;

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

function runBehaviouralSuite(
  label: string,
  makeStore: () => Promise<ShillOrderStore>,
  extra: { withRaceTest: boolean } = { withRaceTest: false },
): void {
  describe(`ShillOrderStore (${label})`, () => {
    let store: ShillOrderStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    it('enqueue creates a queued entry with lowercase targetTokenAddr', async () => {
      const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
      const entry = await store.enqueue(makeInput({ orderId: 'o1', targetTokenAddr: mixed }));

      expect(entry.orderId).toBe('o1');
      expect(entry.status).toBe('queued');
      expect(entry.targetTokenAddr).toBe(mixed.toLowerCase());
      expect(await store.size()).toBe(1);
    });

    it('enqueue with an already-used orderId throws an orderId conflict error', async () => {
      await store.enqueue(makeInput({ orderId: 'dup' }));
      await expect(store.enqueue(makeInput({ orderId: 'dup' }))).rejects.toThrow(
        /orderId conflict/,
      );
      expect(await store.size()).toBe(1);
    });

    it('pullPending returns queued orders sorted by ts ascending, atomically flipped', async () => {
      await store.enqueue(makeInput({ orderId: 'late', ts: '2026-04-20T00:00:05.000Z' }));
      await store.enqueue(makeInput({ orderId: 'early', ts: '2026-04-20T00:00:01.000Z' }));
      await store.enqueue(makeInput({ orderId: 'mid', ts: '2026-04-20T00:00:03.000Z' }));

      const pulled = await store.pullPending();
      expect(pulled.map((o) => o.orderId)).toEqual(['early', 'mid', 'late']);
      expect(pulled.every((o) => o.status === 'processing')).toBe(true);

      // Second pull returns nothing — every order is already processing.
      expect(await store.pullPending()).toEqual([]);
    });

    it('markDone transitions a processing order to done and stores tweet metadata', async () => {
      await store.enqueue(makeInput({ orderId: 'o1' }));
      await store.pullPending();

      const done = await store.markDone('o1', {
        tweetId: '1234567890',
        tweetUrl: 'https://x.com/shiller/status/1234567890',
      });

      expect(done.status).toBe('done');
      expect(done.tweetId).toBe('1234567890');
      expect(done.tweetUrl).toBe('https://x.com/shiller/status/1234567890');

      const fetched = await store.getById('o1');
      expect(fetched?.status).toBe('done');
      expect(fetched?.tweetId).toBe('1234567890');
    });

    it('markDone on a non-processing order throws with the current status in the message', async () => {
      await store.enqueue(makeInput({ orderId: 'o1' })); // still queued
      await expect(
        store.markDone('o1', { tweetId: '1', tweetUrl: 'https://x.com/a/status/1' }),
      ).rejects.toThrow(/cannot markDone: order o1 is queued, expected processing/);
    });

    it('markFailed transitions a processing order to failed and stores errorMessage', async () => {
      await store.enqueue(makeInput({ orderId: 'o1' }));
      await store.pullPending();

      const failed = await store.markFailed('o1', 'X API 401 unauthorized');

      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toBe('X API 401 unauthorized');
      expect((await store.getById('o1'))?.status).toBe('failed');
    });

    it('findByTokenAddr is case-insensitive and isolates different tokens', async () => {
      const tokenA = '0xAaAaaAaaAAaaaaAaAaaaAaAAAaaaAAaAaAaAaAaA';
      const tokenB = '0xBbBbBbbBbbBBBbbbbBbbBBbBbBBbbbBbbBBbbBBb';

      await store.enqueue(
        makeInput({ orderId: 'a1', targetTokenAddr: tokenA, ts: '2026-04-20T00:00:01.000Z' }),
      );
      await store.enqueue(
        makeInput({ orderId: 'a2', targetTokenAddr: tokenA, ts: '2026-04-20T00:00:03.000Z' }),
      );
      await store.enqueue(
        makeInput({ orderId: 'b1', targetTokenAddr: tokenB, ts: '2026-04-20T00:00:02.000Z' }),
      );

      const foundA = await store.findByTokenAddr(tokenA);
      expect(foundA.map((o: ShillOrderEntry) => o.orderId)).toEqual(['a1', 'a2']);

      const foundAUpper = await store.findByTokenAddr(tokenA.toUpperCase());
      expect(foundAUpper.map((o: ShillOrderEntry) => o.orderId)).toEqual(['a1', 'a2']);

      const foundB = await store.findByTokenAddr(tokenB);
      expect(foundB.map((o: ShillOrderEntry) => o.orderId)).toEqual(['b1']);
    });

    it('pullById flips only the specified queued order, leaving orphans queued', async () => {
      await store.enqueue(makeInput({ orderId: 'target', ts: '2026-04-20T00:00:01.000Z' }));
      await store.enqueue(makeInput({ orderId: 'orphan-a', ts: '2026-04-20T00:00:02.000Z' }));
      await store.enqueue(makeInput({ orderId: 'orphan-b', ts: '2026-04-20T00:00:03.000Z' }));

      const pulled = await store.pullById('target');
      expect(pulled?.orderId).toBe('target');
      expect(pulled?.status).toBe('processing');

      expect((await store.getById('orphan-a'))?.status).toBe('queued');
      expect((await store.getById('orphan-b'))?.status).toBe('queued');

      // Second pullById for the same id returns undefined.
      expect(await store.pullById('target')).toBeUndefined();
    });

    it('pullById returns undefined for unknown orderId', async () => {
      await store.enqueue(makeInput({ orderId: 'exists' }));
      expect(await store.pullById('nope')).toBeUndefined();
      expect((await store.getById('exists'))?.status).toBe('queued');
    });

    it('pullById returns undefined when order exists but is not queued', async () => {
      await store.enqueue(makeInput({ orderId: 'o1' }));
      await store.pullPending(); // now processing
      expect(await store.pullById('o1')).toBeUndefined();
      expect((await store.getById('o1'))?.status).toBe('processing');
    });

    it('recordSettlement replaces the pending sentinel with the real tx hash', async () => {
      await store.enqueue(makeInput({ orderId: 'o1', paidTxHash: PENDING_PAID_TX_HASH }));
      const realHash = `0x${'a'.repeat(64)}`;

      await store.recordSettlement('o1', realHash);

      const fetched = await store.getById('o1');
      expect(fetched?.paidTxHash).toBe(realHash);
    });

    it('recordSettlement is idempotent — a second call never overwrites a non-sentinel value', async () => {
      await store.enqueue(makeInput({ orderId: 'o1', paidTxHash: PENDING_PAID_TX_HASH }));
      const firstHash = `0x${'a'.repeat(64)}`;
      const secondHash = `0x${'b'.repeat(64)}`;

      await store.recordSettlement('o1', firstHash);
      // Duplicate finish fire / retry — must be a silent no-op so we never
      // clobber the hash that is already on file.
      await store.recordSettlement('o1', secondHash);

      const fetched = await store.getById('o1');
      expect(fetched?.paidTxHash).toBe(firstHash);
    });

    it('recordSettlement throws on a malformed tx hash and leaves the sentinel intact', async () => {
      await store.enqueue(makeInput({ orderId: 'o1', paidTxHash: PENDING_PAID_TX_HASH }));

      await expect(store.recordSettlement('o1', '0xnothex')).rejects.toThrow(/invalid paidTxHash/);

      const fetched = await store.getById('o1');
      expect(fetched?.paidTxHash).toBe(PENDING_PAID_TX_HASH);
    });

    it('recordSettlement on an unknown orderId is a silent no-op', async () => {
      // No throw, no side effect — matches markDone / markFailed's "best-effort
      // reconciliation" contract for callers that can't know whether the
      // finish hook fired before the row landed.
      await expect(
        store.recordSettlement('does-not-exist', `0x${'a'.repeat(64)}`),
      ).resolves.toBeUndefined();
    });

    it('size tracks total entries across all statuses and clear empties the store', async () => {
      await store.enqueue(makeInput({ orderId: 'o1' }));
      await store.enqueue(makeInput({ orderId: 'o2' }));
      expect(await store.size()).toBe(2);

      await store.pullPending();
      expect(await store.size()).toBe(2);

      await store.clear();
      expect(await store.size()).toBe(0);
      expect(await store.getById('o1')).toBeUndefined();
    });

    if (extra.withRaceTest) {
      it('concurrent pullById only returns the order to one winner (DB-level race)', async () => {
        await store.enqueue(makeInput({ orderId: 'race' }));
        const [a, b] = await Promise.all([store.pullById('race'), store.pullById('race')]);
        const winners = [a, b].filter((x) => x !== undefined);
        expect(winners).toHaveLength(1);
      });
    }
  });
}

runBehaviouralSuite('memory backend', () => Promise.resolve(new ShillOrderStore()));

if (hasDatabaseUrl) {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool();
    await ensureSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  runBehaviouralSuite(
    'pg backend',
    async () => {
      await resetDb(pool, { ...process.env, NODE_ENV: 'test' });
      return new ShillOrderStore({ pool });
    },
    { withRaceTest: true },
  );
}
