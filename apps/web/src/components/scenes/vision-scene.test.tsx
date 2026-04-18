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
    expect(out).toMatch(/data-testid="sku-card-Shill"[^>]+class="[^"]*\bsku-card--shipped\b/);
  });

  it('does NOT mark the non-shipped SKUs (Snipe / LP Provisioning / Alpha Feed) as shipped', () => {
    const out = render();
    for (const sku of VISION_SKUS) {
      if (sku.status === 'shipped') continue;
      // Extract the class attribute for each non-shipped SKU card and assert
      // the shipped marker class is absent. We use a per-testid regex so a
      // shared container class does not false-positive the assertion.
      const re = new RegExp(
        `data-testid="sku-card-${sku.name.replace(/ /g, '\\ ')}"[^>]+class="([^"]*)"`,
      );
      const match = out.match(re);
      expect(match).not.toBeNull();
      expect(match?.[1] ?? '').not.toMatch(/\bsku-card--shipped\b/);
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
    expect(out).toMatch(/data-testid="phase-node-2"[^>]+class="[^"]*\bphase-node--highlighted\b/);
    expect(out).toMatch(/data-testid="phase-node-2"[^>]+class="[^"]*\bsignal-pulse\b/);
  });

  it('does NOT highlight Phase 1 / Phase 3 (single-primary invariant)', () => {
    const out = render();
    for (const phaseId of [1, 3]) {
      const re = new RegExp(`data-testid="phase-node-${phaseId}"[^>]+class="([^"]*)"`);
      const match = out.match(re);
      expect(match).not.toBeNull();
      expect(match?.[1] ?? '').not.toMatch(/\bphase-node--highlighted\b/);
      expect(match?.[1] ?? '').not.toMatch(/\bsignal-pulse\b/);
    }
  });

  it('freeze=true locks the scene into its revealed state (scroll-independent paint)', () => {
    const out = render({ freeze: true });
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene--revealed\b/);
  });
});
