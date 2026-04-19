'use client';

/**
 * Shared rAF-batched `window.scrollY` source for the sticky-stage
 * scrollytelling surface (memind-scrollytelling-rebuild AC-MSR-1).
 *
 * The design-handoff `StickyStage` computes each chapter's opacity/scale/blur
 * from a single scrollY scalar. Every scroll event dispatches at native
 * frequency (60-120 Hz on desktop), so we coalesce bursts into one React
 * re-render per animation frame to keep the stage cheap even when the viewer
 * scrolls fast.
 *
 * Split into a framework-free controller + a thin React shell so the rAF
 * gating is node-testable without jsdom (same convention as
 * `useScrollProgress`).
 *
 * Port reference: `docs/design/memind-handoff/project/components/app.jsx`
 * lines 9-20.
 */
import { useEffect, useState } from 'react';

export interface ScrollYControllerDeps {
  readonly getScrollY: () => number;
  readonly setY: (y: number) => void;
  readonly raf: (cb: FrameRequestCallback) => number;
  readonly caf: (handle: number) => void;
}

export interface ScrollYController {
  /** Read scrollY immediately and push the value once. */
  readonly sync: () => void;
  /** Called from the scroll listener; coalesces bursts via rAF. */
  readonly handleScroll: () => void;
  /** Cancel any pending rAF frame. Call from the React cleanup. */
  readonly dispose: () => void;
}

export function createScrollYController(deps: ScrollYControllerDeps): ScrollYController {
  let pendingRaf: number | null = null;

  const flush = (): void => {
    pendingRaf = null;
    deps.setY(deps.getScrollY());
  };

  return {
    sync() {
      deps.setY(deps.getScrollY());
    },
    handleScroll() {
      if (pendingRaf !== null) return;
      pendingRaf = deps.raf(flush);
    },
    dispose() {
      if (pendingRaf !== null) {
        deps.caf(pendingRaf);
        pendingRaf = null;
      }
    },
  };
}

/**
 * Subscribe to `window.scrollY` with rAF coalescing. Returns the latest
 * scroll offset as a `number` (0 on SSR / before the first effect runs).
 */
export function useScrollY(): number {
  const [y, setY] = useState(0);

  useEffect(() => {
    // SSR guard — no window on the server.
    if (typeof window === 'undefined') return;

    const controller = createScrollYController({
      getScrollY: () => window.scrollY || window.pageYOffset || 0,
      setY,
      raf: window.requestAnimationFrame.bind(window),
      caf: window.cancelAnimationFrame.bind(window),
    });

    // Align with the real scroll position after hydration (handles
    // reloads mid-page where scrollY starts non-zero).
    controller.sync();
    window.addEventListener('scroll', controller.handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', controller.handleScroll);
      controller.dispose();
    };
  }, []);

  return y;
}
