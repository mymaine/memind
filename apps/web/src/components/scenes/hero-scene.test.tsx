/**
 * Red tests for <HeroScene /> (V4.7-P2 Task 3 / AC-P4.7-2).
 *
 * The scene is the first-paint aha moment — 100vh, left pitch + two CTAs,
 * right live double-sided market animation. Most of the motion lives in its
 * child components (`<UsdcParticleFlow />` / `<TweetTypewriter />`) which
 * already have their own tests; HeroScene's own contract is structural:
 *
 *   1. Renders HERO_PITCH_HOME copy by default (narrative-copy is the
 *      single source of truth for marketing strings).
 *   2. Renders both CTA labels (HERO_CTA_PRIMARY + HERO_CTA_SECONDARY).
 *   3. PRIMARY CTA is an in-page anchor link to the LaunchPanel id.
 *   4. SECONDARY CTA is a Next.js link to `/market#order`.
 *   5. The outer <section> has aria-label="Hero" so screen readers
 *      announce the landmark.
 *   6. With `freeze={true}` the component renders deterministically (no
 *      rAF fired) — static markup contains the `.scene` class so
 *      scroll-reveal wiring stays intact.
 *   7. Copy props override narrative-copy defaults — keeps the component
 *      testable without re-exporting the constants.
 *
 * Strategy: node-env vitest + renderToStaticMarkup. `<Link>` from next/link
 * is fine in a static render — it falls back to a plain <a> server-side so
 * the href assertions work without a Next runtime.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroScene } from './hero-scene.js';
import { HERO_CTA_PRIMARY, HERO_CTA_SECONDARY, HERO_PITCH_HOME } from '../../lib/narrative-copy.js';

/**
 * `freeze={true}` short-circuits the 6s rAF orchestrator so the component
 * renders a deterministic `posted` frame. Required for static-markup tests
 * because rAF never fires in the node env.
 */
function render(props: Parameters<typeof HeroScene>[0] = {}): string {
  return renderToStaticMarkup(<HeroScene freeze {...props} />);
}

describe('<HeroScene /> structural contract', () => {
  it('surfaces HERO_PITCH_HOME as the primary pitch copy', () => {
    expect(render()).toContain(HERO_PITCH_HOME);
  });

  it('renders both CTA labels (HERO_CTA_PRIMARY + HERO_CTA_SECONDARY)', () => {
    const out = render();
    expect(out).toContain(HERO_CTA_PRIMARY);
    expect(out).toContain(HERO_CTA_SECONDARY);
  });

  it('wires the PRIMARY CTA to the default #launch-panel in-page anchor', () => {
    const out = render();
    // Match the anchor whose text contains HERO_CTA_PRIMARY. The href must
    // start with `#` so the browser treats it as an in-page scroll rather
    // than a full-page navigation.
    expect(out).toMatch(/href="#launch-panel"[^>]*>[^<]*Launch a token/);
  });

  it('honours a custom `launchAnchorId` prop for the PRIMARY CTA', () => {
    const out = render({ launchAnchorId: 'custom-anchor' });
    expect(out).toMatch(/href="#custom-anchor"[^>]*>[^<]*Launch a token/);
  });

  it('wires the SECONDARY CTA to /market#order (cross-page anchor)', () => {
    const out = render();
    // next/link renders to a plain <a> in SSR; assert the href verbatim so a
    // future refactor that swaps the tag still surfaces the wiring.
    expect(out).toContain('href="/market#order"');
  });

  it('marks the outer landmark with aria-label="Hero"', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+aria-label="Hero"/);
  });

  it('applies the .scene class on the outer landmark (scene-reveal hook)', () => {
    const out = render();
    // `.scene` is the initial (hidden) state; useScrollReveal toggles
    // `.scene--revealed` on first entry. freeze=true does not disable the
    // reveal path — we just need the class marker present so the CSS rules
    // in globals.css pick up the section.
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene\b/);
  });

  it('allows overriding pitch copy via props (escape hatch for lead peer review)', () => {
    const out = render({ pitch: 'Custom override pitch.' });
    expect(out).toContain('Custom override pitch.');
    // And confirm the default is NOT also present — ensures prop wins.
    expect(out).not.toContain(HERO_PITCH_HOME);
  });
});
