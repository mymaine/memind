'use client';

/**
 * useSlashPalette — prefix-filtered slash command palette state (BRAIN-P6 Task 2).
 *
 * Responsibilities:
 *   - Given the current BrainChat input value + a scope, derive the visible
 *     candidate list (scope-match + prefix-match).
 *   - Track `activeIndex` with keyboard navigation (`moveUp` / `moveDown`
 *     wrap modulo candidate count) and expose `pick(index?)` to fetch the
 *     highlighted command.
 *   - Does NOT touch the input value. The parent BrainChat component owns the
 *     textarea state; the hook is pure w.r.t. UI side-effects so
 *     `<BrainChatSlashPalette />` can stay a dumb render of this view.
 *
 * Design:
 *   - `deriveSlashPaletteView` is the pure derivation (open / candidates /
 *     activeIndex). Tests pin its behaviour without React.
 *   - The hook is a thin `useState` wrapper so the surrounding input
 *     re-renders keep `activeIndex` in sync with the current candidate list
 *     (we clamp on every render so candidate-list shrinkage never leaves the
 *     highlight pointing past the end).
 */
import { useCallback, useMemo, useState } from 'react';
import { SLASH_COMMANDS, type SlashCommand, type SlashScope } from '@/lib/slash-commands';

export interface SlashPaletteView {
  readonly open: boolean;
  readonly activeIndex: number;
  readonly candidates: readonly SlashCommand[];
}

export interface UseSlashPaletteResult extends SlashPaletteView {
  moveUp(): void;
  moveDown(): void;
  /**
   * Return the highlighted (or explicitly-indexed) command. Returns `null` if
   * the palette has no candidates or the requested index is out of range.
   *
   * Callers are expected to rewrite the textarea themselves (e.g. replace the
   * current value with `/<name> `). Keeping that responsibility on the parent
   * lets us keep the hook pure and avoids a stale-closure class of bugs
   * where the palette tries to tell the textarea how to be.
   */
  pick(index?: number): SlashCommand | null;
  close(): void;
}

/**
 * Clamp an integer into a valid index of an array of length `len`. Negative
 * values wrap from the end; >= len values wrap modulo len. When `len === 0`
 * returns 0 so the caller never indexes into nothing.
 */
export function clampActiveIndex(raw: number, len: number): number {
  if (len <= 0) return 0;
  const m = ((raw % len) + len) % len;
  return m;
}

/**
 * Pure derivation of the palette view. Exported separately so the unit
 * tests can pin the open / filter / clamp logic without spinning up React.
 */
export function deriveSlashPaletteView(args: {
  input: string;
  scope: SlashScope;
  rawActiveIndex: number;
}): SlashPaletteView {
  const { input, scope, rawActiveIndex } = args;
  if (!input.startsWith('/')) {
    return { open: false, activeIndex: 0, candidates: [] };
  }
  // Prefix after the slash — everything up to the first whitespace. Once
  // the user types ANY whitespace after the command token (UAT 2026-04-20
  // #4), the palette auto-closes so Enter submits the message instead of
  // re-picking a candidate. `afterCommandToken` is what comes after the
  // `(\S*)` prefix, so a non-empty value means the user has already moved
  // past the command name — whether they've started typing arguments yet
  // or just hit space. Either way the user is past the pick phase.
  const afterSlash = input.slice(1);
  const match = /^(\S*)/.exec(afterSlash);
  const prefix = match ? (match[1] ?? '') : '';
  const afterCommandToken = afterSlash.slice(prefix.length);
  if (afterCommandToken.length > 0) {
    return { open: false, activeIndex: 0, candidates: [] };
  }

  const candidates = SLASH_COMMANDS.filter(
    (c) => c.scopes.includes(scope) && c.name.startsWith(prefix),
  );

  return {
    open: true,
    activeIndex: clampActiveIndex(rawActiveIndex, candidates.length),
    candidates,
  };
}

/**
 * React hook wrapper. Callers pass the live input value + scope; the hook
 * returns the derived view plus keyboard-navigation callbacks.
 */
export function useSlashPalette(input: string, scope: SlashScope): UseSlashPaletteResult {
  const [rawActiveIndex, setRawActiveIndex] = useState(0);

  const view = useMemo(
    () => deriveSlashPaletteView({ input, scope, rawActiveIndex }),
    [input, scope, rawActiveIndex],
  );

  const moveUp = useCallback((): void => {
    setRawActiveIndex((i) => i - 1);
  }, []);
  const moveDown = useCallback((): void => {
    setRawActiveIndex((i) => i + 1);
  }, []);
  const close = useCallback((): void => {
    setRawActiveIndex(0);
  }, []);

  const pick = useCallback(
    (index?: number): SlashCommand | null => {
      const target = index ?? view.activeIndex;
      if (view.candidates.length === 0) return null;
      const clamped = clampActiveIndex(target, view.candidates.length);
      return view.candidates[clamped] ?? null;
    },
    [view.activeIndex, view.candidates],
  );

  return {
    open: view.open,
    activeIndex: view.activeIndex,
    candidates: view.candidates,
    moveUp,
    moveDown,
    pick,
    close,
  };
}
