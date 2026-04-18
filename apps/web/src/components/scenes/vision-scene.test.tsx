/**
 * Red tests for <VisionScene /> (V4.7-P5 Task 1 / AC-P4.7-6).
 *
 * Vision is the "why this is a primitive, not a feature" scene. Three
 * sub-blocks share a single 80vh `<section>`:
 *
 *   1. SKU expansion matrix    — 4 cards (Shill / Snipe / LP Provisioning /
 *      Alpha Feed). Only Shill (status='shipped') carries the accent breathing
 *      border; the other three render in a muted variant.
 *   2. Take-rate projection    — formula / derivation / result text stack
 *      alongside a hand-drawn SVG bar chart (no recharts).
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

  it('renders every VISION_SKUS name (Shill / Snipe / LP Provisioning / Alpha Feed)', () => {
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

  it('does NOT mark the non-shipped SKUs (Snipe / LP Provisioning / Alpha Feed) as shipped', () => {
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

  it('renders the VISION_TAKERATE.formula string verbatim (32k tokens/d × 1% paid shill)', () => {
    const out = render();
    expect(out).toContain(VISION_TAKERATE.formula);
  });

  it('renders the VISION_TAKERATE.result string verbatim ($1.6/d protocol revenue)', () => {
    const out = render();
    expect(out).toContain(VISION_TAKERATE.result);
  });

  it('exposes the take-rate bar chart as an accessible SVG (role="img")', () => {
    const out = render();
    // Hand-drawn SVG (no recharts); role="img" + aria-label is how screen
    // readers pick it up. The exact label wording is allowed to evolve, but
    // "chart" must stay so it reads as the visualisation, not the static
    // headline.
    expect(out).toMatch(/role="img"[^>]+aria-label="[^"]*chart/i);
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
