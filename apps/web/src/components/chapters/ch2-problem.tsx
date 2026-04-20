'use client';

/**
 * <Ch2Problem> — second chapter of the Memind scrollytelling narrative.
 *
 * Narrative pivot (2026-04-22): the prior "351 launches/day" anchor was
 * stale. The most citable, reviewer-checkable four.meme stat is the
 * October 2025 spam peak — ~32,480 tokens in a single day, reported by
 * coinspot (linked in the source strip). We count up to that peak, then
 * collapse the graveyard to read the 97% survivor curve from Chainplay's
 * State of Memecoin 2024. Both numbers have primary-source URLs on the
 * chapter, so the dramatic peak stat aligns with the README's Problem
 * section instead of drifting from a Dune dashboard that changes weekly.
 *
 * Interior progress `p ∈ [0, 1]` drives:
 *   - Count-up: `n = floor(lerp(0, 32480, clamp(p/0.6)))`.
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
  const n = Math.floor(lerp(0, 32480, clamp(p / 0.6)));
  // UAT 2026-04-22 timing: the count-up finishes at p=0.6, so the
  // graveyard fade stays dormant until then and sweeps in across the
  // remaining p=0.6 → 1.0 window. Gives the viewer "32,480 tokens
  // first, then watch them die" instead of a simultaneous blur.
  const fadeStage = clamp((p - 0.6) / 0.4);
  const fadeMul = 1 - fadeStage * 0.96;

  return (
    <div className="ch ch-problem">
      <Label n={2}>one day in october 2025</Label>
      <BigHeadline size={104}>
        <span style={{ color: 'var(--fg-tertiary)' }}>{n.toLocaleString()}</span>
        <span className="ch-sub-line">
          {' '}
          tokens on four.meme in 24h — 97% of memecoins eventually die.
        </span>
      </BigHeadline>
      <div className="ch-problem-source">
        <a
          className="mono"
          href="https://coinspot.io/en/cryptocurrencies/four-meme-increased-the-token-launch-fee-to-fight-spam-and-toxic-memes/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {'32k peak \u00b7 coinspot.io oct 2025 \u2197'}
        </a>
        <span className="mono" style={{ color: 'var(--fg-tertiary)', margin: '0 10px' }}>
          ·
        </span>
        <a
          className="mono"
          href="https://chainplay.gg/blog/state-of-memecoin-2024/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {'97% \u00b7 chainplay state of memecoin 2024 \u2197 \u00b7 validated 2025-2026'}
        </a>
      </div>
      <div className="ch-problem-body">
        <div className="graveyard-grid">
          {Array.from({ length: TOTAL_CELLS }, (_, i) => {
            const alive = ALIVE_INDICES.has(i);
            const fade = (i * 13) % 100;
            // Initial brightness bumped from 0.08–0.28 to 0.6–0.92 so
            // viewers read a full field of live tokens before the fade.
            const opacity = alive ? 1 : lerp(0.6, 0.92, fade / 100) * fadeMul;
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
          <Mono dim>{'// four.meme raised the launch fee after this day.'}</Mono>
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
