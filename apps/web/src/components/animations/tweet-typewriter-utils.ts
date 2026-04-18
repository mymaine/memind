/**
 * Pure timing helpers for the `TweetTypewriter` component.
 *
 * The component has two drive modes (controlled / autoplay) but both funnel
 * through these functions — nothing here touches the DOM, React, or
 * `performance.now`, so vitest (node env) can pin every edge case.
 *
 * Design notes:
 *   - Spec (`docs/features/demo-narrative-ui.md` → "Hero 動畫數據流") requires
 *     "逐 frame 遞進 HERO_TWEET_SAMPLE". We do not pin cps there, so we pick
 *     40 chars/sec (`DEFAULT_CHARS_PER_SECOND`) — fast enough to read as "AI
 *     typing", slow enough that the posted window (4000–5500ms = 1.5s) can
 *     display a ~60-char prefix before the loop resets. Callers that need a
 *     different cadence pass `durationMs` directly.
 *   - `sliceToVisible` splits via `Array.from(text)` so a code point counts
 *     as one visible slot. That keeps surrogate pairs ("🚀") and single-
 *     code-point emoji atomic. ZWJ sequences (👨‍👩‍👧) will be split at their
 *     joiner but each half is still a valid code point — no half-emoji box.
 */

/**
 * Return the visible character count for a typewriter of `totalChars` chars
 * over `durationMs` ms, queried at `elapsedMs` since start.
 *
 * Clamped to [0, totalChars]. Negative / pre-start returns 0; post-end
 * returns totalChars. `durationMs === 0` is treated as instant (returns
 * totalChars as soon as elapsedMs >= 0) — avoids divide-by-zero.
 */
export function charsVisibleAt(elapsedMs: number, totalChars: number, durationMs: number): number {
  if (elapsedMs < 0) return 0;
  // durationMs === 0 is "instant" — as soon as elapsedMs is non-negative the
  // full text is visible. Checking this before the elapsed>=duration branch
  // also avoids a divide-by-zero in the fractional path below.
  if (durationMs <= 0) return totalChars;
  if (elapsedMs >= durationMs) return totalChars;
  const raw = (elapsedMs / durationMs) * totalChars;
  // Floor so the character count only ever increases one slot at a time —
  // ceil would let the last char pop in early and then stall.
  return Math.floor(raw);
}

/**
 * Slice the first `visibleCount` code points from `text`, preserving
 * surrogate pairs and emoji clusters so a half-emoji never renders.
 *
 * Internally splits via `Array.from(text)` (one code point per array slot)
 * then joins — the naive `text.substring(0, n)` would slice a surrogate
 * pair in half when `n` falls between a high and low surrogate.
 */
export function sliceToVisible(text: string, visibleCount: number): string {
  if (visibleCount <= 0) return '';
  const codePoints = Array.from(text);
  if (visibleCount >= codePoints.length) return text;
  return codePoints.slice(0, visibleCount).join('');
}

/**
 * Default typewriter speed: chars per second. Spec doesn't pin a number, so
 * we pick 40 cps (≈ 25ms per char) — reads as "AI typing quickly" not
 * sluggish, and keeps a ~200-char tweet under 5s so it can complete inside
 * one Hero loop if needed.
 */
export const DEFAULT_CHARS_PER_SECOND = 40;

/**
 * Derive the default typing duration for a piece of text at the default
 * cps. Returns 0 for empty text so callers can short-circuit the rAF loop.
 */
export function defaultDurationMs(totalChars: number): number {
  if (totalChars <= 0) return 0;
  return Math.round((totalChars / DEFAULT_CHARS_PER_SECOND) * 1000);
}
