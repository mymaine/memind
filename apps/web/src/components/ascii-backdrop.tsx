'use client';

/**
 * Fixed ASCII backdrop. Combines scroll parallax (AC-ISP-8 mini) with a
 * section-aware character palette + Brain-online offset (AC-ISP-9 advanced).
 *
 * Implementation note: the character grid used to be rendered through a
 * `::before { content: '... \A ...' }` rule in globals.css, but a CSS
 * `content` string renders at its natural size and cannot repeat, so on a
 * 1920x1080 viewport the 6-row × 60-char palette only covered the top-left
 * ~720x115 region and the rest of the page was pitch black. We now emit a
 * `<pre>` child whose grid is generated at runtime to the actual viewport
 * dimensions, so the palette + parallax + brain offset all cover the whole
 * screen. The pure `generateAsciiGrid` helper is exported for test.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { SECTION_TOC_ITEMS } from './section-toc';
import { deriveBrainStatus, type BrainStatus } from './brain-status-bar-utils';
import { useRunState } from '@/hooks/useRunStateContext';
import { useSectionObserver } from '@/hooks/useSectionObserver';

/**
 * Per-section character motif. Each motif is repeated across the row, then
 * wrapped to the viewport width. Keep motifs short (2-4 chars) so the
 * repeat boundary is invisible.
 */
const SECTION_MOTIFS: Record<string, string> = {
  hero: '* . ',
  problem: '·   ',
  solution: '→ ← ',
  'brain-architecture': '◉ ',
  'launch-demo': '+ ',
  'order-shill': '+ ',
  'heartbeat-demo': '+ ',
  'take-rate': '$ ',
  'sku-matrix': '$ ',
  'phase-map': '$ ',
  evidence: '✓ ',
};

export function resolveMotif(section: string | null): string {
  const key = section ?? 'hero';
  return SECTION_MOTIFS[key] ?? SECTION_MOTIFS.hero ?? '* . ';
}

/**
 * Build a `rows × cols` text grid tiled from `motif`. Odd rows are offset
 * by one motif so the output does not read as vertical stripes. Pure — no
 * DOM access — so tests can snapshot it.
 */
export function generateAsciiGrid(motif: string, cols: number, rows: number): string {
  if (cols <= 0 || rows <= 0 || motif.length === 0) return '';
  const repeats = Math.ceil(cols / motif.length) + 1;
  const full = motif.repeat(repeats);
  const even = full.slice(0, cols);
  const odd = full.slice(1, cols + 1);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    lines.push(i % 2 === 0 ? even : odd);
  }
  return lines.join('\n');
}

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
  /** Viewport cols — pass from the runtime shell. Defaults to 80 for SSR. */
  readonly cols?: number;
  /** Viewport rows — pass from the runtime shell. Defaults to 40 for SSR. */
  readonly rows?: number;
}

/**
 * Pure view. `activeSection` falls back to `hero` so CSS always has a
 * concrete palette key. The `<pre>` child carries the actual character
 * grid; `data-section` + `data-brain` are retained on the root so any
 * future CSS-only affordance can key off them.
 */
export function AsciiBackdropView(props: AsciiBackdropViewProps): ReactElement {
  const section = props.activeSection ?? 'hero';
  const motif = resolveMotif(section);
  const cols = props.cols ?? 80;
  const rows = props.rows ?? 40;
  const grid = generateAsciiGrid(motif, cols, rows);
  return (
    <div
      className="ascii-backdrop"
      aria-hidden="true"
      data-section={section}
      data-brain={props.brainStatus}
    >
      <pre className="ascii-backdrop-grid">{grid}</pre>
    </div>
  );
}

// Module-level tuple so useSectionObserver gets a stable reference.
const SECTION_IDS: readonly string[] = SECTION_TOC_ITEMS.map((item) => item.id);

// Approximate char/line dimensions at 12px JetBrains Mono, line-height 1.6.
// A bit loose so the grid comfortably over-fills the viewport even if the
// browser font metrics differ. +20% safety margin.
const CHAR_WIDTH_PX = 7.2;
const LINE_HEIGHT_PX = 19.2;

export function AsciiBackdrop(): ReactElement {
  const activeSection = useSectionObserver(SECTION_IDS);
  const runState = useRunState();
  const brainStatus = deriveBrainStatus(runState);
  const [size, setSize] = useState({ cols: 240, rows: 80 });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const recalc = (): void => {
      setSize({
        cols: Math.ceil(window.innerWidth / CHAR_WIDTH_PX) + 8,
        rows: Math.ceil(window.innerHeight / LINE_HEIGHT_PX) + 4,
      });
    };
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, []);

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

  return (
    <AsciiBackdropView
      activeSection={activeSection}
      brainStatus={brainStatus}
      cols={size.cols}
      rows={size.rows}
    />
  );
}
