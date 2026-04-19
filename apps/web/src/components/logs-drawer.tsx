'use client';

/**
 * <LogsDrawer /> — left-side slide-in dev-tools drawer.
 *
 * Replaces the legacy bottom `<FooterDrawer />`. The collapsed state
 * shows only a narrow 32px handle bar pinned to the left edge; clicking
 * the handle (or pressing `D`) expands a 360px body that carries the
 * same three tabs: Developer Logs / On-chain Artifacts / Brain Console.
 *
 * Why a left drawer: the bottom drawer pattern fought with the sticky
 * scrollytelling stage — any expansion covered chapter content. A left
 * drawer overlaps the SectionToc (which we dim or shift aside via
 * `body:has(.logs-drawer.open)` in globals.css) but keeps the full
 * chapter canvas visible for the demo.
 *
 * Data surface: identical to FooterDrawer. When the `runState` prop is
 * omitted the drawer subscribes to the merged `RunStateContext` so
 * BrainChat-sourced logs + artifacts flow through (same mirror contract
 * documented in `hooks/useRunStateContext.tsx`). The prop is kept for
 * SSR fixtures and unit tests that pin a deterministic state.
 *
 * Keyboard:
 *   - `D` / `d`: toggle open (suppressed when focus is inside an
 *     input / textarea / select / contenteditable — same guard as the
 *     legacy drawer, routed through the pure `routeLogsDrawerKey`).
 *   - `Escape`: close when open.
 */
import { useCallback, useEffect, useState, type MouseEvent, type ReactElement } from 'react';
import type { RunState } from '@/hooks/useRun-state';
import { useRunState } from '@/hooks/useRunStateContext';
import { LogsTab } from '@/components/footer-drawer-tabs/logs-tab';
import { ArtifactsTab } from '@/components/footer-drawer-tabs/artifacts-tab';
import { ConsoleTab } from '@/components/footer-drawer-tabs/console-tab';

export type LogsDrawerTab = 'logs' | 'artifacts' | 'console';

export interface LogsDrawerProps {
  /**
   * Optional explicit RunState override. Production path (`app/page.tsx`)
   * leaves it undefined so the drawer subscribes to the merged
   * `RunStateContext` via `useRunState()`. Tests + SSR fixtures pass a
   * pinned RunState so renders stay deterministic without standing up
   * a full provider tree.
   */
  readonly runState?: RunState;
  /** Seed the initial open state. Defaults to false (collapsed). */
  readonly initialOpen?: boolean;
  /** Seed the initial tab. Defaults to `'logs'`. */
  readonly defaultTab?: LogsDrawerTab;
}

/**
 * Pure keyboard router. Returns `'toggle'` when `D`/`d` should flip the
 * drawer, `'close'` for Escape, `null` otherwise. Extracted so the
 * activeElement guard is unit-testable under vitest's node env without
 * jsdom.
 */
export function routeLogsDrawerKey(
  key: string,
  targetTag: string | null,
  editableTarget: boolean,
): 'toggle' | 'close' | null {
  if (editableTarget) return null;
  if (targetTag !== null) {
    const tag = targetTag.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return null;
  }
  if (key === 'd' || key === 'D') return 'toggle';
  if (key === 'Escape') return 'close';
  return null;
}

interface DrawerTabButtonProps {
  readonly label: string;
  readonly dotClass: string;
  readonly count?: string;
  readonly active: boolean;
  readonly onSelect: (e: MouseEvent<HTMLButtonElement>) => void;
}

function DrawerTabButton(props: DrawerTabButtonProps): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      className={props.active ? 'logs-drawer-tab active' : 'logs-drawer-tab'}
      onClick={props.onSelect}
    >
      <span className={`dot ${props.dotClass}`} />
      <span>{props.label}</span>
      {props.count !== undefined ? (
        <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>{`· ${props.count}`}</span>
      ) : null}
    </button>
  );
}

export function LogsDrawer(props: LogsDrawerProps): ReactElement {
  const [open, setOpen] = useState<boolean>(props.initialOpen ?? false);
  const [tab, setTab] = useState<LogsDrawerTab>(props.defaultTab ?? 'logs');

  // Subscribe to context unconditionally so Hooks order stays stable;
  // explicit prop overrides when present. Outside a provider the hook
  // returns IDLE_STATE.
  const contextRunState = useRunState();
  const runState = props.runState ?? contextRunState;

  // Global keyboard routing. `D` toggles; Escape closes when open.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? null;
      const editable = active?.isContentEditable === true;
      const action = routeLogsDrawerKey(event.key, tag, editable);
      if (action === 'toggle') {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (action === 'close') {
        setOpen((prev) => {
          if (!prev) return prev;
          event.preventDefault();
          return false;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const onHandleClick = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const selectTab = useCallback(
    (next: LogsDrawerTab) => (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setTab(next);
      setOpen(true);
    },
    [],
  );

  return (
    <aside
      className={open ? 'logs-drawer open' : 'logs-drawer'}
      aria-label="Developer tools side drawer"
      aria-expanded={open}
    >
      <button
        type="button"
        className="logs-drawer-handle"
        onClick={onHandleClick}
        aria-label={open ? 'Collapse logs drawer' : 'Expand logs drawer'}
      >
        <span className="logs-drawer-handle-icon" aria-hidden="true">
          {open ? '\u25C0' : '\u25B6'}
        </span>
        <span className="logs-drawer-handle-label mono">DEV LOGS</span>
      </button>

      <div className="logs-drawer-body" aria-hidden={!open}>
        <div className="logs-drawer-tabs" role="tablist">
          <DrawerTabButton
            label="Developer Logs"
            dotClass="dot-green"
            count={runState.logs.length.toString()}
            active={tab === 'logs'}
            onSelect={selectTab('logs')}
          />
          <DrawerTabButton
            label="On-chain Artifacts"
            dotClass="dot-amber"
            count={runState.artifacts.length.toString()}
            active={tab === 'artifacts'}
            onSelect={selectTab('artifacts')}
          />
          <DrawerTabButton
            label="Brain Console"
            dotClass="dot-purple"
            active={tab === 'console'}
            onSelect={selectTab('console')}
          />
        </div>
        <div className="logs-drawer-content">
          {tab === 'logs' ? <LogsTab logs={runState.logs} /> : null}
          {tab === 'artifacts' ? <ArtifactsTab artifacts={runState.artifacts} /> : null}
          {tab === 'console' ? <ConsoleTab runState={runState} /> : null}
        </div>
      </div>
    </aside>
  );
}
