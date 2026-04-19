'use client';

/**
 * <FooterDrawer /> — the Memind scrollytelling footer drawer (P0-14).
 *
 * 44px collapsed bar / 320px expanded body. Three tabs:
 *   - Developer Logs  → binds to `runState.logs`
 *   - On-chain Artifacts → binds to `runState.artifacts`
 *   - Brain Console   → terminal-style summary of `runState`
 *
 * Shell ported from `docs/design/memind-handoff/project/components/app.jsx`
 * lines 144-250 (Footer component). CSS hosts `.footer` / `.footer-bar`
 * / `.footer-tab` / `.footer-body` / `.dot` / `.brain-pulse`
 * / `.footer-caret` live in `app/globals.css` (already ported).
 *
 * Interactions:
 *   - Clicking any non-tab area of the bar toggles `open`.
 *   - Clicking a tab button selects that tab and forces `open=true`.
 *   - Pressing `D` (case-insensitive) toggles `open` unless the active
 *     element is an input / textarea / select / contenteditable, routed
 *     through the pure `routeFooterDrawerKey` helper.
 *
 * Test hooks: `initialOpen` and `defaultTab` seed the internal state so
 * the node-env static-markup tests can render each state deterministically
 * without simulating clicks.
 */
import { useCallback, useEffect, useState, type MouseEvent, type ReactElement } from 'react';
import type { RunState } from '@/hooks/useRun-state';
import { LogsTab } from '@/components/footer-drawer-tabs/logs-tab';
import { ArtifactsTab } from '@/components/footer-drawer-tabs/artifacts-tab';
import { ConsoleTab } from '@/components/footer-drawer-tabs/console-tab';

export type FooterDrawerTab = 'logs' | 'artifacts' | 'console';

export interface FooterDrawerProps {
  readonly runState: RunState;
  /** Optional initial open state; defaults to false. */
  readonly initialOpen?: boolean;
  /** Optional initial tab; defaults to `'logs'`. */
  readonly defaultTab?: FooterDrawerTab;
}

/**
 * Pure keyboard router. Returns `'toggle'` when the `D` key should open or
 * close the drawer, `null` otherwise. Extracted so the activeElement guard
 * is unit-testable in the vitest node env without jsdom.
 */
export function routeFooterDrawerKey(
  key: string,
  targetTag: string | null,
  editableTarget: boolean,
): 'toggle' | null {
  if (editableTarget) return null;
  if (targetTag !== null) {
    const tag = targetTag.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return null;
  }
  if (key === 'd' || key === 'D') return 'toggle';
  return null;
}

interface FooterTabButtonProps {
  readonly label: string;
  readonly dotClass: string;
  readonly count?: string;
  readonly active: boolean;
  readonly onSelect: (e: MouseEvent<HTMLButtonElement>) => void;
}

function FooterTabButton(props: FooterTabButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={props.active ? 'footer-tab active' : 'footer-tab'}
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

export function FooterDrawer(props: FooterDrawerProps): ReactElement {
  const [open, setOpen] = useState<boolean>(props.initialOpen ?? false);
  const [tab, setTab] = useState<FooterDrawerTab>(props.defaultTab ?? 'logs');

  const { runState } = props;

  // Global `D` toggle. Mount once on the client. The pure helper above
  // handles the activeElement guard.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? null;
      const editable = active?.isContentEditable === true;
      const action = routeFooterDrawerKey(event.key, tag, editable);
      if (action === 'toggle') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const onBarClick = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const selectTab = useCallback(
    (next: FooterDrawerTab) => (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setTab(next);
      setOpen(true);
    },
    [],
  );

  return (
    <div
      className={open ? 'footer open' : 'footer'}
      role="complementary"
      aria-label="Developer footer drawer"
    >
      <div
        className="footer-bar"
        onClick={onBarClick}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <div className="footer-bar-left">
          <FooterTabButton
            label="Developer Logs"
            dotClass="dot-green"
            count={runState.logs.length.toString()}
            active={tab === 'logs'}
            onSelect={selectTab('logs')}
          />
          <FooterTabButton
            label="On-chain Artifacts"
            dotClass="dot-amber"
            count={runState.artifacts.length.toString()}
            active={tab === 'artifacts'}
            onSelect={selectTab('artifacts')}
          />
          <FooterTabButton
            label="Brain Console"
            dotClass="dot-purple"
            active={tab === 'console'}
            onSelect={selectTab('console')}
          />
        </div>
        <div className="footer-bar-right">
          <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
            brain.tick · 5s
          </span>
          <span className="mono brain-pulse">● LIVE</span>
          <span className="footer-caret">{open ? '\u25be' : '\u25b4'}</span>
        </div>
      </div>
      {open ? (
        <div className="footer-body">
          {tab === 'logs' ? <LogsTab logs={runState.logs} /> : null}
          {tab === 'artifacts' ? <ArtifactsTab artifacts={runState.artifacts} /> : null}
          {tab === 'console' ? <ConsoleTab runState={runState} /> : null}
        </div>
      ) : null}
    </div>
  );
}
