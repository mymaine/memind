/**
 * Tests for <Ch7Saga /> — the lore/saga chapter inserted between Ch6
 * (`order-shill`) and Ch8 (`heartbeat-demo`). Visualises the Narrator
 * persona's `think → write → on-chain` cycle as a single central stage
 * (no two-column chat).
 *
 * Interior progress `p ∈ [0, 1]` drives three acts:
 *   - Act 1 (think) p ∈ [0, 0.30]: thought cloud + 5 keyword tokens drop
 *     in at 0.05 / 0.10 / 0.15 / 0.20 / 0.25 thresholds.
 *   - Act 2 (write) p ∈ [0.30, 0.65]: parchment scroll opens, prose
 *     typewriter advances ~91 chars across the act.
 *   - Act 3 (on-chain) p ∈ [0.65, 1.0]: parchment fades, third chapter
 *     card flies in (status: pinning → pinned → anchored), summary +
 *     closing tagline land in the final 8% / 5%.
 *
 * vitest runs under `node` with no jsdom (matches every existing chapter
 * test), so we render via `renderToStaticMarkup` + regex.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch7Saga } from '../ch7-saga.js';

// CSS-regression source so the chapter-specific .ch-saga rules can be
// asserted without spinning up jsdom.
const GLOBALS_CSS = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');

describe('<Ch7Saga>', () => {
  it('renders the chapter label as CH.07 and the the-saga sub-label', () => {
    const html = renderToStaticMarkup(<Ch7Saga p={0} />);
    expect(html).toContain('CH.07');
    expect(html).toContain('the saga');
    // Headline + sub-mono framing always render regardless of p.
    expect(html).toContain('every token gets a living novel.');
    expect(html).toContain('the brain doesn');
  });

  it('at p=0 mounts the central glyph in `think` mood and shows no typed prose yet', () => {
    const html = renderToStaticMarkup(<Ch7Saga p={0} />);
    expect(html).toMatch(/data-mood="think"/);
    // First scripted prose char should not be visible at p=0 — the prose
    // typewriter only starts at p=0.32.
    expect(html).not.toContain('The frog awoke');
  });

  it('at p=0.06 the first thought-token (frog) is in the DOM but the parchment prose is empty', () => {
    // p just past the 0.05 threshold gives fresh = (0.06-0.05)*30 = 0.3,
    // so the `frog` token renders. The prose typewriter only starts at
    // p >= 0.32 so the parchment body stays empty.
    const html = renderToStaticMarkup(<Ch7Saga p={0.06} />);
    expect(html).toContain('frog');
    expect(html).not.toContain('The frog awoke');
  });

  it('at p=0.5 the parchment prose contains the prefix "The frog awoke"', () => {
    const html = renderToStaticMarkup(<Ch7Saga p={0.5} />);
    // Mood switches to type-keyboard during Act 2.
    expect(html).toMatch(/data-mood="type-keyboard"/);
    expect(html).toContain('The frog awoke');
  });

  it('at p=0.8 the third card status reads "pinning to ipfs"', () => {
    // p ∈ [0.75, 0.85) maps to the pinning-to-ipfs status line.
    const html = renderToStaticMarkup(<Ch7Saga p={0.8} />);
    expect(html).toContain('pinning to ipfs');
    expect(html).not.toContain('anchor #03');
  });

  it('at p=0.93 the third card status reads "anchor #03 · BSC mainnet"', () => {
    const html = renderToStaticMarkup(<Ch7Saga p={0.93} />);
    expect(html).toContain('anchor #03');
    expect(html).toContain('BSC mainnet');
  });

  it('at p=1 the closing tagline + summary line are both in the DOM', () => {
    const html = renderToStaticMarkup(<Ch7Saga p={1} />);
    // Closing tagline bookends Ch2's `creator.offline`.
    expect(html).toContain('creator.online');
    expect(html).toContain('forever');
    // Summary line lands at p >= 0.92.
    expect(html).toContain('chapter 03');
    expect(html).toContain('412 chars');
    // Pre-existing chapter cards stay visible throughout.
    expect(html).toContain('ch.01');
    expect(html).toContain('ch.02');
  });

  it('ships the .ch-saga + .saga-stage shell classes in globals.css', () => {
    // CSS regression — the chapter relies on these classes for layout.
    expect(GLOBALS_CSS).toMatch(/\.ch-saga\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.saga-stage\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.saga-scroll\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.saga-card\s*\{/);
  });
});
