/**
 * Tests for <Ch3Solution /> — third chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch3).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch3Solution
 * (lines 119-161):
 *
 *   - Equation assembly: `step = clamp(p/0.7) * 4`. 4 `.eq-part` slots and
 *     3 `.eq-op` operators toggle `.on` at thresholds
 *     `0.3 / 0.8 / 1.3 / 1.9 / 2.4 / 3.2 / 3.7` (part/op/part/op/part/op/final).
 *   - Brain card hosts a think-mood PixelHumanGlyph (accent primary).
 *   - Wallet card hosts the `⌘` wallet glyph.
 *   - Final MEMIND card lives in an `.eq-final` slot.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch3Solution } from '../ch3-solution.js';

function countOnParts(html: string): number {
  return (html.match(/class="eq-part on"|class="eq-part eq-final on"/g) ?? []).length;
}

function countOnOps(html: string): number {
  return (html.match(/class="eq-op on"|class="eq-op eq-op-eq on"/g) ?? []).length;
}

describe('<Ch3Solution>', () => {
  it('at p=0 no eq-part / eq-op has the `on` class yet', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={0} />);
    expect(countOnParts(html)).toBe(0);
    expect(countOnOps(html)).toBe(0);
  });

  it('at p=0.7 every eq-part and eq-op has the `on` class', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={0.7} />);
    // 4 parts (TOKEN, brain, wallet, MEMIND) + 3 ops (+ + =).
    expect(countOnParts(html)).toBe(4);
    expect(countOnOps(html)).toBe(3);
  });

  it('at p=0.35 (step=2) the first two eq-parts are on but final is not', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={0.35} />);
    expect(countOnParts(html)).toBe(2);
    // Final `eq-final` card must NOT be on yet.
    expect(html).toMatch(/class="eq-part eq-final"(?!\s+on)/);
  });

  it('renders the MEMIND final card with think-mood brain + wallet glyph', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={1} />);
    expect(html).toContain('MEMIND');
    // Think-mood brain glyph sits inside the accent card.
    expect(html).toMatch(/data-mood="think"/);
    // Wallet glyph is the ⌘ command symbol.
    expect(html).toMatch(/class="wallet-glyph"[^>]*>\u2318</);
  });

  it('renders the headline + foot tagline', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={0.5} />);
    expect(html).toContain('what if every token had a');
    expect(html).toContain('brain');
    expect(html).toContain('it thinks. it talks. it pays. it shills itself.');
  });
});
