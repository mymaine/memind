/**
 * Tests for <Ch3Solution /> — third chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch3).
 *
 * Ports the interior-progress contract from the design handoff:
 *
 *   - Equation assembly: `step = clamp(p/0.7) * 4`. 4 `.eq-part` slots and
 *     3 `.eq-op` operators toggle `.on` at thresholds
 *     `0.3 / 0.8 / 1.3 / 1.9 / 2.4 / 3.2 / 3.7` (part/op/part/op/part/op/final).
 *   - Brain card hosts a think-mood PixelHumanGlyph (accent primary).
 *   - Wallet card hosts the `⌘` wallet glyph.
 *   - Final MEMIND card lives in an `.eq-final` slot.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch3Solution } from '../ch3-solution.js';

// CSS-regression source for UAT issue #6 — lets us assert the shipped
// .eq-final-card treatment without spinning jsdom.
const GLOBALS_CSS = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');

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

  it('renders the MEMIND final card with think-mood brain + wallet SVG', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={1} />);
    expect(html).toContain('MEMIND');
    // Think-mood brain glyph sits inside the accent card.
    expect(html).toMatch(/data-mood="think"/);
    // Wallet slot used to paint the Mac Command glyph (U+2318). 2026-04-20
    // swap: inline SVG of an actual wallet (billfold silhouette + card
    // slot + clasp). The regression asserts the SVG shape — a rounded
    // rect for the billfold and a filled circle for the card accent —
    // is present, AND that the old Command-key Unicode is gone.
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 32 32"/);
    expect(html).toMatch(/<rect[^>]*rx="2"/);
    expect(html).toMatch(/<circle[^>]*fill="currentColor"/);
    expect(html).not.toContain('\u2318');
  });

  it('renders the headline + foot tagline + ecosystem-flywheel framing', () => {
    const html = renderToStaticMarkup(<Ch3Solution p={0.5} />);
    expect(html).toContain('what if every token had a');
    expect(html).toContain('brain');
    expect(html).toContain('it thinks. it talks. it pays. it shills itself.');
    // 2026-04-20 strategic framing: align the project with four.meme's
    // post-spam governance direction instead of reading as a rival
    // launchpad. The "ecosystem flywheel" line is load-bearing copy.
    expect(html).toContain('ecosystem flywheel');
    expect(html).toContain('four.meme');
  });

  it('MEMIND final card ships glow treatment, not a flat neon slab (UAT issue #6)', () => {
    // UAT: the old `background: var(--accent); color: #050507;` recipe read
    // as an uncomfortable flat block. The fix swaps to an elevated dark
    // surface with accent border + glow. Regression lock the new recipe
    // so a future refactor cannot silently revert the visual treatment.
    //
    // Strip /* ... */ block comments before matching so doc comments that
    // reference the old recipe don't falsely satisfy or reject the regex.
    const stripped = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = stripped.match(/\.eq-final-card\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    // Background must be a dark elevated surface, NOT raw accent.
    expect(body).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(body).not.toMatch(/background:\s*var\(--accent\)\s*;/);
    // Text color flips to accent so MEMIND glows instead of turning dark.
    expect(body).toMatch(/color:\s*var\(--accent\)/);
    // Accent border + box-shadow glow are the contrast carriers.
    expect(body).toMatch(/border:\s*2px\s+solid\s+var\(--accent\)/);
    expect(body).toMatch(/box-shadow:/);
  });
});
