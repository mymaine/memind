import { describe, expect, it } from 'vitest';
import { PRESET_THEMES } from './preset-texts';

describe('PRESET_THEMES (V2-P5 Task 2)', () => {
  it('exposes exactly three preset themes', () => {
    expect(PRESET_THEMES).toHaveLength(3);
  });

  it('contains the three canonical AC-V2-7 strings verbatim', () => {
    // These literals match docs/features/dashboard-v2.md AC-V2-7; a mismatch
    // here signals a spec drift that must be reconciled before merge.
    expect(PRESET_THEMES).toEqual([
      'Shiba Astronaut on Mars building a moon colony',
      'Cyberpunk Neko detective in Neo-Tokyo 2099',
      'Banana Republic Dictator issuing decrees by tweet',
    ]);
  });

  it('every preset is non-empty and within the 280-character CreateRequest limit', () => {
    for (const theme of PRESET_THEMES) {
      expect(theme.length).toBeGreaterThanOrEqual(3);
      expect(theme.length).toBeLessThanOrEqual(280);
    }
  });
});
