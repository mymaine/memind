'use client';

/**
 * SolutionScene — "how it works" 3-step pipeline (AC-P4.7-4).
 *
 * Layout: 100vh `<section>` with a short overline heading and three
 * side-by-side step cards (Launch → Pay → Shill). The middle card hosts an
 * independent, autoplay instance of <UsdcParticleFlow /> (the x402 micro-
 * animation) plus a static tx-hash pill that flashes to echo settlement.
 *
 * Motion contract (spec "reduced-motion 覆蓋矩陣"):
 *   - Cards have a y-lift + accent border flash on hover; reveal triggers a
 *     one-shot border pulse via `.scene-card--revealed` (globals.css keyframe
 *     `scene-card-reveal-pulse`).
 *   - Middle card's particle flow runs its own 6s rAF loop (autoplay mode)
 *     — independent of any Hero instance per spec "Hero 動畫數據流" note.
 *   - Tx pill runs a 4s ease-in-out drop-shadow pulse (keyframe
 *     `tx-pill-flash`) that does NOT try to sync with the particle-flow
 *     phase — the spec ("tx pill 閃亮") does not require precise sync, and
 *     simpler reads better.
 *
 * Reduced-motion:
 *   - `.scene-card:hover` collapses to a background-color change only; no
 *     lift, no border flash (per the coverage matrix "Solution 卡片微動畫"
 *     row).
 *   - Tx pill freezes with the drop-shadow ON ("static tx pill 點亮").
 *   - UsdcParticleFlow's own reduced-motion guard locks it to the `posted`
 *     frame — we inherit that path without extra wiring.
 *
 * Scroll reveal (AC-P4.7-8):
 *   - Outer <section> carries `.scene`; useScrollReveal adds `.scene--revealed`
 *     on first entry. Unlike Hero this is NOT the first paint — we want real
 *     scroll to trigger the fade+translate, so no mount-time revealed latch.
 *   - `freeze` prop (used by tests + the reduced-motion short-circuit) forces
 *     the revealed class so the scene paints deterministically without
 *     depending on IntersectionObserver firing.
 */
import { useRef } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { SOLUTION_STEPS, type SolutionStep } from '@/lib/narrative-copy';
import { UsdcParticleFlow } from '@/components/animations/usdc-particle-flow';

/**
 * Demo-proof x402 settlement tx hash, surfaced as the middle card's tx-pill
 * label. Hardcoded (not imported from EVIDENCE_ARTIFACTS) so the truncation
 * format `BASE 0x62e4..c3df` stays obvious inline. Any update to
 * EVIDENCE_ARTIFACTS[3] should be mirrored here in the same commit.
 */
const TX_PILL_LABEL = 'BASE 0x62e4..c3df';

/** Relaxed step shape used by the prop; narrative-copy uses a stricter
 *  union title type internally, but callers overriding should be free to
 *  supply any string. */
export interface SolutionSceneStepInput {
  readonly title: string;
  readonly body: string;
}

export interface SolutionSceneProps {
  /** Override the 3 steps (defaults to SOLUTION_STEPS from narrative-copy). */
  readonly steps?: readonly SolutionSceneStepInput[];
  /** Deterministic frame for tests — applies `.scene--revealed` unconditionally
   *  and drops the flashing class from the tx pill so the static drop-shadow
   *  variant is visible. UsdcParticleFlow's own reduced-motion path handles
   *  the rest (freezes on the `posted` frame). */
  readonly freeze?: boolean;
}

export function SolutionScene({
  steps = SOLUTION_STEPS as readonly SolutionStep[],
  freeze = false,
}: SolutionSceneProps): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRevealed = useScrollReveal(sectionRef);
  const revealed = scrollRevealed || freeze;

  // Tx pill: flashing animation runs by default; freeze + reduced-motion
  // both collapse to a static lit variant so the viewer still reads it as
  // "settlement done" without the blink.
  const txPillStatic = freeze || reducedMotion;

  const sceneClass = [
    'scene relative flex min-h-[100vh] flex-col items-center justify-center overflow-hidden px-6 py-16',
    revealed ? 'scene--revealed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={sectionRef} aria-label="Solution" className={sceneClass}>
      {/* Overline heading — orients the reader without dominating the cards. */}
      <h2
        className="mb-10 font-[family-name:var(--font-sans-display)] text-[18px] font-semibold uppercase tracking-[0.45px] text-fg-tertiary"
        data-testid="solution-overline"
      >
        How it works
      </h2>

      {/* 3-card grid — stacks on small screens, side-by-side md+. */}
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-6 md:grid-cols-3">
        {steps.map((step, idx) => {
          const isMiddle = idx === 1;
          const cardClass = [
            'scene-card group relative flex flex-col gap-4 rounded-[var(--radius-card)]',
            'border border-border-default bg-bg-surface p-6',
            revealed ? 'scene-card--revealed' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <article
              key={`${idx.toString()}-${step.title}`}
              className={cardClass}
              data-testid={`solution-card-${idx.toString()}`}
            >
              {/* Step number — mono + tertiary so it reads as meta, not copy. */}
              <span className="font-[family-name:var(--font-mono)] text-[24px] font-semibold text-fg-tertiary">
                {(idx + 1).toString()}
              </span>

              <h3 className="font-[family-name:var(--font-sans-display)] text-[24px] font-semibold leading-[1.1] text-fg-primary">
                {step.title}
              </h3>

              <p className="font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-secondary">
                {step.body}
              </p>

              {/* Middle-card-only: x402 micro-animation + tx pill. */}
              {isMiddle ? (
                <div className="mt-2 flex flex-col items-start gap-3">
                  <UsdcParticleFlow
                    autoplay
                    width={180}
                    ariaLabel="USDC settlement flowing creator to shiller via x402"
                  />
                  <span
                    data-testid="tx-pill"
                    className={[
                      'inline-flex items-center gap-2 rounded-full',
                      'border border-[color:var(--color-chain-base)]',
                      'bg-bg-elevated px-3 py-1',
                      'font-[family-name:var(--font-mono)] text-[11px] text-fg-secondary',
                      txPillStatic ? 'tx-pill--static' : 'tx-pill--flashing',
                    ].join(' ')}
                  >
                    {TX_PILL_LABEL}
                  </span>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
