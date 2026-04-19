'use client';

/**
 * <Ch8TakeRate> — business chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch8).
 *
 * Interior progress `p ∈ [0, 1]` drives two synchronous micro-animations:
 *
 *   - Big count-up: `$` + `fmt(lerp(0, 12.4, clamp(p/0.6)), 2)`. Reaches
 *     `$12.40` at p >= 0.6 and holds flat until chapter exit.
 *   - Staggered bar fills: each of the four SKU bars starts filling once
 *     `p > i * 0.08` and reaches its final `v * 100%` width at a 1.4x
 *     overshoot rate (`clamp((p - i*0.08) * 1.4) * v * 100`).
 *
 * Bar meta + colors are verbatim from the handoff: launch fee (accent) /
 * shill orders (chain-bnb) / persona mint (chain-base) / brain.sub
 * (chain-ipfs). The biz-note footer restates the TAM math unchanged.
 *
 * Outer shell + CSS classes (`.ch-biz`, `.biz-grid`, `.biz-num`,
 * `.biz-num-big`, `.biz-bars`, `.biz-bar-row`, `.biz-bar-label`,
 * `.biz-bar-track`, `.biz-bar-fill`, `.biz-note`) already live in
 * `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { BigHeadline, Label, Mono, clamp, fmt, lerp } from './chapter-primitives';

interface Ch8TakeRateProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type Bar = {
  readonly label: string;
  readonly v: number;
  readonly color: string;
  readonly note: string;
};

// Ported verbatim from chapters.jsx lines 420-425.
const BARS: readonly Bar[] = [
  { label: 'launch fee', v: 0.87, color: 'var(--accent)', note: '1x \u00b7 flat' },
  { label: 'shill orders', v: 0.58, color: 'var(--chain-bnb)', note: '0.08 USDC / tweet' },
  { label: 'persona mint', v: 0.34, color: 'var(--chain-base)', note: '1.20 USDC' },
  { label: 'brain.sub', v: 0.22, color: 'var(--chain-ipfs)', note: '4.99/mo' },
];

export function Ch8TakeRate({ p }: Ch8TakeRateProps): ReactElement {
  const bigNum = fmt(lerp(0, 12.4, clamp(p / 0.6)), 2);
  return (
    <div className="ch ch-biz">
      <Label n={8}>take rate</Label>
      <BigHeadline size={84}>
        revenue per token, <span style={{ color: 'var(--accent)' }}>per heartbeat</span>.
      </BigHeadline>
      <div className="biz-grid">
        <div className="biz-num">
          <div className="biz-num-big">
            $<span>{bigNum}</span>
          </div>
          <Mono dim>avg lifetime revenue / token (projected)</Mono>
        </div>
        <div className="biz-bars">
          {BARS.map((b, i) => {
            const width = clamp((p - i * 0.08) * 1.4) * b.v * 100;
            return (
              <div key={b.label} className="biz-bar-row">
                <div className="biz-bar-label">
                  <Mono>{b.label}</Mono>
                </div>
                <div className="biz-bar-track">
                  <div
                    className="biz-bar-fill"
                    style={{ width: `${width}%`, background: b.color }}
                  />
                </div>
                <Mono dim>{b.note}</Mono>
              </div>
            );
          })}
        </div>
        <div className="biz-note">
          <Mono dim>
            {'TAM \u00b7 ~32k tokens/day \u00d7 $12.4 avg = $400k/day if 10% retain brain'}
          </Mono>
        </div>
      </div>
    </div>
  );
}
