/**
 * Three canonical preset themes surfaced as one-click fill-ins next to the
 * ThemeInput. Pure-data module so the list stays trivially unit-testable.
 *
 * These strings are frozen by spec AC-V2-7 — edits here require a spec update
 * (docs/features/dashboard-v2.md) first.
 */
export const PRESET_THEMES = [
  'Shiba Astronaut on Mars building a moon colony',
  'Cyberpunk Neko detective in Neo-Tokyo 2099',
  'Banana Republic Dictator issuing decrees by tweet',
] as const;

export type PresetTheme = (typeof PRESET_THEMES)[number];
