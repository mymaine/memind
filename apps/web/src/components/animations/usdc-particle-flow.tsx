'use client';

/**
 * UsdcParticleFlow — shared SVG animation for the Hero scene (AC-P4.7-2) and
 * the Solution scene's x402 micro-animation (AC-P4.7-4).
 *
 * Two drive modes:
 *   - **Controlled** (`phase` provided): the parent owns the 6s clock and
 *     tells us which phase to render. Hero scene uses this so its particle
 *     flow, tweet typewriter and slot-highlight animations stay in lockstep.
 *   - **Autoplay** (`autoplay` + no `phase`): component runs its own rAF
 *     loop driven by `getPhaseAtMs(performance.now() - baseline)`. Solution
 *     scene uses this so the x402 micro-animation loops independently of
 *     any Hero instance.
 *
 * Accessibility:
 *   - `prefers-reduced-motion` freezes the component on the `posted` frame
 *     (static tick on the right, particles hidden) per spec "reduced-motion
 *     覆蓋矩陣" row "Solution x402 micro-animation → 靜態 tx pill 點亮".
 *   - Rendered with `role="img"` + `aria-label` so screen readers describe
 *     the animation rather than announcing individual circles.
 *
 * Implementation choices:
 *   - Particles ride the path via CSS `offset-path` (declared in globals.css
 *     `.usdc-particle`). Each particle's stagger is an inline `--particle-
 *     delay` custom property; phase gates (`.usdc-flow--paying` etc.) toggle
 *     `animation-play-state` and duration without re-rendering SVG nodes.
 *   - rAF loop only re-renders when the computed phase changes, not every
 *     frame — avoids the 60-state-updates-per-second footgun.
 *   - Cleanup cancels the outstanding rAF on unmount (AC-P4.7 risk table:
 *     "Hero 動畫 RAF / setInterval 在 Next.js client-side nav 下未 cleanup
 *     → 記憶洩漏" is listed as a hard requirement).
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  HERO_CYCLE_MS,
  HERO_PHASE_RANGES,
  getPhaseAtMs,
  type ParticleFlowPhase,
} from './usdc-particle-flow-utils';

// Particle layout — 5 particles evenly staggered across the animation's
// 1800ms travel time. 5 falls in the spec's 4-6 range and reads as "flow"
// rather than "dots". Adjust via this tuple only; offsets are relative to a
// single particle's 1800ms travel so a 0-indexed position N starts at
// `(N / particleCount) * travelMs`.
const PARTICLE_COUNT = 5;
const PARTICLE_TRAVEL_MS = 1800;

// Path shared with globals.css `.usdc-particle { offset-path: path(...) }`.
// SVG `<path d>` and CSS `offset-path` must stay in sync — edit both together.
const FLOW_PATH_D = 'M 20 40 Q 100 20, 180 40';

// SVG viewBox chosen so the Creator slot sits at x≈10, the Shiller slot at
// x≈190, and the flow path's apex (100, 20) reads as a small arc overhead.
// 2.5:1 aspect (200x80) matches the props.width → height scaling contract.
const VIEW_W = 200;
const VIEW_H = 80;
const ASPECT = VIEW_W / VIEW_H;

export interface UsdcParticleFlowProps {
  /** When provided, the component renders this phase verbatim (controlled
   *  mode). Parent scene owns the 6s clock. */
  readonly phase?: ParticleFlowPhase;
  /** Start an internal 6s loop (uncontrolled mode). Ignored when `phase` is
   *  provided — controlled mode always wins. */
  readonly autoplay?: boolean;
  /** Rendered width in px; height scales with the fixed 2.5:1 aspect. */
  readonly width?: number;
  /** Override the flow color. Defaults to the brand Base-chain gold used by
   *  the x402-edge animation so the two animations read as one family. */
  readonly strokeColor?: string;
  readonly className?: string;
  readonly ariaLabel?: string;
}

