/**
 * Tests for `useTweakMode` — the edit-mode gate that controls the
 * <TweaksPanel /> mount (memind-scrollytelling-rebuild AC-MSR-12).
 *
 * The React hook itself is a thin useState / effect wrapper around the
 * pure `routeTweakMessage` + `readEditQuery` helpers. vitest runs in
 * node without jsdom, so we drive the pure helpers directly — this is
 * the same approach `useReducedMotion.test.ts` uses for its controller.
 */
import { describe, it, expect } from 'vitest';
import { routeTweakMessage, readEditQuery } from './useTweakMode.js';

describe('routeTweakMessage', () => {
  it('returns true for __activate_edit_mode events', () => {
    expect(routeTweakMessage({ type: '__activate_edit_mode' })).toBe(true);
  });

  it('returns false for __deactivate_edit_mode events', () => {
    expect(routeTweakMessage({ type: '__deactivate_edit_mode' })).toBe(false);
  });

  it('ignores unrelated messages and non-object payloads', () => {
    expect(routeTweakMessage(null)).toBeNull();
    expect(routeTweakMessage('hello')).toBeNull();
    expect(routeTweakMessage(42)).toBeNull();
    expect(routeTweakMessage({ type: 'SOMETHING_ELSE' })).toBeNull();
    expect(routeTweakMessage({})).toBeNull();
  });
});

describe('readEditQuery', () => {
  it('returns false for an empty search string', () => {
    expect(readEditQuery('')).toBe(false);
  });

  it('returns true when edit=1 is present (leading ?)', () => {
    expect(readEditQuery('?edit=1')).toBe(true);
  });

  it('returns true when edit=1 is present alongside other params', () => {
    expect(readEditQuery('?debug=foo&edit=1&theme=dark')).toBe(true);
  });

  it('returns false when edit has any value other than 1', () => {
    expect(readEditQuery('?edit=0')).toBe(false);
    expect(readEditQuery('?edit=true')).toBe(false);
  });
});
