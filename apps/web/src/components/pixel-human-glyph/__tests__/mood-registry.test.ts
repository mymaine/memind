/**
 * Tests for the pure mood registry. It is the single source of truth for
 * "what does each mood mean at render time": whether it loops and how long
 * a one-shot mood lasts before the component auto-returns to idle.
 *
 * These tests lock the 10-mood taxonomy in place — any addition / renaming
 * must update both the registry and these assertions together.
 */
import { describe, it, expect } from 'vitest';
import { MOODS, getMoodConfig, type ShillingMood } from '../mood-registry.js';

describe('MOODS', () => {
  it('enumerates exactly the 14 canonical moods', () => {
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
      'sunglasses',
      'type-keyboard',
      'megaphone',
    ];
    expect([...MOODS].sort()).toEqual(expected.sort());
  });
});

describe('getMoodConfig', () => {
  it('marks looping moods with loop=true and terminal moods with loop=false', () => {
    expect(getMoodConfig('idle').loop).toBe(true);
    expect(getMoodConfig('walk-left').loop).toBe(true);
    expect(getMoodConfig('walk-right').loop).toBe(true);
    expect(getMoodConfig('clap').loop).toBe(true);
    expect(getMoodConfig('glitch').loop).toBe(true);
    expect(getMoodConfig('sleep').loop).toBe(true);
    expect(getMoodConfig('work').loop).toBe(true);
    expect(getMoodConfig('think').loop).toBe(true);
    expect(getMoodConfig('jump').loop).toBe(false);
    expect(getMoodConfig('surprise').loop).toBe(false);
    expect(getMoodConfig('celebrate').loop).toBe(false);
    expect(getMoodConfig('sunglasses').loop).toBe(false);
    expect(getMoodConfig('type-keyboard').loop).toBe(false);
    expect(getMoodConfig('megaphone').loop).toBe(false);
  });

  it('gives one-shot moods a finite positive duration in ms', () => {
    expect(getMoodConfig('jump').durationMs).toBe(800);
    expect(getMoodConfig('surprise').durationMs).toBe(600);
    expect(getMoodConfig('celebrate').durationMs).toBe(1200);
    expect(getMoodConfig('sunglasses').durationMs).toBe(2500);
    expect(getMoodConfig('type-keyboard').durationMs).toBe(3000);
    expect(getMoodConfig('megaphone').durationMs).toBe(2500);
  });

  it('gives loop moods durationMs=null so consumers do not schedule timeouts for them', () => {
    expect(getMoodConfig('idle').durationMs).toBeNull();
    expect(getMoodConfig('walk-left').durationMs).toBeNull();
    expect(getMoodConfig('sleep').durationMs).toBeNull();
  });
});
