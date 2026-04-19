'use client';

/**
 * <Ch9SKU> — SKU matrix chapter of the Memind scrollytelling narrative.
 *
 * 2026-04-20 rebuild: prior version shipped a 4-card grid (SHILL.ORDER +
 * BRAIN.BASIC/PRO + PERSONA.MINT) where two of the four cards lacked a
 * real business case — free tiers don't surface revenue, and NFT persona
 * minting had no clear buyer. This rebuild swaps those two for SKUs that
 * the Ch8 projection actually books against:
 *
 *   SKU-01 SHILL.ORDER   · $0.005–$5 dynamic        · live
 *   SKU-02 LAUNCH.BOOST  · $9.99 one-time bundle    · next
 *   SKU-03 BRAIN.PRO     · $49 / month retainer     · planned (billing)
 *   SKU-04 ALPHA.FEED    · $19 / month subscription · planned
 *   SKU-05 KOL.MARKET    · 20% take of GMV          · future
 *
 * Layout is a 2+2+1 time-oriented matrix so the reader walks from
 * shipped → next → planned → future without parsing a single grid:
 *   row 1 · `live` + `next`   (buildable now)
 *   row 2 · `planned` × 2     (subscription-shape, needs billing surface)
 *   row 3 · `future` × 1      (two-sided marketplace; longest runway)
 *
 * Reveal animation preserved: each card fades + scales per `appear =
 * clamp((p - i*0.1) * 2)`.
 */
import type { ReactElement } from 'react';
import { BigHeadline, Label, Mono, clamp, lerp } from './chapter-primitives';

interface Ch9SKUProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type SkuTier = 'pro' | 'item' | 'bundle' | 'sub' | 'market';
type SkuStatus = 'live' | 'next' | 'planned' | 'future';

type Sku = {
  readonly code: string;
  readonly name: string;
  readonly tier: SkuTier;
  readonly desc: string;
  readonly price: string;
  readonly status: SkuStatus;
};

const SKUS: readonly Sku[] = [
  {
    code: 'SKU-01',
    name: 'SHILL.ORDER',
    tier: 'item',
    desc: 'pay on demand, shiller posts a promo tweet from an aged X account. pricing scales with follower count.',
    price: '$0.005 \u2013 $5 / order',
    status: 'live',
  },
  {
    code: 'SKU-02',
    name: 'LAUNCH.BOOST',
    tier: 'bundle',
    desc: 'mint + 10 first-day shills + 3 lore chapters + 7 days of heartbeat tweets. the full "do not abandon your token" bundle.',
    price: '$9.99 one-time',
    status: 'next',
  },
  {
    code: 'SKU-03',
    name: 'BRAIN.PRO',
    tier: 'pro',
    desc: '24/7 brain-as-a-service for surviving tokens. 4 personas, 60s heartbeat, onchain-aware replies.',
    price: '$49 / month retainer',
    status: 'planned',
  },
  {
    code: 'SKU-04',
    name: 'ALPHA.FEED',
    tier: 'sub',
    desc: "trader-side subscription — the brain reads every token's lore and surfaces alpha on which launches are worth watching.",
    price: '$19 / month',
    status: 'planned',
  },
  {
    code: 'SKU-05',
    name: 'KOL.MARKET',
    tier: 'market',
    desc: 'two-sided matching: KOLs list follower counts + floor prices, creators book shills, platform skims a 20% take. long-runway marketplace.',
    price: '20% of GMV',
    status: 'future',
  },
];

// UAT 2026-04-20 swap: 2+2+1 read as lopsided. 3+2 keeps the same
// time-oriented flow (near-term trio on top, long-horizon duo below)
// while giving the matrix a symmetric centre line. Row 1 holds the
// three SKUs a creator actually touches today (shill + bundle + pro);
// row 2 centres the two demand-side / marketplace plays.
const ROW_1 = SKUS.slice(0, 3);
const ROW_2 = SKUS.slice(3);

function statusLabel(s: SkuStatus): string {
  if (s === 'planned') return 'planned';
  return s;
}

function SkuCard({ s, idx, p }: { s: Sku; idx: number; p: number }): ReactElement {
  const appear = clamp((p - idx * 0.1) * 2);
  return (
    <div
      className="sku-card"
      style={{ opacity: appear, transform: `scale(${lerp(0.94, 1, appear)})` }}
      data-sku-status={s.status}
    >
      <div className="sku-head">
        <Mono dim>{s.code}</Mono>
        <div>
          <span className={`sku-tier sku-tier-${s.tier}`}>{s.tier}</span>
          <span className={`sku-status sku-status-${s.status}`}>{statusLabel(s.status)}</span>
        </div>
      </div>
      <div className="sku-name">{s.name}</div>
      <div className="sku-desc">{s.desc}</div>
      <div className="sku-price">{s.price}</div>
    </div>
  );
}

export function Ch9SKU({ p }: Ch9SKUProps): ReactElement {
  return (
    <div className="ch ch-biz">
      <Label n={9}>{'seller + demand side \u00b7 1 live + 4 on the roadmap'}</Label>
      <BigHeadline size={72}>what we sell today, what lands next.</BigHeadline>
      <div className="sku-matrix">
        <div className="sku-row sku-row-3">
          {ROW_1.map((s, i) => (
            <SkuCard key={s.code} s={s} idx={i} p={p} />
          ))}
        </div>
        <div className="sku-row sku-row-2-center">
          {ROW_2.map((s, i) => (
            <SkuCard key={s.code} s={s} idx={i + ROW_1.length} p={p} />
          ))}
        </div>
      </div>
      <div className="sku-footnote">
        <Mono dim>
          {
            'billing rails for BRAIN.PRO + ALPHA.FEED are the "last mile" \u2014 the runtime already hosts both capabilities.'
          }
        </Mono>
        <div style={{ marginTop: 6 }}>
          <Mono dim>
            {
              '// pricing on non-live SKUs is a highly conservative estimate; real tiers will land after pilot data.'
            }
          </Mono>
        </div>
      </div>
    </div>
  );
}
