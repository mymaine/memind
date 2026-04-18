'use client';

/**
 * HeroScene — the first-paint aha moment (AC-P4.7-2).
 *
 * Layout: 100vh `<section>` split into two columns —
 *
 *   Left  · Display-sized pitch + sub-copy + two CTAs
 *     PRIMARY   = `Launch a token` (in-page anchor to #launch-panel)
 *     SECONDARY = `Already have a token? Order a shill` (→ /market#order)
 *
 *   Right · Live double-sided market animation —
 *           Creator card · UsdcParticleFlow · Shiller card
 *           (+ Tweet card slides up from the bottom during `posted`)
 *
 * The right column runs a 6-second loop whose boundaries are pinned in
 * `usdc-particle-flow-utils` (idle 0-0.5s → paying 0.5-2.5s → drafting
 * 2.5-4s → posted 4-5.5s → idle 5.5-6s). This component owns the clock; its
 * children (`<UsdcParticleFlow />`, `<TweetTypewriter />`) stay in lockstep
 * via a single `phase` value and a per-cycle `key` that remounts the
 * typewriter each loop.
 *
 * Orchestration choice — method "C" from the task brief:
 *   - `<UsdcParticleFlow />` is driven in controlled mode so its phase
 *     transitions happen exactly when the scene thinks they should.
 *   - `<TweetTypewriter />` runs its own internal rAF in autoplay mode
 *     during the `posted` window. We force a re-mount each cycle with a
 *     `key={cycleIndex}` so the internal timer restarts cleanly — no
 *     parent-side elapsedMs plumbing, no 60-state-updates-per-second
 *     ping-pong.
 *
 *   Consequence: this component only re-renders on phase boundaries and
 *   cycle roll-overs (≈ 5 renders per 6s loop), while child-level rAFs
 *   continue to run at 60fps for smoothness. The rAF loop itself lives
 *   in a `useEffect` and is cancelled on unmount so Next.js client-side
 *   navigation does not leak listeners.
 *
 * Reduced-motion:
 *   - No rAF loop runs. The phase is locked to `posted` and the tweet
 *     card is always visible. `<TweetTypewriter />`'s own reduced-motion
 *     guard then renders the tweet statically from frame 1.
 *
 * Scroll reveal:
 *   - The outer <section> carries `.scene` so globals.css hides it until
 *     first entry. Hero is the first paint, so a mount-time `useEffect`
 *     flips a local `revealed` flag to true immediately — we do not need
 *     to wait for scroll. (`useScrollReveal` would also trigger on its
 *     own initial-intersection check, but the fallback guarantees we
 *     don't ship an invisible hero if IO fails or is slow.)
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import {
  HERO_CTA_PRIMARY,
  HERO_CTA_SECONDARY,
  HERO_PITCH_HOME,
  HERO_SUBCOPY_HOME,
  HERO_TWEET_SAMPLE,
} from '@/lib/narrative-copy';
import { UsdcParticleFlow, HERO_CYCLE_MS } from '@/components/animations/usdc-particle-flow';
import {
  HERO_PHASE_RANGES,
  getPhaseAtMs,
  type ParticleFlowPhase,
} from '@/components/animations/usdc-particle-flow-utils';
import { TweetTypewriter } from '@/components/animations/tweet-typewriter';

// Tweet typewriter duration inside the posted window. Posted lasts 1.5s
// (4000-5500ms) per spec; the typewriter finishes just before idle resumes.
const TWEET_TYPEWRITER_MS = 1500;

// Side-slot status dot colours keyed by phase. Maps to design tokens rather
// than raw hex so dark-mode + future token renames stay in one place.
function creatorDotColor(phase: ParticleFlowPhase): string {
  if (phase === 'paying') return 'var(--color-accent)';
  if (phase === 'drafting' || phase === 'posted') return 'var(--color-success)';
  return 'var(--color-fg-tertiary)';
}

function shillerDotColor(phase: ParticleFlowPhase): string {
  if (phase === 'drafting') return 'var(--color-accent)';
  if (phase === 'posted') return 'var(--color-success)';
  return 'var(--color-fg-tertiary)';
}

export interface HeroSceneProps {
  /** Anchor id for the primary CTA to scroll to. Default: 'launch-panel'.
   *  Task 4 will mount id="launch-panel" on the ThemeInput container. */
  readonly launchAnchorId?: string;
  /** Anchor for the secondary CTA. Default: '/market#order'. */
  readonly orderHref?: string;
  /** Override hero content — mostly for tests; defaults come from
   *  narrative-copy so marketing copy stays in one file. */
  readonly pitch?: string;
  readonly subcopy?: string;
  readonly primaryCta?: string;
  readonly secondaryCta?: string;
  readonly tweetSample?: string;
  /** Escape hatch for tests: disable the 6s rAF clock so the scene renders
   *  a deterministic `posted` frame. Ignored when reducedMotion=true (that
   *  path already freezes). */
  readonly freeze?: boolean;
}

