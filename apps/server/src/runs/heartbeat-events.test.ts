import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HeartbeatSessionState,
  HeartbeatTickDelta,
} from '../state/heartbeat-session-store.js';
import { HeartbeatEventBus, type HeartbeatTickEvent } from './heartbeat-events.js';

/**
 * HeartbeatEventBus unit tests — covers the four contract guarantees:
 *   1. subscribe + emit delivery
 *   2. unsubscribe stops delivery and drops the per-token set when empty
 *   3. multi-subscriber fan-out with independent unsubscribe
 *   4. listener error isolation: one throw must not poison peers
 */

const TOKEN = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';

function makeSnapshot(overrides: Partial<HeartbeatSessionState> = {}): HeartbeatSessionState {
  return {
    tokenAddr: TOKEN,
    intervalMs: 10_000,
    startedAt: '2026-04-20T00:00:00.000Z',
    running: true,
    maxTicks: 5,
    tickCount: 1,
    successCount: 1,
    errorCount: 0,
    skippedCount: 0,
    lastTickAt: '2026-04-20T00:00:01.000Z',
    lastTickId: 'tick_1',
    lastAction: null,
    lastError: null,
    ...overrides,
  };
}

function makeDelta(overrides: Partial<HeartbeatTickDelta> = {}): HeartbeatTickDelta {
  return {
    tickId: 'tick_1',
    tickAt: '2026-04-20T00:00:01.000Z',
    success: true,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<HeartbeatTickEvent> = {}): HeartbeatTickEvent {
  return {
    tokenAddr: TOKEN,
    snapshot: makeSnapshot(),
    delta: makeDelta(),
    emittedAt: '2026-04-20T00:00:01.050Z',
    ...overrides,
  };
}

describe('HeartbeatEventBus', () => {
  let bus: HeartbeatEventBus;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    bus?.clear();
    warnSpy?.mockRestore();
  });

  it('subscribes and delivers every emitted event verbatim', () => {
    bus = new HeartbeatEventBus();
    const listener = vi.fn<(event: HeartbeatTickEvent) => void>();
    bus.subscribe(TOKEN, listener);

    const event = makeEvent();
    bus.emit(TOKEN, event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('normalises mixed-case addresses when subscribing and emitting', () => {
    bus = new HeartbeatEventBus();
    const upper = TOKEN.toUpperCase();
    const listener = vi.fn<(event: HeartbeatTickEvent) => void>();
    bus.subscribe(upper, listener);

    bus.emit(TOKEN, makeEvent());
    expect(listener).toHaveBeenCalledTimes(1);

    // Also works the other way: subscribe lowercase, emit uppercase.
    const otherListener = vi.fn<(event: HeartbeatTickEvent) => void>();
    bus.subscribe(TOKEN, otherListener);
    bus.emit(upper, makeEvent());
    expect(otherListener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery and cleans up the per-token set', () => {
    bus = new HeartbeatEventBus();
    const listener = vi.fn<(event: HeartbeatTickEvent) => void>();
    const unsubscribe = bus.subscribe(TOKEN, listener);

    expect(bus.subscriberCount(TOKEN)).toBe(1);
    unsubscribe();
    expect(bus.subscriberCount(TOKEN)).toBe(0);

    bus.emit(TOKEN, makeEvent());
    expect(listener).not.toHaveBeenCalled();

    // Second unsubscribe is a no-op — must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });

  it('fans events out to every subscriber and supports independent unsubscribe', () => {
    bus = new HeartbeatEventBus();
    const listenerA = vi.fn<(event: HeartbeatTickEvent) => void>();
    const listenerB = vi.fn<(event: HeartbeatTickEvent) => void>();
    const unsubA = bus.subscribe(TOKEN, listenerA);
    bus.subscribe(TOKEN, listenerB);

    const event1 = makeEvent({ delta: makeDelta({ tickId: 'tick_1' }) });
    bus.emit(TOKEN, event1);
    expect(listenerA).toHaveBeenCalledWith(event1);
    expect(listenerB).toHaveBeenCalledWith(event1);

    unsubA();
    const event2 = makeEvent({ delta: makeDelta({ tickId: 'tick_2' }) });
    bus.emit(TOKEN, event2);
    expect(listenerA).toHaveBeenCalledTimes(1); // not called again
    expect(listenerB).toHaveBeenCalledTimes(2);
  });

  it('isolates listener errors so a thrower does not break peer delivery', () => {
    bus = new HeartbeatEventBus();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = vi.fn<(event: HeartbeatTickEvent) => void>(() => {
      throw new Error('listener boom');
    });
    const healthy = vi.fn<(event: HeartbeatTickEvent) => void>();
    bus.subscribe(TOKEN, throwing);
    bus.subscribe(TOKEN, healthy);

    const event = makeEvent();
    expect(() => bus.emit(TOKEN, event)).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledWith(event);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('emit with no subscribers for the token is a silent no-op', () => {
    bus = new HeartbeatEventBus();
    expect(() => bus.emit(TOKEN, makeEvent())).not.toThrow();
  });

  it('clear drops every subscriber across tokens', () => {
    bus = new HeartbeatEventBus();
    const other = '0x1111111111111111111111111111111111111111';
    const listenerA = vi.fn<(event: HeartbeatTickEvent) => void>();
    const listenerB = vi.fn<(event: HeartbeatTickEvent) => void>();
    bus.subscribe(TOKEN, listenerA);
    bus.subscribe(other, listenerB);

    bus.clear();

    expect(bus.subscriberCount(TOKEN)).toBe(0);
    expect(bus.subscriberCount(other)).toBe(0);
    bus.emit(TOKEN, makeEvent());
    bus.emit(other, makeEvent({ tokenAddr: other }));
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).not.toHaveBeenCalled();
  });
});
