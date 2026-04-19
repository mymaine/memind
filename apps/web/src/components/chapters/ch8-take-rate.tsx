'use client';

/**
 * <Ch8TakeRate> — business chapter of the Memind scrollytelling narrative.
 *
 * Interior progress `p ∈ [0, 1]` drives two synchronous micro-animations:
 *
 *   - Big count-up: `$` + `fmt(lerp(0, 3.20, clamp(p/0.6)), 2)`. Reaches
 *     `$3.20` at p >= 0.6 and holds flat until chapter exit. Number is
 *     labelled as a projection — only the shill-order SKU is live today.
 *   - Staggered bar fills: each of the four SKU bars starts filling once
 *     `p > i * 0.08` and reaches its final `v * 100%` width at a 1.4x
 *     overshoot rate (`clamp((p - i*0.08) * 1.4) * v * 100`).
 *
 * Bar meta (shipped vs. planned):
 *   - shill order — LIVE today (x402 endpoint `/shill/:tokenAddr` at
 *     $0.01 per order, priced in x402/config.ts)
 *   - persona boot, persona mint, brain.sub — PLANNED (roadmap, not yet
 *     wired up). The `(planned)` suffix keeps the footer honest.
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

// Bar meta. Only shill order is live today (x402 /shill/:tokenAddr at
// $0.01 per order). The remaining three bars carry a `(planned)` note so
// the chapter doesn't oversell unshipped SKUs.
const BARS: readonly Bar[] = [
  { label: 'shill order', v: 0.82, color: 'var(--accent)', note: '0.01 USDC \u00b7 live' },
  { label: 'persona boot', v: 0.42, color: 'var(--chain-bnb)', note: 'gas-only (planned)' },
  { label: 'persona mint', v: 0.28, color: 'var(--chain-base)', note: 'TBD (planned)' },
  { label: 'brain.sub', v: 0.18, color: 'var(--chain-ipfs)', note: 'monthly (planned)' },
];

export function Ch8TakeRate({ p }: Ch8TakeRateProps): ReactElement {
  const bigNum = fmt(lerp(0, 3.2, clamp(p / 0.6)), 2);
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
          <Mono dim>projected lifetime / token · shill + 3 planned SKUs</Mono>
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
            {'shipped: shill order at $0.01 \u00b7 rest of the mix lands post-hackathon'}
          </Mono>
        </div>
      </div>
    </div>
  );
}
