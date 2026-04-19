'use client';

/**
 * <Ch2Problem> — second chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch2).
 *
 * Interior progress `p ∈ [0, 1]` drives three synchronous micro-animations:
 *
 *   - Count-up: `n = floor(lerp(0, 32140, clamp(p/0.6)))`, rendered via
 *     `toLocaleString()` so the ticker reads `32,140` at p ≥ 0.6.
 *   - Graveyard grid: 32 cols × 12 rows = 384 dim dots, each `.grave-cell`.
 *     Cell index 47 is the lone "alive" accent marker (`●`); the rest fade
 *     further as `p` passes 0.3.
 *   - Aside: sleep-mood mascot paired with the "most will die in silence"
 *     comment — the counterpoint that motivates Ch3.
 *
 * Outer shell + CSS classes (`.ch-problem`, `.ch-problem-body`,
 * `.graveyard-grid`, `.grave-cell`, `.ch-problem-aside`, `.ch-sub-line`)
 * already live in `app/globals.css`.
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
const ALIVE_INDEX = 47;

export function Ch2Problem({ p }: Ch2ProblemProps): ReactElement {
  const n = Math.floor(lerp(0, 32140, clamp(p / 0.6)));
  // UAT issue #5 — accelerate the dim-majority decay so once the scroll
  // passes the 0.3 → 0.7 window, the graveyard majority fades almost to
  // black, leaving the alive cell as the dominant visual. Old curve only
  // dropped 60%; new curve drops ~92% so the contrast punches through.
  const fadeStage = clamp((p - 0.3) / 0.4);
  const fadeMul = 1 - fadeStage * 0.92;

  return (
    <div className="ch ch-problem">
      <Label n={2}>the graveyard</Label>
      <BigHeadline size={104}>
        <span style={{ color: 'var(--fg-tertiary)' }}>{n.toLocaleString()}</span>
        <span className="ch-sub-line"> meme coins in a single peak day (2025-10).</span>
      </BigHeadline>
      <div className="ch-problem-body">
        <div className="graveyard-grid">
          {Array.from({ length: TOTAL_CELLS }, (_, i) => {
            const alive = i === ALIVE_INDEX;
            const fade = (i * 13) % 100;
            const opacity = alive ? 1 : lerp(0.08, 0.28, fade / 100) * fadeMul;
            // Alive cell picks up a dedicated modifier class whose CSS
            // animation (globals.css `grave-alive-pulse`) drives the
            // breathing + accent glow that the UAT asked for.
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
          <Mono dim>{'// most will die in silence.'}</Mono>
          <br />
          <Mono>no community. no shill. no mind.</Mono>
          <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 14 }}>
            <PixelHumanGlyph
              size={64}
              mood="sleep"
              primaryColor="var(--fg-tertiary)"
              accentColor="var(--fg-tertiary)"
            />
            <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
              tokens.sleeping
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
