/**
 * Single source of truth for the 10 ShillingGlyph moods.
 *
 * Each mood maps to a stable CSS class (attached to the root <svg>) plus
 * metadata about whether it loops and, if not, how long it runs before the
 * React component auto-returns to idle.
 *
 * This module is pure and SSR-safe — it is imported from both the component
 * runtime and unit tests.
 */

export type ShillingMood =
  | 'idle'
  | 'walk-left'
  | 'walk-right'
  | 'jump'
  | 'clap'
  | 'glitch'
  | 'sleep'
  | 'work'
  | 'think'
  | 'surprise'
  | 'celebrate';

export interface MoodConfig {
  readonly cssClass: string;
  readonly loop: boolean;
  /** Null for looping moods; positive integer ms for one-shot moods. */
  readonly durationMs: number | null;
}

/**
 * Ordering is not semantic — consumers that depend on order (e.g. the demo
 * grid) sort / map explicitly. Listed to mirror the visual design table.
 */
export const MOODS = [
  'idle',
  'walk-left',
  'walk-right',
  'jump',
  'clap',
  'glitch',
  'sleep',
  'work',
  'think',
  'surprise',
  'celebrate',
] as const satisfies readonly ShillingMood[];

const REGISTRY: Readonly<Record<ShillingMood, MoodConfig>> = {
  idle: { cssClass: 'glyph--idle', loop: true, durationMs: null },
  'walk-left': { cssClass: 'glyph--walk-left', loop: true, durationMs: null },
  'walk-right': { cssClass: 'glyph--walk-right', loop: true, durationMs: null },
  jump: { cssClass: 'glyph--jump', loop: false, durationMs: 800 },
  clap: { cssClass: 'glyph--clap', loop: true, durationMs: null },
  glitch: { cssClass: 'glyph--glitch', loop: true, durationMs: null },
  sleep: { cssClass: 'glyph--sleep', loop: true, durationMs: null },
  work: { cssClass: 'glyph--work', loop: true, durationMs: null },
  think: { cssClass: 'glyph--think', loop: true, durationMs: null },
  surprise: { cssClass: 'glyph--surprise', loop: false, durationMs: 600 },
  celebrate: { cssClass: 'glyph--celebrate', loop: false, durationMs: 1200 },
};

export function getMoodConfig(mood: ShillingMood): MoodConfig {
  return REGISTRY[mood];
}

export function isLoopMood(mood: ShillingMood): boolean {
  return REGISTRY[mood].loop;
}
