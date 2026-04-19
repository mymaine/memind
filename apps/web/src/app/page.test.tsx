/**
 * Red tests for HomePage (immersive-single-page P1 Task 1 / AC-ISP-2).
 *
 * The immersive single-page pivot collapses `/` + `/market` into one
 * scroll-driven surface with 11 ordered sections. Each section MUST carry
 * a unique `id` so the future sticky TOC + `/market → /#order-shill`
 * redirect can target it. The 11-section order is also the spec's story
 * order (narrative → operation → business → evidence) and cannot change
 * without spec revision.
 *
 * Testing strategy mirrors the scene-level tests: node-env vitest +
 * `renderToStaticMarkup`. Client effects inside the page (`useRun`,
 * `useScrollReveal`, rAF loops) are skipped under static render, so every
 * assertion here is purely structural.
 *
 * The outer sections wrapping the reused scenes (hero / problem / solution
 * / take-rate host / evidence) currently render as `<section id="..."
 * className="scene ...">` in page.tsx — nested sections are valid HTML and
 * the wrapper exists only to expose the stable section id without mutating
 * the scene's own markup. Placeholder sections for T4/T5 work (brain-
 * architecture / launch-demo / order-shill / heartbeat-demo / sku-matrix /
 * phase-map) are empty stubs until their scenes land.
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
