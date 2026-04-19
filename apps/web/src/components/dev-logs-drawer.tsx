'use client';

/**
 * DevLogsDrawer — the engineering-layer drawer (AC-P4.7-5a).
 *
 * A bottom-sticky container that:
 *   - Collapses to a 56px header bar by default.
 *   - Expands to 40vh with a 7-tab tablist (Logs / Arch / Orders / Ledger
 *     / Heartbeat / Tx / Panels) containing the existing engineering
 *     panels untouched (they are imported, not re-implemented). BRAIN-P5
 *     appended the Panels tab to host LaunchPanel + OrderPanel as an
 *     engineering fallback for the chat-driven Live Demo surfaces.
 *   - Persists `{open, tab}` to localStorage via `useDevLogsDrawer`.
 *   - Responds to `D` (toggle), `1..7` (pick tab), and `Esc` (close),
 *     with an activeElement guard so typing in a form field is safe.
 *
 * Mount contract (spec §Risk): tab contents are ALWAYS mounted, even
 * while collapsed. Hiding is done via `hidden` + CSS height:0 only, so
 * the inner LogPanel / TxList / etc. keep consuming SSE events through
 * their props while the drawer appears shut.
 *
 * Tests inject a deterministic `controller` prop so we can render to
 * static markup in the node env without touching localStorage or the
 * browser singleton.
 */
import type { ReactElement, ReactNode } from 'react';
import type { AgentId, AgentStatus, Artifact } from '@hack-fourmeme/shared';
import { LogPanel } from './log-panel';
import { ArchitectureDiagram } from './architecture-diagram';
import { ShillOrderPanel } from './shill-order-panel';
import { AnchorLedgerPanel } from './anchor-ledger-panel';
import { HeartbeatSection } from './heartbeat-section';
import { TxList } from './tx-list';
import { LaunchPanel } from './product/launch-panel';
import { OrderPanel } from './product/order-panel';
import {
  DEV_LOGS_TABS,
  useDevLogsDrawer,
  type DevLogsController,
  type DevLogsState,
  type DevLogsTab,
} from '@/hooks/useDevLogsDrawer';
import type { UseRunResult } from '@/hooks/useRun';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';

export interface DevLogsDrawerProps {
  /**
   * Current run snapshot. When undefined or `phase === 'idle'` the panels
   * fall back to their empty-state rendering (LogPanel with zero events,
   * TxList with zero artifacts, etc.).
   */
  readonly runState?: RunState;
  /** Deterministic controller override for tests. */
  readonly controller?: DevLogsController & { state: DevLogsState };
  /**
   * Host page — determines whether the Orders tab is interactive. On `/`
   * the Orders tab is present but greyed because the a2a flow never emits
   * a `shill-order`.
   */
  readonly host?: 'home' | 'market';
  /**
   * BRAIN-P5 Task 4: optional run controller threaded from the host page.
   * When provided, the Panels tab hosts LaunchPanel + OrderPanel as an
   * engineering fallback for the chat-driven Live Demo surfaces. When
   * absent the Panels tab renders a short placeholder copy.
   */
  readonly runController?: UseRunResult;
  readonly className?: string;
}

const TAB_LABELS: Record<DevLogsTab, string> = {
  logs: 'Logs',
  arch: 'Arch',
  orders: 'Orders',
  ledger: 'Ledger',
  heartbeat: 'HB',
  tx: 'Tx',
  panels: 'Panels',
};

const IDLE_STATUSES: Record<AgentId, AgentStatus> = {
  creator: 'idle',
  narrator: 'idle',
  'market-maker': 'idle',
  heartbeat: 'idle',
  brain: 'idle',
  shiller: 'idle',
};

const TAB_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-[var(--radius-default)] border border-transparent px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-fg-tertiary transition-colors hover:text-fg-primary focus:outline-none focus-visible:border-accent';

const TAB_BUTTON_ACTIVE_CLASS =
  'inline-flex items-center justify-center rounded-[var(--radius-default)] border border-accent/40 bg-accent/10 px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-accent focus:outline-none focus-visible:border-accent';

const TAB_BUTTON_DISABLED_CLASS =
  'inline-flex items-center justify-center rounded-[var(--radius-default)] border border-transparent px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] text-fg-tertiary opacity-40 cursor-not-allowed focus:outline-none';

