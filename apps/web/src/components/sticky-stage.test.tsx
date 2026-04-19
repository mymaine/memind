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

  it('edge.isFirst suppresses fade-in so localP < FADE_IN_FRAC is fully visible', () => {
    // UAT Issue #2: first chapter (Ch1 Hero) must not fade in. scrollY=0
    // puts Ch1 at localP=0; with edge.isFirst=true it lands at the final
    // resolved state (opacity=1, scale=1, blur=0).
    for (const p of [0, 0.05, 0.1, FADE_IN_FRAC - 0.001]) {
      const s = mapStageStyle(p, { isFirst: true });
      expect(s.opacity).toBe(1);
      expect(s.scale).toBe(1);
      expect(s.blur).toBe(0);
    }
  });

  it('edge.isLast suppresses fade-out so localP > 1 - FADE_OUT_FRAC stays visible', () => {
    // UAT Issue #2: last chapter (Ch11 Evidence) must not fade out as
    // scroll reaches the document tail. With edge.isLast=true every
    // post-hold localP returns the final resolved state.
    for (const p of [1 - FADE_OUT_FRAC + 0.001, 0.95, 1.0]) {
      const s = mapStageStyle(p, { isLast: true });
      expect(s.opacity).toBe(1);
      expect(s.scale).toBe(1);
      expect(s.blur).toBe(0);
    }
  });

  it('edge flags do not affect the hold window (opacity stays 1 either way)', () => {
    // Sanity check: hold window is already opacity=1; flags are idempotent.
    for (const edge of [{}, { isFirst: true }, { isLast: true }, { isFirst: true, isLast: true }]) {
      const s = mapStageStyle(0.5, edge);
      expect(s.opacity).toBe(1);
    }
  });
});

describe('<StickyStage />', () => {
  it('culls middle chapters whose slot is far outside the fade window', () => {
    // UAT Issue #2: the first chapter A is pinned fully visible at
    // scrollY=0 (isFirst edge) so we cannot test culling via chapter A
    // any more. Build a stage with an extra leading chapter so the
    // assertion still targets a middle slot — scrollY puts chapter B
    // (here idx 1) in its own fade window but C/D are culled.
    const FOUR = [
      ...CHAPTERS,
      { id: 'd', title: 'DELTA', Comp: ChC },
    ] satisfies readonly StickyStageChapter[];
    // localP of chapter B = (SLOT_PX - SLOT_PX) / SLOT_PX = 0. With no
    // isFirst/isLast flag on idx 1, mapStageStyle returns opacity=0 and
    // StickyStage culls the tile.
    const y = SLOT_PX * 1;
    const html = renderToStaticMarkup(<StickyStage chapters={FOUR} scrollY={y} vh={VH} />);
    // Chapter A is still visible (it is the first chapter at localP=1;
    // with isLast=false it is at opacity=0 — OK, so check its absence).
    // Chapter B at localP=0 with no edge flag → opacity=0 → culled.
    expect(html).not.toMatch(/data-chapter="b"/);
    expect(html).not.toMatch(/data-chapter="c"/);
    expect(html).not.toMatch(/data-chapter="d"/);
  });

  it("at scrollY just inside B's fade-in window, only chapter B is emitted", () => {
    // Pick a middle chapter (B at idx 1) so edge flags do not interfere.
    // localP ~ 0.1 of B → opacity ~ 0.56 > 0.01 → B renders.
    const y = SLOT_PX * 1 + SLOT_PX * 0.1;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="b"/);
    expect(html).not.toMatch(/data-chapter="c"/);
    // Chapter A at localP=1 with isLast=false → opacity=0 → culled.
    expect(html).not.toMatch(/data-chapter="a"/);
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
    // UAT Issue #2: the first chapter A is pinned opaque via the isFirst
    // edge flag, so to test partial-fade pointerEvents we pick a middle
    // chapter (B at idx 1) just inside its fade-in window.
    const y = SLOT_PX * 1 + SLOT_PX * 0.1;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*pointer-events:none/);
  });

  it('first chapter renders at opacity=1 at scrollY=0 (no fade-in black flash)', () => {
    // UAT Issue #2: at the top of the document chapter A (i=0) must paint
    // fully visible — the old behaviour returned opacity=0 which left the
    // landing paint pure black until the user started scrolling.
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={0} vh={VH} />);
    expect(html).toMatch(/data-chapter="a"/);
    expect(html).toMatch(/data-chapter="a"[^>]*style="[^"]*opacity:1/);
    expect(html).toMatch(/data-chapter="a"[^>]*style="[^"]*pointer-events:auto/);
  });

  it('last chapter stays at opacity=1 once scroll is past its hold window', () => {
    // UAT Issue #2: at the tail of the scroll region chapter C (i=N-1)
    // must stay fully visible — the old behaviour faded it back to black
    // as localP climbed past 1 - FADE_OUT_FRAC.
    const SLOT_PX_LOCAL = 2.2 * VH;
    const y = SLOT_PX_LOCAL * 2 + SLOT_PX_LOCAL * 0.95; // well past hold for chapter C (idx 2)
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    expect(html).toMatch(/data-chapter="c"/);
    expect(html).toMatch(/data-chapter="c"[^>]*style="[^"]*opacity:1/);
  });

  it('middle chapters still fade out normally when scroll overshoots their hold', () => {
    // Regression guard: the isLast flag applies only to the last chapter.
    // Chapter B (idx 1, middle of a 3-chapter stage) must still fade out
    // as localP passes 1 - FADE_OUT_FRAC — otherwise the cross-fade
    // engine would never hand off to the next chapter.
    const SLOT_PX_LOCAL = 2.2 * VH;
    const y = SLOT_PX_LOCAL * 1 + SLOT_PX_LOCAL * 0.95;
    const html = renderToStaticMarkup(<StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} />);
    // Chapter B may or may not still be rendered (opacity near 0 is
    // culled), but if it is rendered it must be partially faded — so the
    // inline style must NOT contain `opacity:1` for B here.
    const bMatch = html.match(/data-chapter="b"[^>]*style="([^"]+)"/);
    if (bMatch !== null) {
      expect(bMatch[1]).not.toMatch(/opacity:1(?!\d)/);
    }
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

