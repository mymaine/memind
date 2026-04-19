'use client';

/**
 * Fixed ASCII backdrop — sparse-starfield aesthetic.
 *
 * Design intent (post-scrollytelling rebuild):
 *   - Completely static: no scroll parallax, no scroll listener. The old
 *     parallax pushed the grid off the bottom of long pages and clashed
 *     with the new sticky-pinned scrollytelling layout.
 *   - Sparse: glyph density per section is ~6-12%, not 100%. The feel is
 *     deep space with occasional characters, not a character matrix.
 *   - Deterministic: a tiny seeded PRNG picks the same positions for the
 *     same `(section, cols, rows)` so the grid does not shimmer on every
 *     React re-render.
 *   - Still section-aware: each section owns a glyph palette; the view
 *     swaps palette + emits `data-section` / `data-brain` for any future
 *     CSS-only affordance.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { CHAPTER_META } from '@/lib/chapters';
import { deriveBrainStatus, type BrainStatus } from './brain-status-bar-utils';
import { useRunState } from '@/hooks/useRunStateContext';
import { useSectionObserver } from '@/hooks/useSectionObserver';

export interface SectionPalette {
  readonly glyphs: readonly string[];
  /** Fraction of cells that carry a glyph (0..1). Rest stay blank. */
  readonly density: number;
}

/**
 * Per-section visual palette. `glyphs` is sampled uniformly; `density` is
 * the fraction of grid cells that carry any glyph at all. Keep densities
 * low (≤ 0.12) so the backdrop reads as atmosphere, not content.
 */
const SECTION_PALETTES: Record<string, SectionPalette> = {
  hero: { glyphs: ['*', '·', '.', '✦'], density: 0.08 },
  problem: { glyphs: ['·', ' '], density: 0.05 },
  solution: { glyphs: ['→', '←', '·'], density: 0.06 },
  'brain-architecture': { glyphs: ['◉', '·', '∙'], density: 0.06 },
  'launch-demo': { glyphs: ['+', '·'], density: 0.08 },
  'order-shill': { glyphs: ['+', '·'], density: 0.08 },
  'heartbeat-demo': { glyphs: ['+', '·'], density: 0.08 },
  'take-rate': { glyphs: ['$', '·'], density: 0.06 },
  'sku-matrix': { glyphs: ['$', '·'], density: 0.06 },
  'phase-map': { glyphs: ['$', '·'], density: 0.06 },
  evidence: { glyphs: ['✓', '·'], density: 0.07 },
};

export function resolvePalette(section: string | null): SectionPalette {
  const key = section ?? 'hero';
  return SECTION_PALETTES[key] ?? SECTION_PALETTES.hero!;
}

// Tiny deterministic PRNG (mulberry32). Given the same seed it emits the
// same sequence, so we can re-render without the stars shimmering.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return (): number => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash the section key into a small int so each section has a distinct
// but stable star pattern.
function hashSeed(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = (h ^ key.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Build a sparse `rows × cols` grid by picking per-cell glyph-or-blank
 * using a seeded PRNG. Pure — exported so tests can snapshot deterministic
 * output.
 */
export function generateAsciiGrid(palette: SectionPalette, cols: number, rows: number): string {
  if (cols <= 0 || rows <= 0 || palette.glyphs.length === 0) return '';
  const seed = hashSeed(palette.glyphs.join('|') + '::' + cols + 'x' + rows);
  const rand = mulberry32(seed);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      if (rand() < palette.density) {
        const idx = Math.floor(rand() * palette.glyphs.length);
        line += palette.glyphs[idx] ?? ' ';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
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
 * Pure view. Renders a sparse deterministic glyph grid sized to the
 * passed `cols × rows`. Completely static — no scroll listener, no CSS
 * variable writes — so nothing moves when the user scrolls.
 */
export function AsciiBackdropView(props: AsciiBackdropViewProps): ReactElement {
  const section = props.activeSection ?? 'hero';
  const palette = resolvePalette(section);
  const cols = props.cols ?? 80;
  const rows = props.rows ?? 40;
  const grid = generateAsciiGrid(palette, cols, rows);
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
const SECTION_IDS: readonly string[] = CHAPTER_META.map((item) => item.id);

// Approximate char/line dimensions at 12px JetBrains Mono, line-height 1.6.
// Loose so the grid comfortably over-fills the viewport even if browser
// font metrics differ. +20% safety margin.
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

  return (
    <AsciiBackdropView
      activeSection={activeSection}
      brainStatus={brainStatus}
      cols={size.cols}
      rows={size.rows}
    />
  );
}
