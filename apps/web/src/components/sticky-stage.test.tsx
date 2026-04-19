/**
 * Tests for <StickyStage /> — cross-fade scrollytelling engine
 * (memind-scrollytelling-rebuild AC-MSR-1 / AC-MSR-2).
 *
 * We assert on the pure `mapStageStyle()` helper for the opacity/scale/blur
 * curve boundaries (0, 0.5, 1, plus the FADE_IN/FADE_OUT edges at 0.18 /
 * 0.82). For the component itself we use `renderToStaticMarkup` + regex on
 * the emitted HTML — the repo's vitest runs under `node` without jsdom or
 * `@testing-library/react`, matching the pattern used by every existing
 * scene test.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FADE_IN_FRAC,
  FADE_OUT_FRAC,
  StickyStage,
  mapStageStyle,
  type StickyStageChapter,
} from './sticky-stage.js';

function ChA({ p }: { p: number }): React.ReactElement {
  return <div data-testid="ch-a" data-p={p.toFixed(3)} />;
}
function ChB({ p }: { p: number }): React.ReactElement {
  return <div data-testid="ch-b" data-p={p.toFixed(3)} />;
}
function ChC({ p }: { p: number }): React.ReactElement {
  return <div data-testid="ch-c" data-p={p.toFixed(3)} />;
}

const CHAPTERS: readonly StickyStageChapter[] = [
  { id: 'a', title: 'ALPHA', Comp: ChA },
  { id: 'b', title: 'BETA', Comp: ChB },
  { id: 'c', title: 'GAMMA', Comp: ChC },
];

const VH = 1000;
const SLOT_PX = 2.2 * VH;

describe('mapStageStyle', () => {
  it('at localP = 0 returns opacity=0, scale=0.94, blur=16', () => {
    const s = mapStageStyle(0);
    expect(s.opacity).toBe(0);
    expect(s.scale).toBeCloseTo(0.94, 5);
    expect(s.blur).toBeCloseTo(16, 5);
  });

  it('at the fade-in edge (localP = FADE_IN_FRAC) lands at fully resolved', () => {
    const s = mapStageStyle(FADE_IN_FRAC);
    expect(s.opacity).toBeCloseTo(1, 5);
    expect(s.scale).toBeCloseTo(1, 5);
    expect(s.blur).toBeCloseTo(0, 5);
  });

  it('inside the hold window opacity=1, scale=1, blur=0', () => {
    const s = mapStageStyle(0.5);
    expect(s.opacity).toBe(1);
    expect(s.scale).toBe(1);
    expect(s.blur).toBe(0);
  });

  it('at the fade-out edge (1 - FADE_OUT_FRAC) still resolved', () => {
    const s = mapStageStyle(1 - FADE_OUT_FRAC);
    expect(s.opacity).toBe(1);
    expect(s.scale).toBe(1);
    expect(s.blur).toBe(0);
  });

  it('at localP = 1 returns opacity=0, scale=1.04, blur=16', () => {
    const s = mapStageStyle(1);
    expect(s.opacity).toBeCloseTo(0, 5);
    expect(s.scale).toBeCloseTo(1.04, 5);
    expect(s.blur).toBeCloseTo(16, 5);
  });
});

describe('<StickyStage />', () => {
  it('culls chapters whose slot is far outside the fade window', () => {
    // scrollY=0 → A is at localP=0 (opacity=0, culled). B/C are further out
    // (negative localP → clamp 0 → culled). Stage renders as an empty
    // sticky-viewport until the user scrolls into A's fade-in window.
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={0} vh={VH} />);
    expect(html).not.toMatch(/data-chapter="a"/);
    expect(html).not.toMatch(/data-chapter="b"/);
    expect(html).not.toMatch(/data-chapter="c"/);
  });

  it("at scrollY just inside A's fade-in window, chapter A is emitted and B/C are culled", () => {
    // Pick localP ~ 0.1 of A so opacity ~ 0.56 > 0.01 → A renders.
    const y = SLOT_PX * 0.1;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="a"/);
    expect(html).not.toMatch(/data-chapter="b"/);
    expect(html).not.toMatch(/data-chapter="c"/);
  });

  it('mid-hold of chapter B renders it with opacity=1 and pointerEvents=auto', () => {
    // scrollY lands mid-hold of slot 1 (chapter B, zero-indexed).
    const y = SLOT_PX * 1 + SLOT_PX * 0.5;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="b"/);
    // Opacity in inline style should be 1 for a mid-hold chapter. React
    // serialises the style as `opacity:1`.
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*opacity:1/);
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*pointer-events:auto/);
  });

  it('chapters with opacity <= 0.01 return null (not rendered in markup)', () => {
    // scrollY = 0 puts slot 2 (chapter C) at localP well below fade-in → null.
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={0} vh={VH} />);
    expect(html).not.toMatch(/data-chapter="c"/);
  });

  it('assigns z-index 10+i so chapters stack in slot order', () => {
    // mid-hold of B (idx 1): only B renders, with z-index 11.
    const y = SLOT_PX * 1 + SLOT_PX * 0.5;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*z-index:11/);
    // mid-hold of A (idx 0): only A renders, with z-index 10.
    const y0 = SLOT_PX * 0.5;
    const html0 = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y0} vh={VH} />);
    expect(html0).toMatch(/data-chapter="a"[^>]*style="[^"]*z-index:10/);
  });

  it('pointerEvents is none for partially-faded chapters (opacity <= 0.9)', () => {
    // Pick a scrollY inside A's fade-in window (localP ~ 0.1 → opacity ~ 0.56)
    const y = SLOT_PX * 0.1;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="a"[^>]*style="[^"]*pointer-events:none/);
  });

  it('forwards interior progress p to the chapter Comp', () => {
    // mid-hold: interior should be ~ (localP - 0.18) / (0.82 - 0.18) with
    // localP = 0.5 → interior ≈ 0.5. Chapter dev-glyph writes `p.toFixed(3)`
    // into data-p so we can read it off the markup.
    const y = SLOT_PX * 0.5;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    // ChA is the live one; its data-p should be within [0.4, 0.6] around
    // localP=0.5 (conversion to interior via the hold-window math).
    const m = html.match(/data-testid="ch-a" data-p="([0-9.]+)"/);
    expect(m).not.toBeNull();
    const value = Number.parseFloat(m![1]!);
    expect(value).toBeGreaterThan(0.4);
    expect(value).toBeLessThan(0.6);
  });
});
