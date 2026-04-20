import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPool, resolveDatabaseUrl } from '../db/pool.js';
import { ensureSchema } from '../db/schema.js';
import { resetDb } from '../db/reset.js';
import {
  DEFAULT_HEARTBEAT_MAX_TICKS,
  HeartbeatSessionStore,
  type HeartbeatSessionState,
  type HeartbeatTickDelta,
} from './heartbeat-session-store.js';

/**
 * HeartbeatSessionStore tests: counter semantics, overlap guard, restart
 * behaviour (timers NEVER auto-resume), and pg persistence of counters
 * across a "simulated restart" (construct a second store pointing at the
 * same pool).
 */

const FAKE_ADDR = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
const hasDatabaseUrl = resolveDatabaseUrl() !== undefined;

function makeDelta(overrides: Partial<HeartbeatTickDelta> = {}): HeartbeatTickDelta {
  return {
    tickId: 'tick_one',
    tickAt: '2026-04-20T00:00:00.000Z',
    success: true,
    ...overrides,
  };
}

describe('HeartbeatSessionStore (memory backend)', () => {
  let store: HeartbeatSessionStore;

  beforeEach(() => {
    store = new HeartbeatSessionStore();
  });

  afterEach(async () => {
    await store.clear();
  });

  it('start creates a session and get returns a running snapshot with the correct interval', async () => {
    const { snapshot, restarted } = await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });

    expect(restarted).toBe(false);
    expect(snapshot.tokenAddr).toBe(FAKE_ADDR);
    expect(snapshot.running).toBe(true);
    expect(snapshot.intervalMs).toBe(5_000);
    expect(snapshot.tickCount).toBe(0);

    const read = await store.get(FAKE_ADDR);
    expect(read).toBeDefined();
    expect(read!.running).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('start with the same intervalMs returns restarted=false and keeps counters', async () => {
    await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });
    await store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a' }));

    const second = await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });

    expect(second.restarted).toBe(false);
    expect(second.snapshot.tickCount).toBe(1);
    expect(second.snapshot.successCount).toBe(1);
    expect(second.snapshot.lastTickId).toBe('tick_a');
    expect(store.size()).toBe(1);
  });

  it('start with a different intervalMs restarts the timer but preserves counters', async () => {
    const clearIntervalImpl = vi.fn(clearInterval);
    const setIntervalImpl = vi.fn(setInterval);
    store = new HeartbeatSessionStore({ setIntervalImpl, clearIntervalImpl });

    await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });
    await store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a', action: 'post' }));
    await store.recordTick(
      FAKE_ADDR,
      makeDelta({ tickId: 'tick_b', success: false, error: 'boom' }),
    );

    const second = await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 10_000,
      runTick: async () => makeDelta(),
    });

    expect(second.restarted).toBe(true);
    expect(second.snapshot.intervalMs).toBe(10_000);
    expect(second.snapshot.tickCount).toBe(2);
    expect(second.snapshot.successCount).toBe(1);
    expect(second.snapshot.errorCount).toBe(1);
    expect(second.snapshot.lastTickId).toBe('tick_b');
    expect(second.snapshot.lastError).toBe('boom');
    expect(second.snapshot.running).toBe(true);
    expect(clearIntervalImpl).toHaveBeenCalledTimes(1);
    expect(setIntervalImpl).toHaveBeenCalledTimes(2);
  });

  it('stop flips running to false, preserves counters, and returns the final snapshot', async () => {
    await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });
    await store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a', action: 'idle' }));

    const final = await store.stop(FAKE_ADDR);
    expect(final).toBeDefined();
    expect(final!.running).toBe(false);
    expect(final!.tickCount).toBe(1);
    expect(final!.lastAction).toBe('idle');

    const again = await store.stop(FAKE_ADDR);
    expect(again).toBeDefined();
    expect(again!.running).toBe(false);
    expect(again!.tickCount).toBe(1);
  });

  it('stop returns undefined when no session exists', async () => {
    expect(await store.stop(FAKE_ADDR)).toBeUndefined();
  });

  it('list returns every session including stopped ones', async () => {
    const addrA = '0x1111111111111111111111111111111111111111';
    const addrB = '0x2222222222222222222222222222222222222222';
    await store.start({ tokenAddr: addrA, intervalMs: 1_000, runTick: async () => makeDelta() });
    await store.start({ tokenAddr: addrB, intervalMs: 2_000, runTick: async () => makeDelta() });
    await store.stop(addrA);

    const list = await store.list();
    expect(list).toHaveLength(2);
    const byAddr = new Map(list.map((s) => [s.tokenAddr, s]));
    expect(byAddr.get(addrA)?.running).toBe(false);
    expect(byAddr.get(addrB)?.running).toBe(true);
  });

  it('normalises mixed-case addresses so start + stop operate on the same bucket', async () => {
    const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    await store.start({
      tokenAddr: mixed,
      intervalMs: 1_000,
      runTick: async () => makeDelta(),
    });
    expect((await store.get(mixed))?.tokenAddr).toBe(mixed.toLowerCase());
    expect(await store.get(mixed.toLowerCase())).toBeDefined();
    const final = await store.stop(mixed.toUpperCase());
    expect(final).toBeDefined();
    expect(final!.running).toBe(false);
  });

  it('snapshots are frozen so consumers cannot mutate internal state', async () => {
    await store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 1_000,
      runTick: async () => makeDelta(),
    });
    const snap = (await store.get(FAKE_ADDR))!;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      (snap as unknown as { tickCount: number }).tickCount = 999;
    }).toThrow(TypeError);
  });

  describe('scheduled ticks', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fires the runTick callback each interval and merges its delta', async () => {
      let counter = 0;
      const runTick = vi.fn(async (_snap: HeartbeatSessionState): Promise<HeartbeatTickDelta> => {
        counter += 1;
        return {
          tickId: `tick_${counter.toString()}`,
          tickAt: new Date().toISOString(),
          success: true,
          action: 'post',
        };
      });

      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(runTick).toHaveBeenCalledTimes(3);

      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.tickCount).toBe(3);
      expect(snap.successCount).toBe(3);
      expect(snap.errorCount).toBe(0);
      expect(snap.lastTickId).toBe('tick_3');
      expect(snap.lastAction).toBe('post');
    });

    it('records errors when runTick throws and keeps ticking', async () => {
      const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
        throw new Error('boom');
      });

      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(runTick).toHaveBeenCalledTimes(2);

      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.tickCount).toBe(2);
      expect(snap.errorCount).toBe(2);
      expect(snap.successCount).toBe(0);
      expect(snap.lastError).toBe('boom');
    });

    it('increments skippedCount when a prior tick is still running (overlap guard)', async () => {
      let release: (() => void) | undefined;
      const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return makeDelta({ tickId: 'tick_long' });
      });

      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(runTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);
      const mid = (await store.get(FAKE_ADDR))!;
      expect(mid.skippedCount).toBe(2);
      expect(mid.tickCount).toBe(3);
      expect(mid.successCount).toBe(0);

      release?.();
      await vi.advanceTimersByTimeAsync(0);
      const final = (await store.get(FAKE_ADDR))!;
      expect(final.successCount).toBe(1);
      expect(final.lastTickId).toBe('tick_long');
    });

    it('stop prevents future timer fires', async () => {
      const runTick = vi.fn(async () => makeDelta());

      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(runTick).toHaveBeenCalledTimes(1);

      await store.stop(FAKE_ADDR);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(runTick).toHaveBeenCalledTimes(1);
      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(1);
    });
  });

  describe('maxTicks auto-stop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('defaults maxTicks to DEFAULT_HEARTBEAT_MAX_TICKS when the caller omits it', async () => {
      const { snapshot } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
      });
      expect(snapshot.maxTicks).toBe(DEFAULT_HEARTBEAT_MAX_TICKS);
    });

    it('auto-stops the session once scheduled ticks reach maxTicks', async () => {
      const runTick = vi.fn(async () => makeDelta());
      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 3 });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(runTick).toHaveBeenCalledTimes(3);
      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(3);
      expect(snap.tickCount).toBeGreaterThanOrEqual(snap.maxTicks);
    });

    it('auto-stop counts recordTick invocations alongside scheduled fires', async () => {
      const runTick = vi.fn(async () => makeDelta());
      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 3 });

      await store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'immediate_1' }));
      await store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'immediate_2' }));

      await vi.advanceTimersByTimeAsync(5_000);

      expect(runTick).toHaveBeenCalledTimes(1);
      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(3);
    });

    it('restarting a stopped session resets counters so the new run starts fresh', async () => {
      // Regression for the "/heartbeat <addr> <ms> <n>" re-issue bug: after
      // the first run hits its cap, the next /heartbeat should run N fresh
      // ticks, NOT auto-stop on the immediate tick because the prior
      // counters were still at N.
      const runTick = vi.fn(async () => makeDelta());
      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 2 });

      await vi.advanceTimersByTimeAsync(5_000);
      expect((await store.get(FAKE_ADDR))!.running).toBe(false);
      expect(runTick).toHaveBeenCalledTimes(2);

      // Second run with the SAME cap — would break under the old semantics
      // (tickCount=2, maxTicks=2 → immediate auto-stop). New semantics:
      // stopped session restart resets counters + startedAt.
      const second = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 1_000,
        runTick,
        maxTicks: 2,
      });
      expect(second.restarted).toBe(true);
      expect(second.snapshot.tickCount).toBe(0);
      expect(second.snapshot.running).toBe(true);
      expect(second.snapshot.maxTicks).toBe(2);

      await vi.advanceTimersByTimeAsync(5_000);
      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(2);
      expect(runTick).toHaveBeenCalledTimes(4); // 2 from first run + 2 from fresh restart
    });

    it('fires onAfterTick for scheduled ticks, overlap skips, and recordTick calls with post-autoStop snapshots', async () => {
      // Drive 3 scheduled fires + 1 overlap + 1 external recordTick and
      // assert the hook observes every event (5 total) with the correct
      // delta types and a snapshot reflecting any auto-stop that fired
      // inside the same tick. maxTicks=4 forces the auto-stop to land on
      // the last scheduled fire so we can prove `running=false` reaches
      // the hook in one transaction with the delta.
      const afterTickCalls: Array<{
        snapshot: HeartbeatSessionState;
        delta: HeartbeatTickDelta;
      }> = [];
      const store2 = new HeartbeatSessionStore({
        onAfterTick: (snapshot, delta) => {
          afterTickCalls.push({ snapshot, delta });
        },
      });

      let release: (() => void) | undefined;
      let firstTickEntered = false;
      const runTick = vi.fn(async (snap: HeartbeatSessionState): Promise<HeartbeatTickDelta> => {
        if (!firstTickEntered) {
          firstTickEntered = true;
          // Block the first fire so the next scheduler tick collides and
          // goes down the overlap-skip branch.
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return {
          tickId: `tick_${snap.tickCount.toString()}`,
          tickAt: new Date().toISOString(),
          success: true,
        };
      });

      await store2.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 4 });

      // Fire 1 starts and blocks; fire 2 is skipped (overlap); release
      // fire 1; fire 3 + fire 4 complete in quick succession (4 == cap so
      // the session auto-stops).
      await vi.advanceTimersByTimeAsync(1_000);
      expect(afterTickCalls).toHaveLength(0); // fire 1 still in-flight
      await vi.advanceTimersByTimeAsync(1_000);
      // Fire 2 hit the overlap-skip branch synchronously.
      expect(afterTickCalls).toHaveLength(1);
      expect(afterTickCalls[0]!.delta.error).toBe('overlap-skipped');
      expect(afterTickCalls[0]!.delta.success).toBe(false);
      expect(afterTickCalls[0]!.snapshot.skippedCount).toBe(1);

      release?.();
      await vi.advanceTimersByTimeAsync(0);
      // Fire 1 finished → tickCount now 3 (incremented per overlap + per
      // real fires). advanceTimersByTimeAsync re-runs any pending timers
      // synchronously.
      await vi.advanceTimersByTimeAsync(2_000);

      // One external immediate tick.
      await store2.recordTick(FAKE_ADDR, {
        tickId: 'external_tick',
        tickAt: '2026-04-20T01:00:00.000Z',
        success: true,
      });

      // Five callbacks total: fire1 success, overlap, fire3, fire4 (cap),
      // recordTick. The last scheduled callback's snapshot should reflect
      // the auto-stop.
      expect(afterTickCalls.length).toBeGreaterThanOrEqual(4);
      const lastScheduled = afterTickCalls.filter((c) => c.delta.tickId.startsWith('tick_')).pop();
      expect(lastScheduled).toBeDefined();
      expect(lastScheduled!.snapshot.running).toBe(false);
      expect(lastScheduled!.snapshot.tickCount).toBeGreaterThanOrEqual(
        lastScheduled!.snapshot.maxTicks,
      );

      const external = afterTickCalls.find((c) => c.delta.tickId === 'external_tick');
      expect(external).toBeDefined();
      expect(external!.snapshot.lastTickId).toBe('external_tick');

      await store2.clear();
    });

    it('onAfterTick fires the error branch when runTick throws', async () => {
      const afterTickCalls: Array<{
        snapshot: HeartbeatSessionState;
        delta: HeartbeatTickDelta;
      }> = [];
      const store2 = new HeartbeatSessionStore({
        onAfterTick: (snapshot, delta) => {
          afterTickCalls.push({ snapshot, delta });
        },
      });

      const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
        throw new Error('boom-err');
      });
      await store2.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 5 });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(afterTickCalls).toHaveLength(1);
      expect(afterTickCalls[0]!.delta.success).toBe(false);
      expect(afterTickCalls[0]!.delta.error).toBe('boom-err');

      await store2.clear();
    });

    it('restarting a still-running session (interval change) preserves counters', async () => {
      // The counter-preservation contract is still honoured when the user
      // tweaks the cadence of a running session (NOT a stopped one).
      const runTick = vi.fn(async () => makeDelta());
      await store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 10 });

      await vi.advanceTimersByTimeAsync(2_500);
      expect(runTick).toHaveBeenCalledTimes(2);
      expect((await store.get(FAKE_ADDR))!.running).toBe(true);

      // Interval changes while still running → counters preserved.
      const second = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 500,
        runTick,
        maxTicks: 10,
      });
      expect(second.restarted).toBe(true);
      expect(second.snapshot.tickCount).toBe(2);
      expect(second.snapshot.running).toBe(true);
    });
  });
});