export function HeroScene({
  launchAnchorId = 'launch-panel',
  orderHref = '/market#order',
  pitch = HERO_PITCH_HOME,
  subcopy = HERO_SUBCOPY_HOME,
  primaryCta = HERO_CTA_PRIMARY,
  secondaryCta = HERO_CTA_SECONDARY,
  tweetSample = HERO_TWEET_SAMPLE,
  freeze = false,
}: HeroSceneProps): React.ReactElement {
  const reducedMotion = useReducedMotion();

  // Reduced-motion + freeze both collapse to the `posted` frame so the
  // static-text path (typewriter renders full text) kicks in.
  const forceStatic = reducedMotion || freeze;

  // Phase + cycle index are the only two state slots. setState fires only
  // when a boundary crosses (≤ 5 renders per 6s loop); CSS owns the
  // in-phase motion and the child typewriter owns its own sub-rAF.
  const [phase, setPhase] = useState<ParticleFlowPhase>(forceStatic ? 'posted' : 'idle');
  const [cycleIndex, setCycleIndex] = useState(0);

  // Reveal latch: `useScrollReveal` observes the section, but Hero is the
  // first paint — we cannot depend on scroll to reveal it. A mount-time
  // effect sets `mountRevealed` immediately so the scene paints on first
  // frame; the scroll-reveal hook still runs so the class toggles even
  // when our mount effect is skipped (SSR / test).
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRevealed = useScrollReveal(sectionRef);
  const [mountRevealed, setMountRevealed] = useState(false);
  useEffect(() => {
    // A single microtask is enough — this is only here so the .scene class
    // never stays opacity:0 on the first paint.
    setMountRevealed(true);
  }, []);
  const revealed = scrollRevealed || mountRevealed;

  // rAF orchestrator — drives phase + cycleIndex. Skipped entirely when
  // reduced-motion is on, when `freeze` is on, or when we're in SSR.
  const rafRef = useRef<number | null>(null);
  const lastPhaseRef = useRef<ParticleFlowPhase>('idle');
  const lastCycleRef = useRef(0);
  useEffect(() => {
    if (forceStatic) return;
    if (typeof window === 'undefined') return;

    const baseline = performance.now();
    lastPhaseRef.current = 'idle';
    lastCycleRef.current = 0;

    const tick = (): void => {
      const now = performance.now() - baseline;
      const nextCycle = Math.floor(now / HERO_CYCLE_MS);
      const elapsedInCycle = now - nextCycle * HERO_CYCLE_MS;
      const nextPhase = getPhaseAtMs(elapsedInCycle, HERO_PHASE_RANGES);
      // Only setState on boundary crossings (phase flip or cycle roll-over)
      // — the CSS + child rAFs handle every intermediate frame.
      if (nextPhase !== lastPhaseRef.current) {
        lastPhaseRef.current = nextPhase;
        setPhase(nextPhase);
      }
      if (nextCycle !== lastCycleRef.current) {
        lastCycleRef.current = nextCycle;
        setCycleIndex(nextCycle);
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
  }, [forceStatic]);

  const tweetVisible = phase === 'posted';

  return (
    <section
      ref={sectionRef}
      aria-label="Hero"
      className={`scene relative grid min-h-[100vh] place-items-center overflow-hidden px-6 py-12${
        revealed ? ' scene--revealed' : ''
      }`}
    >
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-12 md:grid-cols-[1.1fr_1fr]">
        {/* ─── Left column · pitch + CTAs ─────────────────────────────── */}
        <div className="flex flex-col gap-6">
          <h1
            className="font-[family-name:var(--font-sans-display)] text-[60px] font-normal leading-[1.0] tracking-[-0.65px] text-fg-emphasis"
            data-testid="hero-pitch"
          >
            {pitch}
          </h1>
          <p className="max-w-[480px] font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-secondary">
            {subcopy}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* PRIMARY CTA — in-page anchor. `scroll-behavior: smooth` in
                globals.css makes this glide instead of jumping. */}
            <a
              href={`#${launchAnchorId}`}
              data-testid="hero-cta-primary"
              className="inline-flex items-center justify-center rounded-[var(--radius-default)] border-2 border-accent bg-bg-surface px-4 py-3 font-[family-name:var(--font-sans-body)] text-[16px] font-semibold text-accent-text transition-opacity duration-150 hover:opacity-80"
            >
              {primaryCta}
            </a>
            {/* SECONDARY CTA — cross-page route via next/link. The cast to
                Next's typed `Route` lets callers pass a plain string prop
                (tests, future links) while satisfying the app's typedRoutes
                config; the default '/market#order' is already a valid Route. */}
            <Link
              href={orderHref as Route}
              data-testid="hero-cta-secondary"
              className="inline-flex items-center justify-center rounded-[var(--radius-default)] border border-border-default bg-transparent px-4 py-3 font-[family-name:var(--font-sans-body)] text-[16px] font-medium text-fg-primary transition-colors duration-150 hover:border-accent"
            >
              {secondaryCta}
            </Link>
          </div>
        </div>

        {/* ─── Right column · live double-sided market animation ──────── */}
        <div
          role="img"
          aria-label="Live demo: creator pays USDC, shiller agent posts a tweet"
          className="relative flex min-h-[320px] items-center justify-center"
          data-testid="hero-animation"
          data-phase={phase}
        >
          <div className="flex items-center gap-4">
            {/* Creator card */}
            <div
              data-testid="hero-creator-card"
              className="flex min-w-[120px] flex-col gap-2 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: creatorDotColor(phase) }}
                />
                <span className="font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">
                  @creator
                </span>
              </div>
              <span className="font-[family-name:var(--font-sans-body)] text-[13px] text-fg-secondary">
                0.01 USDC
              </span>
            </div>

            {/* Particle flow middle — controlled by our phase. */}
            <UsdcParticleFlow phase={phase} width={220} />

            {/* Shiller card */}
            <div
              data-testid="hero-shiller-card"
              className="flex min-w-[120px] flex-col gap-2 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: shillerDotColor(phase) }}
                />
                <span className="font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">
                  @shiller_x
                </span>
              </div>
              <span className="font-[family-name:var(--font-sans-body)] text-[13px] text-fg-secondary">
                AI agent
              </span>
            </div>
          </div>

          {/* Tweet card — slides up from the bottom during `posted`. We
              render it in every phase so the slide transition has a target
              to animate between, and use opacity + translateY to hide it
              outside of the posted window. */}
          <div
            data-testid="hero-tweet-card"
            aria-hidden={tweetVisible ? undefined : 'true'}
            className="absolute inset-x-0 bottom-0 mx-auto max-w-[520px] rounded-[var(--radius-card)] border border-border-default bg-bg-elevated p-4"
            style={{
              opacity: tweetVisible ? 1 : 0,
              transform: tweetVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 400ms var(--ease-out), transform 400ms var(--ease-out)',
            }}
          >
            {/* Key by cycle so each loop re-mounts the typewriter and its
                rAF restarts cleanly. Static modes (reduced-motion / freeze)
                would see cycleIndex = 0 forever; that's fine because the
                typewriter's own reduced-motion path renders the full text
                from the first frame. */}
            <TweetTypewriter
              key={cycleIndex}
              autoplay
              text={tweetSample}
              durationMs={TWEET_TYPEWRITER_MS}
              className="font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-primary"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
