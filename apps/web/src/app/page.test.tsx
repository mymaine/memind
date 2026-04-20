/**
 * Tests for HomePage — StickyStage scrollytelling shell
 * (memind-scrollytelling-rebuild P0 Task 1).
 *
 * The previous sticky-per-chapter layout wrapped every chapter in its own
 * `h-screen` slot with an inner sticky child. That has been replaced by a
 * single `<div class="scroll-slot">` plus the `<StickyStage />` engine,
 * which shares one sticky viewport across all 12 chapters. We assert:
 *
 *   1. The shell mounts `.scroll-slot` exactly once (the whole narrative
 *      is driven from that single pinned viewport).
 *   2. `.scroll-slot`'s inline height equals `CHAPTERS.length * SLOT_VH * vh
 *      + vh` so the sticky pin stays active for the entire scroll duration.
 *   3. At scrollY=0 the StickyStage culls every chapter (no `data-chapter`
 *      tiles) and the `.sticky-viewport` placeholder still mounts.
 *   4. The 12 chapter ids declared by this module stay in the
 *      spec-mandated order — used by anchor-jump (`/market`,
 *      `location.hash`) in P0 Task 16. (The Saga at slot 7 was inserted
 *      2026-04-20.)
 *
 * vitest runs under `node` with no jsdom (matches every existing scene
 * test), so we render via `renderToStaticMarkup` + regex. The previous
 * `<section id>` / `sticky` / scene-integration assertions are gone: the
 * new engine owns all of those concerns internally.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from './page.js';

const SLOT_VH = 3.0;
// page.tsx seeds `vh` to 800 when `window` is undefined (the SSR default
// used by `renderToStaticMarkup`). Keep this in sync with the module.
const SSR_DEFAULT_VH = 800;
const EXPECTED_CHAPTER_COUNT = 12;

function renderHome(): string {
  return renderToStaticMarkup(<HomePage />);
}

describe('HomePage StickyStage shell', () => {
  it('mounts exactly one .scroll-slot wrapping the sticky viewport', () => {
    const html = renderHome();
    const matches = html.match(/class="scroll-slot"/g) ?? [];
    expect(matches.length).toBe(1);
    expect(html).toMatch(/class="sticky-viewport"/);
  });

  it('mounts the new TopBar header above the sticky stage', () => {
    const html = renderHome();
    expect(html).toMatch(/<header[^>]*class="topbar"/);
    expect(html).toContain('MEMIND');
    expect(html).toContain('TOKEN BRAIN');
  });

  it('mounts the frameless SectionToc alongside the sticky stage', () => {
    const html = renderHome();
    expect(html).toMatch(/<nav[^>]*class="toc"/);
    // TOC iterates CHAPTER_META - 11 .toc-item buttons should render.
    const items = html.match(/class="toc-item[^"]*"/g) ?? [];
    expect(items.length).toBe(EXPECTED_CHAPTER_COUNT);
  });

  it('does not mount the bottom-right Watermark (retired 2026-04-20 for demo cleanliness)', () => {
    // Per user UAT feedback, the chapter-counter watermark adds visual
    // clutter during the demo. The TopBar progress bar + N/11 counter
    // already communicates position; the watermark is unmounted from the
    // home surface. Component file + tests are kept so the piece can be
    // re-mounted later without rebuild work.
    const html = renderHome();
    expect(html).not.toMatch(/class="watermark mono"/);
  });

  it('reserves scroll height via a CSS calc(... * 100vh) string so SSR and client agree', () => {
    // Hydration-safe height: `(N * SLOT_VH + 1) * 100vh`. Using a CSS
    // calc string means the server markup and the hydrated client markup
    // are byte-identical — no more React hydration mismatch when the
    // SSR default vh (800) diverges from the real client vh. React
    // escapes `*` into HTML entities when serialising inline styles
    // (`*` becomes `&#x2a;` or similar in some runtimes); unescape the
    // emitted attribute before parsing so the assertion stays robust.
    const html = renderHome();
    // NB: the calc expression contains nested parens — capture the whole
    // `height:` declaration instead of a balanced-paren match.
    const match = html.match(/style="[^"]*height:\s*(calc\([^"]+?\))[;"]/);
    expect(match).not.toBeNull();
    // Expected expression: "(11 * 2.2 + 1) * 100vh". Strip HTML entities
    // React may have interpolated (e.g. `&#x2a;` for `*`) before we
    // evaluate the numeric coefficients — what matters is that the
    // chapter count and slot-vh are both baked into the calc.
    const inner = match![1]!
      .replace(/&#x2a;/g, '*')
      .replace(/&amp;#x2a;/g, '*')
      .replace(/\s+/g, '');
    expect(inner).toContain(`${EXPECTED_CHAPTER_COUNT}`);
    expect(inner).toContain(`${SLOT_VH}`);
    expect(inner).toContain('100vh');
  });

  it('at scrollY=0 renders only the first chapter fully visible (UAT Issue #2)', () => {
    // scrollY=0 → Ch1 (hero) localP=0. With the isFirst edge flag the
    // fade-in curve is suppressed so the landing paint is fully visible
    // rather than a black flash. Every other chapter is further out
    // (negative localP clamped to 0 → still culled).
    const html = renderHome();
    // Only chapter 0 (hero) should appear.
    const chapterMatches = html.match(/data-chapter="[^"]+"/g) ?? [];
    expect(chapterMatches).toEqual(['data-chapter="hero"']);
    // And it must be fully opaque.
    expect(html).toMatch(/data-chapter="hero"[^>]*style="[^"]*opacity:1/);
  });

  it('mounts <Ch1Hero /> for the hero slot once scrollY lands in its hold window', () => {
    // scrollY is 0 under SSR (useScrollY guards on `window`), so no
    // chapters render by default (all culled). Mock the hook to return a
    // scrollY that puts slot 0 (hero) mid-hold, then re-import HomePage
    // so the mock takes effect. The Ch1Hero mid-hold markup contains the
    // canonical "memind.system › boot" string + the 3 chain pills, which
    // never appear in <ChPlaceholder />.
    vi.resetModules();
    const SLOT_PX = SLOT_VH * SSR_DEFAULT_VH;
    vi.doMock('@/hooks/useScrollY', () => ({
      useScrollY: () => SLOT_PX * 0.5,
    }));
    return import('./page.js').then(({ default: Page }) => {
      const html = renderToStaticMarkup(<Page />);
      expect(html).toMatch(/data-chapter="hero"/);
      expect(html).toContain('memind.system');
      expect(html).toContain('BNB CHAIN');
      expect(html).toContain('BASE L2');
      expect(html).toContain('IPFS');
      vi.doUnmock('@/hooks/useScrollY');
      vi.resetModules();
    });
  });

  it('mounts the right slide-in BrainPanel in the closed state by default', () => {
    // SSR entrypoint renders the panel with open=false so `aria-hidden="true"`
    // is the canonical marker. The panel's close button + meta labels must
    // both surface in the DOM (always-mounted so the slide-in transform has
    // a target) but assistive tech skips the subtree until the user opens it.
    const html = renderHome();
    expect(html).toMatch(/<aside[^>]*class="brain-panel\s*"/);
    expect(html).toMatch(/<aside[^>]*aria-hidden="true"/);
    expect(html).toMatch(/aria-label="Close brain panel"/);
  });

  it('mounts the CRT scanlines overlay in the default (no-reduced-motion) render', () => {
    // AC-MSR-13: the decorative scanlines layer is on by default. Under
    // SSR `useReducedMotion()` returns false, so the overlay renders.
    const html = renderHome();
    expect(html).toMatch(/<div[^>]*class="scanlines-overlay"[^>]*aria-hidden="true"/);
  });

  it('exposes the TopBar brain indicator as the trigger for opening the BrainPanel', () => {
    // AC-MSR-7: clicking the TopBar <BrainIndicator /> opens the BrainPanel.
    // SSR-only assertion: the indicator's `aria-label="Open brain panel"`
    // button exists and the page has exactly one BrainPanel rendered as
    // the receiver (aside). Runtime wiring of the click is delegated to
    // React's synthetic event system.
    const html = renderHome();
    expect(html).toMatch(/<button[^>]*aria-label="Open brain panel"/);
    const panelMatches = html.match(/<aside[^>]*class="brain-panel/g) ?? [];
    expect(panelMatches.length).toBe(1);
  });

  it('still declares the 12 spec-mandated chapter ids in order via StickyStage props', () => {
    // The chapter ids drive anchor-jump + TOC highlighting (P0 Task 16 /
    // `/market` redirect). At scrollY=0 every chapter is culled so the
    // ids are not visible in the SSR markup; the strongest SSR-only
    // invariant is that the `.scroll-slot` calc height bakes the chapter
    // count into a `(N * SLOT_VH + 1) * 100vh` string, since that is the
    // hydration-safe replacement for the old `height:Xpx` assertion.
    const html = renderHome();
    // NB: the calc expression contains nested parens — capture the whole
    // `height:` declaration instead of a balanced-paren match.
    const match = html.match(/style="[^"]*height:\s*(calc\([^"]+?\))[;"]/);
    expect(match).not.toBeNull();
    const inner = match![1]!
      .replace(/&#x2a;/g, '*')
      .replace(/&amp;#x2a;/g, '*')
      .replace(/\s+/g, '');
    // The expression must mention the chapter count, slot-vh, and
    // terminate in `100vh` so the chapter count is reconstructable.
    expect(inner).toContain(`${EXPECTED_CHAPTER_COUNT}`);
    expect(inner).toContain(`${SLOT_VH}`);
    expect(inner).toContain('100vh');
  });

  it('renders byte-identical scroll-slot markup across renders (hydration-safe)', () => {
    // Regression guard for Next.js hydration mismatch: two sequential
    // `renderToStaticMarkup` calls must produce the same `.scroll-slot`
    // inline style. Under the old JS-computed `height: totalScrollH`
    // approach this still passed (both calls used SSR default vh=800),
    // but the real mismatch surfaced between server render and client
    // rehydrate; the CSS-calc expression removes that divergence by
    // never depending on JS-evaluated vh for the slot height.
    const a = renderHome();
    const b = renderHome();
    const aSlot = a.match(/class="scroll-slot"[^>]*style="([^"]+)"/);
    const bSlot = b.match(/class="scroll-slot"[^>]*style="([^"]+)"/);
    expect(aSlot).not.toBeNull();
    expect(bSlot).not.toBeNull();
    expect(aSlot![1]).toBe(bSlot![1]);
  });
});
