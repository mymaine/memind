/**
 * Unit tests for `useActiveChapter` — pure derivation from
 * (scrollY, viewport height, chapter count) to the currently active chapter
 * index plus the overall progress scalar [0, 1].
 *
 * Mirrors the StickyStage math in `docs/design/memind-handoff/project/components/app.jsx`
 * lines 334-339:
 *   slotPx        = SLOT_VH * vh
 *   totalScrollH  = chapterCount * slotPx + vh
 *   activeIdx     = clamp(floor((scrollY + slotPx*0.3) / slotPx), [0, count-1])
 *   progress      = clamp01(scrollY / max(1, totalScrollH - vh))
 *
 * We test the pure `deriveActiveChapter()` helper so every edge case (vh=0,
 * count=1, tail overscroll) is covered without needing a React renderer.
 */
import { describe, it, expect } from 'vitest';
import { deriveActiveChapter, SLOT_VH } from './useActiveChapter.js';

describe('deriveActiveChapter', () => {
  const VH = 1000;
  const SLOT_PX = SLOT_VH * VH; // 2200

  it('scrollY=0 yields activeIdx=0 and progress=0', () => {
    const { activeIdx, progress } = deriveActiveChapter(0, VH, 11);
    expect(activeIdx).toBe(0);
    expect(progress).toBe(0);
  });

  it('scrollY mid-hold of chapter 3 yields activeIdx=2', () => {
    // land near the centre of chapter 3's slot (zero-based idx 2)
    const y = SLOT_PX * 2 + SLOT_PX * 0.5;
    const { activeIdx } = deriveActiveChapter(y, VH, 11);
    expect(activeIdx).toBe(2);
  });

  it('scrollY at the very tail clamps activeIdx to count-1 and progress ~ 1', () => {
    // totalScrollH = 11 * SLOT_PX + VH
    const totalScrollH = 11 * SLOT_PX + VH;
    const y = totalScrollH - VH; // last scrollable pixel
    const { activeIdx, progress } = deriveActiveChapter(y, VH, 11);
    expect(activeIdx).toBe(10);
    expect(progress).toBeCloseTo(1, 5);
  });

  it('vh=0 returns safe defaults (activeIdx=0, progress=0) without division blowups', () => {
    const { activeIdx, progress } = deriveActiveChapter(500, 0, 11);
    expect(activeIdx).toBe(0);
    expect(Number.isFinite(progress)).toBe(true);
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(1);
  });

  it('chapterCount=1 never yields activeIdx > 0', () => {
    const { activeIdx } = deriveActiveChapter(SLOT_PX * 10, VH, 1);
    expect(activeIdx).toBe(0);
  });

  it('activeIdx is clamped to [0, chapterCount-1] even when scrollY overshoots', () => {
    const way = SLOT_PX * 999;
    const { activeIdx } = deriveActiveChapter(way, VH, 11);
    expect(activeIdx).toBe(10);
  });

  it('progress is clamped to [0,1] for any non-negative scrollY', () => {
    for (const y of [-500, 0, 100, 5000, 1_000_000]) {
      const { progress } = deriveActiveChapter(y, VH, 11);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});
