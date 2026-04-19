/**
 * Tests for <Ch8TakeRate /> — business chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch8).
 *
 * Ports the interior-progress contract from the design handoff:
 *
 *   - Big count-up: `$` + `fmt(lerp(0, 12.4, clamp(p/0.6)), 2)` — the
 *     projected avg lifetime revenue per token. Reaches `$12.40` at
 *     p >= 0.6 and stays there.
 *   - Four stacked bars (launch fee / shill orders / persona mint /
 *     brain.sub). Each bar's fill width is
 *     `clamp((p - i*0.08) * 1.4) * v * 100` percent. Colors map to
 *     accent / chain-bnb / chain-base / chain-ipfs respectively.
 *   - Footer note calling out TAM arithmetic.
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

  it('at p=0.6 the big number reaches "$12.40"', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0.6} />);
    expect(html).toContain('12.40');
  });

  it('renders exactly four revenue bars (launch fee / shill orders / persona mint / brain.sub)', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0.5} />);
    const rows = html.match(/class="biz-bar-row"/g) ?? [];
    expect(rows.length).toBe(4);
    expect(html).toContain('launch fee');
    expect(html).toContain('shill orders');
    expect(html).toContain('persona mint');
    expect(html).toContain('brain.sub');
  });

  it('each bar uses its design-handoff color (accent / chain-bnb / chain-base / chain-ipfs)', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={1} />);
    // Fill order in the DOM matches the bars array order.
    expect(html).toMatch(/background:var\(--accent\)/);
    expect(html).toMatch(/background:var\(--chain-bnb\)/);
    expect(html).toMatch(/background:var\(--chain-base\)/);
    expect(html).toMatch(/background:var\(--chain-ipfs\)/);
  });

  it('renders the TAM business note beneath the grid', () => {
    const html = renderToStaticMarkup(<Ch8TakeRate p={0.5} />);
    expect(html).toMatch(/class="biz-note"/);
    expect(html).toContain('TAM');
    expect(html).toContain('32k tokens/day');
    expect(html).toContain('$400k/day');
  });
});
