/**
 * Tests for <Ch6Shill /> — shilling-by-chat chapter
 * (memind-scrollytelling-rebuild AC-MSR-9 ch6).
 *
 * Ports the interior-progress contract from the design handoff. Two static
 * chat lines anchor the top of the panel; 3 `tweet-card` elements appear
 * staggered at `t = 0.15 / 0.40 / 0.68` and fade in via
 * `fresh = clamp((p - t) * 12)` with a small translateY.
 *
 * vitest runs under `node` with no jsdom, so we render via
 * `renderToStaticMarkup` + regex.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ch6Shill } from '../ch6-shill.js';

describe('<Ch6Shill>', () => {
  it('at p=0 no tweet-card is rendered (first tweet needs p>0.15)', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={0} />);
    const matches = html.match(/class="tweet-card"/g) ?? [];
    expect(matches).toHaveLength(0);
    // 2026-04-20 fact correction: the real slash command is `/order`
    // (brain.ts:51). The brain response reflects the real $0.01 USDC
    // price on Base Sepolia (x402/config.ts:56), not a scheduled batch.
    expect(html).toContain('/order 0x4E39..74444');
    expect(html).toContain('paying 0.01 USDC on Base Sepolia');
    // Regression guards: kill the old fictional copy.
    expect(html).not.toContain('/shill 3 tweets');
    expect(html).not.toContain('scheduling 3 drops');
    expect(html).not.toContain('0.03 USDC');
  });

  it('at p=0.2 only the first tweet card is rendered (t=0.15 crossed)', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={0.2} />);
    const matches = html.match(/class="tweet-card"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(html).toContain('gm degens');
    expect(html).not.toContain('i dont shill');
    expect(html).not.toContain('they said AI would replace');
  });

  it('at p=0.7 all three tweet cards are rendered (all three t <= 0.68)', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={0.7} />);
    const matches = html.match(/class="tweet-card"/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(html).toContain('gm degens');
    expect(html).toContain('i dont shill');
    expect(html).toContain('they said AI would replace');
  });

  it('renders the @memind_ai handle on every tweet-head', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={1} />);
    const matches = html.match(/@memind_ai/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it('renders the correct like / retweet counts from the script', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={1} />);
    // Tweet 1: 142 likes, 38 rt
    expect(html).toContain('142');
    expect(html).toContain('38');
    // Tweet 2: 890 likes, 201 rt
    expect(html).toContain('890');
    expect(html).toContain('201');
    // Tweet 3: 2104 likes, 612 rt
    expect(html).toContain('2104');
    expect(html).toContain('612');
  });

  it('mounts the pixel-human glyph with mood=megaphone', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={0.3} />);
    expect(html).toMatch(/data-mood="megaphone"/);
    expect(html).toContain('broadcasting');
  });

  it('renders the broadcasting label with the animated dots span (UAT issue #8)', () => {
    // UAT: "broadcasting..." was a static string; the new AnimatedLabel
    // cycles dots on the client so the label visibly "works" during hold.
    const html = renderToStaticMarkup(<Ch6Shill p={0.3} />);
    expect(html).toMatch(
      /class="demo-side-label">broadcasting<span class="demo-side-dots"[^>]*><\/span>/,
    );
  });

  it('tweet cards carry a subtle `sample` badge so scripted copy never reads as live', () => {
    // 2026-04-20: the three tweet cards are scripted placeholders. A low-
    // contrast "sample" badge lands top-right of every card so evidence
    // readers know these are illustrative, not drawn from a real run.
    const html = renderToStaticMarkup(<Ch6Shill p={1} />);
    const badges = html.match(/class="tweet-sample-badge mono"/g) ?? [];
    expect(badges).toHaveLength(3);
  });

  it('side-panel spec cites the real x402 endpoint + $0.01 USDC settlement on Base', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={0.3} />);
    expect(html).toContain('POST /shill/:addr');
    expect(html).toContain('$0.01 USDC');
    expect(html).toContain('base sepolia');
    // Regression: the old "3 tweets / 4h cadence" spec rows are gone.
    expect(html).not.toMatch(/<span[^>]*>cadence<\/span>/);
  });
});
