/**
 * Tests for <Ch10SKU /> — rebuilt 2026-04-20 around a five-SKU, 2+2+1
 * time-oriented matrix.
 *
 * Contract:
 *
 *   - Five SKU cards (SKU-01 through SKU-05) in a `.sku-matrix` with
 *     three rows: live+next · planned×2 · future×1. The solo `future`
 *     row carries the `sku-row-solo` modifier class so it centres.
 *   - Tier classes: `item` / `bundle` / `pro` / `sub` / `market`.
 *     Status classes: `live` / `next` / `planned` / `future`.
 *   - Each card reveals via `appear = clamp((p - i*0.1) * 2)` — at p=0
 *     every card lands at opacity:0.
 *
 * vitest runs without jsdom; render via `renderToStaticMarkup` + regex.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch10SKU } from '../ch10-sku.js';

describe('<Ch10SKU>', () => {
  it('renders exactly five SKU cards with their codes', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    const cards = html.match(/class="sku-card"/g) ?? [];
    expect(cards.length).toBe(5);
    for (const code of ['SKU-01', 'SKU-02', 'SKU-03', 'SKU-04', 'SKU-05']) {
      expect(html).toContain(code);
    }
  });

  it('at p=0 every card has opacity:0 (first card too, since (0-0)*2 = 0)', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={0} />);
    const opacities = html.match(/class="sku-card"[^>]*style="opacity:0/g) ?? [];
    expect(opacities.length).toBe(5);
  });

  it('applies the correct tier class to each card (item / bundle / pro / sub / market)', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    expect(html).toContain('sku-tier sku-tier-item');
    expect(html).toContain('sku-tier sku-tier-bundle');
    expect(html).toContain('sku-tier sku-tier-pro');
    expect(html).toContain('sku-tier sku-tier-sub');
    expect(html).toContain('sku-tier sku-tier-market');
    // Regression: the old `free` tier is gone — BRAIN.BASIC was cut.
    expect(html).not.toContain('sku-tier sku-tier-free');
  });

  it('status chips surface one live + one next + two planned + one future', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    const live = (html.match(/class="sku-status sku-status-live"/g) ?? []).length;
    const next = (html.match(/class="sku-status sku-status-next"/g) ?? []).length;
    const planned = (html.match(/class="sku-status sku-status-planned"/g) ?? []).length;
    const future = (html.match(/class="sku-status sku-status-future"/g) ?? []).length;
    expect(live).toBe(1);
    expect(next).toBe(1);
    expect(planned).toBe(2);
    expect(future).toBe(1);
    // data-sku-status attributes match.
    expect(html).toContain('data-sku-status="live"');
    expect(html).toContain('data-sku-status="next"');
    expect(html).toContain('data-sku-status="future"');
  });

  it('surfaces the real dynamic shill pricing instead of the old flat $0.01', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    expect(html).toContain('$0.005 \u2013 $5 / order');
    expect(html).toContain('$9.99 one-time');
    expect(html).toContain('$49 / month retainer');
    expect(html).toContain('$19 / month');
    expect(html).toContain('20% of GMV');
    // Regression: old flat pricing gone.
    expect(html).not.toContain('$0.01 / order');
  });

  it('renders the five SKU product names', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    for (const name of ['SHILL.ORDER', 'LAUNCH.BOOST', 'BRAIN.PRO', 'ALPHA.FEED', 'KOL.MARKET']) {
      expect(html).toContain(name);
    }
    // Regression: deprecated SKUs are gone.
    expect(html).not.toContain('BRAIN.BASIC');
    expect(html).not.toContain('PERSONA.MINT');
  });

  it('arranges the cards in a 3+2 symmetric matrix (UAT 2026-04-20)', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    // Exactly two rows: a `.sku-row-3` trio of near-term SKUs on top
    // and a `.sku-row-2-center` duo of long-horizon SKUs centred below.
    // The old 2+2+1 layout (with `.sku-row-solo`) is gone.
    const rows = html.match(/class="sku-row[^"]*"/g) ?? [];
    expect(rows.length).toBe(2);
    expect(html).toContain('sku-row sku-row-3');
    expect(html).toContain('sku-row sku-row-2-center');
    expect(html).not.toContain('sku-row-solo');
  });

  it('ships an honest footnote about the billing rails being the last mile', () => {
    const html = renderToStaticMarkup(<Ch10SKU p={1} />);
    expect(html).toMatch(/class="sku-footnote"/);
    expect(html).toContain('billing rails');
    expect(html).toContain('last mile');
    // UAT 2026-04-20: non-live SKU pricing MUST be flagged as a highly
    // conservative estimate so readers do not mistake it for promised revenue.
    expect(html).toContain('highly conservative estimate');
  });
});
