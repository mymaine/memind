/**
 * Tests for the pure mood registry. The registry is the single source of truth
 * for "what does each ShillingMood mean at render time": its CSS class on the
 * root SVG, whether the animation loops, and how long a one-shot mood lasts
 * before returning to idle.
 *
 * These tests lock the 10-mood taxonomy in place — any addition / renaming
 * must update both production code and these assertions together.
 */
import { describe, it, expect } from 'vitest';
import { MOODS, getMoodConfig, isLoopMood, type ShillingMood } from '../mood-registry.js';

describe('MOODS', () => {
  it('enumerates exactly the 10 canonical moods', () => {
    const expected: ShillingMood[] = [
      'idle',
      'walk-left',
      'walk-right',
      'jump',
      'clap',
      'glitch',
      'sleep',
      'work',
      'think',
      'surprise',
      'celebrate',
    ];
    // `MOODS` is allowed to include `walk-left` + `walk-right` as two entries;
    // we assert the exact set (order-insensitive) so walks are not collapsed.
    expect([...MOODS].sort()).toEqual(expected.sort());
  });
});

describe('getMoodConfig', () => {
  it('returns a stable CSS class namespaced under glyph--', () => {
    for (const mood of MOODS) {
      const cfg = getMoodConfig(mood);
      expect(cfg.cssClass).toMatch(/^glyph--/);
      expect(cfg.cssClass).toContain(mood);
    }
  });

  it('marks looping moods with loop=true and terminal moods with loop=false', () => {
    expect(getMoodConfig('idle').loop).toBe(true);
    expect(getMoodConfig('walk-left').loop).toBe(true);
    expect(getMoodConfig('walk-right').loop).toBe(true);
    expect(getMoodConfig('clap').loop).toBe(true);
    expect(getMoodConfig('glitch').loop).toBe(true);
    expect(getMoodConfig('sleep').loop).toBe(true);
    expect(getMoodConfig('work').loop).toBe(true);
    expect(getMoodConfig('think').loop).toBe(true);
    // One-shot moods: jump / surprise / celebrate
    expect(getMoodConfig('jump').loop).toBe(false);
    expect(getMoodConfig('surprise').loop).toBe(false);
    expect(getMoodConfig('celebrate').loop).toBe(false);
  });

  it('gives one-shot moods a finite positive duration in ms', () => {
    expect(getMoodConfig('jump').durationMs).toBeGreaterThan(0);
    expect(getMoodConfig('surprise').durationMs).toBeGreaterThan(0);
    expect(getMoodConfig('celebrate').durationMs).toBeGreaterThan(0);
    // Spec: jump 800ms, surprise 600ms, celebrate 1200ms.
    expect(getMoodConfig('jump').durationMs).toBe(800);
    expect(getMoodConfig('surprise').durationMs).toBe(600);
    expect(getMoodConfig('celebrate').durationMs).toBe(1200);
  });

  it('gives loop moods durationMs=null so consumers do not schedule timeouts for them', () => {
    expect(getMoodConfig('idle').durationMs).toBeNull();
    expect(getMoodConfig('walk-left').durationMs).toBeNull();
    expect(getMoodConfig('sleep').durationMs).toBeNull();
  });
});

describe('isLoopMood', () => {
  it('mirrors getMoodConfig().loop', () => {
    for (const mood of MOODS) {
      expect(isLoopMood(mood)).toBe(getMoodConfig(mood).loop);
    }
  });
});
