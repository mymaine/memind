'use client';

/**
 * <Ch7Saga> — the lore chapter (memind-scrollytelling-rebuild AC-MSR-9 ch7).
 *
 * Sits between Ch6 (`order-shill`) and Ch8 (`heartbeat-demo`) and gives
 * the Narrator persona's `think → write → on-chain` cycle its own scene.
 * The chapter is a pure function of `p`: no useState, no useEffect — the
 * three acts collapse to their final state at p=1, which is also what
 * <StickyStage /> renders under reduced motion (AC-MSR-14).
 *
 * Three acts:
 *   - Act 1 (think) p ∈ [0, 0.30]: glyph in `think` mood, thought cloud
 *     fades in across [0, 0.10], 5 keyword tokens drop in at thresholds
 *     0.05 / 0.10 / 0.15 / 0.20 / 0.25. Cloud fades out [0.30, 0.35].
 *   - Act 2 (write) p ∈ [0.30, 0.65]: glyph in `type-keyboard` mood, the
 *     parchment scroll opens via scaleX over [0.30, 0.35], then a 91-char
 *     prose typewriter advances across [0.32, 0.62].
 *   - Act 3 (on-chain) p ∈ [0.65, 1.0]: parchment fades + scales away
 *     [0.65, 0.75], a third chapter card flies into the right-side stack
 *     at p ≥ 0.75, status line steps through pinning → pinned → anchored,
 *     summary appears at p ≥ 0.92, closing tagline `creator.online ·
 *     forever` lands at p ≥ 0.95.
 *
 * The animation maps to a real backend flow — `apps/server/src/agents/
 * narrator.ts` calls `extend_lore` once, `apps/server/src/tools/lore-
 * extend.ts` runs Anthropic → Pinata pin → LoreStore upsert (and
 * optionally appends to the AnchorLedger). The on-screen think → write →
 * on-chain beats mirror that pipeline 1:1.
 *
 * Layout classes (`.ch-saga`, `.saga-stage`, `.saga-thought`,
 * `.saga-thought-token`, `.saga-rings`, `.saga-glyph-wrap`,
 * `.saga-scroll`, `.saga-stack`, `.saga-card`, `.saga-card--new`,
 * `.saga-status-line`, `.saga-summary`, `.saga-closing`) live in
 * `app/globals.css`.
 */
import { useMemo, type ReactElement } from 'react';
import { PixelHumanGlyph, type ShillingMood } from '@/components/pixel-human-glyph';
import { BigHeadline, Label, Mono, clamp } from './chapter-primitives';

interface Ch7SagaProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

// Five keyword tokens that drop into the thought cloud one by one. Order
// + thresholds match the spec; words pull from the lore vocabulary used
// by lore-extend.ts (mythic + on-chain register).
const THOUGHT_TOKENS: readonly { readonly word: string; readonly t: number }[] = [
  { word: 'frog', t: 0.05 },
  { word: 'swamp', t: 0.1 },
  { word: 'amnesia', t: 0.15 },
  { word: 'ledger', t: 0.2 },
  { word: 'awake', t: 0.25 },
];

// The actual sentence the Narrator persona "writes" on the parchment.
// 91 chars; mirrors the FIRST_CHAPTER_SYSTEM_PROMPT tone (mythic +
// internet-era irony) used by extend_lore for first chapters.
const PROSE =
  'The frog awoke in the swamp of digital amnesia. The ledger remembered everything it forgot.';

// Concentric brain-electrical rings drawn behind the glyph during Act 1.
// Radii hold throughout Act 2/3 — they read as ambient neural activity,
// not a one-shot pulse.
const RING_RADII: readonly number[] = [40, 70, 100, 130];

function pickMood(p: number): ShillingMood {
  if (p >= 0.78) return 'jump';
  if (p >= 0.65) return 'celebrate';
  if (p >= 0.3) return 'type-keyboard';
  return 'think';
}

