/**
 * Red tests for <EvidenceScene /> (V4.7-P5 Task 2 / AC-P4.7-7).
 *
 * Evidence is the "trust anchor" scene — a fixed set of 5 on-chain artifacts
 * (BSC token, BSC deploy tx, IPFS creator lore CID, two Base Sepolia x402
 * settlement txs) rendered as clickable pills that open the real explorer in
 * a new tab, plus 3 engineering stats badges. The artifact list is pinned to
 * EVIDENCE_ARTIFACTS in narrative-copy.ts — the scene does NOT derive from
 * the current run (per the spec: "fixed demo proof — do NOT derive from the
 * current run"). This also doubles as the target of the Header's Evidence
 * anchor (`#evidence`).
 *
 * Strategy mirrors vision-scene.test.tsx: node-env vitest + renderToStaticMarkup.
 * Client effects (useScrollReveal) never fire under renderToStaticMarkup, so
 * every assertion is purely structural; `freeze` forces `.scene--revealed`
 * for the scroll-independent paint test.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceScene } from './evidence-scene.js';
import { EVIDENCE_ARTIFACTS, STATS_BADGES } from '../../lib/narrative-copy.js';

function render(props: Parameters<typeof EvidenceScene>[0] = {}): string {
  return renderToStaticMarkup(<EvidenceScene {...props} />);
}

/** Truncate helper identical to shortHash used inside evidence-scene so the
 *  test asserts on the same short form the component renders. Kept local so
 *  the test is self-contained. */
function shortHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}..${value.slice(-tail)}`;
}

describe('<EvidenceScene /> structural contract', () => {
  it('mounts the outer landmark with id="evidence" (Header anchor target)', () => {
    // The Header's Evidence nav entry links to `/#evidence`. The outer
    // <section> MUST carry id="evidence" so the anchor resolves on both
    // `/` and `/market`. Task V4.7-P4 Task 10 marked this Roadmap row as
    // unblocked-by this scene — breaking the id breaks the anchor.
    const out = render();
    expect(out).toMatch(/<section[^>]+id="evidence"/);
  });

  it('marks the outer landmark with aria-label="Evidence"', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+aria-label="Evidence"/);
  });

  it('applies the `.scene` class on the outer landmark (scene-reveal hook)', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene\b/);
  });

  it('renders every EVIDENCE_ARTIFACTS short-hash value (5 fixed demo-proof pills)', () => {
    // Spec AC-P4.7-7: 5 artifacts are fixed, read from the narrative-copy
    // constant, not derived from the current run. Assert the short-form
    // each pill displays appears at least once — that pins both the count
    // and the truncation format.
    const out = render();
    for (const artifact of EVIDENCE_ARTIFACTS) {
      expect(out).toContain(shortHash(artifact.value));
    }
  });

  it('renders 5 <a> tags pointing at real explorer URLs with safe rel/target', () => {
    // Every artifact pill is an external link: must open in a new tab with
    // `rel="noopener noreferrer"` (no referrer leak, no opener hijack —
    // see design.md §9 a11y + OWASP target="_blank" advice).
    const out = render();
    for (const artifact of EVIDENCE_ARTIFACTS) {
      // Escape regex-special chars in the URL so the assertion matches
      // literally; URLs contain '/' and '.' which are fine but '?' / ':'
      // would break an unescaped regex.
      const escapedHref = artifact.explorerUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // The anchor tag must include the href, target=_blank, and rel with
      // both noopener and noreferrer. Attribute order is not guaranteed, so
      // match them individually on the same tag.
      const tagRe = new RegExp(`<a[^>]+href="${escapedHref}"[^>]*>`);
      const tag = out.match(tagRe)?.[0];
      expect(tag, `missing pill for ${artifact.explorerUrl}`).toBeDefined();
      expect(tag).toMatch(/target="_blank"/);
      expect(tag).toMatch(/rel="[^"]*noopener[^"]*"/);
      expect(tag).toMatch(/rel="[^"]*noreferrer[^"]*"/);
    }
  });

  it('renders the chain labels BSC / IPFS / BASE (one short label per pill)', () => {
    // The chain badge is what the viewer scans first to recognise which
    // network the artifact lives on. All three labels must appear at least
    // once: BSC (2×), IPFS (1×), BASE (2×).
    const out = render();
    expect(out).toContain('BSC');
    expect(out).toContain('IPFS');
    expect(out).toContain('BASE');
  });

  it('renders every STATS_BADGES string verbatim (427 tests / strict TS / AGPL)', () => {
    // Stats badges are static engineering proof — the copy lives in
    // narrative-copy so edits go through the snapshot review. Assert each
    // string appears verbatim so a drift shows up here, not on demo day.
    const out = render();
    for (const badge of STATS_BADGES) {
      expect(out).toContain(badge);
    }
  });

  it('freeze=true locks the scene into its revealed state (scroll-independent paint)', () => {
    // Mirrors the vision-scene freeze contract: tests bypass the observer
    // so structural markup paints deterministically regardless of IO firing.
    const out = render({ freeze: true });
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene--revealed\b/);
  });
});
