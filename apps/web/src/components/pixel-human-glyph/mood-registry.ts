/**
 * Single source of truth for the 10 PixelHumanGlyph moods.
 *
 * Tracks two facts per mood:
 *   - whether the animation loops forever (idle-style) or is one-shot
 *   - how long a one-shot lasts before the component auto-returns to idle
 *
 * The CSS class name is computed in `<PixelHumanGlyph>` itself (see
 * `MOOD_CSS_CLASS` in pixel-human-glyph/index.tsx) — it is not stored here
 * so the registry stays purely about timing semantics and remains reusable
 * if another glyph style is ever introduced.
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
  | 'celebrate'
  | 'sunglasses'
  | 'type-keyboard'
  | 'megaphone';

export interface MoodConfig {
  readonly loop: boolean;
  /** Null for looping moods; positive integer ms for one-shot moods. */
  readonly durationMs: number | null;
}

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
  'sunglasses',
  'type-keyboard',
  'megaphone',
] as const satisfies readonly ShillingMood[];

const REGISTRY: Readonly<Record<ShillingMood, MoodConfig>> = {
  idle: { loop: true, durationMs: null },
  'walk-left': { loop: true, durationMs: null },
  'walk-right': { loop: true, durationMs: null },
  jump: { loop: false, durationMs: 800 },
  clap: { loop: true, durationMs: null },
  glitch: { loop: true, durationMs: null },
  sleep: { loop: true, durationMs: null },
  work: { loop: true, durationMs: null },
  think: { loop: true, durationMs: null },
  surprise: { loop: false, durationMs: 600 },
  celebrate: { loop: false, durationMs: 1200 },
  // Prop-based one-shots: draw-out -> hold/action -> stow. Duration covers
  // the full round-trip including both transitions.
  sunglasses: { loop: false, durationMs: 2500 },
  'type-keyboard': { loop: false, durationMs: 3000 },
  megaphone: { loop: false, durationMs: 2500 },
};

export function getMoodConfig(mood: ShillingMood): MoodConfig {
  return REGISTRY[mood];
}
