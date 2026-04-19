'use client';

/**
 * <Ch3Solution> — third chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch3).
 *
 * Ported from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 119-161.
 *
 * Interior progress `p ∈ [0, 1]` drives the equation assembly:
 *
 *     step = clamp(p / 0.7) * 4
 *
 * A 7-element sequence toggles `.on` at thresholds 0.3 / 0.8 / 1.3 / 1.9 /
 * 2.4 / 3.2 / 3.7 — part $TOKEN → op `+` → part brain → op `+` → part wallet
 * → op `=` → final MEMIND. CSS `.eq-part` fades from opacity 0 + scale 0.85
 * + blur 8px to clean when `.on` lands.
 *
 * Outer shell + CSS classes (`.ch-solution`, `.equation`, `.eq-part`,
 * `.eq-op`, `.eq-card`, `.eq-card-accent`, `.wallet-glyph`,
 * `.ch-solution-foot`) already live in `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { BigHeadline, Label, Mono, clamp } from './chapter-primitives';

interface Ch3SolutionProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

function onClass(base: string, active: boolean): string {
  return active ? `${base} on` : base;
}

export function Ch3Solution({ p }: Ch3SolutionProps): ReactElement {
  const step = clamp(p / 0.7) * 4;

  return (
    <div className="ch ch-solution">
      <Label n={3}>the fix</Label>
      <BigHeadline size={96}>
        <span>
          what if every token had a <span style={{ color: 'var(--accent)' }}>brain</span>?
        </span>
      </BigHeadline>
      <div className="equation">
        <div className={onClass('eq-part', step >= 0.3)}>
          <div className="eq-card">$TOKEN</div>
          <Mono dim>meme coin</Mono>
        </div>
        <div className={onClass('eq-op', step >= 0.8)}>+</div>
        <div className={onClass('eq-part', step >= 1.3)}>
          <div className="eq-card eq-card-accent">
            <PixelHumanGlyph
              size={54}
              mood="think"
              primaryColor="var(--accent)"
              accentColor="var(--chain-bnb)"
            />
          </div>
          <Mono dim>AI brain</Mono>
        </div>
        <div className={onClass('eq-op', step >= 1.9)}>+</div>
        <div className={onClass('eq-part', step >= 2.4)}>
          <div className="eq-card">
            <span className="wallet-glyph">{'\u2318'}</span>
          </div>
          <Mono dim>wallet</Mono>
        </div>
        <div className={onClass('eq-op eq-op-eq', step >= 3.2)}>=</div>
        <div className={onClass('eq-part eq-final', step >= 3.7)}>
          <div className="eq-card eq-final-card">
            <span className="mono" style={{ fontSize: 15, letterSpacing: 2 }}>
              MEMIND
            </span>
          </div>
          <Mono dim>meme + mind</Mono>
        </div>
      </div>
      <div className="ch-solution-foot">
        <Mono>&gt; it thinks. it talks. it pays. it shills itself.</Mono>
      </div>
    </div>
  );
}
