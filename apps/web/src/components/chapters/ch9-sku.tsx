'use client';

/**
 * <Ch9SKU> — SKU matrix chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch9).
 *
 * Interior progress `p ∈ [0, 1]` drives a staggered card reveal:
 *
 *   - Each of the four product cards fades + scales in via
 *     `appear = clamp((p - i*0.1) * 2)`; opacity tracks `appear` and
 *     scale lerps 0.94 -> 1.0 over the same interval.
 *   - Tier chip color is driven purely by the `.sku-tier-${tier}` class
 *     already ported into `app/globals.css` (free / pro / item / bundle).
 *
 * Outer shell + CSS classes (`.ch-biz`, `.sku-grid`, `.sku-card`,
 * `.sku-head`, `.sku-tier`, `.sku-name`, `.sku-desc`, `.sku-price`) live
 * in `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { BigHeadline, Label, Mono, clamp, lerp } from './chapter-primitives';

interface Ch9SKUProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type SkuTier = 'free' | 'pro' | 'item' | 'bundle';

type Sku = {
  readonly code: string;
  readonly name: string;
  readonly tier: SkuTier;
  readonly desc: string;
  readonly price: string;
};

// Ported verbatim from chapters.jsx lines 457-462.
const SKUS: readonly Sku[] = [
  {
    code: 'SKU-01',
    name: 'BRAIN.BASIC',
    tier: 'free',
    desc: 'idle + shill only. 1 persona.',
    price: '$0',
  },
  {
    code: 'SKU-02',
    name: 'BRAIN.PRO',
    tier: 'pro',
    desc: '4 personas. onchain decisions. heartbeat 5s.',
    price: '$4.99/mo',
  },
  {
    code: 'SKU-03',
    name: 'PERSONA.MINT',
    tier: 'item',
    desc: 'mint a custom persona NFT. 14 moods.',
    price: '$1.20',
  },
  {
    code: 'SKU-04',
    name: 'SHILL.CREDITS',
    tier: 'bundle',
    desc: '100 tweets, any persona. no decay.',
    price: '$6.40',
  },
];

export function Ch9SKU({ p }: Ch9SKUProps): ReactElement {
  return (
    <div className="ch ch-biz">
      <Label n={9}>{'seller side \u00b7 4 SKUs'}</Label>
      <BigHeadline size={72}>what we sell, to whom.</BigHeadline>
      <div className="sku-grid">
        {SKUS.map((s, i) => {
          const appear = clamp((p - i * 0.1) * 2);
          return (
            <div
              key={s.code}
              className="sku-card"
              style={{ opacity: appear, transform: `scale(${lerp(0.94, 1, appear)})` }}
            >
              <div className="sku-head">
                <Mono dim>{s.code}</Mono>
                <span className={`sku-tier sku-tier-${s.tier}`}>{s.tier}</span>
              </div>
              <div className="sku-name">{s.name}</div>
              <div className="sku-desc">{s.desc}</div>
              <div className="sku-price">{s.price}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
