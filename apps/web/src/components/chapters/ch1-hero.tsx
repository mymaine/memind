'use client';

/**
 * <Ch1Hero> — first chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch1).
 *
 * Interior progress `p ∈ [0, 1]` drives three synchronous micro-animations:
 *
 *   - Type-on: `"Pay USDC. Get tweets."` reveals letter-by-letter across
 *     `p ∈ [0, 0.5]`, staying full after that. Implemented as
 *     `Math.floor(clamp(p/0.5) * FULL.length)`.
 *   - Glyph translate: x slides from -120px to +120px across
 *     `p ∈ [0.2, 0.9]` (lerp + clamp).
 *   - Mood cycle: `walk-right` → `celebrate` (p > 0.5) → `sunglasses`
 *     (p > 0.7). All three moods exist in
 *     `components/pixel-human-glyph/mood-registry.ts`.
 *
 * The outer shell + CSS classes (`.ch-hero`, `.ch-hero-top`,
 * `.ch-hero-sub`, `.ch-hero-glyph`, `.ch-hero-chainrow`, `.ch-hero-bottom`)
 * are already ported into `app/globals.css` — this component only fills
 * them in.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph, type ShillingMood } from '@/components/pixel-human-glyph';
import { BigHeadline, Mono, Pill, clamp, fmt, lerp } from './chapter-primitives';

interface Ch1HeroProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

const FULL = 'Pay USDC. Get tweets.';

export function Ch1Hero({ p }: Ch1HeroProps): ReactElement {
  const shown = Math.floor(clamp(p / 0.5) * FULL.length);
  const typed = FULL.slice(0, shown);
  const glyphX = lerp(-120, 120, clamp((p - 0.2) / 0.7));
  const mood: ShillingMood = p > 0.7 ? 'sunglasses' : p > 0.5 ? 'celebrate' : 'walk-right';

  return (
    <div className="ch ch-hero">
      <div className="ch-hero-top">
        <Mono dim>memind.system › boot</Mono>
        <Mono dim>chain=bnb · persona=glitchy · t={fmt(p, 3)}</Mono>
      </div>
      <BigHeadline size={132}>
        <span style={{ color: 'var(--fg-emphasis)' }}>{typed}</span>
        <span className="caret">▌</span>
      </BigHeadline>
      <div className="ch-hero-sub">
        <Mono>
          &gt; give every meme coin an <span style={{ color: 'var(--accent)' }}>AI brain</span> and
          a wallet.
        </Mono>
      </div>
      <div className="ch-hero-glyph" style={{ transform: `translateX(${glyphX}px)` }}>
        <PixelHumanGlyph
          size={220}
          mood={mood}
          primaryColor="var(--accent)"
          accentColor="var(--chain-bnb)"
        />
      </div>
      <div className="ch-hero-bottom">
        <div className="ch-hero-chainrow">
          <Pill color="var(--chain-bnb)">BNB CHAIN</Pill>
          <Pill color="var(--chain-base)">BASE L2</Pill>
          <Pill color="var(--chain-ipfs)">IPFS</Pill>
        </div>
        <Mono dim>scroll ↓ to watch the brain boot</Mono>
      </div>
    </div>
  );
}
