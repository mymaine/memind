/**
 * Red tests for `useDevLogsDrawer` + `createDevLogsController` +
 * `routeKeyToAction` (V4.7-P4 Task 6 / AC-P4.7-5a).
 *
 * The drawer hook follows the `useReducedMotion` / `useScrollReveal` DI
 * pattern: a pure controller + `routeKeyToAction` pure helper sit next to
 * a thin `useDevLogsDrawer` React shell. Tests target the controller + key
 * router directly so we stay in vitest's node env (no jsdom, no real
 * localStorage, no window.addEventListener).
 *
 * Pinned contract:
 *   - `routeKeyToAction` skips `input` / `textarea` / contenteditable focus.
 *   - `'d'` / `'D'` toggle; `'Escape'` closes only when open; `'1'..'6'`
 *     switch tabs only when open; unknown keys are no-ops.
 *   - `createDevLogsController` defaults to `{ open: false, tab: 'logs' }`,
 *     persists through an injected Storage-shaped mock, and notifies
 *     subscribers on every state change.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DEV_LOGS_TABS,
  createDevLogsController,
  routeKeyToAction,
  type DevLogsState,
} from './useDevLogsDrawer.js';

// ---------------------------------------------------------------------------
// In-memory Storage mock: matches the `Storage` interface surface we touch.
// ---------------------------------------------------------------------------
function makeStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  const storage: Storage = {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number): string | null {
      const keys = Array.from(map.keys());
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
  };
  return storage;
}

// ---------------------------------------------------------------------------
// routeKeyToAction pure routing.
// ---------------------------------------------------------------------------
describe('routeKeyToAction', () => {
  const OPEN_STATE: DevLogsState = { open: true, tab: 'logs' };
  const CLOSED_STATE: DevLogsState = { open: false, tab: 'logs' };

  it('returns null when the focused target is an input element', () => {
    expect(routeKeyToAction('d', 'input', false, CLOSED_STATE)).toBeNull();
  });

  it("maps 'd' with no focused input target to a toggle action", () => {
    expect(routeKeyToAction('d', null, false, CLOSED_STATE)).toEqual({ type: 'toggle' });
  });

  it("maps uppercase 'D' to a toggle action too", () => {
    expect(routeKeyToAction('D', null, false, CLOSED_STATE)).toEqual({ type: 'toggle' });
  });

  it("maps 'Escape' when open to a close action", () => {
    expect(routeKeyToAction('Escape', null, false, OPEN_STATE)).toEqual({ type: 'close' });
  });

  it("returns null for 'Escape' when the drawer is already closed", () => {
    expect(routeKeyToAction('Escape', null, false, CLOSED_STATE)).toBeNull();
  });

  it("maps '1' (open state) to setTab 'logs'", () => {
    expect(routeKeyToAction('1', null, false, OPEN_STATE)).toEqual({
      type: 'setTab',
      tab: 'logs',
    });
  });

  it("maps '3' (open state) to setTab 'orders'", () => {
    expect(routeKeyToAction('3', null, false, OPEN_STATE)).toEqual({
      type: 'setTab',
      tab: 'orders',
    });
  });

  it("maps '6' (open state) to setTab 'tx'", () => {
    expect(routeKeyToAction('6', null, false, OPEN_STATE)).toEqual({
      type: 'setTab',
      tab: 'tx',
    });
  });

  it("returns null for '1'..'6' when the drawer is closed", () => {
    expect(routeKeyToAction('1', null, false, CLOSED_STATE)).toBeNull();
    expect(routeKeyToAction('6', null, false, CLOSED_STATE)).toBeNull();
  });

  it('returns null for unrecognised keys', () => {
    expect(routeKeyToAction('x', null, false, OPEN_STATE)).toBeNull();
    expect(routeKeyToAction('F5', null, false, OPEN_STATE)).toBeNull();
  });

  it('returns null when the focused target is contenteditable', () => {
    // `editableTarget === true` represents `[contenteditable]` matches; the
    // helper must short-circuit regardless of key.
    expect(routeKeyToAction('d', null, true, OPEN_STATE)).toBeNull();
    expect(routeKeyToAction('Escape', null, true, OPEN_STATE)).toBeNull();
    expect(routeKeyToAction('1', null, true, OPEN_STATE)).toBeNull();
  });

  it('returns null when the focused target is a textarea element', () => {
    expect(routeKeyToAction('d', 'textarea', false, OPEN_STATE)).toBeNull();
  });

  it('DEV_LOGS_TABS export exposes 6 ordered tab ids', () => {
    // Sanity pin so `'1'..'6'` routing stays aligned with the drawer UI.
    expect(DEV_LOGS_TABS).toEqual(['logs', 'arch', 'orders', 'ledger', 'heartbeat', 'tx']);
  });
});

// ---------------------------------------------------------------------------
// createDevLogsController behaviour.
// ---------------------------------------------------------------------------
describe('createDevLogsController', () => {
  it('returns default snapshot when no storage is available', () => {
    const ctrl = createDevLogsController({ getStorage: () => null });
    expect(ctrl.getSnapshot()).toEqual({ open: false, tab: 'logs' });
  });

  it('setTab updates the snapshot', () => {
    const ctrl = createDevLogsController({ getStorage: () => null });
    ctrl.setTab('arch');
    expect(ctrl.getSnapshot().tab).toBe('arch');
  });

  it('toggle twice returns open to its initial value', () => {
    const ctrl = createDevLogsController({ getStorage: () => null });
    const initialOpen = ctrl.getSnapshot().open;
    ctrl.toggle();
    ctrl.toggle();
    expect(ctrl.getSnapshot().open).toBe(initialOpen);
  });

  it('persists open + tab through the injected storage so a fresh controller re-reads it', () => {
    const storage = makeStorage();
    const getStorage = (): Storage => storage;
    const first = createDevLogsController({ getStorage });
    first.setOpen(true);
    first.setTab('tx');
    // Values survive the storage boundary.
    expect(storage.getItem('shilling-market.devlogs.open')).toBe('true');
    expect(storage.getItem('shilling-market.devlogs.tab')).toBe('tx');
    // A fresh controller reads the persisted values.
    const second = createDevLogsController({ getStorage });
    expect(second.getSnapshot()).toEqual({ open: true, tab: 'tx' });
  });

  it('notifies subscribers when state changes', () => {
    const ctrl = createDevLogsController({ getStorage: () => null });
    const cb = vi.fn();
    ctrl.subscribe(cb);
    ctrl.setTab('ledger');
    expect(cb).toHaveBeenCalledTimes(1);
    ctrl.toggle();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const ctrl = createDevLogsController({ getStorage: () => null });
    const cb = vi.fn();
    const unsubscribe = ctrl.subscribe(cb);
    ctrl.setTab('heartbeat');
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    ctrl.setTab('tx');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores corrupt storage values and falls back to defaults', () => {
    const storage = makeStorage({
      'shilling-market.devlogs.open': 'not-json',
      'shilling-market.devlogs.tab': 'unknown-tab',
    });
    const ctrl = createDevLogsController({ getStorage: () => storage });
    // Both corrupt values should be rejected without throwing.
    expect(ctrl.getSnapshot()).toEqual({ open: false, tab: 'logs' });
  });

  it('honours the defaults option when storage is absent', () => {
    const ctrl = createDevLogsController({
      getStorage: () => null,
      defaults: { open: true, tab: 'arch' },
    });
    expect(ctrl.getSnapshot()).toEqual({ open: true, tab: 'arch' });
  });
});
