'use client';

/**
 * SSR-safe `prefers-reduced-motion` detection.
 *
 * The React hook is a thin wrapper around `createReducedMotionController` — the
 * controller is the unit-testable surface (vitest runs in node env; there is
 * no real window / matchMedia). Tests drive the controller directly with an
 * injected `getMql` factory.
 *
 * Default during SSR / initial render: `false`. We do not read matchMedia on
 * mount via useLayoutEffect to avoid hydration mismatches — if the real value
 * ends up being `true`, the first client paint may briefly show the animated
 * variant; the switch to the static variant happens one frame later via
 * useSyncExternalStore. That flash is acceptable (spec: WCAG AA) and cheap.
 */
import { useSyncExternalStore } from 'react';

type MinimalMql = {
  matches: boolean;
  addEventListener: (type: 'change', cb: (e: { matches: boolean }) => void) => void;
  removeEventListener: (type: 'change', cb: (e: { matches: boolean }) => void) => void;
};

export interface ReducedMotionController {
  getSnapshot: () => boolean;
  subscribe: (onChange: () => void) => () => void;
}

/**
 * Pure controller. `getMql` must return `null` when no browser environment is
 * available (SSR, Node test). Returning null short-circuits both getSnapshot
 * and subscribe.
 */
export function createReducedMotionController(
  getMql: () => MinimalMql | null,
): ReducedMotionController {
  return {
    getSnapshot(): boolean {
      const mql = getMql();
      return mql ? mql.matches : false;
    },
    subscribe(onChange: () => void): () => void {
      const mql = getMql();
      if (!mql) return () => {};
      const handler = (): void => onChange();
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    },
  };
}

// Browser singleton — resolved lazily so this module is SSR-safe.
function browserMql(): MinimalMql | null {
  if (typeof window === 'undefined') return null;
  // window.matchMedia is unavailable in very old browsers; guard defensively.
  if (typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

const BROWSER_CONTROLLER: ReducedMotionController = createReducedMotionController(browserMql);

export function useReducedMotion(): boolean {
  // getServerSnapshot returns false — matches SSR contract and avoids mismatch.
  return useSyncExternalStore(
    BROWSER_CONTROLLER.subscribe,
    BROWSER_CONTROLLER.getSnapshot,
    () => false,
  );
}
