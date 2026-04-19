/**
 * Tests for `<DevLogsDrawer />` (V4.7-P4 Task 6 / AC-P4.7-5a,
 * BRAIN-P5 Task 4 / AC-BRAIN-6).
 *
 * The drawer is a sticky-bottom container that toggles between a 56px
 * header and a 40vh expanded panel, hosts the engineering panels
 * (Logs / Arch / Orders / Ledger / Heartbeat / Tx / Panels) in a tablist,
 * and NEVER unmounts its tab contents (risk: SSE events queue up into an
 * unmounted LogPanel and get lost).
 *
 * Tests render to static markup so we can pin:
 *   - `aria-expanded` on the drawer trigger reflects controller.state.open.
 *   - `role="tablist"` is present with 7 tabs and labels.
 *   - `aria-selected="true"` tracks controller.state.tab.
 *   - All 7 tab panels exist in the markup in every combination — the
 *     only visibility difference is the `hidden` attribute.
 *   - host='home' greys the Orders tab; host='market' keeps it active.
 *   - A run-state with pill-shaped artifacts produces at least one
 *     `<a href="...">` inside the Tx panel.
 *   - Panels tab renders LaunchPanel + OrderPanel when a runController is
 *     threaded (BRAIN-P5 fallback) and a placeholder copy otherwise.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import type { UseRunResult } from '@/hooks/useRun';
import type { DevLogsController, DevLogsState, DevLogsTab } from '@/hooks/useDevLogsDrawer.js';
import { DevLogsDrawer } from './dev-logs-drawer.js';

const RUN_ID = 'run_drawer_test';
const TX_HASH = `0x${'a'.repeat(64)}`;

function makeController(state: DevLogsState): DevLogsController & { state: DevLogsState } {
  return {
    state,
    getSnapshot: () => state,
    subscribe: () => () => {},
    toggle: () => {},
    setOpen: (_open: boolean) => {},
    setTab: (_tab: DevLogsTab) => {},
  };
}

function doneRunState(artifacts: Artifact[]): RunState {
  return {
    phase: 'done',
    runId: RUN_ID,
    logs: [],
    artifacts,
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    error: null,
  };
}

describe('<DevLogsDrawer />', () => {
  it('renders as collapsed by default (aria-expanded="false") and keeps tab panels mounted', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: false, tab: 'logs' })} host="home" />,
    );
    // Collapsed trigger — aria-expanded reflects open=false.
    expect(out).toContain('aria-expanded="false"');
    // Risk-guard: tab content region must still be in the DOM even when
    // collapsed (drawer hides via CSS height:0, never unmounts).
    expect(out).toContain('role="tabpanel"');
    // And the collapsed region must be marked hidden so assistive tech
    // skips it until the drawer is re-expanded.
    expect(out).toContain('hidden');
  });

  it('renders as expanded when the controller state is open and marks the active tab aria-selected', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'logs' })} host="home" />,
    );
    expect(out).toContain('aria-expanded="true"');
    // Active tab carries aria-selected="true"; other tabs stay false.
    const selectedMatches = out.match(/aria-selected="true"/g) ?? [];
    expect(selectedMatches.length).toBe(1);
  });

  it('renders a tablist with the 7 dev-log tab labels (incl. Panels)', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'logs' })} host="market" />,
    );
    expect(out).toContain('role="tablist"');
    for (const label of ['Logs', 'Arch', 'Orders', 'Ledger', 'HB', 'Tx', 'Panels']) {
      expect(out).toContain(label);
    }
  });

  it('greys the Orders tab on host="home" (aria-disabled=true)', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'logs' })} host="home" />,
    );
    // Orders button is present but aria-disabled / hint is visible.
    expect(out).toMatch(/aria-controls="devlogs-panel-orders"[^>]*aria-disabled="true"/);
    expect(out).toContain('order shill to populate');
  });

  it('keeps the Orders tab active on host="market" (no aria-disabled on that button)', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'orders' })} host="market" />,
    );
    // No aria-disabled on the Orders tab button. Match the tab button
    // segment with a bounded look-ahead to avoid false positives from
    // unrelated disabled attributes elsewhere in the markup.
    const ordersButtonMatch = out.match(/<button[^>]*aria-controls="devlogs-panel-orders"[^>]*>/);
    expect(ordersButtonMatch).not.toBeNull();
    expect(ordersButtonMatch?.[0]).not.toContain('aria-disabled="true"');
  });

  it('mounts all 7 tab panels simultaneously so SSE events reach every inner component', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'tx' })} host="market" />,
    );
    // All seven panel ids must appear in the markup regardless of active tab.
    for (const tab of ['logs', 'arch', 'orders', 'ledger', 'heartbeat', 'tx', 'panels']) {
      expect(out).toContain(`id="devlogs-panel-${tab}"`);
    }
  });

  it('default active tab is logs when controller reports tab="logs"', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'logs' })} host="market" />,
    );
    // The aria-selected button should be the Logs tab.
    const match = out.match(
      /<button[^>]*aria-selected="true"[^>]*aria-controls="devlogs-panel-logs"[^>]*>/,
    );
    expect(match).not.toBeNull();
  });

  it('switches aria-selected to tx when controller reports tab="tx"', () => {
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'tx' })} host="market" />,
    );
    const match = out.match(
      /<button[^>]*aria-selected="true"[^>]*aria-controls="devlogs-panel-tx"[^>]*>/,
    );
    expect(match).not.toBeNull();
  });

  it('passes run-state artifacts through to the Tx panel (pill links appear)', () => {
    const artifacts: Artifact[] = [
      {
        kind: 'x402-tx',
        chain: 'base-sepolia',
        txHash: TX_HASH,
        explorerUrl: `https://sepolia.basescan.org/tx/${TX_HASH}`,
        amountUsdc: '0.01',
      },
    ];
    const out = renderToStaticMarkup(
      <DevLogsDrawer
        controller={makeController({ open: true, tab: 'tx' })}
        host="market"
        runState={doneRunState(artifacts)}
      />,
    );
    // The Tx panel should contain at least one pill link pointing to our fixture.
    expect(out).toContain(`https://sepolia.basescan.org/tx/${TX_HASH}`);
  });

  it('renders LaunchPanel + OrderPanel inside the Panels tab when a runController is threaded (BRAIN-P5 Task 4)', () => {
    // When a runController is injected, the Panels tab hosts LaunchPanel
    // (section#launch-panel) + OrderPanel (section#order) as an engineering
    // fallback for the BRAIN-P5 chat-driven Live Demo surfaces.
    const runController: UseRunResult = {
      state: IDLE_STATE,
      startRun: () => Promise.resolve(),
      resetRun: () => {},
    };
    const out = renderToStaticMarkup(
      <DevLogsDrawer
        controller={makeController({ open: true, tab: 'panels' })}
        host="home"
        runController={runController}
      />,
    );
    expect(out).toMatch(/<section[^>]+id="launch-panel"/);
    expect(out).toMatch(/<section[^>]+id="order"/);
  });

  it('shows the "Panels are only available on the main surface" placeholder when runController is absent', () => {
    // Without a runController the panels cannot drive real runs, so the
    // tab renders a short placeholder copy that points engineers at the
    // main Live Demo surface.
    const out = renderToStaticMarkup(
      <DevLogsDrawer controller={makeController({ open: true, tab: 'panels' })} host="home" />,
    );
    expect(out).toContain('Panels are only available on the main surface.');
  });
});
