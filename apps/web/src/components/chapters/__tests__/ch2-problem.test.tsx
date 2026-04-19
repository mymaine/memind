/**
 * Tests for <Ch2Problem /> — second chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch2).
 *
 * Ports the interior-progress contract from the design handoff:
 *
 *   - Count-up: `Math.floor(lerp(0, 32140, clamp(p/0.6)))`, rendered via
 *     `n.toLocaleString()`.
 *   - Graveyard grid: 32 cols × 12 rows = 384 cells, each `.grave-cell`.
 *     Cell index 47 is "alive" (accent `●`); the rest render dim `·`.
 *   - Aside: "most will die in silence" comment + sleep-mood mascot.
 *
 * Rendered via `renderToStaticMarkup` to match every other chapter test.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch2Problem } from '../ch2-problem.js';

// CSS-regression source for UAT issue #5 — lets us assert the alive-cell
// pulse animation lives in the shipped stylesheet without spinning jsdom.
const GLOBALS_CSS = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');

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
    // Dim + alive share the base class name — count on the class attr.
    const matches = html.match(/class="grave-cell(?: grave-cell--alive)?"/g) ?? [];
    expect(matches.length).toBe(384);
  });

  it('cell #47 is alive — accent color, `●` glyph, and grave-cell--alive modifier', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.3} />);
    // UAT issue #5 — the alive cell now carries the `grave-cell--alive`
    // modifier so it picks up the CSS pulse + glow animation. Assert the
    // modifier lands on exactly one cell and still renders the ● glyph
    // with accent color.
    const aliveMatches = html.match(/class="grave-cell grave-cell--alive"/g) ?? [];
    expect(aliveMatches).toHaveLength(1);
    expect(html).toMatch(
      /class="grave-cell grave-cell--alive"[^>]*color:var\(--accent\)[^>]*>\u25cf<\/span>/,
    );
    // Sanity — the dim glyph is also present (lots of them).
    expect(html).toContain('\u00b7');
  });

  it('alive-cell pulse animation is declared in globals.css (UAT issue #5)', () => {
    // Animation must loop forever (infinite) so the "survivor" visual keeps
    // breathing for the entire length of the chapter hold.
    expect(GLOBALS_CSS).toMatch(
      /\.grave-cell--alive\s*\{[^}]*animation:\s*grave-alive-pulse[^}]*infinite/,
    );
    expect(GLOBALS_CSS).toMatch(/@keyframes\s+grave-alive-pulse\s*\{/);
  });

  it('dim majority fades hard as p passes 0.7 (UAT issue #5)', () => {
    // Collect inline opacity values for every non-alive cell at p=0.7 and
    // confirm their average sits below 0.05 — the UAT fix raises the decay
    // from 60% to ~92% so dim cells nearly vanish when the stage reaches
    // its climax.
    const html = renderToStaticMarkup(<Ch2Problem p={0.7} />);
    const dimMatches = [...html.matchAll(/class="grave-cell"[^>]*style="opacity:([0-9.]+)/g)].map(
      (m) => Number(m[1]),
    );
    expect(dimMatches.length).toBeGreaterThan(380);
    const avg = dimMatches.reduce((s, v) => s + v, 0) / dimMatches.length;
    expect(avg).toBeLessThan(0.05);
  });

  it('renders the "most will die in silence" aside and the sleep-mood mascot', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.5} />);
    expect(html).toContain('most will die in silence');
    // Sleep-mood glyph sits next to the aside copy.
    expect(html).toMatch(/data-mood="sleep"/);
  });
});
