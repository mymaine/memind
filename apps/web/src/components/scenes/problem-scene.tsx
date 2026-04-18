'use client';

/**
 * ProblemScene — the "32k noise" scene (AC-P4.7-3).
 *
 * Layout: 80vh `<section>` whose background is a slow, multi-row marquee of
 * fake-memecoin ticker pills and whose foreground is a centred large
 * headline + subcopy callout. The combination dramatises PROBLEM_SUBCOPY's
 * "32,000 new tokens in a single October 2025 day" image — the pills read
 * as noise; the foreground copy reads as signal.
 *
 * Motion budget (V4.7-P3 risk row in docs/features/demo-narrative-ui.md):
 *   - DOM node budget ≤ 60 pills. We render 2 rows × 14 tokens × 2 repeats
 *     = 56 pills (+ 2 row wrappers + outer container = well under 60).
 *     The × 2 repeat is what lets the marquee loop seamlessly: the first
 *     copy scrolls off the right edge exactly as the second copy enters
 *     from the left, using a -50% translate at the animation's endpoint.
 *   - Ticker speed: `40s` linear (design.md §7 `duration-marquee 40-80s`,
 *     floored at 40s so the eye registers motion without distracting from
 *     the foreground copy).
 *   - Row direction alternates (row 0 left→right via the default keyframe,
 *     row 1 right→left via `.ticker-row--reverse` which flips
 *     animation-direction). The alternating direction makes the background
 *     feel "chaotic" rather than "orderly" — matching the narrative.
 *
 * IntersectionObserver play/pause (AC-P4.7-3 explicit requirement):
 *   The ticker animates only while the scene is in the viewport. On leave,
 *   we PAUSE (animation-play-state: paused) rather than unmount — no DOM
 *   churn, state preserved, re-enter continues from the frozen frame.
 *
 *   This IS NOT shared with `useScrollReveal` because that hook disconnects
 *   its observer on first entry (one-way latch) — so it cannot pause on
 *   leave. We run a second, raw IO whose lifecycle is tied to section
 *   unmount via useEffect cleanup.
 *
 * Reduced-motion:
 *   `useReducedMotion()` → true short-circuits to a static first-12-token
 *   view with `tickerPlayState='paused'` forced. globals.css already zeros
 *   animation-duration under `prefers-reduced-motion: reduce`, but the
 *   explicit `.ticker--paused` class is a belt-and-braces guarantee.
 *
 * Scene reveal (AC-P4.7-8):
 *   Outer section carries `.scene` + `useScrollReveal` adds `.scene--revealed`
 *   on first entry. Unlike Hero this is NOT the first paint — we want real
 *   scroll to trigger the fade+translate, so no mount-time revealed latch.
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { PROBLEM_HEADLINE, PROBLEM_SUBCOPY } from '@/lib/narrative-copy';

// Representative fake memecoin-style names evoking the 32k daily-spam image
// referenced by PROBLEM_HEADLINE. Deliberately goofy to read as noise, not
// signal. Length = 14 so 2 rows × 2 repeats stays within the 60-node budget.
const DEFAULT_TICKER_TOKENS = [
  '$PEPE2.0',
  '$MOON69',
  '$WIF',
  '$SHIBX',
  '$FLOKI4',
  '$BONK99',
  '$DOGE9',
  '$FROG',
  '$CATDAO',
  '$ELON',
  '$TRUMP',
  '$KANYE',
  '$SATO',
  '$BITCOIN2',
] as const;

// Number of tokens shown in the reduced-motion static fallback. Matches the
// AC-P4.7-12 reduced-motion matrix row ("static, first 12 fake tokens").
const REDUCED_MOTION_STATIC_COUNT = 12;

// Rows rendered in the background marquee. Two rows keeps the DOM budget
// comfortably under 60 nodes while still giving the eye enough visual
// density to read as "noise".
const TICKER_ROW_COUNT = 2;

export interface ProblemSceneProps {
  /** Headline override (defaults to PROBLEM_HEADLINE). */
  readonly headline?: string;
  /** Subcopy override (defaults to PROBLEM_SUBCOPY). */
  readonly subcopy?: string;
  /** Override the fake token list shown in the ticker. */
  readonly tickerTokens?: readonly string[];
  /** Force ticker play-state — `null` (default) lets IntersectionObserver
   *  decide; `'paused'` freezes the animation, `'running'` overrides to
   *  always-on. Mainly used by tests + the reduced-motion short-circuit. */
  readonly tickerPlayState?: 'paused' | 'running' | null;
}

