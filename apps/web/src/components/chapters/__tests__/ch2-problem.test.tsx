/**
 * Tests for <Ch2Problem /> — the "after the filter" chapter.
 *
 * 2026-04-20 rebuild: the prior draft counted up to a fictional 32,140
 * (one-off October 2025 spike conflated with daily reality). The new
 * copy counts up to 351 — the l0k1 Dune dashboard's real four.meme
 * daily launch rate — and spreads four alive cells across the 384-cell
 * graveyard so the 3% survival curve reads visually.
 *
 *   - Count-up: `Math.floor(lerp(0, 351, clamp(p/0.6)))`.
 *   - Graveyard grid: 384 cells; indices 47 / 183 / 241 / 309 are alive.
 *   - Aside: "four.meme filtered the spam" comment + sleep mascot +
 *     Dune source link.
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

  it('at p=0.6 the count-up reaches 351 (real four.meme daily rate, Dune-verified)', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.6} />);
    expect(html).toContain('>351<');
    // Regression: the old fabricated 32,140 number must be gone.
    expect(html).not.toContain('32,140');
  });

  it('renders exactly 384 graveyard cells (32 cols × 12 rows)', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.3} />);
    // Dim + alive share the base class name — count on the class attr.
    const matches = html.match(/class="grave-cell(?: grave-cell--alive)?"/g) ?? [];
    expect(matches.length).toBe(384);
  });

  it('four alive cells carry the grave-cell--alive modifier (3% survival curve)', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.3} />);
    // Four scattered alive cells carry the pulse modifier — they map
    // to the four ALIVE_INDICES (47 / 183 / 241 / 309) in the component.
    const aliveMatches = html.match(/class="grave-cell grave-cell--alive"/g) ?? [];
    expect(aliveMatches).toHaveLength(4);
    // Every alive cell still renders the ● glyph with accent color.
    const aliveGlyphCount = (
      html.match(
        /class="grave-cell grave-cell--alive"[^>]*color:var\(--accent\)[^>]*>\u25cf<\/span>/g,
      ) ?? []
    ).length;
    expect(aliveGlyphCount).toBe(4);
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

  it('graveyard reads bright at p=0.6 and nearly black at p=1.0 (2026-04-20 timing)', () => {
    // Timing rebuild: the fade now dormant until the count-up finishes
    // at p=0.6, then sweeps the graveyard dim across p=0.6→1.0. Two
    // checkpoints lock the contract:
    //   - At p=0.6 (count-up complete, fade about to start) the dim
    //     average sits ≥ 0.7 — viewer still reads "351 live tokens".
    //   - At p=1.0 the dim average collapses below 0.06 — only the 4
    //     alive cells remain legible.
    const dimFor = (p: number): number[] =>
      [
        ...renderToStaticMarkup(<Ch2Problem p={p} />).matchAll(
          /class="grave-cell"[^>]*style="opacity:([0-9.]+)/g,
        ),
      ].map((m) => Number(m[1]));

    const atStart = dimFor(0.6);
    expect(atStart.length).toBe(380);
    const avgStart = atStart.reduce((s, v) => s + v, 0) / atStart.length;
    expect(avgStart).toBeGreaterThan(0.7);

    const atEnd = dimFor(1);
    expect(atEnd.length).toBe(380);
    const avgEnd = atEnd.reduce((s, v) => s + v, 0) / atEnd.length;
    expect(avgEnd).toBeLessThan(0.06);
  });

  it('renders the "filtered the spam" aside + the sleep mascot + the Dune source link', () => {
    const html = renderToStaticMarkup(<Ch2Problem p={0.5} />);
    expect(html).toContain('four.meme filtered the spam');
    // Core thesis: creator walks away at hour 0.
    expect(html).toContain('creator walks away');
    // Sleep-mood glyph sits next to the aside copy.
    expect(html).toMatch(/data-mood="sleep"/);
    // Dune dashboard source link — honest data attribution.
    expect(html).toContain('dune.com/l0k1/fourmeme-insights');
    expect(html).toContain('https://dune.com/l0k1/fourmeme-insights');
  });
});
