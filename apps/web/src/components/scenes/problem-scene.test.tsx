/**
 * Red tests for <ProblemScene /> (V4.7-P3 Task 1 / AC-P4.7-3).
 *
 * The scene sits after Hero and before Solution — an 80vh band whose
 * background is a slow marquee of fake memecoin ticker pills (evoking the
 * "32,000 tokens in one October 2025 day" image from PROBLEM_SUBCOPY) and
 * whose foreground is a large headline + subcopy callout.
 *
 * Most of the motion is visual (CSS marquee + IntersectionObserver play/
 * pause) — ProblemScene's own contract, tested here, is structural:
 *
 *   1. Renders PROBLEM_HEADLINE verbatim (narrative-copy is single source).
 *   2. Renders PROBLEM_SUBCOPY verbatim (contains "32,000" + "October 2025").
 *   3. Outer <section> has aria-label="Problem" for landmark a11y.
 *   4. Default render contains every DEFAULT_TICKER_TOKENS entry — the bg
 *      marquee is populated from the component's const list.
 *   5. `tickerPlayState='paused'` prop surfaces a `ticker--paused` class on
 *      the ticker container so the CSS animation freezes without unmount.
 *   6. Copy overrides (`headline` / `subcopy` props) win over narrative
 *      defaults — same escape hatch pattern as HeroScene.
 *   7. `tickerTokens` override replaces the default list; passing
 *      `['$ONE','$TWO']` renders only those tokens (no stale defaults).
 *   8. The outer <section> carries the `.scene` class so globals.css
 *      scene-reveal CSS (AC-P4.7-8) still picks it up.
 *
 * Strategy: node-env vitest + renderToStaticMarkup, mirroring hero-scene.
 * renderToStaticMarkup skips client effects, so useScrollReveal and the
 * ticker IntersectionObserver never fire — perfect for structural assertions.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProblemScene } from './problem-scene.js';
import { PROBLEM_HEADLINE, PROBLEM_SUBCOPY } from '../../lib/narrative-copy.js';

/** Default DOM-rendered ticker tokens — kept in sync with problem-scene.tsx
 *  so this test file does not import a private constant (which would force
 *  an export purely for tests). Any drift in the component const will fail
 *  the `renders every default ticker token` test below, forcing a review. */
const EXPECTED_DEFAULT_TOKENS = [
  '$PEPE2.0',
  '$MOON69',
  '$WIF',
  '$SHIBX',
  '$FLOKI4',
  '$BONK99',
  '$DOGE9',
  '$FROG',
  '$CATDAO',
  '$ELON',
  '$TRUMP',
  '$KANYE',
  '$SATO',
  '$BITCOIN2',
];

function render(props: Parameters<typeof ProblemScene>[0] = {}): string {
  return renderToStaticMarkup(<ProblemScene {...props} />);
}

describe('<ProblemScene /> structural contract', () => {
  it('surfaces PROBLEM_HEADLINE as the foreground headline', () => {
    expect(render()).toContain(PROBLEM_HEADLINE);
  });

  it('surfaces PROBLEM_SUBCOPY (with "32,000" + "October 2025") as subcopy', () => {
    const out = render();
    expect(out).toContain(PROBLEM_SUBCOPY);
    // Belt-and-braces: the narrative hinges on these two tokens. If a future
    // copy edit drops either, the scene's whole purpose (the 32k image)
    // evaporates — snapshot equality on PROBLEM_SUBCOPY guards the full
    // string, but an explicit substring check makes the intent obvious.
    expect(out).toContain('32,000');
    expect(out).toContain('October 2025');
  });

  it('marks the outer landmark with aria-label="Problem"', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+aria-label="Problem"/);
  });

  it('renders every DEFAULT_TICKER_TOKENS entry in the bg marquee', () => {
    const out = render();
    for (const token of EXPECTED_DEFAULT_TOKENS) {
      expect(out).toContain(token);
    }
  });

  it('applies `ticker--paused` class when tickerPlayState="paused"', () => {
    const out = render({ tickerPlayState: 'paused' });
    // `.ticker--paused` is a scoped class on the ticker wrapper that freezes
    // the CSS animation via animation-play-state: paused. Tests + reduced-
    // motion share this path.
    expect(out).toMatch(/class="[^"]*\bticker--paused\b/);
  });

  it('applies `.scene` class on the outer landmark (scene-reveal hook)', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene\b/);
  });

  it('allows overriding headline + subcopy via props (single-source escape hatch)', () => {
    const out = render({
      headline: 'Custom problem headline.',
      subcopy: 'Custom subcopy text.',
    });
    expect(out).toContain('Custom problem headline.');
    expect(out).toContain('Custom subcopy text.');
    // Defaults must NOT leak — prop fully wins.
    expect(out).not.toContain(PROBLEM_HEADLINE);
    expect(out).not.toContain(PROBLEM_SUBCOPY);
  });

  it('allows overriding tickerTokens — only the supplied entries render', () => {
    const out = render({ tickerTokens: ['$ONE', '$TWO'] });
    expect(out).toContain('$ONE');
    expect(out).toContain('$TWO');
    // None of the defaults leak through when the override replaces the list.
    for (const token of EXPECTED_DEFAULT_TOKENS) {
      expect(out).not.toContain(token);
    }
  });
});
