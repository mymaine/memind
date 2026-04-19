/**
 * Red tests for the `useSlashPalette` hook (BRAIN-P6 Task 2).
 *
 * The hook's interesting logic is pure: given (input, scope, activeIndex)
 * derive {open, candidates, activeIndex}. We extract that derivation into
 * `deriveSlashPaletteView` and test it directly — same pattern
 * `useRun-state.ts` uses to keep React out of unit tests (no jsdom, no RTL).
 *
 * Four cases from the BRAIN-P6 brief:
 *   1. input = "/" → open=true, candidates = every scope-visible command
 *   2. input = "/l" (launch scope) → candidates = launch + lore only
 *   3. moveDown + pick → returns candidate at next index
 *   4. input = 'abc' → closed, candidates = []
 */
import { describe, it, expect } from 'vitest';
import { deriveSlashPaletteView, clampActiveIndex } from './useSlashPalette';

describe('deriveSlashPaletteView — open state', () => {
  it('opens and surfaces every scope-visible command when input is "/"', () => {
    const view = deriveSlashPaletteView({ input: '/', scope: 'launch', rawActiveIndex: 0 });
    expect(view.open).toBe(true);
    const names = view.candidates.map((c) => c.name).sort();
    // launch scope sees scoped commands (launch, lore) + client commands visible in every scope (clear, help, reset, status)
    expect(names).toEqual(['clear', 'help', 'launch', 'lore', 'reset', 'status']);
    expect(view.activeIndex).toBe(0);
  });
});

describe('deriveSlashPaletteView — prefix filter', () => {
  it('keeps only candidates whose name starts with the prefix after /', () => {
    const view = deriveSlashPaletteView({ input: '/l', scope: 'launch', rawActiveIndex: 0 });
    expect(view.open).toBe(true);
    const names = view.candidates.map((c) => c.name).sort();
    expect(names).toEqual(['launch', 'lore']);
  });
});

describe('deriveSlashPaletteView — activeIndex clamps', () => {
  it('clampActiveIndex wraps around via modulo when given out-of-bounds values', () => {
    expect(clampActiveIndex(5, 3)).toBe(2);
    expect(clampActiveIndex(-1, 3)).toBe(2);
    expect(clampActiveIndex(0, 0)).toBe(0);
  });

  it('pick returns the candidate at the clamped activeIndex after moveDown', () => {
    // Simulate moveDown by advancing rawActiveIndex.
    const view = deriveSlashPaletteView({ input: '/', scope: 'global', rawActiveIndex: 1 });
    const picked = view.candidates[view.activeIndex] ?? null;
    expect(picked).not.toBeNull();
    // Compare with the second candidate produced with activeIndex=0.
    const baseline = deriveSlashPaletteView({ input: '/', scope: 'global', rawActiveIndex: 0 });
    expect(picked).toEqual(baseline.candidates[1]);
  });
});

describe('deriveSlashPaletteView — closed state', () => {
  it('returns open=false and empty candidates when input does not begin with /', () => {
    const view = deriveSlashPaletteView({ input: 'abc', scope: 'launch', rawActiveIndex: 0 });
    expect(view.open).toBe(false);
    expect(view.candidates).toEqual([]);
  });

  it('closes as soon as any whitespace follows the command token', () => {
    // Trailing space alone is enough — user has moved past the pick phase
    // even before typing arguments, so Enter should submit.
    const spaceOnly = deriveSlashPaletteView({
      input: '/launch ',
      scope: 'launch',
      rawActiveIndex: 0,
    });
    expect(spaceOnly.open).toBe(false);
    expect(spaceOnly.candidates).toEqual([]);

    // Space + partial argument keeps it closed.
    const withArgs = deriveSlashPaletteView({
      input: '/launch cyber',
      scope: 'launch',
      rawActiveIndex: 0,
    });
    expect(withArgs.open).toBe(false);
    expect(withArgs.candidates).toEqual([]);
  });
});
