'use client';

/**
 * StickyStage — the cross-fade scrollytelling engine
 * (memind-scrollytelling-rebuild AC-MSR-1 / AC-MSR-2).
 *
 * All 12 chapters are absolutely positioned inside a single sticky viewport.
 * Each chapter owns `SLOT_VH * vh` pixels of scroll distance. Within that
 * slot the chapter cross-fades in (12%), holds fully resolved (76%), then
 * cross-fades out (12%) — opacity / scale / blur only, NO translateY.
 * Hold widened from 64% to 76% after UAT Issue #3 so chapter animations
 * have room to dwell on their resolved state before the cross-fade.
 *
 * The pure `mapStageStyle()` helper is exported for unit tests so the
 * opacity / scale / blur curve is verifiable without mounting the
 * component.
 */
import type { CSSProperties, ReactElement } from 'react';

// UAT 2026-04-20 (round 2): users reported the chapter animations finish
// and the next scroll-tick already hands off to the next chapter, making
// the resolved frame feel fleeting. Bump slot distance from 2.2 → 3.0
// (each chapter owns 300vh of scroll) and double the interior speed-up so
// animations land in the first ~half of hold and stay resolved for the
// remaining ~half before fade-out begins. Fade window also shrunk from
// 0.12 → 0.10 each side so the 80% hold window feels even wider.
export const SLOT_VH = 3.0;
export const FADE_IN_FRAC = 0.1;
export const FADE_OUT_FRAC = 0.1;
/**
 * Interior progress multiplier (UAT Issue #3 / round 2). The raw
 * `interior` scalar goes 0 → 1 across the hold window; multiplying by
 * 2.0 then clamping means chapter animations (count-up, type-on, EKG
 * draw, equation assemble) saturate in the first 50% of hold and the
 * second 50% is a fully-resolved still frame — users can actually read
 * the chapter before it cross-fades out.
 */
export const INTERIOR_SPEEDUP = 2.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface StageStyle {
  readonly opacity: number;
  readonly scale: number;
  readonly blur: number;
}

/** Optional edge flags for `mapStageStyle`. */
export interface MapStageStyleEdge {
  /**
   * When true, suppress the fade-in portion of the curve (localP < holdStart
   * still returns opacity=1, scale=1, blur=0). Used for the first chapter so
   * the very first paint at scrollY=0 is not a black screen — users land on
   * Ch1 already fully visible.
   */
  readonly isFirst?: boolean;
  /**
   * When true, suppress the fade-out portion of the curve (localP > holdEnd
   * still returns opacity=1, scale=1, blur=0). Used for the last chapter so
   * the final paint after the user scrolls past hold does not fade back to
   * black — Ch11 stays fully visible when the document bottoms out.
   */
  readonly isLast?: boolean;
}

/**
 * Map a per-slot progress scalar (0 → 1) to the stage-slot's
 * opacity/scale/blur triple. Exposed as a named export so tests can verify
 * the curve boundaries without re-rendering the component.
 *
 * `edge.isFirst` / `edge.isLast` short-circuit the fade-in / fade-out halves
 * respectively so the first chapter opens fully visible (no initial black
 * flash before localP crosses FADE_IN_FRAC) and the last chapter stays
 * visible past hold (no closing black flash as scroll reaches the tail).
 */
export function mapStageStyle(localP: number, edge: MapStageStyleEdge = {}): StageStyle {
  const holdStart = FADE_IN_FRAC;
  const holdEnd = 1 - FADE_OUT_FRAC;
  if (localP < holdStart) {
    if (edge.isFirst) {
      return { opacity: 1, scale: 1, blur: 0 };
    }
    const t = localP / holdStart;
    return { opacity: t, scale: lerp(0.94, 1, t), blur: lerp(16, 0, t) };
  }
  if (localP > holdEnd) {
    if (edge.isLast) {
      return { opacity: 1, scale: 1, blur: 0 };
    }
    const t = (localP - holdEnd) / (1 - holdEnd);
    return { opacity: 1 - t, scale: lerp(1, 1.04, t), blur: lerp(0, 16, t) };
  }
  return { opacity: 1, scale: 1, blur: 0 };
}

/** Public chapter shape consumed by `<StickyStage />`. */
export interface StickyStageChapter {
  readonly id: string;
  readonly title: string;
  readonly Comp: React.ComponentType<{ p: number }>;
}