export function UsdcParticleFlow({
  phase: controlledPhase,
  autoplay = false,
  width = 240,
  strokeColor = 'var(--color-chain-bnb)',
  className,
  ariaLabel = 'USDC flowing from creator to shiller agent',
}: UsdcParticleFlowProps): React.ReactElement {
  const reducedMotion = useReducedMotion();

  // Internal phase for autoplay mode. Seed with 'idle' so SSR and first
  // client paint agree. The rAF effect below flips it to the real phase.
  const [autoPhase, setAutoPhase] = useState<ParticleFlowPhase>('idle');

  // Controlled mode wins over autoplay; reduced motion wins over everything.
  // Order matters: reduced-motion check must be last so it can freeze the
  // component regardless of driver.
  let effectivePhase: ParticleFlowPhase = controlledPhase ?? autoPhase;
  if (reducedMotion) effectivePhase = 'posted';

  // Drive the internal rAF loop only when uncontrolled + autoplay + motion
  // is allowed. Any one of those being false skips the effect entirely.
  const rafRef = useRef<number | null>(null);
  const lastPhaseRef = useRef<ParticleFlowPhase>('idle');

  useEffect(() => {
    if (controlledPhase !== undefined) return;
    if (!autoplay) return;
    if (reducedMotion) return;
    if (typeof window === 'undefined') return;

    const baseline = performance.now();
    lastPhaseRef.current = 'idle';

    const tick = (): void => {
      const elapsed = performance.now() - baseline;
      const next = getPhaseAtMs(elapsed, HERO_PHASE_RANGES);
      // Only trigger a re-render when the phase boundary is crossed — inside
      // a phase the CSS handles every frame, so React can stay idle.
      if (next !== lastPhaseRef.current) {
        lastPhaseRef.current = next;
        setAutoPhase(next);
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
  }, [controlledPhase, autoplay, reducedMotion]);

  const height = width / ASPECT;
  const pathBright = effectivePhase !== 'idle';
  const showTick = effectivePhase === 'posted';

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-phase={effectivePhase}
      className={className}
      style={{ width, height }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W.toString()} ${VIEW_H.toString()}`}
        preserveAspectRatio="xMidYMid meet"
        width={width}
        height={height}
        aria-hidden="true"
      >
        {/* Creator slot — the money source. */}
        <g data-testid="creator-slot">
          <circle
            cx={10}
            cy={40}
            r={8}
            fill="var(--color-bg-elevated)"
            stroke="var(--color-border-default)"
            strokeWidth={1.5}
          />
          <text
            x={10}
            y={43}
            textAnchor="middle"
            fontSize={7}
            fontFamily="var(--font-mono)"
            fill="var(--color-fg-secondary)"
          >
            C
          </text>
        </g>

        {/* Shiller slot — the service provider. Tick overlay appears in posted. */}
        <g data-testid="shiller-slot">
          <circle
            cx={190}
            cy={40}
            r={8}
            fill="var(--color-bg-elevated)"
            stroke={showTick ? 'var(--color-accent)' : 'var(--color-border-default)'}
            strokeWidth={showTick ? 2 : 1.5}
            style={showTick ? { filter: 'drop-shadow(0 0 4px var(--color-accent))' } : undefined}
          />
          {showTick ? (
            // Checkmark glyph built from two strokes — tiny and a11y-invisible
            // (the outer `role="img"` already labels the animation).
            <path
              d="M 186 40 L 189 43 L 194 37"
              stroke="var(--color-accent)"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : (
            <text
              x={190}
              y={43}
              textAnchor="middle"
              fontSize={7}
              fontFamily="var(--font-mono)"
              fill="var(--color-fg-secondary)"
            >
              S
            </text>
          )}
        </g>

        {/* Flow path — idle = dashed muted, anything else = solid bright. */}
        <path
          data-testid="flow-path"
          d={FLOW_PATH_D}
          fill="none"
          stroke={pathBright ? strokeColor : 'var(--color-border-default)'}
          strokeWidth={pathBright ? 1.5 : 1}
          strokeDasharray={pathBright ? undefined : '3 3'}
          opacity={pathBright ? 1 : 0.45}
        />

        {/* Particle group — CSS drives motion via `.usdc-flow--<phase>` on the
            wrapper div's data-phase. Each particle rides the same offset-path
            with a staggered animation-delay so the river reads as continuous. */}
        <g className={`usdc-flow usdc-flow--${effectivePhase}`} data-testid="particle-group">
          {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
            const delayMs = Math.round((i / PARTICLE_COUNT) * PARTICLE_TRAVEL_MS);
            return (
              <circle
                key={i}
                className="usdc-particle"
                data-testid={`particle-${i.toString()}`}
                r={2.5}
                fill={strokeColor}
                style={{ ['--particle-delay' as string]: `${delayMs.toString()}ms` }}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// Re-export the cycle duration so scene components that mirror this animation's
// cadence (tweet typewriter) do not have to reach into `-utils`.
export { HERO_CYCLE_MS };
