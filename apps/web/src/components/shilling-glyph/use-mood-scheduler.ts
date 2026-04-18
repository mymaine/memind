'use client';

/**
 * Idle micro-animation scheduler.
 *
 * While the glyph sits in `idle`, this module decides when to play one of
 * five tiny personality flourishes: blink, wink, smirk-amp, glitch-shiver,
 * cursor-pulse. The scheduler is exposed as a pure controller (createMoodScheduler)
 * and a React hook (useMoodScheduler) built on top. Tests exercise the
 * controller directly with injected timers + random.
 *
 * Design rationale — why the controller is a plain object, not a hook:
 *   - Unit tests run in node; jsdom is not installed.
 *   - The only external-effect surface is `setMicro`, `schedule`, `cancel`.
 *     All three are injectable → deterministic tests.
 *   - The hook layer is trivially derivable and stays a 15-line wrapper.
 */
import { useEffect, useRef } from 'react';

export const MICRO_ANIMATIONS = [
  'blink',
  'wink',
  'smirk-amp',
  'cursor-pulse',
  'glitch-shiver',
] as const;

export type MicroAnimation = (typeof MICRO_ANIMATIONS)[number];

// Weighted pool — chosen so the idle logo mostly blinks/winks (feels alive
// without being distracting), occasionally smirks or pulses its cursor, and
// rarely glitches. Weights sum to 1.0; order follows MICRO_ANIMATIONS above.
const WEIGHTS: readonly number[] = [0.4, 0.3, 0.15, 0.1, 0.05];

/**
 * Pure weighted pick. `rand` must be in [0, 1). Returns the micro-animation
 * whose cumulative weight bucket contains `rand`.
 */
export function pickMicroAnimation(rand: number): MicroAnimation {
  let acc = 0;
  for (let i = 0; i < MICRO_ANIMATIONS.length; i += 1) {
    acc += WEIGHTS[i] ?? 0;
    if (rand < acc) return MICRO_ANIMATIONS[i] as MicroAnimation;
  }
  // Numeric edge case (rand = 0.9999… when weights sum to 1.0): return last.
  return MICRO_ANIMATIONS[MICRO_ANIMATIONS.length - 1] as MicroAnimation;
}

export type Range = readonly [number, number];

/**
 * Uniform sample in [low, high) rounded down to the nearest millisecond.
 * Integer result keeps timer IDs stable across fake-timer frameworks.
 */
export function pickNextDelayMs(rand: number, range: Range): number {
  const [low, high] = range;
  return Math.floor(low + rand * (high - low));
}

export interface MoodSchedulerDeps {
  rangeMs: Range;
  /** How long a micro animation stays active before being cleared. */
  microDurationMs: number;
  setMicro: (micro: MicroAnimation | null) => void;
  schedule: (cb: () => void, delayMs: number) => number;
  cancel: (id: number) => void;
  random: () => number;
}

export interface MoodScheduler {
  start: () => void;
  stop: () => void;
}

/**
 * Pure scheduler controller. Calling `start()` is idempotent; `stop()` clears
 * any pending timer and enters a terminal state — the scheduler cannot be
 * resumed after stop. Create a new one if you need that.
 */
export function createMoodScheduler(deps: MoodSchedulerDeps): MoodScheduler {
  let stopped = false;
  let pendingId: number | null = null;

  function scheduleNextTrigger(): void {
    if (stopped) return;
    const delay = pickNextDelayMs(deps.random(), deps.rangeMs);
    pendingId = deps.schedule(() => {
      pendingId = null;
      if (stopped) return;
      const micro = pickMicroAnimation(deps.random());
      deps.setMicro(micro);
      // Schedule both the clear and the next trigger. We keep only the next
      // trigger's timer as `pendingId` because the clear is a fire-and-forget
      // side effect — cancelling it on stop() is also correct but not strictly
      // necessary (the setter guard below handles the late fire).
      deps.schedule(() => {
        if (stopped) return;
        deps.setMicro(null);
      }, deps.microDurationMs);
      scheduleNextTrigger();
    }, delay);
  }

  return {
    start(): void {
      if (stopped) return;
      if (pendingId !== null) return; // already running
      scheduleNextTrigger();
    },
    stop(): void {
      stopped = true;
      if (pendingId !== null) {
        deps.cancel(pendingId);
        pendingId = null;
      }
    },
  };
}

export interface UseMoodSchedulerOptions {
  enabled: boolean;
  rangeMs: Range;
  onMicro: (micro: MicroAnimation | null) => void;
  microDurationMs?: number;
}

/**
 * React hook wrapper around createMoodScheduler. Re-creates the scheduler
 * whenever `enabled` or `rangeMs` change; disposes on unmount.
 */
export function useMoodScheduler(options: UseMoodSchedulerOptions): void {
  const onMicroRef = useRef(options.onMicro);
  onMicroRef.current = options.onMicro;

  useEffect(() => {
    if (!options.enabled) return;
    if (typeof window === 'undefined') return; // SSR guard
    const s = createMoodScheduler({
      rangeMs: options.rangeMs,
      microDurationMs: options.microDurationMs ?? 400,
      setMicro: (m) => onMicroRef.current(m),
      schedule: (cb, delay) => window.setTimeout(cb, delay),
      cancel: (id) => window.clearTimeout(id),
      random: () => Math.random(),
    });
    s.start();
    return () => s.stop();
  }, [options.enabled, options.rangeMs, options.microDurationMs]);
}
