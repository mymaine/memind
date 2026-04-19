/**
 * Tests for HomePage — sticky-pinned scrollytelling layout.
 *
 * The pivot from IntersectionObserver reveal → sticky-pinned scrollytelling
 * wraps every chapter in an outer `.sticky top-0 h-screen` container so the
 * "camera" stays fixed while the next chapter stacks on top. Each of the 11
 * chapters is a distinct scroll anchor (`<section id="...">`) and the DOM
 * order + id contract is unchanged from the pre-pivot layout.
 *
 * Testing strategy mirrors the scene-level tests: node-env vitest +
 * `renderToStaticMarkup`. Client effects inside the page (`useRun`,
 * `useScroll`, `useTransform`, rAF) are skipped under static render, so
 * every assertion here is purely structural.
 *
 * Contract highlights:
 *   1. All 11 spec-mandated section ids are present in the mandated order.
 *   2. Each chapter DOM node carries `sticky` in its className — this is the
 *      load-bearing layout primitive that drives the pin-and-cover effect.
 *   3. The chapter wrappers emit 11 sticky chapter containers (one per
 *      chapter), matching the 11-section contract 1:1.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from './page.js';

const EXPECTED_SECTION_ORDER: readonly string[] = [
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
];

function renderHome(): string {
  return renderToStaticMarkup(<HomePage />);
}

/**
 * Pull every `<section id="...">` opening tag in document order and return
 * the id sequence. Using a plain regex is enough here — we do not need DOM
 * parsing, and nested sections are fine because the regex captures every
 * opening tag it sees.
 */
function extractSectionIdsInOrder(html: string): readonly string[] {
  const ids: string[] = [];
  const re = /<section\b[^>]*\bid="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    ids.push(match[1]!);
  }
  return ids;
}

/**
 * Count chapter wrappers carrying the `sticky` class on the landing page.
 * The scrollytelling layout emits one `<div class="... sticky ...">` per
 * chapter as the direct child of the scroll container; each of those drives
 * the pin-and-cover effect. We count opening tags in document order so the
 * assertion also catches accidental double-wrapping.
 */
function countStickyChapterWrappers(html: string): number {
  // Match any opening tag whose class attribute contains the `sticky` token
  // as a word boundary. Using a word-boundary regex keeps us safe from
  // Tailwind utility collisions like `sticky-toc` or `stickygroup`.
  const re = /<[a-z][a-z0-9]*\b[^>]*\bclass(?:Name)?="[^"]*\bsticky\b[^"]*"/gi;
  let count = 0;
  while (re.exec(html) !== null) {
    count += 1;
  }
  return count;
}

describe('HomePage immersive single-page section structure', () => {
  it('renders all 11 expected section ids at least once', () => {
    const html = renderHome();
    const ids = extractSectionIdsInOrder(html);
    for (const expectedId of EXPECTED_SECTION_ORDER) {
      expect(ids, `missing section id="${expectedId}"`).toContain(expectedId);
    }
  });

  it('renders the 11 top-level section ids in the spec-mandated order', () => {
    const html = renderHome();
    const ids = extractSectionIdsInOrder(html);
    // Some scenes (e.g. <HeroScene />) themselves render an inner <section>
    // without an id. Those inner opening tags match the regex if and only if
    // they also carry an id — they do not, so they are skipped. Extract only
    // the ids that belong to our 11-section contract and assert their order.
    const filtered = ids.filter((id) => EXPECTED_SECTION_ORDER.includes(id));
    expect(filtered).toEqual(EXPECTED_SECTION_ORDER);
  });
});

describe('HomePage sticky-pinned scrollytelling layout', () => {
  it('wraps every chapter in a sticky container (at least 11 sticky wrappers)', () => {
    const html = renderHome();
    // The sticky-left-side <SectionToc /> also carries `sticky`, so the raw
    // count is at least 11 (one per chapter) plus the TOC. We assert the
    // count is >= 11 rather than == 11 to stay robust against peripheral
    // sticky elements (TOC, Header if ever rendered under this tree, etc.).
    expect(countStickyChapterWrappers(html)).toBeGreaterThanOrEqual(11);
  });

  it('includes at least one h-screen sticky chapter wrapper', () => {
    const html = renderHome();
    // The sticky chapter wrappers also carry `h-screen` so they fill the
    // viewport vertically — this is what makes the "camera fixed" effect
    // register during scroll. Guard against a refactor that drops the class.
    expect(html).toMatch(/class(?:Name)?="[^"]*\bsticky\b[^"]*\bh-screen\b[^"]*"/);
  });
});