export interface StickyStageProps {
  readonly chapters: readonly StickyStageChapter[];
  readonly scrollY: number;
  readonly vh: number;
  /**
   * When true (user has `prefers-reduced-motion: reduce` or the Tweaks
   * panel override is on), the stage bypasses the cross-fade engine and
   * renders only the currently active chapter with `p=1` so every
   * interior animation lands in its final state. See AC-MSR-11 /
   * AC-MSR-14.
   */
  readonly reducedMotion?: boolean;
  /**
   * Optional consumer-supplied active chapter index used by the
   * reduced-motion branch. When omitted we derive it from scrollY with
   * the same mid-hold bias `useActiveChapter` uses, so the stage works
   * standalone even when the parent has not plumbed the hook through.
   */
  readonly activeIdx?: number;
}

/**
 * Render every chapter as an absolutely-positioned `.stage-slot` inside
 * a shared `.sticky-viewport`. Chapters whose opacity drops below 0.01
 * return `null` so the DOM stays lean (only 1-2 chapters paint at any
 * moment during normal scrolling).
 *
 * Under `reducedMotion`, the cross-fade engine is short-circuited: the
 * stage renders only the active chapter with `p=1` and `transform/filter`
 * explicitly set to `none` so the chapter lands in its final state with
 * no animated transitions between chapters.
 */
export function StickyStage({
  chapters,
  scrollY,
  vh,
  reducedMotion = false,
  activeIdx,
}: StickyStageProps): ReactElement {
  if (reducedMotion) {
    const slotPx = SLOT_VH * vh;
    const derivedIdx =
      slotPx > 0
        ? Math.max(0, Math.min(chapters.length - 1, Math.floor((scrollY + slotPx * 0.3) / slotPx)))
        : 0;
    const idx = activeIdx ?? derivedIdx;
    const safeIdx = Math.max(0, Math.min(chapters.length - 1, idx));
    const ch = chapters[safeIdx];
    if (!ch) return <div className="sticky-viewport" />;
    const { Comp } = ch;
    const style: CSSProperties = {
      opacity: 1,
      transform: 'none',
      filter: 'none',
      zIndex: 10 + safeIdx,
      pointerEvents: 'auto',
    };
    return (
      <div className="sticky-viewport">
        <div
          key={ch.id}
          className="stage-slot"
          data-chapter={ch.id}
          data-screen-label={`${String(safeIdx + 1).padStart(2, '0')} ${ch.title}`}
          style={style}
        >
          <Comp p={1} />
        </div>
      </div>
    );
  }
  return (
    <div className="sticky-viewport">
      {chapters.map((ch, i) => {
        const { Comp } = ch;
        const slotPx = SLOT_VH * vh;
        const startY = i * slotPx;
        const localP = slotPx > 0 ? clamp01((scrollY - startY) / slotPx) : 0;

        // Interior progress drives chapter-internal animations (type-on,
        // count-up, bar fills). The raw 0→1 scalar spans the hold window;
        // the INTERIOR_SPEEDUP multiplier lets animations finish at ~2/3
        // of hold (UAT Issue #3) so users spend the rest of hold on the
        // resolved state instead of watching the animation finish at the
        // boundary.
        const holdStart = FADE_IN_FRAC;
        const holdEnd = 1 - FADE_OUT_FRAC;
        const interiorRaw = clamp01((localP - holdStart) / (holdEnd - holdStart));
        const interior = clamp01(interiorRaw * INTERIOR_SPEEDUP);

        // Edge flags (Issue #2 / UAT): the first and last chapter skip
        // their fade-in / fade-out halves respectively so scrollY=0 paints
        // Ch1 fully visible (no black flash) and the tail scroll past
        // Ch(N-1) hold keeps the last chapter on screen instead of
        // fading back to black.
        const isFirst = i === 0;
        const isLast = i === chapters.length - 1;
        const { opacity, scale, blur } = mapStageStyle(localP, { isFirst, isLast });
        if (opacity <= 0.01) return null;

        const style: CSSProperties = {
          opacity,
          transform: `scale(${scale})`,
          filter: `blur(${blur.toFixed(2)}px)`,
          zIndex: 10 + i,
          pointerEvents: opacity > 0.9 ? 'auto' : 'none',
        };

        return (
          <div
            key={ch.id}
            className="stage-slot"
            data-chapter={ch.id}
            data-screen-label={`${String(i + 1).padStart(2, '0')} ${ch.title}`}
            style={style}
          >
            <Comp p={interior} />
          </div>
        );
      })}
    </div>
  );
}
