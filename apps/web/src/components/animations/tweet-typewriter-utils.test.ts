/**
 * Red tests for the `tweet-typewriter` pure timing calculator.
 *
 * The Hero scene (AC-P4.7-2) drives the typewriter via the same 6s loop as
 * `usdc-particle-flow`: during the `posted` phase (4000–5500ms) the tweet
 * card slides up from the bottom edge and the body text types in. The
 * OrderPanel `posted` state (AC-P4.7-5) reuses the same component in
 * autoplay mode once the shill-tweet artifact arrives.
 *
 * All timing logic lives in these pure helpers so vitest (node env, no DOM)
 * can pin every boundary — the component itself is a thin rAF + useState
 * shell that delegates to `charsVisibleAt` + `sliceToVisible`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARS_PER_SECOND,
  charsVisibleAt,
  defaultDurationMs,
  sliceToVisible,
} from './tweet-typewriter-utils';

describe('charsVisibleAt — boundary math', () => {
  it('returns 0 at elapsed=0 (nothing typed yet)', () => {
    expect(charsVisibleAt(0, 100, 2000)).toBe(0);
  });

  it('returns half the chars at the midpoint of the duration', () => {
    expect(charsVisibleAt(1000, 100, 2000)).toBe(50);
  });

  it('returns all chars exactly when elapsed meets durationMs', () => {
    expect(charsVisibleAt(2000, 100, 2000)).toBe(100);
  });

  it('clamps post-end: elapsed > durationMs returns totalChars (no overflow)', () => {
    expect(charsVisibleAt(3000, 100, 2000)).toBe(100);
    expect(charsVisibleAt(60_000, 100, 2000)).toBe(100);
  });

  it('clamps pre-start: negative elapsed returns 0 (no underflow)', () => {
    expect(charsVisibleAt(-100, 100, 2000)).toBe(0);
    expect(charsVisibleAt(-10_000, 100, 2000)).toBe(0);
  });

  it('treats durationMs === 0 as instant: elapsed >= 0 returns totalChars', () => {
    expect(charsVisibleAt(0, 100, 0)).toBe(100);
    expect(charsVisibleAt(500, 100, 0)).toBe(100);
  });

  it('floors fractional char counts — 3/7 of 10 chars is 4 chars visible, not 4.28', () => {
    // 300/700 * 10 = 4.2857... → floor = 4
    expect(charsVisibleAt(300, 10, 700)).toBe(4);
  });
});

describe('sliceToVisible — code-point safe slicing', () => {
  it('slices simple ASCII with no surprises', () => {
    expect(sliceToVisible('hello', 3)).toBe('hel');
  });

  it('returns empty string when visibleCount is 0', () => {
    expect(sliceToVisible('abc', 0)).toBe('');
  });

  it('returns the full text when visibleCount exceeds length (no overrun)', () => {
    expect(sliceToVisible('abc', 10)).toBe('abc');
  });

  it('treats a rocket emoji as one slot — never splits a surrogate pair', () => {
    // 'hello 🚀 world' — positions (by code point):
    //   0:h 1:e 2:l 3:l 4:o 5:' ' 6:🚀 7:' ' 8:w ...
    // Slicing the first 7 slots yields "hello 🚀" — the emoji must render
    // whole, not as a lone high-surrogate box.
    const out = sliceToVisible('hello 🚀 world', 7);
    expect(out).toBe('hello \u{1F680}');
    // Sanity: the emoji code point is present as a single grapheme.
    expect(Array.from(out).length).toBe(7);
  });

  it('slicing mid-emoji text returns the chars before the emoji intact', () => {
    expect(sliceToVisible('hello 🚀 world', 6)).toBe('hello ');
  });

  it('handles a leading emoji — one slot counts as one code point', () => {
    expect(sliceToVisible('🐱🚀 go', 1)).toBe('\u{1F431}');
    expect(sliceToVisible('🐱🚀 go', 2)).toBe('\u{1F431}\u{1F680}');
  });
});

describe('defaultDurationMs + DEFAULT_CHARS_PER_SECOND', () => {
  it('DEFAULT_CHARS_PER_SECOND is pinned to 40 (≈25ms per char)', () => {
    expect(DEFAULT_CHARS_PER_SECOND).toBe(40);
  });

  it('defaultDurationMs(80) lands in the 1500–2500ms window (spec: ~2000ms)', () => {
    const ms = defaultDurationMs(80);
    expect(ms).toBeGreaterThanOrEqual(1500);
    expect(ms).toBeLessThanOrEqual(2500);
  });

  it('defaultDurationMs(0) returns 0 — empty text types instantly', () => {
    expect(defaultDurationMs(0)).toBe(0);
  });

  it('defaultDurationMs scales linearly — doubling chars doubles duration', () => {
    const a = defaultDurationMs(40);
    const b = defaultDurationMs(80);
    expect(b).toBe(a * 2);
  });
});
