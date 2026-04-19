/**
 * Red tests for <VisionScene /> (V4.7-P5 Task 1 / AC-P4.7-6).
 *
 * Vision is the "why this is a primitive, not a feature" scene. Three
 * sub-blocks share a single 80vh `<section>`:
 *
 *   1. SKU expansion matrix    — 4 cards (Shill / Launch Boost /
 *      Community Ops / Alpha Feed, all sell-side per AGENTS.md hard rule
 *      #2). Only Shill (status='shipped') carries the accent breathing
 *      border; the other three render in a muted variant.
 *   2. Take-rate projection    — three equal-weight cards (demo floor /
 *      real-world pricing / multi-SKU TAM). No bar chart — the prior SVG
 *      anchored the eye on the $1.6/d demo-floor figure, exactly the framing
 *      this redesign exists to correct.
 *   3. Agent Commerce Primitive phase map — 3 horizontal nodes (Phase 1 / 2 /
 *      3). Phase 2 (this project) is highlighted with the `signal-pulse`
 *      animation; Phase 1 / 3 render in the default, non-highlighted variant.
 *
 * Testing strategy mirrors hero / problem / solution scenes: node-env vitest
 * with renderToStaticMarkup. Client effects (useScrollReveal) do not fire under
 * renderToStaticMarkup, so every assertion is purely structural. The `freeze`
 * prop forces `.scene--revealed` so markup paints deterministically.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisionScene } from './vision-scene.js';
import { VISION_SKUS, VISION_TAKERATE, PHASE_MAP } from '../../lib/narrative-copy.js';

function render(props: Parameters<typeof VisionScene>[0] = {}): string {
  return renderToStaticMarkup(<VisionScene {...props} />);
}

/**
 * Extract the class attribute of the element carrying a given data-testid,
 * regardless of attribute order. React renders attributes in prop-declaration
 * order so we cannot assume `data-testid` comes after `class`; a simple
 * positional regex would fail. This helper returns the class string (or
 * `undefined`) so callers can assert on it with a plain substring / regex.
 */
function classForTestid(html: string, testid: string): string | undefined {
  // Match `<tag ...attrs... data-testid="${testid}" ...attrs...>` in either
  // order: grab every attribute chunk and scan for class="...".
  const escaped = testid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRe = new RegExp(`<[a-zA-Z][^>]*data-testid="${escaped}"[^>]*>`);
  const tag = html.match(tagRe)?.[0];
  if (!tag) return undefined;
  const classMatch = tag.match(/\sclass="([^"]*)"/);
  return classMatch?.[1];
}

describe('<VisionScene /> structural contract', () => {
  it('marks the outer landmark with aria-label="Vision"', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+aria-label="Vision"/);
  });

  it('applies the `.scene` class on the outer landmark (scene-reveal hook)', () => {
    const out = render();
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene\b/);
  });

  it('renders every VISION_SKUS name (Shill / Launch Boost / Community Ops / Alpha Feed)', () => {
    const out = render();
    for (const sku of VISION_SKUS) {
      expect(out).toContain(sku.name);
    }
  });

  it('marks the shipped SKU (Shill) with the `sku-card--shipped` class', () => {
    const out = render();
    // A single shipped SKU exists in narrative-copy; it MUST carry the
    // breathing-border variant so reduced-motion CSS can collapse it to a
    // static glow (per reduced-motion matrix "Vision SKU pulse" row).
    const cls = classForTestid(out, 'sku-card-Shill');
    expect(cls).toBeDefined();
    expect(cls).toMatch(/\bsku-card--shipped\b/);
  });

  it('does NOT mark the non-shipped SKUs (Launch Boost / Community Ops / Alpha Feed) as shipped', () => {
    const out = render();
    for (const sku of VISION_SKUS) {
      if (sku.status === 'shipped') continue;
      // Extract the class attribute for each non-shipped SKU card and assert
      // the shipped marker class is absent. A shared container class ("sku-card")
      // is expected; only the variant class ("sku-card--shipped") must be
      // absent on non-shipped cards.
      const cls = classForTestid(out, `sku-card-${sku.name}`);
      expect(cls).toBeDefined();
      expect(cls).not.toMatch(/\bsku-card--shipped\b/);
    }
  });

  it('renders the demo-floor tier with the literal $1.6/d number (proof, not projection)', () => {
    const out = render();
    // The demo-floor card must still surface $1.6/d so judges can tie the
    // number to the live x402 transactions. It is flanked by real-world and
    // multi-SKU cards so nobody mistakes the floor for the ceiling.
    expect(out).toContain(VISION_TAKERATE.demoFloor.formula);
    expect(out).toContain('$1.6/d');
  });

  it('renders the real-world tier with the $320–$1,600/d band and $117k lower-bound annual', () => {
    const out = render();
    expect(out).toContain(VISION_TAKERATE.realWorld.formula);
    expect(out).toContain(VISION_TAKERATE.realWorld.result);
    expect(out).toContain('$117k');
  });

  it('renders every multi-SKU TAM row plus the ~$2M/y headline', () => {
    const out = render();
    for (const row of VISION_TAKERATE.multiSkuTam.breakdown) {
      expect(out).toContain(row.sku);
      expect(out).toContain(row.annual);
    }
    expect(out).toContain(VISION_TAKERATE.multiSkuTam.total);
    expect(out).toContain('$2M');
  });

  it('does not render any <svg> chart (bar chart removed in the three-tier redesign)', () => {
    const out = render();
    // The prior revision shipped a hand-drawn SVG bar chart. It was removed
    // because it visually anchored the eye on the $1.6/d demo-floor figure —
    // the exact framing this redesign exists to correct.
    expect(out).not.toMatch(/<svg\b/);
    expect(out).not.toMatch(/role="img"/);
  });

  it('renders every PHASE_MAP name (Agent Skill Framework / Agent Commerce Primitive / Agent Economic Loop)', () => {
    const out = render();
    for (const node of PHASE_MAP) {
      expect(out).toContain(node.name);
    }
  });

  it('highlights Phase 2 with the `phase-node--highlighted` class and signal-pulse', () => {
    const out = render();
    // The highlighted phase (Phase 2) is this project — the viewer must
    // register it as "you are here". We assert both the semantic class and
    // the animation class so reduced-motion CSS can target either.
    const cls = classForTestid(out, 'phase-node-2');
    expect(cls).toBeDefined();
    expect(cls).toMatch(/\bphase-node--highlighted\b/);
    expect(cls).toMatch(/\bsignal-pulse\b/);
  });

  it('does NOT highlight Phase 1 / Phase 3 (single-primary invariant)', () => {
    const out = render();
    for (const phaseId of [1, 3]) {
      const cls = classForTestid(out, `phase-node-${phaseId.toString()}`);
      expect(cls).toBeDefined();
      expect(cls).not.toMatch(/\bphase-node--highlighted\b/);
      expect(cls).not.toMatch(/\bsignal-pulse\b/);
    }
  });

  it('freeze=true locks the scene into its revealed state (scroll-independent paint)', () => {
    const out = render({ freeze: true });
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene--revealed\b/);
  });
});
