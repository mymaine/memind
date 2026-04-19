'use client';

/**
 * <Ch2Problem> — second chapter of the Memind scrollytelling narrative.
 *
 * Narrative pivot (2026-04-20): the prior draft counted up to `32,140`
 * which conflated a one-time October 2025 spam spike with daily reality.
 * Real four.meme throughput today is ~351 launches/day (source: the
 * l0k1 Dune dashboard linked in the footer). Counting up to 351 misses
 * the real story — four.meme already filtered the spam, but 97% of the
 * survivors still die inside 48h because creators mint-and-walk. That
 * is the hook Ch3 resolves.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *   - Count-up: `n = floor(lerp(0, 351, clamp(p/0.6)))`.
 *   - Graveyard grid: 32×12 = 384 dim dots kept as-is — the visual
 *     metric is "a sea of dim cells, a handful alive", not literal count.
 *   - Aside: sleep mascot + "creator walks away at hour 0" line.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { BigHeadline, Label, Mono, clamp, lerp } from './chapter-primitives';

interface Ch2ProblemProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

const COLS = 32;
const ROWS = 12;
const TOTAL_CELLS = COLS * ROWS;
// Spread a handful of alive cells across the grid so the visual reads
// "three percent survive" rather than "one lucky seed". Indices picked
// to sit in different quadrants (top-left, center, right, bottom).
const ALIVE_INDICES = new Set<number>([47, 183, 241, 309]);

export function Ch2Problem({ p }: Ch2ProblemProps): ReactElement {
  const n = Math.floor(lerp(0, 351, clamp(p / 0.6)));
  const fadeStage = clamp((p - 0.3) / 0.4);
  const fadeMul = 1 - fadeStage * 0.92;

  return (
    <div className="ch ch-problem">
      <Label n={2}>after the filter</Label>
      <BigHeadline size={104}>
        <span style={{ color: 'var(--fg-tertiary)' }}>{n.toLocaleString()}</span>
        <span className="ch-sub-line"> four.meme launches / day — 97% die inside 48h.</span>
      </BigHeadline>
      <div className="ch-problem-source">
        <a
          className="mono"
          href="https://dune.com/l0k1/fourmeme-insights"
          target="_blank"
          rel="noopener noreferrer"
        >
          {'source \u00b7 dune.com/l0k1/fourmeme-insights \u00b7 2026-04-20 \u2197'}
        </a>
      </div>
      <div className="ch-problem-body">
        <div className="graveyard-grid">
          {Array.from({ length: TOTAL_CELLS }, (_, i) => {
            const alive = ALIVE_INDICES.has(i);
            const fade = (i * 13) % 100;
            const opacity = alive ? 1 : lerp(0.08, 0.28, fade / 100) * fadeMul;
            const className = alive ? 'grave-cell grave-cell--alive' : 'grave-cell';
            return (
              <span
                key={i}
                className={className}
                style={{
                  opacity,
                  color: alive ? 'var(--accent)' : 'var(--fg-tertiary)',
                }}
              >
                {alive ? '\u25cf' : '\u00b7'}
              </span>
            );
          })}
        </div>
        <div className="ch-problem-aside">
          <Mono dim>{'// four.meme filtered the spam.'}</Mono>
          <br />
          <Mono>the survivors still die at hour 0 — because the creator walks away.</Mono>
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <PixelHumanGlyph
              size={56}
              mood="sleep"
              primaryColor="var(--fg-tertiary)"
              accentColor="var(--fg-tertiary)"
            />
            <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
              creator.offline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
