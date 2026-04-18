'use client';

/**
 * Track whether the page has been scrolled past a threshold in CSS pixels.
 *
 * Backs AC-P4.7-1 (Header scroll-blur flips on after scrollY > 80). Returns
 * false on the initial render so SSR and the first hydration pass agree even
 * when the user reloads mid-page; a post-mount effect then reads window.scrollY
 * once to align state with the real scroll position. Scroll events are
 * debounced through requestAnimationFrame so a burst of native events
 * collapses into one re-render.
 */
import { useEffect, useState } from 'react';

/** Pure threshold check extracted so the math is trivially testable. */
export function shouldBeScrolled(scrollY: number, threshold: number): boolean {
  return scrollY > threshold;
}

export interface ScrollProgressControllerDeps {
  readonly threshold: number;
  readonly getScrollY: () => number;
  readonly setScrolled: (value: boolean) => void;
  readonly raf: (cb: FrameRequestCallback) => number;
  readonly caf: (handle: number) => void;
}

export interface ScrollProgressController {
  /** Read scrollY immediately and push the derived boolean once. */
  readonly sync: () => void;
  /** Called from the scroll listener; coalesces bursts via rAF. */
  readonly handleScroll: () => void;
  /** Cancel any pending rAF frame. Call from the React cleanup. */
  readonly dispose: () => void;
}

/**
 * Pure controller around the rAF-debounced scroll state machine. The React
 * hook below plumbs real browser APIs into it; tests inject fakes so we can
 * drive every branch without a DOM.
 */
export function createScrollProgressController(
  deps: ScrollProgressControllerDeps,
): ScrollProgressController {
  let pendingRaf: number | null = null;

  const flush = (): void => {
    pendingRaf = null;
    deps.setScrolled(shouldBeScrolled(deps.getScrollY(), deps.threshold));
  };

  return {
    sync() {
      deps.setScrolled(shouldBeScrolled(deps.getScrollY(), deps.threshold));
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

export function useScrollProgress(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // SSR guard: on the server there is no window; bail before touching it.
    if (typeof window === 'undefined') return;

    const controller = createScrollProgressController({
      threshold,
      getScrollY: () => window.scrollY,
      setScrolled,
      raf: window.requestAnimationFrame.bind(window),
      caf: window.cancelAnimationFrame.bind(window),
    });

    // Align with the real scroll position after hydration.
    controller.sync();
    window.addEventListener('scroll', controller.handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', controller.handleScroll);
      controller.dispose();
    };
  }, [threshold]);

  return scrolled;
}
