import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createPool, resolveDatabaseUrl } from '../db/pool.js';
import { ensureSchema } from '../db/schema.js';
import { resetDb } from '../db/reset.js';
import {
  DEFAULT_HEARTBEAT_MAX_TICKS,
  HeartbeatSessionStore,
  MAX_FIRE_ATTEMPTS_MULTIPLIER,
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
      // Overlap skips only bump `skippedCount` — `tickCount` stays at 0
      // while the long-running tick is still in flight and has not yet
      // returned a delta. This is the CronJob-style semantic: "N ticks"
      // means N real executions, not N scheduler fire attempts.
      expect(mid.skippedCount).toBe(2);
      expect(mid.tickCount).toBe(0);
      expect(mid.successCount).toBe(0);

      release?.();
      await vi.advanceTimersByTimeAsync(0);
      const final = (await store.get(FAKE_ADDR))!;
      // The long tick finally resolved and advances `tickCount` by 1.
      // `skippedCount` carries the 2 ghosts from the in-flight window.
      expect(final.tickCount).toBe(1);
      expect(final.successCount).toBe(1);
      expect(final.skippedCount).toBe(2);
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
      // Drive 3 real scheduled fires + 1 overlap + 1 external recordTick and
      // assert the hook observes every event (5 total) with the correct
      // delta types and a snapshot reflecting any auto-stop that fired
      // inside the same tick. Under the new semantics `tickCount` tracks
      // only real executions, so `maxTicks=3` forces the auto-stop to land
      // on the third real scheduled fire — proving `running=false` reaches
      // the hook in the same transaction as the cap-tripping delta.
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

      await store2.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 3 });

      // Fire 1 starts and blocks; fire 2 is skipped (overlap); release
      // fire 1; fires 3 + 4 complete in quick succession — real fire #3
      // (the third successful execution) trips the maxTicks=3 cap.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(afterTickCalls).toHaveLength(0); // fire 1 still in-flight
      await vi.advanceTimersByTimeAsync(1_000);
      // Fire 2 hit the overlap-skip branch synchronously.
      expect(afterTickCalls).toHaveLength(1);
      expect(afterTickCalls[0]!.delta.error).toBe('overlap-skipped');
      expect(afterTickCalls[0]!.delta.success).toBe(false);
      expect(afterTickCalls[0]!.snapshot.skippedCount).toBe(1);
      // Overlap must NOT advance `tickCount` under the new semantics.
      expect(afterTickCalls[0]!.snapshot.tickCount).toBe(0);

      release?.();
      await vi.advanceTimersByTimeAsync(0);
      // Fire 1 finished → tickCount now 1 (overlap did NOT increment it).
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

  // ─── recent tick ring buffer (LLM memory across ticks) ───────────────────
  //
  // Per-tick in-memory history so the heartbeat LLM can see what the prior
  // few ticks did (post / extend_lore / idle / error / skip) and avoid
  // repeating itself. Pure memory — never persisted — because the only
  // consumer is the next LLM prompt a few seconds away. Store caps the
  // history at 5 entries per token and keeps buckets isolated per token
  // addr.
  describe('recent tick ring buffer', () => {
    const ADDR_A = '0x1111111111111111111111111111111111111111';
    const ADDR_B = '0x2222222222222222222222222222222222222222';

    it('returns an empty array for a brand new session', async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
      });
      expect(store.getRecentTicks(ADDR_A)).toEqual([]);
    });

    it('returns an empty array for a token that was never started', async () => {
      expect(store.getRecentTicks(ADDR_A)).toEqual([]);
    });

    it('keeps at most the last 5 entries in arrival order (oldest first)', async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
        maxTicks: 20,
      });
      for (let i = 1; i <= 7; i += 1) {
        await store.recordTick(ADDR_A, {
          tickId: `tick_${i.toString()}`,
          tickAt: `2026-04-20T00:00:0${i.toString()}.000Z`,
          success: true,
          action: 'post',
          reason: `reason_${i.toString()}`,
        });
      }
      const recent = store.getRecentTicks(ADDR_A);
      expect(recent).toHaveLength(5);
      // Oldest (tick 3) first, newest (tick 7) last.
      expect(recent.map((r) => r.tickAt)).toEqual([
        '2026-04-20T00:00:03.000Z',
        '2026-04-20T00:00:04.000Z',
        '2026-04-20T00:00:05.000Z',
        '2026-04-20T00:00:06.000Z',
        '2026-04-20T00:00:07.000Z',
      ]);
      for (const entry of recent) {
        expect(entry.action).toBe('post');
      }
    });

    it("records 'error' when the tick failed and 'skip' when success=true without action", async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
        maxTicks: 10,
      });
      await store.recordTick(ADDR_A, {
        tickId: 'tick_ok',
        tickAt: '2026-04-20T00:00:01.000Z',
        success: true,
        action: 'extend_lore',
        reason: 'lore top-up',
      });
      await store.recordTick(ADDR_A, {
        tickId: 'tick_err',
        tickAt: '2026-04-20T00:00:02.000Z',
        success: false,
        error: 'boom',
      });
      await store.recordTick(ADDR_A, {
        tickId: 'tick_noop',
        tickAt: '2026-04-20T00:00:03.000Z',
        success: true,
        // No action — treat as a successful no-op / skip.
      });
      const recent = store.getRecentTicks(ADDR_A);
      expect(recent).toHaveLength(3);
      expect(recent[0]!.action).toBe('extend_lore');
      expect(recent[0]!.reason).toBe('lore top-up');
      expect(recent[1]!.action).toBe('error');
      expect(recent[2]!.action).toBe('skip');
    });

    it('keeps separate buckets per tokenAddr', async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
        maxTicks: 10,
      });
      await store.start({
        tokenAddr: ADDR_B,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
        maxTicks: 10,
      });
      await store.recordTick(ADDR_A, {
        tickId: 'tick_a1',
        tickAt: '2026-04-20T00:00:01.000Z',
        success: true,
        action: 'post',
      });
      await store.recordTick(ADDR_B, {
        tickId: 'tick_b1',
        tickAt: '2026-04-20T00:00:02.000Z',
        success: true,
        action: 'idle',
      });
      const a = store.getRecentTicks(ADDR_A);
      const b = store.getRecentTicks(ADDR_B);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.action).toBe('post');
      expect(b[0]!.action).toBe('idle');
    });

    it('returned entries are read-only — mutating them does not affect the store', async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
      });
      await store.recordTick(ADDR_A, {
        tickId: 'tick_one',
        tickAt: '2026-04-20T00:00:01.000Z',
        success: true,
        action: 'post',
        reason: 'r1',
      });
      const recent = store.getRecentTicks(ADDR_A);
      // Array itself or its entries must not permit external mutation to
      // corrupt internal state. Either the array is frozen or the caller
      // gets a fresh copy — we verify the store is unperturbed after a
      // best-effort mutation attempt.
      try {
        (recent as unknown as { push: (x: unknown) => void }).push({ tickAt: 'x', action: 'post' });
      } catch {
        /* frozen array throws in strict mode — that is fine */
      }
      const again = store.getRecentTicks(ADDR_A);
      expect(again).toHaveLength(1);
      expect(again[0]!.tickAt).toBe('2026-04-20T00:00:01.000Z');
    });

    it('clear() wipes the recentTicks buckets', async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
      });
      await store.recordTick(ADDR_A, {
        tickId: 'tick_one',
        tickAt: '2026-04-20T00:00:01.000Z',
        success: true,
        action: 'post',
      });
      expect(store.getRecentTicks(ADDR_A)).toHaveLength(1);
      await store.clear();
      expect(store.getRecentTicks(ADDR_A)).toEqual([]);
    });

    it('normalises mixed-case addresses so getRecentTicks hits the same bucket', async () => {
      const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
      await store.start({
        tokenAddr: mixed,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
      });
      await store.recordTick(mixed.toLowerCase(), {
        tickId: 'tick_one',
        tickAt: '2026-04-20T00:00:01.000Z',
        success: true,
        action: 'post',
      });
      expect(store.getRecentTicks(mixed.toUpperCase())).toHaveLength(1);
    });

    // Regression for the cross-run contamination bug: explicit `stop()` MUST
    // wipe the per-token ring buffer so a user who issues `/heartbeat <addr>`
    // → /stop → /heartbeat <addr>` starts the next run with an empty history.
    // Without this the first tick of run #2 sees the last 5 decisions of run
    // #1 and fires Decision Rules 3/4 (post-spam detection / lore-stocked
    // heuristic) against stale data.
    it('stop() wipes the recentTicks ring buffer for the stopped token', async () => {
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
        maxTicks: 10,
      });
      for (let i = 1; i <= 3; i += 1) {
        await store.recordTick(ADDR_A, {
          tickId: `tick_${i.toString()}`,
          tickAt: `2026-04-20T00:00:0${i.toString()}.000Z`,
          success: true,
          action: 'post',
          reason: `r${i.toString()}`,
        });
      }
      expect(store.getRecentTicks(ADDR_A)).toHaveLength(3);

      await store.stop(ADDR_A);
      expect(store.getRecentTicks(ADDR_A)).toEqual([]);
    });

    // Second leg of the same regression: an auto-stop (tickCount hit maxTicks)
    // followed by a restart under the `wasStopped` branch of start() must also
    // hand the new run an empty history. This is belt-and-suspenders with the
    // stop()-wipe test above because the auto-stop path does NOT go through
    // the public stop() method — it flips `running=false` inline inside
    // `maybeAutoStop()` — so we assert the reset lives on the start() side
    // too, making the invariant robust to either-side-only regressions.
    it('start() resets recentTicks when the prior session had been stopped (auto-stop + restart)', async () => {
      const runTick = vi.fn(async () => makeDelta());
      await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick,
        maxTicks: 3,
      });
      for (let i = 1; i <= 3; i += 1) {
        await store.recordTick(ADDR_A, {
          tickId: `tick_${i.toString()}`,
          tickAt: `2026-04-20T00:00:0${i.toString()}.000Z`,
          success: true,
          action: 'post',
          reason: `r${i.toString()}`,
        });
      }
      // Auto-stop fired on the third recordTick because tickCount >= maxTicks.
      const afterCap = (await store.get(ADDR_A))!;
      expect(afterCap.running).toBe(false);
      expect(store.getRecentTicks(ADDR_A)).toHaveLength(3);

      // Restart under the wasStopped branch. The new run must start with an
      // empty history so Decision Rule 3/4 cannot fire against stale ticks.
      const second = await store.start({
        tokenAddr: ADDR_A,
        intervalMs: 1_000,
        runTick,
        maxTicks: 3,
      });
      expect(second.restarted).toBe(true);
      expect(second.snapshot.running).toBe(true);
      expect(second.snapshot.tickCount).toBe(0);
      expect(store.getRecentTicks(ADDR_A)).toEqual([]);
    });
  });

  // The matrix below is the canonical coverage of `start(...)` semantics
  // when a prior session already exists. The neighbouring "restarting a
  // stopped session resets counters" test (~line 317) overlaps with two
  // of the cells below but is keyed by a different assertion shape and
  // protects the specific `/heartbeat <addr> <ms> <n>` re-issue UX
  // regression — keep both.
  describe('restart state machine matrix', () => {
    // Use `recordTick` to drive counters rather than fake-timer scheduling
    // so each test is fast, deterministic, and cannot flake on timer
    // coalescing. Fake timers are therefore NOT installed here.

    const TICK_A: HeartbeatTickDelta = {
      tickId: 'tick_a',
      tickAt: '2026-04-20T00:00:01.000Z',
      success: true,
      action: 'post',
    };
    const TICK_B: HeartbeatTickDelta = {
      tickId: 'tick_b',
      tickAt: '2026-04-20T00:00:02.000Z',
      success: true,
      action: 'idle',
    };

    async function seedRunningWith(
      s: HeartbeatSessionStore,
      intervalMs: number,
      maxTicks: number | undefined,
      ticks: HeartbeatTickDelta[],
    ): Promise<HeartbeatSessionState> {
      await s.start({
        tokenAddr: FAKE_ADDR,
        intervalMs,
        runTick: async () => makeDelta(),
        ...(maxTicks !== undefined ? { maxTicks } : {}),
      });
      for (const t of ticks) {
        await s.recordTick(FAKE_ADDR, t);
      }
      return (await s.get(FAKE_ADDR))!;
    }

    it('running + same intervalMs + maxTicks omitted → keep counters, keep cap, running=true', async () => {
      const prior = await seedRunningWith(store, 5_000, 7, [TICK_A]);
      expect(prior.running).toBe(true);
      expect(prior.tickCount).toBe(1);

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 5_000,
        runTick: async () => makeDelta(),
      });

      expect(restarted).toBe(false);
      expect(snapshot.running).toBe(true);
      expect(snapshot.tickCount).toBe(1);
      expect(snapshot.successCount).toBe(1);
      expect(snapshot.maxTicks).toBe(7);
    });

    it('running + same intervalMs + higher maxTicks → keep counters, raise cap, running=true', async () => {
      await seedRunningWith(store, 5_000, 5, [TICK_A]);

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 5_000,
        runTick: async () => makeDelta(),
        maxTicks: 20,
      });

      expect(restarted).toBe(false);
      expect(snapshot.running).toBe(true);
      expect(snapshot.tickCount).toBe(1);
      expect(snapshot.maxTicks).toBe(20);
    });

    it('running + same intervalMs + lower maxTicks → keep counters, lower cap, running=true', async () => {
      // Do NOT drive any further ticks here — the contract only asserts
      // the snapshot state after start(). The next tick MAY trigger an
      // auto-stop if tickCount>=maxTicks, but that belongs on a
      // dedicated auto-stop test.
      await seedRunningWith(store, 5_000, 10, [TICK_A]);

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 5_000,
        runTick: async () => makeDelta(),
        maxTicks: 3,
      });

      expect(restarted).toBe(false);
      expect(snapshot.running).toBe(true);
      expect(snapshot.tickCount).toBe(1);
      expect(snapshot.maxTicks).toBe(3);
    });

    it('running + new intervalMs + maxTicks omitted → keep counters AND keep prior cap, restarted=true', async () => {
      // Seed with a custom cap (7) so we can prove it survives a
      // cadence-only restart when the caller omits maxTicks.
      await seedRunningWith(store, 5_000, 7, [TICK_A, TICK_B]);

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 10_000,
        runTick: async () => makeDelta(),
      });

      expect(restarted).toBe(true);
      expect(snapshot.running).toBe(true);
      expect(snapshot.intervalMs).toBe(10_000);
      expect(snapshot.tickCount).toBe(2);
      expect(snapshot.successCount).toBe(2);
      // Preserve the previously-configured cap when the caller omits
      // `maxTicks`. Tweaking the cadence mid-run must NOT silently reset a
      // customised cap back to DEFAULT_HEARTBEAT_MAX_TICKS.
      expect(snapshot.maxTicks).toBe(7);
    });

    it('running + new intervalMs + explicit maxTicks → keep counters, explicit cap, restarted=true', async () => {
      await seedRunningWith(store, 5_000, 7, [TICK_A]);

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 20_000,
        runTick: async () => makeDelta(),
        maxTicks: 12,
      });

      expect(restarted).toBe(true);
      expect(snapshot.running).toBe(true);
      expect(snapshot.intervalMs).toBe(20_000);
      expect(snapshot.tickCount).toBe(1);
      expect(snapshot.maxTicks).toBe(12);
    });

    it('stopped (hit cap) + same intervalMs + same maxTicks → reset counters, refresh startedAt, restarted=true', async () => {
      // Drive the real cap-hit path: start with maxTicks=2, recordTick
      // twice, assert the auto-stop fired, then restart with the same cap.
      await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 5_000,
        runTick: async () => makeDelta(),
        maxTicks: 2,
      });
      await store.recordTick(FAKE_ADDR, TICK_A);
      await store.recordTick(FAKE_ADDR, TICK_B);
      const afterCap = (await store.get(FAKE_ADDR))!;
      expect(afterCap.running).toBe(false);
      expect(afterCap.tickCount).toBe(2);
      const capStartedAt = afterCap.startedAt;

      // Cross a millisecond boundary so the refreshed `startedAt` cannot
      // collide with `capStartedAt`. `new Date().toISOString()` is ms-
      // granular; synchronous awaits can resolve inside the same ms.
      await new Promise((resolve) => setTimeout(resolve, 2));

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 5_000,
        runTick: async () => makeDelta(),
        maxTicks: 2,
      });

      expect(restarted).toBe(true);
      expect(snapshot.running).toBe(true);
      expect(snapshot.tickCount).toBe(0);
      expect(snapshot.successCount).toBe(0);
      expect(snapshot.errorCount).toBe(0);
      expect(snapshot.skippedCount).toBe(0);
      expect(snapshot.lastTickId).toBeNull();
      expect(snapshot.maxTicks).toBe(2);
      // startedAt should refresh to the restart moment (not the original
      // first-run moment) so "session age" in the UI tracks the active run.
      expect(snapshot.startedAt).not.toBe(capStartedAt);
    });

    it('stopped (explicit stop) + same intervalMs + same maxTicks → reset counters, refresh startedAt, restarted=true', async () => {
      await seedRunningWith(store, 5_000, 7, [TICK_A, TICK_B]);
      const final = await store.stop(FAKE_ADDR);
      expect(final!.running).toBe(false);
      const stoppedStartedAt = final!.startedAt;

      // Cross a millisecond boundary so the refreshed `startedAt` is
      // provably different (see sibling test comment).
      await new Promise((resolve) => setTimeout(resolve, 2));

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 5_000,
        runTick: async () => makeDelta(),
        maxTicks: 7,
      });

      expect(restarted).toBe(true);
      expect(snapshot.running).toBe(true);
      expect(snapshot.tickCount).toBe(0);
      expect(snapshot.successCount).toBe(0);
      expect(snapshot.errorCount).toBe(0);
      expect(snapshot.maxTicks).toBe(7);
      expect(snapshot.startedAt).not.toBe(stoppedStartedAt);
    });

    it('stopped + new intervalMs + new higher maxTicks → reset counters, new cap, restarted=true', async () => {
      await seedRunningWith(store, 5_000, 3, [TICK_A]);
      await store.stop(FAKE_ADDR);

      const { snapshot, restarted } = await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 15_000,
        runTick: async () => makeDelta(),
        maxTicks: 10,
      });

      expect(restarted).toBe(true);
      expect(snapshot.running).toBe(true);
      expect(snapshot.intervalMs).toBe(15_000);
      expect(snapshot.tickCount).toBe(0);
      expect(snapshot.successCount).toBe(0);
      expect(snapshot.maxTicks).toBe(10);
    });
  });

  // ─── runExclusiveTick overlap discipline ────────────────────────────────
  //
  // Regression for the bug where `/heartbeat <addr> <intervalMs>` showed
  // continuous tool calls with no spacing: the "immediate tick" ran its
  // 20-30s LLM loop without setting `tickInFlight`, so every setInterval
  // fire that landed during the immediate tick's run spun up a parallel
  // LLM call instead of recording as an overlap-skip. Unifying both entry
  // points under `runExclusiveTick` is the fix; this block pins that
  // invariant so a future refactor cannot re-introduce the race.
  describe('runExclusiveTick overlap discipline', () => {
    it('serialises concurrent runExclusiveTick calls — second wins a skip, not a parallel run', async () => {
      let concurrentEnters = 0;
      let maxConcurrent = 0;
      const slowRunTick = async (): Promise<HeartbeatTickDelta> => {
        concurrentEnters += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrentEnters);
        // Yield microtasks so a second runExclusiveTick can interleave and
        // attempt to acquire the lock while the first is still in flight.
        await new Promise<void>((r) => setTimeout(r, 0));
        concurrentEnters -= 1;
        return {
          tickId: `ok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          tickAt: '2026-04-20T00:00:00.000Z',
          success: true,
        };
      };

      await store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 60_000,
        runTick: slowRunTick,
        maxTicks: 10,
      });

      // Fire two runExclusiveTick calls back-to-back. Only one can hold
      // the lock at a time; the other must record as an overlap-skip.
      const [a, b] = await Promise.all([
        store.runExclusiveTick(FAKE_ADDR, slowRunTick),
        store.runExclusiveTick(FAKE_ADDR, slowRunTick),
      ]);

      expect(maxConcurrent).toBe(1);
      // Exactly one of the two calls ran the LLM body (success=1), the
      // other was recorded as a skip. Under CronJob-style semantics only
      // the real execution advances `tickCount`; the overlap skip bumps
      // `skippedCount` alone.
      const snap = (await store.get(FAKE_ADDR))!;
      expect(snap.successCount).toBe(1);
      expect(snap.skippedCount).toBe(1);
      expect(snap.tickCount).toBe(1);
      // Both callers got a post-tick snapshot (neither returned undefined).
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it('scheduled setInterval fires land as skips while an immediate runExclusiveTick holds the lock', async () => {
      vi.useFakeTimers();
      try {
        let slowTickResolve: (() => void) | null = null;
        const slowTickRunning = new Promise<void>((r) => {
          slowTickResolve = r;
        });
        const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
          await slowTickRunning;
          return {
            tickId: 'slow_ok',
            tickAt: '2026-04-20T00:00:00.000Z',
            success: true,
          };
        });

        await store.start({
          tokenAddr: FAKE_ADDR,
          intervalMs: 1_000,
          runTick,
          maxTicks: 5,
        });

        // Kick off the immediate tick — it acquires the lock and then
        // parks on `slowTickRunning` until we release it.
        const immediatePromise = store.runExclusiveTick(FAKE_ADDR, runTick);

        // Let the microtask queue drain so runExclusiveTick actually takes
        // the lock before we advance timers.
        await Promise.resolve();
        await Promise.resolve();

        // Advance past 3 interval boundaries while the immediate tick is
        // still in flight. Each scheduled fire should see tickInFlight=true
        // and skip rather than launching a parallel LLM invocation.
        await vi.advanceTimersByTimeAsync(3_500);

        // Only one LLM invocation has run (the immediate one). Scheduled
        // fires at t=1s / 2s / 3s all skipped.
        expect(runTick).toHaveBeenCalledTimes(1);

        // Now release the immediate tick and let everything settle.
        slowTickResolve!();
        await immediatePromise;

        const snap = (await store.get(FAKE_ADDR))!;
        expect(snap.successCount).toBe(1);
        expect(snap.skippedCount).toBe(3);
        // `tickCount` counts real executions only — the 3 ghosted fires
        // are accounted for by `skippedCount`.
        expect(snap.tickCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    // ─── CronJob-style maxTicks semantics ────────────────────────────────
    //
    // Regression for the bug where `/heartbeat <addr> 10000 3` ran exactly
    // ONE real tick and auto-stopped because two overlap-skips (from the
    // scheduler firing during the immediate tick's ~22s LLM call) bumped
    // `tickCount` to 3. New contract: `tickCount` counts only real
    // executions (success + error); `skippedCount` carries overlaps.
    it('overlap skips during a long immediate tick do not advance maxTicks', async () => {
      // Case A: persona takes 30s, intervalMs=10s, maxTicks=3. While the
      // immediate tick holds the lock, two scheduler fires collide and
      // record as overlap skips. `tickCount` must remain 1 and the session
      // must stay `running=true` — the user asked for 3 real ticks, not 3
      // fire attempts.
      vi.useFakeTimers();
      try {
        let release: (() => void) | undefined;
        const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {
            tickId: 'immediate_tick',
            tickAt: '2026-04-20T00:00:30.000Z',
            success: true,
          };
        });

        await store.start({
          tokenAddr: FAKE_ADDR,
          intervalMs: 10_000,
          runTick,
          maxTicks: 3,
        });

        // Kick off the immediate tick (parks on the release Promise).
        const immediatePromise = store.runExclusiveTick(FAKE_ADDR, runTick);
        await Promise.resolve();
        await Promise.resolve();

        // Simulate 25s of wall clock: two interval boundaries fire at
        // t=10s and t=20s, both must record as overlap skips.
        await vi.advanceTimersByTimeAsync(25_000);

        const mid = (await store.get(FAKE_ADDR))!;
        expect(mid.tickCount).toBe(0);
        expect(mid.skippedCount).toBe(2);
        expect(mid.successCount).toBe(0);
        expect(mid.running).toBe(true);

        // Release the immediate tick; the single real execution lands.
        release?.();
        await immediatePromise;
        await vi.advanceTimersByTimeAsync(0);

        const afterImmediate = (await store.get(FAKE_ADDR))!;
        expect(afterImmediate.tickCount).toBe(1);
        expect(afterImmediate.skippedCount).toBe(2);
        expect(afterImmediate.successCount).toBe(1);
        // maxTicks=3 and we have only 1 real tick — must still be running.
        expect(afterImmediate.running).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reaches maxTicks by counting only real executions, preserving skippedCount', async () => {
      // Case B: continuation of Case A — after the long immediate tick
      // resolves, subsequent scheduler fires each complete well inside the
      // interval. The session must auto-stop exactly when the third REAL
      // tick lands (not on the second, which would be old-semantics bug),
      // and the 2 carried-over skips must remain visible on the snapshot.
      vi.useFakeTimers();
      try {
        let blockFirst = true;
        let releaseFirst: (() => void) | undefined;
        const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
          if (blockFirst) {
            blockFirst = false;
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
            return {
              tickId: 'immediate_tick',
              tickAt: '2026-04-20T00:00:30.000Z',
              success: true,
            };
          }
          return {
            tickId: `tick_${Date.now().toString(36)}`,
            tickAt: new Date().toISOString(),
            success: true,
          };
        });

        await store.start({
          tokenAddr: FAKE_ADDR,
          intervalMs: 10_000,
          runTick,
          maxTicks: 3,
        });

        const immediatePromise = store.runExclusiveTick(FAKE_ADDR, runTick);
        await Promise.resolve();
        await Promise.resolve();

        // 25s wall clock → 2 overlap skips, still blocked.
        await vi.advanceTimersByTimeAsync(25_000);
        releaseFirst?.();
        await immediatePromise;
        await vi.advanceTimersByTimeAsync(0);

        // First real tick done → tickCount=1, skippedCount=2, running=true.
        const afterFirstReal = (await store.get(FAKE_ADDR))!;
        expect(afterFirstReal.tickCount).toBe(1);
        expect(afterFirstReal.skippedCount).toBe(2);
        expect(afterFirstReal.running).toBe(true);

        // Advance past two more interval boundaries. Each runs the fast
        // persona branch → two real ticks → tickCount reaches 3 → auto-stop.
        await vi.advanceTimersByTimeAsync(20_000);

        const final = (await store.get(FAKE_ADDR))!;
        expect(final.tickCount).toBe(3);
        expect(final.successCount).toBe(3);
        expect(final.skippedCount).toBe(2);
        expect(final.running).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('safety rail auto-stops when fire attempts exceed maxTicks * multiplier', async () => {
      // Case C: the persona is permanently slower than the interval, so
      // every scheduler fire lands mid-tick and records as a skip. Without
      // a safety rail the loop would fire forever. With maxTicks=2 the
      // absolute cap is 2 * MAX_FIRE_ATTEMPTS_MULTIPLIER = 10 fire
      // attempts — force-stop at the 10th attempt with a warn log.
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
      };
      try {
        // A persona that never resolves — every runExclusiveTick entry
        // beyond the first sees `tickInFlight=true` and records as a skip.
        const neverResolvingTick = (): Promise<HeartbeatTickDelta> =>
          new Promise<HeartbeatTickDelta>(() => {
            // intentionally never resolves
          });

        await store.start({
          tokenAddr: FAKE_ADDR,
          intervalMs: 60_000,
          runTick: neverResolvingTick,
          maxTicks: 2,
        });

        // First call takes the lock and parks forever; subsequent calls
        // record as overlap skips.
        void store.runExclusiveTick(FAKE_ADDR, neverResolvingTick);
        await Promise.resolve();
        await Promise.resolve();

        const expectedLimit = 2 * MAX_FIRE_ATTEMPTS_MULTIPLIER; // 10
        // Dispatch `expectedLimit` additional fire attempts. The parked
        // first attempt (`tickCount=0`) plus `expectedLimit` overlap skips
        // means `fireAttempts = 0 + 10 = 10`, which equals the rail and
        // trips auto-stop. `skippedCount` lands at 10.
        for (let i = 0; i < expectedLimit; i += 1) {
          await store.runExclusiveTick(FAKE_ADDR, neverResolvingTick);
        }

        const snap = (await store.get(FAKE_ADDR))!;
        expect(snap.running).toBe(false);
        expect(snap.skippedCount).toBe(expectedLimit);
        expect(snap.tickCount).toBe(0); // the parked tick never resolved
        const matched = warnings.find(
          (w) => w.includes('safety rail tripped') && w.includes(FAKE_ADDR),
        );
        expect(matched).toBeDefined();
      } finally {
        console.warn = originalWarn;
      }
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
