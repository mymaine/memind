/**
 * Tests for `<LogsDrawer />` (Memind UAT layout refactor).
 *
 * LogsDrawer replaces the legacy bottom `<FooterDrawer />` with a
 * left-side slide-in panel. Collapsed state shows only a narrow 32px
 * handle bar on the left edge; expanded state reveals a 360px body
 * carrying the same three tabs (logs / artifacts / console).
 *
 * Tests run in the node env and verify structural output via
 * `renderToStaticMarkup`. Keyboard routing is tested through the pure
 * `routeLogsDrawerKey` helper so the activeElement guard is covered
 * without needing jsdom.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import { LogsDrawer, routeLogsDrawerKey } from '../logs-drawer.js';

function runningState(logs: LogEvent[] = []): RunState {
  return {
    phase: 'running',
    runId: 'run_logs_drawer_test',
    logs,
    artifacts: [],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    error: null,
  };
}

describe('<LogsDrawer />', () => {
  it('renders collapsed by default with the handle visible and the body hidden', () => {
    const out = renderToStaticMarkup(<LogsDrawer runState={IDLE_STATE} />);
    // Root `.logs-drawer` without `.open`.
    expect(out).toMatch(/class="[^"]*\blogs-drawer\b[^"]*"/);
    expect(out).not.toMatch(/class="[^"]*\blogs-drawer\s+open\b[^"]*"/);
    // Handle button + vertical label present in collapsed state.
    expect(out).toContain('logs-drawer-handle');
    expect(out).toContain('DEV LOGS');
    // Body is rendered but aria-hidden in collapsed state.
    expect(out).toContain('logs-drawer-body');
    expect(out).toMatch(/logs-drawer-body[^>]*aria-hidden="true"/);
  });

  it('renders expanded with `.open` modifier and the body un-hidden when initialOpen=true', () => {
    const out = renderToStaticMarkup(<LogsDrawer runState={IDLE_STATE} initialOpen />);
    expect(out).toMatch(/class="[^"]*\blogs-drawer\s+open\b[^"]*"/);
    expect(out).toMatch(/logs-drawer-body[^>]*aria-hidden="false"/);
    // Three tab buttons rendered.
    expect(out).toContain('Developer Logs');
    expect(out).toContain('On-chain Artifacts');
    expect(out).toContain('Brain Console');
  });

  it('defaults to the logs tab when open', () => {
    const out = renderToStaticMarkup(<LogsDrawer runState={IDLE_STATE} initialOpen />);
    expect(out).toContain('logs-pane');
    expect(out).not.toContain('artifacts-pane');
    expect(out).not.toContain('console-pane');
  });

  it('renders the Artifacts pane when defaultTab=artifacts', () => {
    const out = renderToStaticMarkup(
      <LogsDrawer runState={runningState()} initialOpen defaultTab="artifacts" />,
    );
    expect(out).toContain('artifacts-pane');
    expect(out).toContain('no artifacts yet');
  });

  it('renders the Console pane when defaultTab=console', () => {
    const out = renderToStaticMarkup(
      <LogsDrawer runState={IDLE_STATE} initialOpen defaultTab="console" />,
    );
    expect(out).toContain('console-pane');
    expect(out).toContain('brain@memind');
  });

  it('shows the runState.logs count chip on the Developer Logs tab', () => {
    const logs: LogEvent[] = [
      {
        ts: '2026-04-20T12:00:00.000Z',
        level: 'info',
        agent: 'brain',
        tool: 'think',
        message: 'a',
      },
      {
        ts: '2026-04-20T12:00:01.000Z',
        level: 'info',
        agent: 'brain',
        tool: 'think',
        message: 'b',
      },
    ];
    const out = renderToStaticMarkup(
      <LogsDrawer runState={runningState(logs)} initialOpen defaultTab="logs" />,
    );
    expect(out).toMatch(/Developer Logs[\s\S]*· 2/);
  });

  it('shows the runState.artifacts count chip on the Artifacts tab', () => {
    const state: RunState = {
      phase: 'running',
      runId: 'run-arts',
      logs: [],
      artifacts: [{ kind: 'lore-cid', cid: 'bafy-1', gatewayUrl: 'https://x', author: 'narrator' }],
      toolCalls: EMPTY_TOOL_CALLS,
      assistantText: EMPTY_ASSISTANT_TEXT,
      error: null,
    };
    const out = renderToStaticMarkup(
      <LogsDrawer runState={state} initialOpen defaultTab="artifacts" />,
    );
    expect(out).toMatch(/On-chain Artifacts[\s\S]*· 1/);
  });

  it('routeLogsDrawerKey toggles on `D` / `d` when focus is not editable', () => {
    expect(routeLogsDrawerKey('d', null, false)).toBe('toggle');
    expect(routeLogsDrawerKey('D', null, false)).toBe('toggle');
    expect(routeLogsDrawerKey('d', 'DIV', false)).toBe('toggle');
  });

  it('routeLogsDrawerKey closes on Escape (only when open)', () => {
    expect(routeLogsDrawerKey('Escape', null, false)).toBe('close');
  });

  it('routeLogsDrawerKey returns null when focus is editable or for unrelated keys', () => {
    expect(routeLogsDrawerKey('d', 'INPUT', false)).toBe(null);
    expect(routeLogsDrawerKey('d', 'TEXTAREA', false)).toBe(null);
    expect(routeLogsDrawerKey('d', 'SELECT', false)).toBe(null);
    expect(routeLogsDrawerKey('d', 'DIV', true)).toBe(null);
    expect(routeLogsDrawerKey('a', null, false)).toBe(null);
    expect(routeLogsDrawerKey('Enter', null, false)).toBe(null);
  });

  it('renders without crashing and stays SSR-safe outside a provider', () => {
    // No `runState` prop, no context — should fall back to IDLE_STATE
    // and render the empty-state copy when forced open.
    const out = renderToStaticMarkup(<LogsDrawer initialOpen defaultTab="logs" />);
    expect(out).toContain('awaiting run');
  });
});
