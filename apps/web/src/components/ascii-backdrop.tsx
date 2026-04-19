'use client';

/**
 * Fixed ASCII backdrop. Combines scroll parallax (AC-ISP-8 mini) with a
 * section-aware character palette + Brain-online offset (AC-ISP-9 advanced).
 *
 * `.ascii-backdrop::before` in globals.css paints the character grid; the
 * view writes `data-section` + `data-brain` so attribute-selector rules
 * swap the palette and nudge the layer toward the Header Brain indicator.
 * `AsciiBackdropView` is pure (SSR / node-testable); the scroll controller
 * skips installing when `prefers-reduced-motion` is ON.
 */
import { useEffect, type ReactElement } from 'react';
import { SECTION_TOC_ITEMS } from './section-toc';
import { deriveBrainStatus, type BrainStatus } from './brain-status-bar-utils';
import { useRunState } from '@/hooks/useRunStateContext';
import { useSectionObserver } from '@/hooks/useSectionObserver';

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

export interface AsciiBackdropViewProps {
  readonly activeSection: string | null;
  readonly brainStatus: BrainStatus;
}

/**
 * Pure view. `activeSection` falls back to `hero` so CSS always has a
 * concrete palette key — matches the pre-scroll reading experience where the
 * top of the page is Hero.
 */
export function AsciiBackdropView(props: AsciiBackdropViewProps): ReactElement {
  const section = props.activeSection ?? 'hero';
  return (
    <div
      className="ascii-backdrop"
      aria-hidden="true"
      data-section={section}
      data-brain={props.brainStatus}
    />
  );
}

// Module-level tuple so useSectionObserver gets a stable reference.
const SECTION_IDS: readonly string[] = SECTION_TOC_ITEMS.map((item) => item.id);

export function AsciiBackdrop(): ReactElement {
  const activeSection = useSectionObserver(SECTION_IDS);
  const runState = useRunState();
  const brainStatus = deriveBrainStatus(runState);

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

  return <AsciiBackdropView activeSection={activeSection} brainStatus={brainStatus} />;
}
