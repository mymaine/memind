/**
 * Red tests for the `usdc-particle-flow` pure phase calculator.
 *
 * The Hero scene (AC-P4.7-2) and the Solution scene's x402 micro-animation
 * (AC-P4.7-4) both drive a 6-second loop whose boundaries are pinned by
 * spec (`docs/features/demo-narrative-ui.md` → "Hero 動畫數據流"):
 *
 *   idle     0    – 500
 *   paying   500  – 2500
 *   drafting 2500 – 4000
 *   posted   4000 – 5500
 *   idle     5500 – 6000
 *
 * The component itself stays visual — all timing logic lives in these pure
 * helpers so vitest (node env, no DOM) can pin them without rendering.
 */
import { describe, expect, it } from 'vitest';
import {
  HERO_CYCLE_MS,
  HERO_PHASE_RANGES,
  cycleDurationMs,
  getPhaseAtMs,
} from './usdc-particle-flow-utils';

describe('HERO_PHASE_RANGES structure', () => {
  it('contains the five pinned segments (idle-paying-drafting-posted-idle)', () => {
    expect(HERO_PHASE_RANGES.length).toBe(5);
    expect(HERO_PHASE_RANGES[0]?.startMs).toBe(0);
    expect(HERO_PHASE_RANGES[HERO_PHASE_RANGES.length - 1]?.endMs).toBe(HERO_CYCLE_MS);
  });

  it('has no gaps between consecutive segments', () => {
    for (let i = 0; i < HERO_PHASE_RANGES.length - 1; i += 1) {
      const current = HERO_PHASE_RANGES[i];
      const next = HERO_PHASE_RANGES[i + 1];
      expect(current?.endMs).toBe(next?.startMs);
    }
  });

  it('pins the boundaries to the spec values (500 / 2500 / 4000 / 5500)', () => {
    // Verify the phase at the canonical start of each named segment.
    expect(HERO_PHASE_RANGES.find((r) => r.startMs === 0)?.phase).toBe('idle');
    expect(HERO_PHASE_RANGES.find((r) => r.startMs === 500)?.phase).toBe('paying');
    expect(HERO_PHASE_RANGES.find((r) => r.startMs === 2500)?.phase).toBe('drafting');
    expect(HERO_PHASE_RANGES.find((r) => r.startMs === 4000)?.phase).toBe('posted');
    expect(HERO_PHASE_RANGES.find((r) => r.startMs === 5500)?.phase).toBe('idle');
  });
});

describe('cycleDurationMs', () => {
  it('sums to 6000ms for the Hero ranges', () => {
    expect(cycleDurationMs(HERO_PHASE_RANGES)).toBe(6000);
    expect(cycleDurationMs(HERO_PHASE_RANGES)).toBe(HERO_CYCLE_MS);
  });

  it('returns the span from first startMs to last endMs for an arbitrary ranges tuple', () => {
    const custom = [
      { phase: 'idle', startMs: 0, endMs: 100 },
      { phase: 'paying', startMs: 100, endMs: 400 },
    ] as const;
    expect(cycleDurationMs(custom)).toBe(400);
  });
});

describe('getPhaseAtMs — inclusive-exclusive boundaries', () => {
  it('returns idle at the very start of the cycle', () => {
    expect(getPhaseAtMs(0)).toBe('idle');
  });

  it('still returns idle at 499ms (end of the opening idle segment, exclusive upper)', () => {
    expect(getPhaseAtMs(499)).toBe('idle');
  });

  it('flips to paying exactly at 500ms (inclusive lower of the next segment)', () => {
    expect(getPhaseAtMs(500)).toBe('paying');
  });

  it('stays paying mid-segment (2000ms) and flips to drafting at 2500ms', () => {
    expect(getPhaseAtMs(2000)).toBe('paying');
    expect(getPhaseAtMs(2500)).toBe('drafting');
  });

  it('stays drafting at 3999ms and flips to posted at 4000ms', () => {
    expect(getPhaseAtMs(3999)).toBe('drafting');
    expect(getPhaseAtMs(4000)).toBe('posted');
  });

  it('flips back to idle at 5500ms and stays idle at 5999ms', () => {
    expect(getPhaseAtMs(5500)).toBe('idle');
    expect(getPhaseAtMs(5999)).toBe('idle');
  });
});

describe('getPhaseAtMs — wrap-around', () => {
  it('wraps positive overflow back into [0, 6000): 6500 → paying (500)', () => {
    expect(getPhaseAtMs(6500)).toBe('paying');
  });

  it('wraps two full cycles: 12500 → paying (500)', () => {
    expect(getPhaseAtMs(12500)).toBe('paying');
  });

  it('wraps exactly at the cycle boundary: 6000 → idle (0)', () => {
    expect(getPhaseAtMs(6000)).toBe('idle');
  });

  it('wraps negative input: -500 → idle (5500)', () => {
    expect(getPhaseAtMs(-500)).toBe('idle');
  });

  it('wraps deeply negative input: -3500 → drafting (2500)', () => {
    expect(getPhaseAtMs(-3500)).toBe('drafting');
  });
});

describe('getPhaseAtMs — degenerate inputs', () => {
  it('throws when ranges is empty (phase lookup would be undefined otherwise)', () => {
    expect(() => getPhaseAtMs(0, [])).toThrow();
  });
});
