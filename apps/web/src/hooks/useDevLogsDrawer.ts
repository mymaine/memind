'use client';

/**
 * Developer Logs drawer controller + hook (AC-P4.7-5a).
 *
 * The drawer has two pieces of state:
 *   - `open`: collapsed (56px header) vs expanded (40vh).
 *   - `tab`:  which of the 7 engineering panels is active (BRAIN-P5
 *            appended the `panels` fallback tab).
 *
 * Both persist across reloads through `localStorage`. The spec's risk
 * section mandates that closing the drawer must NOT unmount tab contents
 * (otherwise SSE events queue up into components that are no longer
 * subscribed). That mandate is enforced by the consumer (dev-logs-drawer.tsx
 * uses CSS height:0 + overflow:hidden); this module only owns state +
 * keyboard routing.
 *
 * Architecture follows the `useReducedMotion` / `useScrollReveal` family:
 *   - `routeKeyToAction`: pure mapping from a keyboard event to a drawer
 *     action. Drives the `D` / `1-7` / `Esc` shortcuts and the
 *     activeElement guard.
 *   - `createDevLogsController`: pure controller backed by an injected
 *     Storage-shaped store + subscriber list. All state mutations go
 *     through it so React and raw DOM listeners read the same snapshot.
 *   - `useDevLogsDrawer`: thin React shell. Uses `useSyncExternalStore`
 *     to subscribe to the browser-singleton controller, then attaches a
 *     single `keydown` listener with SSR guards.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type DevLogsTab = 'logs' | 'arch' | 'orders' | 'ledger' | 'heartbeat' | 'tx' | 'panels';

/** Ordered tab list — index (+1) maps to the `'1'..'7'` keyboard shortcut.
 *  BRAIN-P5 Task 4 appended the `panels` fallback tab hosting LaunchPanel +
 *  OrderPanel as an engineering alternative to the chat-driven Live Demo
 *  surfaces. */
export const DEV_LOGS_TABS = [
  'logs',
  'arch',
  'orders',
  'ledger',
  'heartbeat',
  'tx',
  'panels',
] as const satisfies readonly DevLogsTab[];

const TAB_SET = new Set<DevLogsTab>(DEV_LOGS_TABS);

export interface DevLogsState {
  readonly open: boolean;
  readonly tab: DevLogsTab;
}

export interface DevLogsController {
  getSnapshot: () => DevLogsState;
  subscribe: (onChange: () => void) => () => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setTab: (tab: DevLogsTab) => void;
}

export type DevLogsAction =
  | { type: 'toggle' }
  | { type: 'setTab'; tab: DevLogsTab }
  | { type: 'close' };

const STORAGE_KEY_OPEN = 'shilling-market.devlogs.open';
const STORAGE_KEY_TAB = 'shilling-market.devlogs.tab';

const DEFAULT_STATE: DevLogsState = { open: false, tab: 'logs' };

/**
 * Map a keyboard event (key + focused target tag + editable flag + current
 * drawer state) to a drawer action. Returns null when the keypress should
 * be a no-op (focused inside an input, contenteditable, unknown key, etc.).
 *
 * Exposed separately from the controller so the activeElement guard is
 * unit-testable in the vitest node env — jsdom / real DOM would add cost
 * without raising coverage.
 */
