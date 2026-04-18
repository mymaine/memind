/**
 * SSR-safe `prefers-reduced-motion` detection. The hook itself is a thin
 * useSyncExternalStore wrapper; the pure controller exported alongside it is
 * what we unit-test (vitest runs in node env — no real matchMedia).
 *
 * Controller behavior:
 *   - If `getMql` returns null (no window), getSnapshot() returns false.
 *   - If the MediaQueryList reports `.matches === true`, snapshot is true.
 *   - `subscribe` wires listener + returns an unsubscribe that removes it.
 */
import { describe, it, expect, vi } from 'vitest';
import { createReducedMotionController } from './useReducedMotion.js';

function makeMql(initial: boolean) {
  type Listener = (e: { matches: boolean }) => void;
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    addEventListener: vi.fn((_type: string, cb: Listener) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: string, cb: Listener) => listeners.delete(cb)),
  };
  return {
    mql,
    emit(matches: boolean) {
      mql.matches = matches;
      for (const cb of listeners) cb({ matches });
    },
    listenerCount: () => listeners.size,
  };
}

describe('createReducedMotionController (SSR / no window)', () => {
  it('returns false when getMql returns null', () => {
    const ctrl = createReducedMotionController(() => null);
    expect(ctrl.getSnapshot()).toBe(false);
  });

  it('subscribe is a no-op when getMql returns null', () => {
    const ctrl = createReducedMotionController(() => null);
    const cb = vi.fn();
    const unsubscribe = ctrl.subscribe(cb);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe(); // should not throw
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('createReducedMotionController (with MediaQueryList)', () => {
  it('reflects the initial .matches value', () => {
    const { mql } = makeMql(true);
    const ctrl = createReducedMotionController(() => mql);
    expect(ctrl.getSnapshot()).toBe(true);
  });

  it('flips snapshot after the mql dispatches a change', () => {
    const { mql, emit } = makeMql(false);
    const ctrl = createReducedMotionController(() => mql);
    expect(ctrl.getSnapshot()).toBe(false);
    // subscribe must be active for subsequent snapshot reads.
    const onChange = vi.fn();
    ctrl.subscribe(onChange);
    emit(true);
    expect(ctrl.getSnapshot()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the listener', () => {
    const h = makeMql(false);
    const ctrl = createReducedMotionController(() => h.mql);
    const cb = vi.fn();
    const unsubscribe = ctrl.subscribe(cb);
    expect(h.listenerCount()).toBe(1);
    unsubscribe();
    expect(h.listenerCount()).toBe(0);
  });
});
