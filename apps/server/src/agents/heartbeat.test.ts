import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { logEventSchema, type LogEvent } from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { HeartbeatAgent } from './heartbeat.js';
import type { AgentLoopResult, runAgentLoop } from './runtime.js';

/**
 * Build a minimal AgentLoopResult stub so the heartbeat tests can focus on
 * scheduling / error handling behaviour without touching the real runtime.
 */
function okLoopResult(): AgentLoopResult {
  return {
    finalText: 'ok',
    toolCalls: [],
    trace: [],
    stopReason: 'end_turn',
  };
}

function makeAgent(overrides: {
  runAgentLoopImpl: ReturnType<typeof vi.fn>;
  onLog?: (event: LogEvent) => void;
  intervalMs?: number;
}): HeartbeatAgent {
  return new HeartbeatAgent({
    // Anthropic client is never invoked directly when runAgentLoopImpl is stubbed.
    client: {} as unknown as Anthropic,
    model: 'test-model',
    registry: new ToolRegistry(),
    systemPrompt: 'tick system prompt',
    buildUserInput: ({ tickId }) => `tick ${tickId}`,
    intervalMs: overrides.intervalMs ?? 1000,
    onLog: overrides.onLog,
    runAgentLoopImpl: overrides.runAgentLoopImpl as unknown as typeof runAgentLoop,
  });
}