export function routeKeyToAction(
  key: string,
  targetTag: string | null,
  editableTarget: boolean,
  state: DevLogsState,
): DevLogsAction | null {
  // activeElement guard — keep shortcut keys out of any form field.
  if (editableTarget) return null;
  if (targetTag !== null) {
    const tag = targetTag.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return null;
  }

  // Case-insensitive `D` toggles the drawer.
  if (key === 'd' || key === 'D') {
    return { type: 'toggle' };
  }

  if (key === 'Escape') {
    return state.open ? { type: 'close' } : null;
  }

  // `1..7` pick tabs; only meaningful while the drawer is open so the user
  // always sees the result of pressing the key. BRAIN-P5 extended the range
  // to include the `panels` fallback tab.
  if (state.open && key.length === 1 && key >= '1' && key <= '7') {
    const idx = Number(key) - 1;
    const tab = DEV_LOGS_TABS[idx];
    if (tab !== undefined) return { type: 'setTab', tab };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Persistence helpers.
// ---------------------------------------------------------------------------

function readPersisted(storage: Storage | null, fallback: DevLogsState): DevLogsState {
  if (storage === null) return fallback;
  let open = fallback.open;
  let tab = fallback.tab;
  try {
    const rawOpen = storage.getItem(STORAGE_KEY_OPEN);
    if (rawOpen !== null) {
      // JSON parse tolerates 'true' / 'false'; reject anything else.
      const parsed: unknown = JSON.parse(rawOpen);
      if (typeof parsed === 'boolean') open = parsed;
    }
  } catch {
    /* corrupt value — keep fallback.open */
  }
  const rawTab = storage.getItem(STORAGE_KEY_TAB);
  if (rawTab !== null && TAB_SET.has(rawTab as DevLogsTab)) {
    tab = rawTab as DevLogsTab;
  }
  return { open, tab };
}

function writePersisted(storage: Storage | null, next: DevLogsState): void {
  if (storage === null) return;
  try {
    storage.setItem(STORAGE_KEY_OPEN, JSON.stringify(next.open));
    storage.setItem(STORAGE_KEY_TAB, next.tab);
  } catch {
    /* storage quota / SecurityError — best-effort only */
  }
}

// ---------------------------------------------------------------------------
// Controller.
// ---------------------------------------------------------------------------

export interface CreateDevLogsControllerOptions {
  readonly getStorage: () => Storage | null;
  readonly defaults?: { open?: boolean; tab?: DevLogsTab };
}

/**
 * Pure controller backed by a persistent store. `getStorage` is injected so
 * tests can supply an in-memory map-backed Storage mock without touching
 * window.localStorage. State lives in a closure so it is stable across
 * getSnapshot calls (required by useSyncExternalStore).
 */
export function createDevLogsController(opts: CreateDevLogsControllerOptions): DevLogsController {
  const fallback: DevLogsState = {
    open: opts.defaults?.open ?? DEFAULT_STATE.open,
    tab: opts.defaults?.tab ?? DEFAULT_STATE.tab,
  };

  const storage = opts.getStorage();
  let state: DevLogsState = readPersisted(storage, fallback);

  const listeners = new Set<() => void>();

  function setState(next: DevLogsState): void {
    if (next.open === state.open && next.tab === state.tab) return;
    state = next;
    writePersisted(opts.getStorage(), state);
    for (const cb of listeners) cb();
  }

  return {
    getSnapshot(): DevLogsState {
      return state;
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    toggle(): void {
      setState({ open: !state.open, tab: state.tab });
    },
    setOpen(open: boolean): void {
      setState({ open, tab: state.tab });
    },
    setTab(tab: DevLogsTab): void {
      setState({ open: state.open, tab });
    },
  };
}

// ---------------------------------------------------------------------------
// Browser singleton + React hook.
// ---------------------------------------------------------------------------

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Safari in private mode and some embedded webviews throw on access.
    return null;
  }
}

const BROWSER_CONTROLLER: DevLogsController = createDevLogsController({
  getStorage: browserStorage,
});

export interface UseDevLogsDrawerResult extends DevLogsController {
  readonly state: DevLogsState;
}

/**
 * Subscribe to the browser-singleton controller and attach the global
 * keyboard listener. Returns the controller surface + a live snapshot.
 */
export function useDevLogsDrawer(): UseDevLogsDrawerResult {
  const state = useSyncExternalStore(
    BROWSER_CONTROLLER.subscribe,
    BROWSER_CONTROLLER.getSnapshot,
    () => DEFAULT_STATE,
  );

  const toggle = useCallback((): void => {
    BROWSER_CONTROLLER.toggle();
  }, []);
  const setOpen = useCallback((open: boolean): void => {
    BROWSER_CONTROLLER.setOpen(open);
  }, []);
  const setTab = useCallback((tab: DevLogsTab): void => {
    BROWSER_CONTROLLER.setTab(tab);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? null;
      const editable = active?.isContentEditable === true;
      const action = routeKeyToAction(event.key, tag, editable, BROWSER_CONTROLLER.getSnapshot());
      if (action === null) return;
      event.preventDefault();
      if (action.type === 'toggle') BROWSER_CONTROLLER.toggle();
      else if (action.type === 'close') BROWSER_CONTROLLER.setOpen(false);
      else BROWSER_CONTROLLER.setTab(action.tab);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return {
    state,
    getSnapshot: BROWSER_CONTROLLER.getSnapshot,
    subscribe: BROWSER_CONTROLLER.subscribe,
    toggle,
    setOpen,
    setTab,
  };
}
