'use client';

/**
 * Derive the currently active chapter index + overall scroll progress for
 * the sticky-stage scrollytelling surface (memind-scrollytelling-rebuild
 * AC-MSR-1 / AC-MSR-2).
 *
 * The StickyStage allocates `SLOT_VH * vh` pixels of scroll distance per
 * chapter. The `+ slotPx * 0.3` bias inside the floor() lands `activeIdx` on
 * chapter `i` as soon as the hold-window of that chapter enters view
 * (otherwise the index would flip at the slot boundary, mid-cross-fade).
 *
 * Pure derivation so it can be unit-tested without a React renderer. The
 * React hook is a trivial wrapper returning the derived shape.
 */

export const SLOT_VH = 3.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export interface ActiveChapterState {
  readonly activeIdx: number;
  readonly progress: number;
}

/**
 * Pure derivation — given a scroll offset, viewport height, and total
 * chapter count, return the active chapter index plus the overall progress
 * scalar.
 */
export function deriveActiveChapter(
  scrollY: number,
  vh: number,
  chapterCount: number,
): ActiveChapterState {
  // Guards — `vh = 0` can happen during the first tick on mobile resize
  // handlers; `chapterCount < 1` is nonsense but we treat as 1 to avoid
  // negative clamps upstream.
  const safeCount = Math.max(1, chapterCount);
  const slotPx = SLOT_VH * vh;
  if (slotPx <= 0) {
    return { activeIdx: 0, progress: 0 };
  }
  const totalScrollH = safeCount * slotPx + vh;
  const activeIdx = Math.max(
    0,
    Math.min(safeCount - 1, Math.floor((scrollY + slotPx * 0.3) / slotPx)),
  );
  const progress = clamp01(scrollY / Math.max(1, totalScrollH - vh));
  return { activeIdx, progress };
}

/**
 * React hook wrapper around `deriveActiveChapter`. Consumers pass the
 * rAF-batched scrollY (from `useScrollY`) plus the current viewport height
 * and chapter count; the hook just returns the pure derivation so React can
 * re-render when any input changes.
 */
export function useActiveChapter(
  scrollY: number,
  vh: number,
  chapterCount: number,
): ActiveChapterState {
  return deriveActiveChapter(scrollY, vh, chapterCount);
}