if (hasDatabaseUrl) {
  describe('HeartbeatSessionStore (pg backend — restart semantics)', () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = createPool();
      await ensureSchema(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await resetDb(pool, { ...process.env, NODE_ENV: 'test' });
    });

    it('counters survive a simulated process restart but running flips to false', async () => {
      const first = new HeartbeatSessionStore({ pool });
      await first.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 10_000,
        runTick: async () => makeDelta(),
      });
      await first.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a' }));
      await first.recordTick(
        FAKE_ADDR,
        makeDelta({ tickId: 'tick_b', success: false, error: 'boom' }),
      );
      await first.clear.bind(first); // avoid unused warning in minified builds
      // Drop the first store without calling clear() — clear() TRUNCATEs
      // the table, which would defeat the test. The in-memory timer stays
      // ref'd by Node's event loop but .unref() was called inside the
      // store; rely on vitest's test teardown rather than manually killing.

      // Simulate boot: run ensureSchema again and construct a fresh store.
      await ensureSchema(pool);
      const second = new HeartbeatSessionStore({ pool });
      const snap = await second.get(FAKE_ADDR);
      expect(snap).toBeDefined();
      expect(snap!.tickCount).toBe(2);
      expect(snap!.successCount).toBe(1);
      expect(snap!.errorCount).toBe(1);
      expect(snap!.running).toBe(false);
    });
  });
}
