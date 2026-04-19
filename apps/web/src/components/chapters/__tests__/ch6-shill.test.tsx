/**
 * Tests for <Ch6Shill /> — shilling-by-chat chapter
 * (memind-scrollytelling-rebuild AC-MSR-9 ch6).
 *
 * Ports the interior-progress contract from
 * `docs/design/memind-handoff/project/components/chapters.jsx` Ch6Shill
 * (lines 307-366). Two static chat lines anchor the top of the panel;
 * 3 `tweet-card` elements appear staggered at `t = 0.15 / 0.40 / 0.68`
 * and fade in via `fresh = clamp((p - t) * 12)` with a small translateY.
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
    // The two static chat lines still mount (opacity is driven by inline
    // style, not conditional rendering).
    expect(html).toContain('/shill 3 tweets, 4 hours apart');
    expect(html).toContain('scheduling 3 drops');
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

  it('renders the @pepesupreme_ai handle on every tweet-head', () => {
    const html = renderToStaticMarkup(<Ch6Shill p={1} />);
    const matches = html.match(/@pepesupreme_ai/g) ?? [];
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
});
