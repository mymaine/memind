/**
 * Guards around CHAPTER_META — the single source of truth for the 11-chapter
 * order used by TOC / Watermark / StickyStage / ascii-backdrop. A stray
 * reorder or typo here breaks anchor-jump + deep-link semantics, so we pin
 * the list + count explicitly.
 */
import { describe, expect, it } from 'vitest';
import { CHAPTER_META } from './chapters.js';

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
