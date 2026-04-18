'use client';

/**
 * TweetTypewriter — shared component that types out a tweet body char-by-char.
 *
 * Used in two places:
 *   - **Hero scene (AC-P4.7-2)**: parent owns the 6s loop and feeds
 *     `elapsedMs` (controlled mode). The component renders the visible slice
 *     verbatim and does NOT start an internal rAF, so the typewriter stays
 *     in lockstep with the USDC particle flow and the rest of the Hero
 *     animation cluster.
 *   - **OrderPanel `posted` state (AC-P4.7-5)**: component mounts when the
 *     shill-tweet artifact arrives and runs its own rAF loop until the
 *     tweet fully types out (autoplay mode). The outer tweet-preview-card
 *     shell (Task V4.7-P4) wraps this for the body slot.
 *
 * Accessibility:
 *   - `prefers-reduced-motion` short-circuits any rAF and renders the
 *     complete text from frame 1, per spec "reduced-motion 覆蓋矩陣" →
 *     "Hero 雙邊市場 6s loop → 凍結在 posted 幀，顯示靜態 tweet 文本".
 *   - `aria-label` (or the full text as fallback) is set on the container so
 *     screen readers announce the tweet once, not character-by-character.
 *     We deliberately do NOT set `aria-live` — this is decorative typing,
 *     not a status update.
 *
 * Implementation notes:
 *   - All timing math lives in `tweet-typewriter-utils` (pure, node-testable).
 *     The only thing this file does is hook those functions into React state
 *     and a rAF loop.
 *   - The rAF loop calls `setState` only when the visible char count changes,
 *     not every frame — avoids the 60-setState/sec footgun on longer tweets.
 *   - Cleanup cancels the outstanding rAF on unmount (Phase 4.7 risk:
 *     "Hero 動畫 RAF / setInterval 在 Next.js client-side nav 下未 cleanup").
 *   - SSR guard: `typeof window === 'undefined'` skips the rAF effect so the
 *     server renders the initial state only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { HERO_TWEET_SAMPLE } from '@/lib/narrative-copy';
import { charsVisibleAt, defaultDurationMs, sliceToVisible } from './tweet-typewriter-utils';

export interface TweetTypewriterProps {
  /** Text to type. Defaults to `HERO_TWEET_SAMPLE` from narrative-copy. */
  readonly text?: string;
  /** Total duration of the typing animation in ms. If omitted, derived from
   *  the text's code-point length at `DEFAULT_CHARS_PER_SECOND`. */
  readonly durationMs?: number;
  /** Controlled mode: if provided, the component renders
   *  `charsVisibleAt(elapsedMs, totalChars, durationMs)` chars verbatim —
   *  no internal rAF. */
  readonly elapsedMs?: number;
  /** Uncontrolled mode: start an internal rAF loop on mount. Ignored when
   *  `elapsedMs` is provided (controlled wins). */
  readonly autoplay?: boolean;
  /** Render a blinking caret after the last visible char. Defaults true.
   *  Reduced-motion users get a static caret (CSS handles that). */
  readonly caret?: boolean;
  readonly className?: string;
  /** aria-label override. Defaults to the full text so screen readers read
   *  the tweet once (not char-by-char). */
  readonly ariaLabel?: string;
  /** Fires once when autoplay reaches the end. Not fired in reduced-motion
   *  (text is static from frame 1) or in controlled mode (the parent owns
   *  completion semantics). */
  readonly onComplete?: () => void;
}

export function TweetTypewriter({
  text = HERO_TWEET_SAMPLE,
  durationMs,
  elapsedMs,
  autoplay = false,
  caret = true,
  className,
  ariaLabel,
  onComplete,
}: TweetTypewriterProps): React.ReactElement {
  const reducedMotion = useReducedMotion();

  // Code-point length — mirrors sliceToVisible's splitting so
  // `charsVisibleAt(…, totalChars, …)` and the slice agree on what "one slot"
  // means. `text.length` counts UTF-16 units, which would overcount emoji.
  const totalChars = useMemo(() => Array.from(text).length, [text]);
  const effectiveDurationMs = durationMs ?? defaultDurationMs(totalChars);
  const isControlled = elapsedMs !== undefined;

  // Uncontrolled visible count. Seeded at 0 so SSR renders an empty span and
  // the first client frame flips it to the real value (unless reduced-motion,
  // in which case the whole text renders from the first paint).
  const [autoCount, setAutoCount] = useState(0);
  const lastCountRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    // Bail for every mode that shouldn't drive an internal rAF:
    //   - controlled mode (parent owns the clock)
    //   - autoplay disabled
    //   - reduced-motion (render static full text instead)
    //   - SSR (no window)
    if (isControlled) return;
    if (!autoplay) return;
    if (reducedMotion) return;
    if (typeof window === 'undefined') return;

    // Reset local state each time the effect re-runs (e.g. text change).
    completedRef.current = false;
    lastCountRef.current = 0;
    setAutoCount(0);

    const baseline = performance.now();

    const tick = (): void => {
      const elapsed = performance.now() - baseline;
      const next = charsVisibleAt(elapsed, totalChars, effectiveDurationMs);
      // Only setState on a boundary crossing — the character count is a
      // step function, so interior frames produce the same value.
      if (next !== lastCountRef.current) {
        lastCountRef.current = next;
        setAutoCount(next);
      }
      if (next >= totalChars) {
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        }
        return; // stop the loop — nothing more to type
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isControlled, autoplay, reducedMotion, totalChars, effectiveDurationMs, onComplete]);

  // Resolve the visible char count for the current render.
  //   1. reduced-motion → always totalChars (static)
  //   2. controlled     → derive from elapsedMs
  //   3. autoplay       → read from state
  //   4. fallback (no autoplay, no elapsedMs) → totalChars (component is a
  //      static label; caller probably forgot a prop, but rendering blank
  //      would be worse than rendering the full text)
  let visibleCount: number;
  if (reducedMotion) {
    visibleCount = totalChars;
  } else if (isControlled) {
    visibleCount = charsVisibleAt(elapsedMs, totalChars, effectiveDurationMs);
  } else if (autoplay) {
    visibleCount = autoCount;
  } else {
    visibleCount = totalChars;
  }

  const visibleText = sliceToVisible(text, visibleCount);
  const isTypingComplete = visibleCount >= totalChars;

  return (
    <p
      role="text"
      aria-label={ariaLabel ?? text}
      data-testid="tweet-typewriter"
      data-complete={isTypingComplete ? 'true' : 'false'}
      className={className}
    >
      <span>{visibleText}</span>
      {caret ? <span className="tw-caret" aria-hidden="true" /> : null}
    </p>
  );
}
