/**
 * Guards around CHAPTER_META — the single source of truth for the 11-chapter
 * order used by TOC / Watermark / StickyStage / ascii-backdrop. A stray
 * reorder or typo here breaks anchor-jump + deep-link semantics, so we pin
 * the list + count explicitly.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_META,
  SLOT_VH,
  chapterScrollTarget,
  resolveChapterIndexFromHash,
} from './chapters.js';

describe('CHAPTER_META', () => {
  it('declares exactly 11 chapters in the spec-mandated order', () => {
    expect(CHAPTER_META.map((c) => c.id)).toEqual([
      'hero',
      'problem',
      'solution',
      'brain-architecture',
      'launch-demo',
      'order-shill',
      'heartbeat-demo',
      'take-rate',
      'sku-matrix',
      'phase-map',
      'evidence',
    ]);
  });

  it('gives every chapter a non-empty uppercase title', () => {
    for (const ch of CHAPTER_META) {
      expect(ch.title.length).toBeGreaterThan(0);
      expect(ch.title).toBe(ch.title.toUpperCase());
    }
  });

  it('keeps ids globally unique so anchor-jump lookups stay deterministic', () => {
    const ids = CHAPTER_META.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveChapterIndexFromHash', () => {
  it('returns null for an empty hash', () => {
    expect(resolveChapterIndexFromHash('')).toBeNull();
    expect(resolveChapterIndexFromHash('#')).toBeNull();
  });

  it('resolves a leading-# hash to the zero-based chapter index', () => {
    expect(resolveChapterIndexFromHash('#hero')).toBe(0);
    expect(resolveChapterIndexFromHash('#order-shill')).toBe(5);
    expect(resolveChapterIndexFromHash('#evidence')).toBe(10);
  });

  it('resolves a bare id (no leading #) to the same chapter index', () => {
    expect(resolveChapterIndexFromHash('hero')).toBe(0);
    expect(resolveChapterIndexFromHash('phase-map')).toBe(9);
  });

  it('returns null for an unknown hash', () => {
    expect(resolveChapterIndexFromHash('#banana')).toBeNull();
    expect(resolveChapterIndexFromHash('#HERO')).toBeNull();
  });
});

describe('chapterScrollTarget', () => {
  it('lands at 30% into the chapter slot so the chapter is past fade-in', () => {
    const vh = 800;
    const slotPx = SLOT_VH * vh;
    expect(chapterScrollTarget(0, vh)).toBeCloseTo(slotPx * 0.3, 5);
    expect(chapterScrollTarget(5, vh)).toBeCloseTo(5 * slotPx + slotPx * 0.3, 5);
    expect(chapterScrollTarget(10, vh)).toBeCloseTo(10 * slotPx + slotPx * 0.3, 5);
  });

  it('scales linearly with viewport height', () => {
    const small = chapterScrollTarget(3, 400);
    const large = chapterScrollTarget(3, 800);
    expect(large).toBeCloseTo(small * 2, 5);
  });
});
