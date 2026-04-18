/**
 * Unit tests for `resetRun` — the V4.7-P4 Task 1 addition to useRun.
 *
 * The hook owns a live EventSource (via `esRef`) and an in-flight guard
 * (`startingRef`). Rather than spin up React (no jsdom / no RTL in this repo,
 * per vitest.config.ts), we extract the imperative reset side effect into a
 * pure helper `performRunReset({ esRef, startingRef, setState })` exported
 * from `useRun-state.ts`. The hook wires real refs into the helper; the tests
 * feed mutable `{ current: ... }` objects plus a `vi.fn()` setState to verify
 * every side effect (EventSource.close() called, ref nulled, startingRef
 * cleared, state set to IDLE_STATE) across the four spec-mandated starting
 * phases: idle, running, done, error.
 *
 * Covered cases (see spec §V4.7-P4 risk row for useRun.resetRun):
 *   1. idle start — close is never called (ref is null), state reset anyway
 *   2. running start — close called exactly once, ref nulled
 *   3. done start — status handler already nulled ref; reset is idle-safe
 *   4. error start — same as done (ref already nulled in production path)
 *   5. startingRef is always cleared so a subsequent startRun can enter
 *   6. Running case: close is called exactly once (no leak, no double-close)
 */
import { describe, it, expect, vi } from 'vitest';
import { IDLE_STATE, performRunReset, type RunState } from './useRun-state.js';

type MockEventSource = { close: ReturnType<typeof vi.fn> };

function makeRefs(opts: { es: MockEventSource | null; starting: boolean }) {
  const esRef = { current: opts.es as unknown as EventSource | null };
  const startingRef = { current: opts.starting };
  const setState = vi.fn<(next: RunState) => void>();
  return { esRef, startingRef, setState };
}

function makeMockEventSource(): MockEventSource {
  return { close: vi.fn() };
}

describe('IDLE_STATE', () => {
  it('is a well-formed idle RunState', () => {
    expect(IDLE_STATE.phase).toBe('idle');
    expect(IDLE_STATE.logs).toEqual([]);
    expect(IDLE_STATE.artifacts).toEqual([]);
    expect(IDLE_STATE.runId).toBeNull();
    expect(IDLE_STATE.error).toBeNull();
  });
});

describe('performRunReset — idle start', () => {
  it('is a no-op on EventSource (ref is null) but still clears state and startingRef', () => {
    const { esRef, startingRef, setState } = makeRefs({ es: null, starting: false });
    performRunReset({ esRef, startingRef, setState });
    expect(esRef.current).toBeNull();
    expect(startingRef.current).toBe(false);
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith(IDLE_STATE);
  });
});

describe('performRunReset — running start', () => {
  it('closes the live EventSource and nulls the ref', () => {
    const es = makeMockEventSource();
    const { esRef, startingRef, setState } = makeRefs({ es, starting: true });
    performRunReset({ esRef, startingRef, setState });
    expect(es.close).toHaveBeenCalledTimes(1);
    expect(esRef.current).toBeNull();
    expect(startingRef.current).toBe(false);
    expect(setState).toHaveBeenCalledWith(IDLE_STATE);
  });

  it('calls EventSource.close exactly once (no double-close, no leak)', () => {
    const es = makeMockEventSource();
    const { esRef, startingRef, setState } = makeRefs({ es, starting: true });
    performRunReset({ esRef, startingRef, setState });
    expect(es.close).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledTimes(1);
  });
});

describe('performRunReset — done start', () => {
  it('handles the ref-already-nulled case (status handler closed ES on done) idempotently', () => {
    // In production, the `status` event handler for `done` already calls
    // `es.close()` and sets `esRef.current = null`. A subsequent resetRun()
    // must not crash and must still reset the state to idle.
    const { esRef, startingRef, setState } = makeRefs({ es: null, starting: false });
    performRunReset({ esRef, startingRef, setState });
    expect(esRef.current).toBeNull();
    expect(setState).toHaveBeenCalledWith(IDLE_STATE);
  });
});

describe('performRunReset — error start', () => {
  it('handles the ref-already-nulled case (status handler closed ES on error) idempotently', () => {
    // Same contract as done: the error-status handler in useRun already nulls
    // esRef.current before the user gets a chance to press `Run another`.
    const { esRef, startingRef, setState } = makeRefs({ es: null, starting: false });
    performRunReset({ esRef, startingRef, setState });
    expect(esRef.current).toBeNull();
    expect(setState).toHaveBeenCalledWith(IDLE_STATE);
  });
});

describe('performRunReset — startingRef clearance', () => {
  it('resets startingRef so a subsequent startRun can enter the critical section', () => {
    // Simulate the edge case where a reset fires while startRun is mid-flight
    // (e.g. between fetch resolve and EventSource wire-up). The hook's
    // try/finally already sets startingRef=false, but reset must guarantee it
    // regardless so the next startRun is not permanently locked out.
    const { esRef, startingRef, setState } = makeRefs({ es: null, starting: true });
    performRunReset({ esRef, startingRef, setState });
    expect(startingRef.current).toBe(false);
    expect(setState).toHaveBeenCalledWith(IDLE_STATE);
  });
});

describe('useRun module exports', () => {
  it('exports resetRun on the UseRunResult shape (surface check via type import)', async () => {
    const mod = await import('./useRun.js');
    // The hook itself is only fully exercisable inside a React tree; here we
    // only assert the module exports `useRun` as a function (the consumer-
    // facing surface). The resetRun method is validated by the performRunReset
    // tests above, which cover the imperative core the hook delegates to.
    expect(typeof mod.useRun).toBe('function');
  });
});