describe('<StickyStage /> reduced-motion path (AC-MSR-11 / AC-MSR-14)', () => {
  it('reducedMotion=true renders only the active chapter with p=1 and no transform/filter', () => {
    // Pick a scrollY that would normally put chapter B mid-hold. In
    // reduced-motion the stage must short-circuit: render B only, p=1,
    // no scale/blur/opacity transform so the chapter lands in its final
    // state. We also pass activeIdx explicitly (consumer-supplied) to
    // match the wiring in page.tsx.
    const y = SLOT_PX * 1 + SLOT_PX * 0.5;
    const html = renderToStaticMarkup(
      <StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} reducedMotion activeIdx={1} />,
    );
    // Only chapter B should be rendered.
    expect(html).toMatch(/data-chapter="b"/);
    expect(html).not.toMatch(/data-chapter="a"/);
    expect(html).not.toMatch(/data-chapter="c"/);
    // p forwarded as 1.000 (final state).
    expect(html).toMatch(/data-testid="ch-b" data-p="1\.000"/);
    // No cross-fade styles — transform/filter must be explicit 'none'.
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*transform:none/);
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*filter:none/);
    // Opacity must land at 1 (final state, not the fade curve value).
    expect(html).toMatch(/data-chapter="b"[^>]*style="[^"]*opacity:1/);
  });

  it('reducedMotion=true falls back to deriving activeIdx from scrollY when not supplied', () => {
    // Without an explicit activeIdx the stage must still resolve to the
    // chapter under scrollY — same derivation the cross-fade path uses.
    // scrollY lands inside chapter C's slot (idx 2).
    const y = SLOT_PX * 2 + SLOT_PX * 0.4;
    const html = renderToStaticMarkup(
      <StickyStage chapters={CHAPTERS} scrollY={y} vh={VH} reducedMotion />,
    );
    expect(html).toMatch(/data-chapter="c"/);
    expect(html).not.toMatch(/data-chapter="a"/);
    expect(html).not.toMatch(/data-chapter="b"/);
  });
});
