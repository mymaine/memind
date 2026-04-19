/**
 * Tests for <Ch1Hero /> — first chapter of the scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch1).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch1Hero
 * (lines 37-71):
 *
 *   - Type-on `"Pay USDC. Get tweets."` across p ∈ [0, 0.5]
 *   - Glyph translates on X across p ∈ [0.2, 0.9]
 *   - Mood switches: walk-right → celebrate (p > 0.5) → sunglasses (p > 0.7)
 *   - 3 chain pills anchor the bottom row
 *
 * vitest runs under `node` with no jsdom (matches every existing scene +
 * sticky-stage test), so we render via `renderToStaticMarkup` + regex.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch1Hero } from '../ch1-hero.js';

// Absolute path to globals.css — lets the CSS-regression tests below
// assert shipped spacing rules without spinning up jsdom.
const GLOBALS_CSS = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');

const FULL = 'Pay USDC. Get tweets.';

describe('<Ch1Hero>', () => {
  it('at p=0 the typed string is empty but the blinking caret still renders', () => {
    const html = renderToStaticMarkup(<Ch1Hero p={0} />);
    // ch-headline content starts with the typed span (empty) followed by
    // the caret. Assert both shapes are present.
    expect(html).toMatch(/class="ch-headline"/);
    expect(html).toMatch(/class="caret"/);
    // Full string should NOT appear at p=0 (no letters typed yet).
    expect(html).not.toContain(FULL);
  });

  it('at p=0.25 the typed length matches the type-on curve (Math.floor(0.5 * len))', () => {
    // p/0.5 = 0.5 → floor(0.5 * 21) = 10 characters ("Pay USDC. ")
    const html = renderToStaticMarkup(<Ch1Hero p={0.25} />);
    const expectedPrefix = FULL.slice(0, Math.floor(0.5 * FULL.length));
    expect(expectedPrefix).toBe('Pay USDC. ');
    // The prefix must appear inside the headline span; the full sentence
    // must NOT appear yet.
    expect(html).toContain(expectedPrefix);
    expect(html).not.toContain(FULL);
  });

  it('at p=0.5 the full sentence is revealed', () => {
    const html = renderToStaticMarkup(<Ch1Hero p={0.5} />);
    expect(html).toContain(FULL);
  });

  it('at p=0.4 the mood stays walk-right (<= 0.5 threshold)', () => {
    const html = renderToStaticMarkup(<Ch1Hero p={0.4} />);
    expect(html).toMatch(/data-mood="walk-right"/);
    expect(html).not.toMatch(/data-mood="celebrate"/);
    expect(html).not.toMatch(/data-mood="sunglasses"/);
  });

  it('at p=0.6 the mood switches to celebrate (> 0.5 and <= 0.7)', () => {
    const html = renderToStaticMarkup(<Ch1Hero p={0.6} />);
    expect(html).toMatch(/data-mood="celebrate"/);
    expect(html).not.toMatch(/data-mood="sunglasses"/);
  });

  it('at p=0.8 the mood advances to sunglasses (> 0.7)', () => {
    const html = renderToStaticMarkup(<Ch1Hero p={0.8} />);
    expect(html).toMatch(/data-mood="sunglasses"/);
  });

  it('renders the three chain pills (BNB CHAIN, BASE L2, IPFS) at any progress', () => {
    const html = renderToStaticMarkup(<Ch1Hero p={0.5} />);
    expect(html).toContain('BNB CHAIN');
    expect(html).toContain('BASE L2');
    expect(html).toContain('IPFS');
    // All three live inside a .ch-hero-chainrow flex row
    expect(html).toMatch(/class="ch-hero-chainrow"/);
  });

  it('uses translateX on the glyph container to drive horizontal motion', () => {
    // At p=0.5 the formula (p-0.2)/0.7 = 0.428..., lerp(-120, 120, 0.428)
    // ≈ -17px — any non-zero finite translateX proves the wiring without
    // re-deriving the curve here.
    const html = renderToStaticMarkup(<Ch1Hero p={0.5} />);
    expect(html).toMatch(/class="ch-hero-glyph"[^>]*style="transform:translateX\(-?\d/);
  });

  it('leaves breathing room between .ch-hero-sub and .ch-hero-bottom (UAT issue #4)', () => {
    // UAT reported the sub-headline `> give every meme coin an AI brain`
    // and the BNB/BASE/IPFS chain-pill row were visually touching. The
    // fix ships as CSS: sub gets margin-bottom, bottom row gets margin-top.
    // Regression lock the minimum values so a future cleanup cannot
    // regress the spacing without also updating this test.
    expect(GLOBALS_CSS).toMatch(
      /\.ch-hero-sub\s*\{[^}]*margin-bottom:\s*(?:4[0-9]|[5-9]\d|\d{3,})px/,
    );
    expect(GLOBALS_CSS).toMatch(
      /\.ch-hero-bottom\s*\{[^}]*margin-top:\s*(?:1[6-9]|[2-9]\d|\d{3,})px/,
    );
  });
});