export function Ch7Saga({ p }: Ch7SagaProps): ReactElement {
  // Act 1 — thought cloud + tokens.
  const cloudOpacity = clamp(p / 0.1) * (1 - clamp((p - 0.3) / 0.05));

  // Act 2 — scroll reveal + prose typewriter.
  const scrollWidth = clamp((p - 0.3) / 0.05);
  const shown = Math.floor(clamp((p - 0.32) / 0.3) * PROSE.length);
  const prose = PROSE.slice(0, shown);

  // Act 2 → Act 3 transition — parchment fades + shrinks.
  const scrollFade = clamp((p - 0.65) / 0.1);
  const scrollOpacity = (1 - scrollFade) * clamp(p / 0.32);
  const scrollScaleY = 1 - scrollFade * 0.4;

  // Act 3 — third chapter card inbound + status timeline.
  const cardAppear = clamp((p - 0.75) * 8);
  let statusText = '';
  let statusColor = 'var(--chain-bnb)';
  if (p >= 0.75) {
    if (p < 0.85) {
      statusText = 'pinning to ipfs \u23f3';
    } else if (p < 0.92) {
      statusText = 'bafkrei..f7q3 \u2713 pinned';
      statusColor = 'var(--accent)';
    } else {
      statusText = 'anchor #03 \u00b7 BSC mainnet';
    }
  }

  const summaryOpacity = clamp((p - 0.92) / 0.08);
  const closingOpacity = clamp((p - 0.95) / 0.05);

  // Memo the ring opacities so the inline SVG attributes stay stable
  // across re-renders for a fixed `p` — useful when StickyStage paints
  // the chapter at the same progress on consecutive frames.
  const ringOpacities = useMemo(
    () => RING_RADII.map((_, i) => 0.05 + (0.35 - 0.05) * clamp(p / 0.25 - i * 0.08)),
    [p],
  );

  const mood = pickMood(p);

  return (
    <div className="ch ch-saga">
      <Label n={7}>the saga</Label>
      <BigHeadline size={84}>every token gets a living novel.</BigHeadline>
      <div className="ch-saga-sub">
        <Mono dim>
          {
            '// the brain doesn\u2019t tweet then sleep \u2014 it writes the next chapter, then pins it.'
          }
        </Mono>
      </div>

      <div className="saga-stage">
        {/*
         * Background brain-electrical rings. Pure SVG so they layer
         * cleanly behind the glyph without affecting flex sizing.
         */}
        <svg className="saga-rings" viewBox="-150 -150 300 300" aria-hidden>
          {RING_RADII.map((r, i) => (
            <circle
              key={r}
              cx={0}
              cy={0}
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={0.5}
              strokeOpacity={ringOpacities[i]}
            />
          ))}
        </svg>

        {/* Act 1 thought cloud above the glyph. */}
        <div className="saga-thought" style={{ opacity: cloudOpacity }}>
          {THOUGHT_TOKENS.map(({ word, t }) => {
            const fresh = clamp((p - t) * 30);
            if (fresh <= 0) return null;
            return (
              <span
                key={word}
                className="saga-thought-token"
                style={{
                  opacity: fresh,
                  transform: `translateY(${(1 - fresh) * 6}px)`,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>

        {/* Central novelist glyph. */}
        <div className="saga-glyph-wrap">
          <PixelHumanGlyph
            size={140}
            mood={mood}
            primaryColor="var(--accent)"
            accentColor="var(--chain-bnb)"
          />
        </div>

        {/* Act 2 parchment / scroll panel. */}
        <div
          className="saga-scroll"
          style={{
            opacity: scrollOpacity,
            transform: `scaleX(${scrollWidth}) scaleY(${scrollScaleY})`,
          }}
        >
          <div className="saga-scroll-head">
            <Mono dim>narrator.ch03</Mono>
            <Mono dim>writing</Mono>
          </div>
          <div className="saga-scroll-body">
            <span className="mono">{prose}</span>
            <span className="caret">{'\u258c'}</span>
          </div>
        </div>

        {/* Act 3 chapter stack on the right. */}
        <div className="saga-stack">
          <div className="saga-card">
            <div className="saga-card-head">
              <Mono>{'ch.01 \u2713'}</Mono>
            </div>
            <Mono dim>bafkrei..a3df</Mono>
            <Mono dim>pinned</Mono>
          </div>
          <div className="saga-card">
            <div className="saga-card-head">
              <Mono>{'ch.02 \u2713'}</Mono>
            </div>
            <Mono dim>bafkrei..7e02</Mono>
            <Mono dim>pinned</Mono>
          </div>
          {p >= 0.75 && (
            <div
              className="saga-card saga-card--new"
              style={{
                opacity: cardAppear,
                transform: `translateY(${(1 - cardAppear) * 24}px)`,
              }}
            >
              <div className="saga-card-head">
                <Mono>ch.03</Mono>
              </div>
              <div className="saga-status-line" style={{ color: statusColor }}>
                <span className="mono">{statusText}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="saga-summary" style={{ opacity: summaryOpacity }}>
        <Mono dim>
          {'> chapter 03 \u00b7 412 chars \u00b7 ipfs://bafkrei..f7q3 \u00b7 anchored 0x9e02..411d'}
        </Mono>
      </div>

      <div className="saga-closing" style={{ opacity: closingOpacity }}>
        {'> creator.online \u00b7 forever'}
      </div>
    </div>
  );
}