/** Pill styling shared across rows. Extracted so the repeated element stays
 *  cheap to change. */
const PILL_CLASS =
  'inline-flex items-center gap-2 rounded-full border border-border-default px-3 py-1 ' +
  'font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary';

export function ProblemScene({
  headline = PROBLEM_HEADLINE,
  subcopy = PROBLEM_SUBCOPY,
  tickerTokens = DEFAULT_TICKER_TOKENS,
  tickerPlayState = null,
}: ProblemSceneProps): React.ReactElement {
  const reducedMotion = useReducedMotion();

  // Scene-reveal observer (one-way latch) — AC-P4.7-8.
  const sectionRef = useRef<HTMLElement | null>(null);
  const revealed = useScrollReveal(sectionRef);

  // Independent ticker-viewport observer — toggles play/pause based on
  // whether the section currently intersects the viewport. Starts paused so
  // the first paint (before the observer fires) is static rather than
  // already-animating.
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Two-way: we DO want to pause on leave (unlike scene-reveal).
          setInView(entry.isIntersecting);
        }
      },
      // `threshold: 0` fires as soon as any pixel of the section is visible.
      // rootMargin 0 keeps pause/play exactly aligned with the visible band.
      { rootMargin: '0px', threshold: 0 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, []);

  // Resolve final play-state. Prop override wins (tests + reduced-motion
  // short-circuit below); otherwise mirror inView.
  const effectivePlayState: 'paused' | 'running' =
    tickerPlayState ?? (reducedMotion ? 'paused' : inView ? 'running' : 'paused');

  // Reduced-motion: show a static slice of the first 12 tokens, no repeats,
  // no marquee scroll. The pause class is still applied so the global
  // `prefers-reduced-motion: reduce` CSS rule and the scoped class agree.
  const rows: readonly (readonly string[])[] = reducedMotion
    ? [tickerTokens.slice(0, REDUCED_MOTION_STATIC_COUNT)]
    : Array.from({ length: TICKER_ROW_COUNT }, () => tickerTokens);

  // Repeat each row twice in non-reduced mode so the -50% translate endpoint
  // loops seamlessly. Reduced-motion rows render once (no animation).
  const rowRepeats = reducedMotion ? 1 : 2;

  const tickerContainerClass = [
    'ticker',
    effectivePlayState === 'running' ? 'ticker--running' : 'ticker--paused',
    'absolute inset-0 flex flex-col justify-center gap-8 opacity-40',
  ].join(' ');

  const sceneClass = [
    'scene relative flex min-h-[80vh] items-center justify-center overflow-hidden px-6 py-12',
    revealed ? 'scene--revealed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={sectionRef} aria-label="Problem" className={sceneClass}>
      {/* ─── Background · 32k fake-token ticker marquee ──────────────── */}
      <div
        className={tickerContainerClass}
        aria-hidden="true"
        data-testid="problem-ticker"
        data-play-state={effectivePlayState}
      >
        {rows.map((rowTokens, rowIdx) => (
          <div
            key={`row-${rowIdx}`}
            className={`ticker-row ${rowIdx % 2 === 1 ? 'ticker-row--reverse' : ''} inline-flex min-w-max items-center gap-3`}
          >
            {Array.from({ length: rowRepeats }).flatMap((_, repeatIdx) =>
              rowTokens.map((token) => (
                <span key={`${rowIdx}-${repeatIdx}-${token}`} className={PILL_CLASS}>
                  {token}
                </span>
              )),
            )}
          </div>
        ))}
      </div>

      {/* ─── Foreground · centered headline + subcopy callout ─────────── */}
      <div className="relative z-10 mx-auto max-w-[880px] px-6 text-center">
        <h2
          className="font-[family-name:var(--font-sans-display)] text-[48px] font-normal leading-[1.0] tracking-[-0.5px] text-fg-emphasis md:text-[72px]"
          data-testid="problem-headline"
        >
          {headline}
        </h2>
        <p
          className="mt-4 font-[family-name:var(--font-sans-body)] text-[18px] leading-[1.5] text-fg-secondary"
          data-testid="problem-subcopy"
        >
          {subcopy}
        </p>
      </div>
    </section>
  );
}