export function DevLogsDrawer(props: DevLogsDrawerProps): ReactElement {
  // Hook always runs (rules-of-hooks); the prop override takes priority only
  // when it exists. The fallback to useDevLogsDrawer is what wires real
  // localStorage + keyboard shortcuts in production.
  const hooked = useDevLogsDrawer();
  const controller = props.controller ?? hooked;
  const { state } = controller;
  const host = props.host ?? 'home';

  const runState = props.runState;
  const phase = runState?.phase ?? 'idle';
  const artifacts: Artifact[] = phase === 'idle' ? [] : (runState?.artifacts ?? []);
  const logs = phase === 'idle' ? [] : (runState?.logs ?? []);
  const toolCalls = runState?.toolCalls ?? EMPTY_TOOL_CALLS;
  const assistantText = runState?.assistantText ?? EMPTY_ASSISTANT_TEXT;

  const wrapperClass = [
    'fixed bottom-0 left-0 right-0 z-30 border-t border-border-default bg-bg-primary',
    'devlogs-drawer',
    state.open ? 'devlogs-drawer--open' : 'devlogs-drawer--closed',
    props.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <aside
      role="complementary"
      aria-label="Developer logs"
      className={wrapperClass}
      data-host={host}
    >
      {/* --------------------------------------------------------------- */}
      {/* Header bar (always visible).                                    */}
      {/* --------------------------------------------------------------- */}
      <div className="flex h-[56px] items-center justify-between gap-3 px-4">
        <button
          type="button"
          aria-expanded={state.open}
          aria-controls="devlogs-content"
          onClick={() => controller.toggle()}
          className="flex items-center gap-2 font-[family-name:var(--font-sans-display)] text-[13px] font-semibold uppercase tracking-[0.5px] text-fg-primary"
        >
          <span
            aria-hidden
            className={`font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary transition-transform ${state.open ? 'rotate-90' : ''}`}
          >
            {'>'}
          </span>
          Developer Logs
          <span className="font-[family-name:var(--font-mono)] text-[11px] font-normal text-fg-tertiary">
            {state.open ? '· press D to hide' : '· press D to show'}
          </span>
        </button>

        <div role="tablist" aria-label="Developer logs tabs" className="flex items-center gap-1">
          {DEV_LOGS_TABS.map((tab) => {
            const isActive = state.tab === tab;
            const isOrdersOnHome = tab === 'orders' && host === 'home';
            const disabled = isOrdersOnHome;
            const className = disabled
              ? TAB_BUTTON_DISABLED_CLASS
              : isActive
                ? TAB_BUTTON_ACTIVE_CLASS
                : TAB_BUTTON_CLASS;
            return (
              <button
                key={tab}
                role="tab"
                type="button"
                id={`devlogs-tab-${tab}`}
                aria-selected={isActive}
                aria-controls={`devlogs-panel-${tab}`}
                aria-disabled={disabled ? true : undefined}
                tabIndex={isActive && !disabled ? 0 : -1}
                onClick={() => {
                  if (disabled) return;
                  controller.setTab(tab);
                  if (!state.open) controller.setOpen(true);
                }}
                className={className}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* --------------------------------------------------------------- */}
      {/* Content region — ALWAYS mounted so inner panels keep receiving  */}
      {/* SSE-derived props. CSS `devlogs-drawer--closed` zeroes height.  */}
      {/* --------------------------------------------------------------- */}
      <div
        id="devlogs-content"
        aria-hidden={!state.open}
        hidden={!state.open}
        className={state.open ? 'devlogs-content devlogs-content--open' : 'devlogs-content'}
        style={state.open ? { height: '40vh' } : { height: 0, overflow: 'hidden' }}
      >
        <div className="h-full overflow-auto px-4 py-4">
          <DevLogsTabPanel id="logs" active={state.tab === 'logs'}>
            <LogPanel logs={logs} toolCalls={toolCalls} assistantText={assistantText} />
          </DevLogsTabPanel>
          <DevLogsTabPanel id="arch" active={state.tab === 'arch'}>
            <ArchitectureDiagram statuses={IDLE_STATUSES} artifacts={artifacts} />
          </DevLogsTabPanel>
          <DevLogsTabPanel id="orders" active={state.tab === 'orders'}>
            {host === 'home' ? (
              <div
                aria-disabled
                className="rounded-[var(--radius-card)] border border-dashed border-border-default bg-bg-surface p-6 text-center text-[13px] text-fg-tertiary opacity-60"
              >
                order shill to populate
              </div>
            ) : (
              <ShillOrderPanel artifacts={artifacts} />
            )}
          </DevLogsTabPanel>
          <DevLogsTabPanel id="ledger" active={state.tab === 'ledger'}>
            <AnchorLedgerPanel artifacts={artifacts} />
          </DevLogsTabPanel>
          <DevLogsTabPanel id="heartbeat" active={state.tab === 'heartbeat'}>
            <HeartbeatSection />
          </DevLogsTabPanel>
          <DevLogsTabPanel id="tx" active={state.tab === 'tx'}>
            <TxList artifacts={artifacts} />
          </DevLogsTabPanel>
          <DevLogsTabPanel id="panels" active={state.tab === 'panels'}>
            {props.runController !== undefined ? (
              <div className="flex flex-col gap-4">
                <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
                  Engineering fallback — the form-driven Launch + Order panels remain available
                  alongside the chat-driven Live Demo surfaces.
                </p>
                <LaunchPanel runController={props.runController} />
                <OrderPanel runController={props.runController} />
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border-default bg-bg-surface p-6 text-center text-[13px] text-fg-tertiary">
                Panels are only available on the main surface.
              </div>
            )}
          </DevLogsTabPanel>
        </div>
      </div>
    </aside>
  );
}

/**
 * Single tab panel wrapper. Always mounted (see risk section) — the `hidden`
 * attribute + CSS `display:none` controls visibility. We lean on native
 * `hidden` rather than unmounting so SSE events continue to reach the
 * inner components and so the drawer's collapsed height does not grow.
 */
function DevLogsTabPanel(props: {
  readonly id: DevLogsTab;
  readonly active: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      role="tabpanel"
      id={`devlogs-panel-${props.id}`}
      aria-labelledby={`devlogs-tab-${props.id}`}
      hidden={!props.active}
      className={props.active ? 'devlogs-tab devlogs-tab--active' : 'devlogs-tab'}
    >
      {props.children}
    </div>
  );
}
