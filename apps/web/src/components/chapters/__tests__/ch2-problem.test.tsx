/**
 * Tests for <Ch2Problem /> — second chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch2).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch2Problem
 * (lines 73-117):
 *
 *   - Count-up: `Math.floor(lerp(0, 32140, clamp(p/0.6)))`, rendered via
 *     `n.toLocaleString()`.
 *   - Graveyard grid: 32 cols × 12 rows = 384 cells, each `.grave-cell`.
 *     Cell index 47 is "alive" (accent `●`); the rest render dim `·`.
 *   - Aside: "most will die in silence" comment + sleep-mood mascot.
 *
 * Rendered via `renderToStaticMarkup` to match every other chapter test.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch2Problem } from '../ch2-problem.js';

describe('<Ch2Problem>', () => {
  it('at p=0 the count-up displays "0"', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0} />);
    // Count lives inside the headline span with var(--fg-tertiary) color.
    expect(html).toMatch(/class="ch-headline"[^>]*>\s*<span[^>]*>0<\/span>/);
  });

  it('at p=0.6 the count-up reaches 32,140 (toLocaleString formatted)', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.6} />);
    expect(html).toContain('32,140');
  });

  it('renders exactly 384 graveyard cells (32 cols × 12 rows)', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.3} />);
    const matches = html.match(/class="grave-cell"/g) ?? [];
    expect(matches.length).toBe(384);
  });

  it('cell #47 is alive — rendered with accent color and `●` glyph', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.3} />);
    // The alive cell has color:var(--accent) and content ●. Other cells use
    // var(--fg-tertiary) + `·`. Match the alive cell's inline style + content.
    expect(html).toMatch(/class="grave-cell"[^>]*color:var\(--accent\)[^>]*>\u25cf<\/span>/);
    // Sanity — the dim glyph is also present (lots of them).
    expect(html).toContain('\u00b7');
  });

  it('renders the "most will die in silence" aside and the sleep-mood mascot', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.5} />);
    expect(html).toContain('most will die in silence');
    // Sleep-mood glyph sits next to the aside copy.
    expect(html).toMatch(/data-mood="sleep"/);
  });
});
