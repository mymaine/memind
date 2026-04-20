/**
 * Tests for <Ch9TakeRate /> — rebuilt 2026-04-20 around a five-SKU
 * revenue mix + a four-stage adoption projection.
 *
 * Contract:
 *
 *   - Big count-up: `$` + `fmt(lerp(0, 3.2, clamp(p/0.6)), 2)`. Lands at
 *     `$3.20` once p >= 0.6 and holds flat.
 *   - Five bars — shill order (live), launch boost (next), brain.pro
 *     retainer (planned), alpha feed subscription (planned), KOL market
 *     take (future). Each status chip maps to a dedicated CSS class.
 *   - Four projection rows (6mo / 12mo / 24mo / 36mo) fade in once the
 *     bars finish stretching. Each row carries a daily + ARR column and
 *     an adoption footnote.
 *
 * Rendered via `renderToStaticMarkup` (vitest runs without jsdom).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch9TakeRate } from '../ch9-take-rate.js';

describe('<Ch9TakeRate>', () => {
  it('at p=0 the big number renders "$0.00"', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={0} />);
    expect(html).toMatch(/class="biz-num-big"[^>]*>\$<span>0\.00<\/span>/);
  });

  it('at p=0.6 the big number reaches "$3.20"', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={0.6} />);
    expect(html).toContain('3.20');
    // Cohort caption: 351 launches × 3% survival curve.
    expect(html).toContain('351 launches');
    // Every commercial projection in the chapter must be flagged as a
    // highly conservative estimate per UAT 2026-04-20.
    expect(html).toContain('highly conservative estimate');
  });

  it('renders exactly five revenue bars with the new SKU labels', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={1} />);
    const rows = html.match(/class="biz-bar-row"/g) ?? [];
    expect(rows.length).toBe(5);
    expect(html).toContain('shill order');
    expect(html).toContain('launch boost');
    expect(html).toContain('brain.pro retainer');
    expect(html).toContain('alpha feed subscription');
    expect(html).toContain('KOL market take');
    // Regression: the old four-bar mix referenced fictional SKUs.
    expect(html).not.toContain('persona boot');
    expect(html).not.toContain('persona mint');
    expect(html).not.toContain('brain.sub');
  });

  it('status chips surface one live + one next + two planned + one future', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={1} />);
    const live = (html.match(/biz-bar-status biz-bar-status-live/g) ?? []).length;
    const next = (html.match(/biz-bar-status biz-bar-status-next/g) ?? []).length;
    const planned = (html.match(/biz-bar-status biz-bar-status-planned/g) ?? []).length;
    const future = (html.match(/biz-bar-status biz-bar-status-future/g) ?? []).length;
    expect(live).toBe(1);
    expect(next).toBe(1);
    expect(planned).toBe(2);
    expect(future).toBe(1);
  });

  it('dynamic shill pricing hint surfaces the $0.005 – $5 range', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={1} />);
    expect(html).toContain('$0.005 \u2013 $5 dynamic');
    // Regression: kill any remnants of the flat $0.01 only copy.
    expect(html).not.toContain('0.01 USDC \u00b7 live');
  });

  it('each bar uses its design-handoff color (accent / chain-bnb / chain-base / chain-ipfs / fg-secondary)', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={1} />);
    expect(html).toMatch(/background:var\(--accent\)/);
    expect(html).toMatch(/background:var\(--chain-bnb\)/);
    expect(html).toMatch(/background:var\(--chain-base\)/);
    expect(html).toMatch(/background:var\(--chain-ipfs\)/);
    expect(html).toMatch(/background:var\(--fg-secondary\)/);
  });

  it('renders all four projection rows with daily + ARR + footnote columns', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={1} />);
    const rows = html.match(/class="biz-projection-row"/g) ?? [];
    expect(rows.length).toBe(4);
    // 2026-04-20: the timeline compresses to a 6-month horizon so the
    // projection matches the 3-day MVP velocity of this build. The
    // WEEK 2 break-even and MONTH 6 seed-stage anchors are the canaries.
    expect(html).toContain('NOW');
    expect(html).toContain('WEEK 2');
    expect(html).toContain('MONTH 3');
    expect(html).toContain('MONTH 6');
    expect(html).toContain('$74 / day');
    expect(html).toContain('$27k ARR');
    expect(html).toContain('$740 / day');
    expect(html).toContain('$270k ARR');
    expect(html).toContain('break-even for solo dev');
    expect(html).toContain('seed-stage momentum');
    // Regression: the old 24- and 36-month rows are gone.
    expect(html).not.toContain('24 months');
    expect(html).not.toContain('36 months');
    expect(html).not.toContain('$900k ARR');
  });

  it('ships a margin note that mentions the X API cost floor but does not dwell on it', () => {
    const html = renderToStaticMarkup(<Ch9TakeRate p={1} />);
    expect(html).toMatch(/class="biz-projection-note"/);
    expect(html).toContain('shill price floors at $0.02');
  });
});