describe('HeartbeatAgent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tick() executes runAgentLoopImpl exactly once and increments successCount', async () => {
    const runAgentLoopImpl = vi.fn(async () => okLoopResult());
    const agent = makeAgent({ runAgentLoopImpl });

    await agent.tick();

    expect(runAgentLoopImpl).toHaveBeenCalledTimes(1);
    expect(agent.state.successCount).toBe(1);
    expect(agent.state.errorCount).toBe(0);
    expect(agent.state.lastError).toBeNull();
    expect(agent.state.lastTickId).toMatch(/^tick_/);
    expect(agent.state.lastTickAt).not.toBeNull();
  });

  it('tick() swallows runAgentLoopImpl errors and records them in state', async () => {
    const runAgentLoopImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const agent = makeAgent({ runAgentLoopImpl });

    // Explicit tick() call must not bubble the error to the caller.
    await expect(agent.tick()).resolves.toBeUndefined();

    expect(agent.state.errorCount).toBe(1);
    expect(agent.state.successCount).toBe(0);
    expect(agent.state.lastError).toBe('boom');

    // A second tick accumulates and keeps the latest message.
    await agent.tick();
    expect(agent.state.errorCount).toBe(2);
    expect(agent.state.lastError).toBe('boom');
  });

  it('start() keeps running even when the first tick throws', async () => {
    const runAgentLoopImpl = vi.fn(async () => {
      throw new Error('boot-fail');
    });
    const agent = makeAgent({ runAgentLoopImpl });
    agent.start();

    // Drain the fire-and-forget first tick microtasks without advancing time.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(agent.running).toBe(true);
    expect(agent.state.errorCount).toBe(1);
    expect(agent.state.lastError).toBe('boot-fail');

    await agent.shutdown();
  });

  it('start() is idempotent — only one interval scheduled', async () => {
    const runAgentLoopImpl = vi.fn(async () => okLoopResult());
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const agent = makeAgent({ runAgentLoopImpl, intervalMs: 1000 });
    agent.start();
    agent.start();
    agent.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await agent.shutdown();
    setIntervalSpy.mockRestore();
  });

  it('shutdown() clears the interval so no further ticks fire', async () => {
    const runAgentLoopImpl = vi.fn(async () => okLoopResult());
    const agent = makeAgent({ runAgentLoopImpl, intervalMs: 1000 });

    agent.start();
    // Flush the immediate first tick scheduled as a microtask.
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    const callsAfterStart = runAgentLoopImpl.mock.calls.length;

    await agent.shutdown();
    expect(agent.running).toBe(false);

    // Advance well past the interval — zero additional invocations expected.
    await vi.advanceTimersByTimeAsync(5000);
    expect(runAgentLoopImpl.mock.calls.length).toBe(callsAfterStart);

    // Idempotent — second shutdown is a no-op.
    await expect(agent.shutdown()).resolves.toBeUndefined();
  });

  it('scheduler skips overlapping ticks while a previous tick is still in flight', async () => {
    const release: { fn: (() => void) | null } = { fn: null };
    const runAgentLoopImpl = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release.fn = resolve;
      });
      return okLoopResult();
    });

    const agent = makeAgent({ runAgentLoopImpl, intervalMs: 1000 });
    agent.start();

    // Let the fire-and-forget first tick latch onto the pending promise.
    await Promise.resolve();
    await Promise.resolve();
    expect(runAgentLoopImpl).toHaveBeenCalledTimes(1);

    // Advance timers past two interval boundaries: the scheduled callbacks
    // should see isTickRunning=true and increment skippedCount instead of
    // kicking off parallel ticks.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(runAgentLoopImpl).toHaveBeenCalledTimes(1);
    expect(agent.state.skippedCount).toBeGreaterThanOrEqual(1);

    // Let the in-flight tick resolve and shut down cleanly.
    release.fn?.();
    await Promise.resolve();
    await Promise.resolve();
    await agent.shutdown();
  });

  it('start() then synchronous shutdown() leaks no scheduler-triggered ticks', async () => {
    // Regression for the Fix 5 race: if the scheduler callback does not
    // re-check `_running` at the top, a timer fire queued milliseconds
    // before shutdown() can still kick off a tick *after* clearInterval
    // has been called. We force that window by calling shutdown() inside
    // the same microtask as start() and then advancing fake time past 10
    // full interval boundaries. Expected: zero additional scheduler ticks.
    const runAgentLoopImpl = vi.fn(async () => okLoopResult());
    const intervalMs = 10;
    const agent = makeAgent({ runAgentLoopImpl, intervalMs });

    agent.start();
    // No await — shutdown runs in the same microtask as start().
    void agent.shutdown();

    // Drain the fire-and-forget first tick's microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const callsAfterShutdown = runAgentLoopImpl.mock.calls.length;

    // Advance well past 10 interval boundaries. Any interval leak surfaces
    // as extra runAgentLoopImpl invocations here.
    await vi.advanceTimersByTimeAsync(intervalMs * 10);
    await vi.advanceTimersByTimeAsync(intervalMs * 10);

    expect(runAgentLoopImpl.mock.calls.length).toBe(callsAfterShutdown);
    expect(agent.running).toBe(false);
  });

  it('emits LogEvents that all satisfy logEventSchema', async () => {
    const logs: LogEvent[] = [];
    const runAgentLoopImpl = vi.fn(async () => okLoopResult());
    const agent = makeAgent({
      runAgentLoopImpl,
      onLog: (event) => logs.push(event),
    });

    await agent.tick();

    // Also exercise the error path so both success + failure log shapes run
    // through the schema validator.
    const failingLoop = vi.fn(async () => {
      throw new Error('nope');
    });
    const failingAgent = new HeartbeatAgent({
      client: {} as unknown as Anthropic,
      model: 'test-model',
      registry: new ToolRegistry(),
      systemPrompt: 'p',
      buildUserInput: () => 'x',
      intervalMs: 1000,
      onLog: (event) => logs.push(event),
      runAgentLoopImpl: failingLoop as unknown as typeof runAgentLoop,
    });
    await failingAgent.tick();
    await failingAgent.shutdown();

    expect(logs.length).toBeGreaterThan(0);
    for (const event of logs) {
      expect(() => logEventSchema.parse(event)).not.toThrow();
      expect(event.agent).toBe('heartbeat');
    }
    // At least one tick-lifecycle log should mention "tick".
    expect(logs.some((e) => e.message.includes('tick'))).toBe(true);
  });
});
