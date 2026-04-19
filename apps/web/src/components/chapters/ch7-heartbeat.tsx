'use client';

/**
 * <Ch7Heartbeat> — autonomous-heartbeat chapter of the Memind
 * scrollytelling narrative (memind-scrollytelling-rebuild AC-MSR-9 ch7).
 *
 * Ported from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 368-416.
 *
 * Interior progress `p ∈ [0, 1]` drives two synchronous animations:
 *   - EKG polyline: `strokeDasharray=1000` + `strokeDashoffset = 1000 - p*1000`
 *     so the trace draws from left to right as the chapter progresses. A
 *     vertical playhead (`<line>`) tracks `x = p * 400`.
 *   - Decision log: `ticks = floor(p * 14)` selects how many of the 8
 *     scripted decisions are rendered. The floor factor is intentionally
 *     > 8 so the log fills before the EKG finishes drawing.
 *
 * Layout classes (`.ch-heartbeat`, `.hb-grid`, `.hb-pulse`, `.hb-svg`,
 * `.hb-axis`, `.hb-ops`, `.hb-ops-head`, `.hb-op-row`, `.hb-glyph`)
 * already live in `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { BigHeadline, Label, Mono } from './chapter-primitives';

interface Ch7HeartbeatProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

// Ported verbatim from chapters.jsx lines 371-380.
const DECISIONS: readonly string[] = [
  'read mentions',
  'check liquidity',
  'draft reply',
  'price-probe',
  'reject (sentiment low)',
  'reschedule shill',
  'mint reply',
  'sleep 5s',
];

// Raw EKG points from chapters.jsx line 390 — left alone so the pulse
// rhythm matches the design handoff one-for-one.
const EKG_POINTS =
  '0,70 40,70 50,70 55,30 60,110 65,50 70,70 90,70 130,70 135,35 140,100 145,70 180,70 220,70 225,40 230,95 235,70 270,70 310,70 315,30 320,110 325,70 360,70 400,70';

export function Ch7Heartbeat({ p }: Ch7HeartbeatProps): ReactElement {
  const ticks = Math.floor(p * 14);
  const visibleDecisions = DECISIONS.slice(0, ticks);

  return (
    <div className="ch ch-heartbeat">
      <Label n={7}>autonomous heartbeat</Label>
      <BigHeadline size={72}>
        <span>
          every 5 seconds, the brain wakes up and{' '}
          <span style={{ color: 'var(--accent)' }}>decides</span>.
        </span>
      </BigHeadline>
      <div className="hb-grid">
        <div className="hb-pulse">
          <svg viewBox="0 0 400 140" className="hb-svg">
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              points={EKG_POINTS}
              strokeDasharray={1000}
              strokeDashoffset={1000 - p * 1000}
            />
            <line
              x1={p * 400}
              y1={0}
              x2={p * 400}
              y2={140}
              stroke="var(--accent)"
              strokeWidth={1}
              strokeOpacity={0.4}
            />
          </svg>
          <div className="hb-axis">
            <Mono dim>t=0</Mono>
            <Mono dim>
              tick {'\u00b7'} tick {'\u00b7'} tick
            </Mono>
            <Mono dim>t=70s</Mono>
          </div>
        </div>
        <div className="hb-ops">
          <div className="hb-ops-head">
            <Mono dim>operator.log</Mono>
          </div>
          {visibleDecisions.map((d, i) => (
            <div key={i} className="hb-op-row">
              <Mono dim>{`${String(i * 5).padStart(2, '0')}s`}</Mono>
              <Mono>{d}</Mono>
              <Mono dim>{i % 3 === 0 ? '\u2713 onchain' : 'offchain'}</Mono>
            </div>
          ))}
        </div>
        <div className="hb-glyph">
          <PixelHumanGlyph
            size={96}
            mood="walk-right"
            primaryColor="var(--accent)"
            accentColor="var(--chain-bnb)"
          />
          <Mono dim>brain.heartbeat / runs alone</Mono>
        </div>
      </div>
    </div>
  );
}
