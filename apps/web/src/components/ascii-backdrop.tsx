'use client';

/**
 * Fixed ASCII backdrop with rAF-throttled scroll parallax (AC-ISP-8).
 * `.ascii-backdrop::before` in globals.css paints the character grid; this
 * component writes `--scroll-y` for the parallax transform. Users with
 * `prefers-reduced-motion` get a static frame — no listener attached. Pure
 * controller split matches useScrollProgress so node-env vitest can drive
 * every branch via injected fakes.
 */
import { useEffect, type ReactElement } from 'react';

export interface AsciiBackdropControllerDeps {
  readonly reducedMotion: () => boolean;
  readonly addScrollListener: (h: () => void, o: { passive: true }) => void;
  readonly removeScrollListener: (h: () => void) => void;
  readonly setScrollVar: (v: number) => void;
  readonly getScrollY: () => number;
  readonly raf: (cb: () => void) => number;
  readonly caf: (handle: number) => void;
}

export function createAsciiBackdropController(deps: AsciiBackdropControllerDeps): {
  install: () => () => void;
} {
  return {
    install() {
      if (deps.reducedMotion()) return () => {};
      let pending: number | null = null;
      const handler = (): void => {
        if (pending !== null) return;
        pending = deps.raf(() => {
          pending = null;
          deps.setScrollVar(deps.getScrollY());
        });
      };
      deps.addScrollListener(handler, { passive: true });
      return () => {
        deps.removeScrollListener(handler);
        if (pending !== null) deps.caf(pending);
      };
    },
  };
}

export function AsciiBackdrop(): ReactElement {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    return createAsciiBackdropController({
      reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      addScrollListener: (h, o) => window.addEventListener('scroll', h, o),
      removeScrollListener: (h) => window.removeEventListener('scroll', h),
      setScrollVar: (v) => document.documentElement.style.setProperty('--scroll-y', String(v)),
      getScrollY: () => window.scrollY,
      raf: window.requestAnimationFrame.bind(window),
      caf: window.cancelAnimationFrame.bind(window),
    }).install();
  }, []);
  return <div className="ascii-backdrop" aria-hidden="true" />;
}
