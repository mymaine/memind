/**
 * Pure helpers backing the `UsdcParticleFlow` SVG component.
 *
 * The Hero scene (AC-P4.7-2) and the Solution scene's x402 micro-animation
 * (AC-P4.7-4) both drive a 6-second loop. Spec (`docs/features/
 * demo-narrative-ui.md` → "Hero 動畫數據流") pins the phase boundaries:
 *
 *   idle     0    – 500
 *   paying   500  – 2500
 *   drafting 2500 – 4000
 *   posted   4000 – 5500
 *   idle     5500 – 6000
 *
 * Keeping the timing in a pure module lets vitest (node env, no DOM) verify
 * every boundary + wrap-around case without ever rendering the SVG. The
 * component's rAF loop just feeds `performance.now() - baseline` into
 * `getPhaseAtMs` each frame.
 */

export type ParticleFlowPhase = 'idle' | 'paying' | 'drafting' | 'posted';

export interface PhaseRange {
  readonly phase: ParticleFlowPhase;
  readonly startMs: number; // inclusive
  readonly endMs: number; //  exclusive
}

/** Total duration of one Hero loop. Re-exported for scene components that
 *  want to align their own animations (e.g. tweet typewriter finish) to the
 *  same 6s cadence without hard-coding the magic number. */
export const HERO_CYCLE_MS = 6000;

/**
 * The Hero 6s cycle broken into contiguous `[startMs, endMs)` segments. The
 * tuple is intentionally `readonly` + `as const` so consumers cannot mutate
 * the global schedule at runtime — callers that need a different timeline
 * pass their own `PhaseRange[]` to `getPhaseAtMs` / `cycleDurationMs`.
 *
 * Order matters: `getPhaseAtMs` does a linear scan and returns the first
 * matching segment. The tests pin each boundary explicitly.
 */
export const HERO_PHASE_RANGES: readonly PhaseRange[] = [
  { phase: 'idle', startMs: 0, endMs: 500 },
  { phase: 'paying', startMs: 500, endMs: 2500 },
  { phase: 'drafting', startMs: 2500, endMs: 4000 },
  { phase: 'posted', startMs: 4000, endMs: 5500 },
  { phase: 'idle', startMs: 5500, endMs: HERO_CYCLE_MS },
] as const;

/**
 * Span from the first segment's `startMs` to the last segment's `endMs`. For
 * the Hero ranges this is exactly `HERO_CYCLE_MS`; exposed as a helper so
 * callers that build custom schedules do not have to re-derive it.
 *
 * Assumes ranges are non-empty and ordered; passing an empty tuple is a
 * programmer error caught at the `getPhaseAtMs` call site.
 */
export function cycleDurationMs(ranges: readonly PhaseRange[]): number {
  if (ranges.length === 0) return 0;
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  // Non-empty check above guarantees both are defined; the optional chaining
  // is defensive for `noUncheckedIndexedAccess`.
  return (last?.endMs ?? 0) - (first?.startMs ?? 0);
}

/**
 * Resolve the phase at `elapsedMs` inside one cycle.
 *
 * Inputs are wrapped into `[0, cycleDurationMs)` before lookup, so callers do
 * NOT need to modulo themselves — both positive overflow (6500 → 500) and
 * negative input (-500 → 5500) flow through the same wrap. The standard
 * `((x % total) + total) % total` idiom keeps negatives positive because JS
 * modulo preserves the sign of the dividend.
 *
 * Throws when `ranges` is empty — there is no meaningful fallback phase, and
 * silent defaulting would mask bugs in custom schedules.
 */
export function getPhaseAtMs(
  elapsedMs: number,
  ranges: readonly PhaseRange[] = HERO_PHASE_RANGES,
): ParticleFlowPhase {
  if (ranges.length === 0) {
    throw new Error('getPhaseAtMs: ranges must not be empty');
  }

  const total = cycleDurationMs(ranges);
  // Guard against degenerate zero-length schedules (e.g. single range with
  // start === end) — fall back to the first segment rather than dividing by 0.
  if (total <= 0) {
    const first = ranges[0];
    if (!first) throw new Error('getPhaseAtMs: ranges must not be empty');
    return first.phase;
  }

  const wrapped = ((elapsedMs % total) + total) % total;

  for (const range of ranges) {
    if (wrapped >= range.startMs && wrapped < range.endMs) {
      return range.phase;
    }
  }

  // Ranges are expected to cover [0, total) with no gaps. If the loop falls
  // through the schedule is malformed; surface it loudly so tests catch it.
  throw new Error(`getPhaseAtMs: no range covers ${wrapped.toString()}ms — schedule has gaps`);
}
