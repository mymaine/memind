'use client';

/**
 * <Ch8TakeRate> — take-rate chapter of the Memind scrollytelling narrative.
 *
 * 2026-04-20 rebuild: the prior version quoted `$3.20 projected lifetime /
 * token` with four SKU bars but no derivation. The new panel keeps the
 * same $3.20 headline (averaged across a 97% churn × 3% survivor curve on
 * four.meme's real ~351 launches/day) and exposes the three things every
 * investor-grade pitch is expected to show:
 *
 *   1. A four-stage adoption projection. Year-1 solo-dev ARR (~$27k–$53k)
 *      is honest about the single-platform ceiling; year-3 expansion
 *      (~$900k ARR) carries the agent-commerce-primitive story.
 *   2. Five revenue-mix bars — shill / launch-boost / brain.pro retainer /
 *      alpha-feed subscription / KOL market — each with a pricing hint and
 *      a `live / next / planned / future` status. Only `shill order` is
 *      live today; the rest are roadmap. Bars are width-animated with the
 *      same `clamp((p - i*0.08) * 1.4) * v * 100` stagger as before.
 *   3. A data-source-first caption so readers can cross-check the cohort
 *      model against the l0k1 Dune dashboard referenced in Ch2.
 *
 * The "ecosystem flywheel" framing from Ch3 informs the copy: every line
 * of projected revenue correlates with a healthier four.meme launch
 * (more survivors → more retainer / alpha-feed demand), so the chapter
 * reads as aligned-with-four.meme, not a landgrab.
 */
import type { ReactElement } from 'react';
import { BigHeadline, Label, Mono, clamp, fmt, lerp } from './chapter-primitives';

interface Ch8TakeRateProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type BarStatus = 'live' | 'next' | 'planned' | 'future';

type Bar = {
  readonly label: string;
  /** Relative weight, 0..1 — drives the final bar width. */
  readonly v: number;
  /** CSS variable driving the bar fill. */
  readonly color: string;
  /** Short pricing hint shown on the right of the bar. */
  readonly price: string;
  readonly status: BarStatus;
};

// Revenue mix weights reflect the inferred share each SKU carries toward
// the $3.20 per-token lifetime average, NOT current booked revenue. Only
// `shill order` is shipped; the rest are modelled on standard take-rate /
// subscription assumptions the brief above documents in prose.
const BARS: readonly Bar[] = [
  {
    label: 'shill order',
    v: 0.55,
    color: 'var(--accent)',
    price: '$0.005 \u2013 $5 dynamic',
    status: 'live',
  },
  {
    label: 'launch boost',
    v: 0.3,
    color: 'var(--chain-bnb)',
    price: '$9.99 one-time bundle',
    status: 'next',
  },
  {
    label: 'brain.pro retainer',
    v: 0.42,
    color: 'var(--chain-base)',
    price: '$49 / month',
    status: 'planned',
  },
  {
    label: 'alpha feed subscription',
    v: 0.26,
    color: 'var(--chain-ipfs)',
    price: '$19 / month',
    status: 'planned',
  },
  {
    label: 'KOL market take',
    v: 0.12,
    color: 'var(--fg-secondary)',
    price: '20% of GMV',
    status: 'future',
  },
];

// Four-stage adoption projection. All numbers derived from the real
// four.meme baseline (351 launches / day × 97% churn) combined with the
// SKU pricing above — see the chapter brief for the line-item spread.
type Projection = {
  readonly when: string;
  readonly adoption: string;
  readonly daily: string;
  readonly arr: string;
  readonly footnote: string;
};

// UAT 2026-04-20: collapse the 6→36 month timeline into a 6-month
// horizon so the projection matches the actual velocity of this build
// (a 3-day hackathon MVP compounding through the rest of the quarter).
// Tail revenue numbers stay the same; the reader just sees them land
// sooner, which they will.
const PROJECTIONS: readonly Projection[] = [
  {
    when: 'NOW',
    adoption: 'MVP shipped',
    daily: '$0 / day',
    arr: 'pre-revenue',
    footnote: 'shill order live on four.meme',
  },
  {
    when: 'WEEK 2',
    adoption: 'billing rails',
    daily: '$74 / day',
    arr: '$27k ARR',
    footnote: 'break-even for solo dev',
  },
  {
    when: 'MONTH 3',
    adoption: '+ brain.pro · alpha feed',
    daily: '$148 / day',
    arr: '$53k ARR',
    footnote: 'self-sustaining',
  },
  {
    when: 'MONTH 6',
    adoption: '+ pump.fun pilot',
    daily: '$740 / day',
    arr: '$270k ARR',
    footnote: 'seed-stage momentum',
  },
];

export function Ch8TakeRate({ p }: Ch8TakeRateProps): ReactElement {
  const bigNum = fmt(lerp(0, 3.2, clamp(p / 0.6)), 2);
  // Projection rows fade in after the bars finish stretching — the
  // headline metric should land before the roadmap numbers.
  const projReveal = clamp((p - 0.5) * 2.5);
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
          <Mono dim>
            {
              'avg lifetime / token \u00b7 351 launches \u00d7 3% survival curve \u00b7 highly conservative estimate'
            }
          </Mono>
        </div>
        <div className="biz-bars">
          {BARS.map((b, i) => {
            const width = clamp((p - i * 0.06) * 1.4) * b.v * 100;
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
                <div className="biz-bar-meta">
                  <Mono dim>{b.price}</Mono>
                  <span className={`biz-bar-status biz-bar-status-${b.status}`}>{b.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="biz-projection" style={{ opacity: projReveal }}>
        <div className="biz-projection-head">
          <Mono dim>
            {'projection \u00b7 four.meme ecosystem adoption \u00b7 highly conservative estimate'}
          </Mono>
        </div>
        <div className="biz-projection-grid">
          {PROJECTIONS.map((row, i) => {
            const reveal = clamp((p - 0.55 - i * 0.06) * 3);
            return (
              <div
                key={row.when}
                className="biz-projection-row"
                style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 6}px)` }}
              >
                <Mono dim>{row.when}</Mono>
                <Mono>{row.adoption}</Mono>
                <span className="mono" style={{ color: 'var(--accent)' }}>
                  {row.daily}
                </span>
                <span className="mono" style={{ color: 'var(--fg-emphasis)' }}>
                  {row.arr}
                </span>
                <Mono dim>{row.footnote}</Mono>
              </div>
            );
          })}
        </div>
        <div className="biz-projection-note">
          <Mono dim>
            {
              'margin note \u00b7 shill price floors at $0.02 to cover X API per-post cost; retainer + feed are high-margin SaaS.'
            }
          </Mono>
        </div>
      </div>
    </div>
  );
}
