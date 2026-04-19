/**
 * Red tests for <SectionTocView /> — the pure presentational piece behind
 * the sticky left-side TOC (immersive-single-page P1 Task 2 / AC-ISP-3).
 *
 * The runtime <SectionToc /> is a client shell that wires
 * `useSectionObserver` to live browser state; tests exercise the view layer
 * via renderToStaticMarkup with explicit props. This mirrors the
 * <HeaderView /> / <BrainStatusBarView /> split convention.
 *
 * We assert five behaviours per the V4.7-P5 brief:
 *   1. All 11 spec sections render as <a href="#..."> anchor links.
 *   2. The item matching the active section carries aria-current="true".
 *   3. The active item includes a visible 2px accent border marker.
 *   4. The TOC root is `hidden md:flex` so sub-md viewports do not see it.
 *   5. Each link is a native anchor (keyboard focusable via Tab without
 *      needing extra wiring) with an explicit href.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SECTION_TOC_ITEMS, SectionTocView } from './section-toc.js';

function render(activeId: string | null): string {
  return renderToStaticMarkup(<SectionTocView activeId={activeId} items={SECTION_TOC_ITEMS} />);
}

describe('SECTION_TOC_ITEMS', () => {
  it('lists exactly the 11 spec-mandated sections in order', () => {
    const ids = SECTION_TOC_ITEMS.map((i) => i.id);
    expect(ids).toEqual([
      'hero',
      'problem',
      'solution',
      'brain-architecture',
      'launch-demo',
      'order-shill',
      'heartbeat-demo',
      'take-rate',
      'sku-matrix',
      'phase-map',
      'evidence',
    ]);
  });
});

describe('<SectionTocView />', () => {
  it('renders every item as an <a href="#<id>"> anchor link', () => {
    const out = render(null);
    for (const item of SECTION_TOC_ITEMS) {
      expect(out).toContain(`href="#${item.id}"`);
    }
  });

  it('marks the active item with aria-current="true"', () => {
    const out = render('problem');
    // The `problem` anchor should carry aria-current="true"; other anchors
    // must not (we assert that only one total aria-current is emitted).
    expect(out).toMatch(/aria-current="true"[^>]*>[^<]*Problem/);
    const matches = out.match(/aria-current="true"/g);
    expect(matches?.length).toBe(1);
  });

  it('applies an accent left-border marker class to the active item', () => {
    const activeOut = render('solution');
    // The active item should include an accent left-border marker. We assert
    // the border classes the view uses so a future style refactor has to
    // change both the component and this test in lockstep.
    expect(activeOut).toMatch(/border-l-2[\s\S]*border-accent[\s\S]*font-semibold/);
  });

  it('is hidden on sub-md viewports (`hidden md:flex`)', () => {
    const out = render(null);
    // The root <nav> must gate visibility behind the md breakpoint so mobile
    // viewers fall back to the Header navigation per AC-ISP-3.
    expect(out).toMatch(/<nav[^>]*class="[^"]*hidden[^"]*md:flex[^"]*"/);
  });

  it('wraps items in a <nav aria-label> landmark for assistive tech', () => {
    const out = render(null);
    expect(out).toMatch(/<nav[^>]+aria-label="Page sections"/);
  });

  it('renders non-active entries without aria-current so screen readers only announce one active item', () => {
    const out = render('hero');
    const currentMatches = out.match(/aria-current="/g) ?? [];
    expect(currentMatches.length).toBe(1);
  });
});
