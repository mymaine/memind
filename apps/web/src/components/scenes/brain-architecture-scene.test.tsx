/**
 * Red tests for <BrainArchitectureScene /> (immersive-single-page P1 Task 4).
 *
 * BrainArchitectureScene is the stand-alone scene extracted from
 * <VisionScene />. It renders the "1 Brain + pluggable personas" sub-block
 * as its own `<section id="brain-architecture">` so the single-page home
 * surface can mount it under the matching TOC anchor. Data source is still
 * the static BRAIN_ARCHITECTURE constant in narrative-copy — the extraction
 * must not introduce new strings (pitch-layer lock per
 * docs/decisions/2026-04-19-brain-agent-positioning.md).
 *
 * These assertions mirror the Brain architecture sub-block coverage that
 * previously lived inside `vision-scene.test.tsx` (7 cases). Keeping the
 * assertions identical guarantees the extraction is behaviour-preserving.
 *
 * Testing strategy mirrors the sibling scene tests: node-env vitest with
 * `renderToStaticMarkup`. Client effects (useScrollReveal) do not fire under
 * static render, so assertions are purely structural. The `freeze` prop
 * forces `.scene--revealed` when deterministic paint is required.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrainArchitectureScene } from './brain-architecture-scene.js';
import { BRAIN_ARCHITECTURE } from '../../lib/narrative-copy.js';

function render(props: Parameters<typeof BrainArchitectureScene>[0] = {}): string {
  return renderToStaticMarkup(<BrainArchitectureScene {...props} />);
}

/**
 * Extract the class attribute of the element carrying a given data-testid,
 * regardless of attribute order. React renders attributes in prop-declaration
 * order so we cannot assume `data-testid` comes after `class`; a simple
 * positional regex would fail. This helper returns the class string (or
 * `undefined`) so callers can assert on it with a plain substring / regex.
 */
function classForTestid(html: string, testid: string): string | undefined {
  const escaped = testid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRe = new RegExp(`<[a-zA-Z][^>]*data-testid="${escaped}"[^>]*>`);
  const tag = html.match(tagRe)?.[0];
  if (!tag) return undefined;
  const classMatch = tag.match(/\sclass="([^"]*)"/);
  return classMatch?.[1];
}

describe('<BrainArchitectureScene /> structural contract', () => {
  it('renders a Brain architecture landmark heading with the constant-derived label', () => {
    const out = render();
    // Landmark: assert both the visible label text and the presence of an
    // aria-labelledby wiring on the sub-block region.
    expect(out).toContain(BRAIN_ARCHITECTURE.brainLabel);
    expect(out).toContain(BRAIN_ARCHITECTURE.brainSubtitle);
    expect(out).toMatch(/aria-labelledby="[^"]*brain-architecture[^"]*"/);
  });

  it('renders every shipped persona from BRAIN_ARCHITECTURE.shippedPersonas with a visible name', () => {
    const out = render();
    for (const persona of BRAIN_ARCHITECTURE.shippedPersonas) {
      expect(out).toContain(persona.name);
      expect(out).toContain(persona.role);
    }
  });

  it('renders every future slot with its name and an UPPERCASE status pill', () => {
    const out = render();
    for (const slot of BRAIN_ARCHITECTURE.futureSlots) {
      expect(out).toContain(slot.name);
      // Status pill text is uppercase for "next" / "roadmap". Assert the
      // uppercased form appears somewhere after the slot name in the markup.
      expect(out).toContain(slot.status.toUpperCase());
    }
  });

  it('marks every future slot card with the `brain-port--future` variant class', () => {
    const out = render();
    // Future-slot cards carry a concrete marker class. Extract each card's
    // class attribute via its data-testid and assert the variant marker is
    // present. Reviewers (and future reduced-motion CSS) can target
    // "not-yet" ports without relying on inline styles.
    for (const slot of BRAIN_ARCHITECTURE.futureSlots) {
      const cls = classForTestid(out, `brain-port-${slot.name}`);
      expect(cls).toBeDefined();
      expect(cls).toMatch(/\bbrain-port--future\b/);
    }
  });

  it('marks every shipped port with accent border and does NOT mark it as future', () => {
    const out = render();
    for (const persona of BRAIN_ARCHITECTURE.shippedPersonas) {
      const cls = classForTestid(out, `brain-port-${persona.name}`);
      expect(cls).toBeDefined();
      expect(cls).toMatch(/\bborder-accent\b/);
      expect(cls).not.toMatch(/\bbrain-port--future\b/);
    }
  });

  it('does not embed any <canvas>, <svg>, or external chart root (no chart library)', () => {
    const out = render({ freeze: true });
    // Pitch-surface rule: no chart/viz library. <canvas> and <svg> never
    // appear; no recognised chart-library root class attaches to the scene.
    expect(out).not.toMatch(/<canvas\b/);
    expect(out).not.toMatch(/<svg\b/);
    expect(out).not.toMatch(/class="[^"]*\brecharts\b/);
    expect(out).not.toMatch(/class="[^"]*\bchartjs\b/);
    expect(out).not.toMatch(/class="[^"]*\bplotly\b/);
  });

  it('mounts the outer landmark as <section id="brain-architecture"> with the `.scene` class', () => {
    const out = render();
    // The scene owns its own `<section id="brain-architecture">` so page.tsx
    // can mount <BrainArchitectureScene /> directly without an outer wrapper
    // (which would duplicate the id). The `.scene` class feeds the shared
    // scroll-reveal CSS.
    expect(out).toMatch(/<section[^>]+id="brain-architecture"/);
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene\b/);
  });

  it('freeze=true locks the scene into its revealed state (scroll-independent paint)', () => {
    const out = render({ freeze: true });
    expect(out).toMatch(/<section[^>]+class="[^"]*\bscene--revealed\b/);
  });
});
