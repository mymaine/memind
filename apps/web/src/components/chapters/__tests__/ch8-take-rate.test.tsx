/**
 * Tests for <Ch8TakeRate /> — business chapter of the scrollytelling narrative.
 *
 * Interior-progress contract:
 *
 *   - Big count-up: `$` + `fmt(lerp(0, 3.2, clamp(p/0.6)), 2)` — projected
 *     lifetime revenue per token. Reaches `$3.20` at p >= 0.6 and stays
 *     there.
 *   - Four stacked bars (shill order / persona boot / persona mint /
 *     brain.sub). Each bar's fill width is
 *     `clamp((p - i*0.08) * 1.4) * v * 100` percent. Colors map to
 *     accent / chain-bnb / chain-base / chain-ipfs respectively.
 *   - Footer note states the shipped SKU + flags the planned rest.
 *
 * Rendered via `renderToStaticMarkup` to match every other chapter test
 * (vitest runs without jsdom).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch8TakeRate } from '../ch8-take-rate.js';

describe('<Ch8TakeRate>', () => {
  it('at p=0 the big number renders "$0.00"', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0} />);
    expect(html).toMatch(/class="biz-num-big"[^>]*>\$<span>0\.00<\/span>/);
  });

  it('at p=0.6 the big number reaches "$3.20"', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0.6} />);
    expect(html).toContain('3.20');
  });

  it('renders exactly four revenue bars (shill order / persona boot / persona mint / brain.sub)', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0.5} />);
    const rows = html.match(/class="biz-bar-row"/g) ?? [];
    expect(rows.length).toBe(4);
    expect(html).toContain('shill order');
    expect(html).toContain('persona boot');
    expect(html).toContain('persona mint');
    expect(html).toContain('brain.sub');
  });

  it('flags shipped vs planned SKUs so the chapter does not oversell', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={1} />);
    // Only shill order carries a `live` flag; the other three are planned.
    expect(html).toContain('0.01 USDC \u00b7 live');
    const plannedCount = (html.match(/\(planned\)/g) ?? []).length;
    expect(plannedCount).toBe(3);
  });

  it('each bar uses its design-handoff color (accent / chain-bnb / chain-base / chain-ipfs)', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={1} />);
    // Fill order in the DOM matches the bars array order.
    expect(html).toMatch(/background:var\(--accent\)/);
    expect(html).toMatch(/background:var\(--chain-bnb\)/);
    expect(html).toMatch(/background:var\(--chain-base\)/);
    expect(html).toMatch(/background:var\(--chain-ipfs\)/);
  });

  it('renders an honest business note (shipped SKU + planned rest)', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0.5} />);
    expect(html).toMatch(/class="biz-note"/);
    expect(html).toContain('shipped');
    expect(html).toContain('shill order at $0.01');
    expect(html).toContain('post-hackathon');
    // Regression guards against the old fabricated TAM copy.
    expect(html).not.toContain('TAM');
    expect(html).not.toContain('32k tokens/day');
    expect(html).not.toContain('$400k/day');
  });
});
