import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HEARTBEAT_MAX_TICKS,
  HeartbeatSessionStore,
  type HeartbeatSessionState,
  type HeartbeatTickDelta,
} from './heartbeat-session-store.js';

/**
 * HeartbeatSessionStore drives real background heartbeat loops keyed by
 * tokenAddr. These tests cover:
 *   - start / restart / stop semantics (including counter preservation)
 *   - overlap guard for long-running ticks
 *   - snapshot immutability
 *   - deterministic tick drive via injected setInterval/clearInterval
 *
 * We use vitest fake timers for the scheduled-tick tests; the restart +
 * counter-preservation tests drive `recordTick` directly so they do not
 * depend on timer tuning.
 */

const FAKE_ADDR = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';

function makeDelta(overrides: Partial<HeartbeatTickDelta> = {}): HeartbeatTickDelta {
  return {
    tickId: 'tick_one',
    tickAt: '2026-04-20T00:00:00.000Z',
    success: true,
    ...overrides,
  };
}

describe('HeartbeatSessionStore', () => {
  let store: HeartbeatSessionStore;

  beforeEach(() => {
    store = new HeartbeatSessionStore();
  });

  afterEach(() => {
    store.clear();
  });

  it('start creates a session and get returns a running snapshot with the correct interval', () => {
    const { snapshot, restarted } = store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });

    expect(restarted).toBe(false);
    expect(snapshot.tokenAddr).toBe(FAKE_ADDR);
    expect(snapshot.running).toBe(true);
    expect(snapshot.intervalMs).toBe(5_000);
    expect(snapshot.tickCount).toBe(0);
    expect(snapshot.successCount).toBe(0);
    expect(snapshot.errorCount).toBe(0);
    expect(snapshot.skippedCount).toBe(0);
    expect(snapshot.lastTickAt).toBeNull();
    expect(snapshot.lastTickId).toBeNull();
    expect(snapshot.lastAction).toBeNull();

    const read = store.get(FAKE_ADDR);
    expect(read).toBeDefined();
    expect(read!.running).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('start with the same intervalMs returns restarted=false and keeps the original snapshot', () => {
    store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });
    store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a' }));

    const second = store.start({
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

  it('start with a different intervalMs restarts the timer but preserves counters', () => {
    const clearIntervalImpl = vi.fn(clearInterval);
    const setIntervalImpl = vi.fn(setInterval);
    store = new HeartbeatSessionStore({ setIntervalImpl, clearIntervalImpl });

    store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });
    // Seed some state so we can prove it survives the restart.
    store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a', action: 'post' }));
    store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_b', success: false, error: 'boom' }));

    const second = store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 10_000,
      runTick: async () => makeDelta(),
    });

    expect(second.restarted).toBe(true);
    expect(second.snapshot.intervalMs).toBe(10_000);
    // Counters preserved verbatim.
    expect(second.snapshot.tickCount).toBe(2);
    expect(second.snapshot.successCount).toBe(1);
    expect(second.snapshot.errorCount).toBe(1);
    expect(second.snapshot.lastTickId).toBe('tick_b');
    expect(second.snapshot.lastError).toBe('boom');
    expect(second.snapshot.running).toBe(true);
    // Timer churn: one clear (old timer) plus two sets (one per start).
    expect(clearIntervalImpl).toHaveBeenCalledTimes(1);
    expect(setIntervalImpl).toHaveBeenCalledTimes(2);
  });

  it('stop flips running to false, preserves counters, and returns the final snapshot', () => {
    store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 5_000,
      runTick: async () => makeDelta(),
    });
    store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'tick_a', action: 'idle' }));

    const final = store.stop(FAKE_ADDR);
    expect(final).toBeDefined();
    expect(final!.running).toBe(false);
    expect(final!.tickCount).toBe(1);
    expect(final!.successCount).toBe(1);
    expect(final!.lastAction).toBe('idle');

    // stop is idempotent: a second stop still returns the final snapshot.
    const again = store.stop(FAKE_ADDR);
    expect(again).toBeDefined();
    expect(again!.running).toBe(false);
    expect(again!.tickCount).toBe(1);
  });

  it('stop returns undefined when no session exists', () => {
    expect(store.stop(FAKE_ADDR)).toBeUndefined();
  });

  it('list returns every session including stopped ones', () => {
    const addrA = '0x1111111111111111111111111111111111111111';
    const addrB = '0x2222222222222222222222222222222222222222';
    store.start({ tokenAddr: addrA, intervalMs: 1_000, runTick: async () => makeDelta() });
    store.start({ tokenAddr: addrB, intervalMs: 2_000, runTick: async () => makeDelta() });
    store.stop(addrA);

    const list = store.list();
    expect(list).toHaveLength(2);
    const byAddr = new Map(list.map((s) => [s.tokenAddr, s]));
    expect(byAddr.get(addrA)?.running).toBe(false);
    expect(byAddr.get(addrB)?.running).toBe(true);
  });

  it('clear stops every timer and empties the registry', () => {
    const clearIntervalImpl = vi.fn(clearInterval);
    store = new HeartbeatSessionStore({ clearIntervalImpl });

    store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 1_000,
      runTick: async () => makeDelta(),
    });
    store.start({
      tokenAddr: '0x2222222222222222222222222222222222222222',
      intervalMs: 2_000,
      runTick: async () => makeDelta(),
    });

    store.clear();
    expect(store.size()).toBe(0);
    expect(store.get(FAKE_ADDR)).toBeUndefined();
    // Both timers cleared.
    expect(clearIntervalImpl).toHaveBeenCalledTimes(2);
  });

  it('normalises mixed-case addresses so start + stop operate on the same bucket', () => {
    const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    store.start({
      tokenAddr: mixed,
      intervalMs: 1_000,
      runTick: async () => makeDelta(),
    });
    // Both casings resolve to the same entry.
    expect(store.get(mixed)?.tokenAddr).toBe(mixed.toLowerCase());
    expect(store.get(mixed.toLowerCase())).toBeDefined();
    // Stop via upper-case address still clears the session.
    const final = store.stop(mixed.toUpperCase());
    expect(final).toBeDefined();
    expect(final!.running).toBe(false);
  });

  it('snapshots are frozen so consumers cannot mutate internal state', () => {
    store.start({
      tokenAddr: FAKE_ADDR,
      intervalMs: 1_000,
      runTick: async () => makeDelta(),
    });
    const snap = store.get(FAKE_ADDR)!;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      (snap as unknown as { tickCount: number }).tickCount = 999;
    }).toThrow(TypeError);
  });

  // ─── Timer-driven ticks ───────────────────────────────────────────────────
  //
  // Use vitest fake timers to advance the `setInterval` deterministically.
  // Each test flushes the scheduler callbacks with `vi.advanceTimersByTime`
  // and then awaits pending promises so the async runTick has a chance to
  // land its delta through `applyDelta`.
  // ----------------------------------------------------------------------------

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

      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });

      await vi.advanceTimersByTimeAsync(3_000);
      expect(runTick).toHaveBeenCalledTimes(3);

      const snap = store.get(FAKE_ADDR)!;
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

      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });

      await vi.advanceTimersByTimeAsync(2_000);
      expect(runTick).toHaveBeenCalledTimes(2);

      const snap = store.get(FAKE_ADDR)!;
      expect(snap.tickCount).toBe(2);
      expect(snap.errorCount).toBe(2);
      expect(snap.successCount).toBe(0);
      expect(snap.lastError).toBe('boom');
    });

    it('increments skippedCount when a prior tick is still running (overlap guard)', async () => {
      // Build a runTick that does not resolve until we explicitly release it.
      // This simulates a long LLM call that outlives the scheduled interval.
      let release: (() => void) | undefined;
      const runTick = vi.fn(async (): Promise<HeartbeatTickDelta> => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return makeDelta({ tickId: 'tick_long' });
      });

      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });

      // Advance one tick — runTick starts, blocks on release.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(runTick).toHaveBeenCalledTimes(1);

      // Advance two more intervals — both should hit the overlap guard.
      await vi.advanceTimersByTimeAsync(2_000);
      const mid = store.get(FAKE_ADDR)!;
      expect(mid.skippedCount).toBe(2);
      expect(mid.tickCount).toBe(3);
      expect(mid.successCount).toBe(0);

      // Release the long tick — it should now land its success delta.
      release?.();
      await vi.advanceTimersByTimeAsync(0);
      const final = store.get(FAKE_ADDR)!;
      expect(final.successCount).toBe(1);
      expect(final.lastTickId).toBe('tick_long');
    });

    it('stop prevents future timer fires', async () => {
      const runTick = vi.fn(async () => makeDelta());

      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(runTick).toHaveBeenCalledTimes(1);

      store.stop(FAKE_ADDR);
      await vi.advanceTimersByTimeAsync(5_000);
      // No additional invocations after stop.
      expect(runTick).toHaveBeenCalledTimes(1);
      const snap = store.get(FAKE_ADDR)!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(1);
    });
  });

  // ─── maxTicks cap ────────────────────────────────────────────────────────

  describe('maxTicks auto-stop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('defaults maxTicks to DEFAULT_HEARTBEAT_MAX_TICKS when the caller omits it', () => {
      const { snapshot } = store.start({
        tokenAddr: FAKE_ADDR,
        intervalMs: 1_000,
        runTick: async () => makeDelta(),
      });
      expect(snapshot.maxTicks).toBe(DEFAULT_HEARTBEAT_MAX_TICKS);
    });

    it('auto-stops the session once scheduled ticks reach maxTicks', async () => {
      const runTick = vi.fn(async () => makeDelta());
      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 3 });

      // Fire enough intervals to blow through the cap, plus one extra to
      // confirm no further invocation happens after auto-stop.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runTick).toHaveBeenCalledTimes(3);
      const snap = store.get(FAKE_ADDR)!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(3);
      expect(snap.tickCount).toBeGreaterThanOrEqual(snap.maxTicks);
    });

    it('auto-stop counts recordTick invocations alongside scheduled fires', async () => {
      const runTick = vi.fn(async () => makeDelta());
      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 3 });

      // Simulate the "immediate tick" path: external recordTick calls.
      store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'immediate_1' }));
      store.recordTick(FAKE_ADDR, makeDelta({ tickId: 'immediate_2' }));

      // Only one scheduled fire should land before the cap is hit.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(runTick).toHaveBeenCalledTimes(1);
      const snap = store.get(FAKE_ADDR)!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(3);
    });

    it('restarting with a higher maxTicks lets a stopped session resume', async () => {
      const runTick = vi.fn(async () => makeDelta());
      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 2 });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.get(FAKE_ADDR)!.running).toBe(false);
      expect(runTick).toHaveBeenCalledTimes(2);

      // Restart with a bigger cap — interval unchanged, but the prior cap (2)
      // was reached so the session was stopped. Bumping to 5 should allow
      // 3 more fires.
      store.start({ tokenAddr: FAKE_ADDR, intervalMs: 1_000, runTick, maxTicks: 5 });
      await vi.advanceTimersByTimeAsync(5_000);

      const snap = store.get(FAKE_ADDR)!;
      expect(snap.running).toBe(false);
      expect(snap.tickCount).toBe(5);
      expect(snap.maxTicks).toBe(5);
      expect(runTick).toHaveBeenCalledTimes(5);
    });
  });
});
