/**
 * Tests for `<FooterDrawer />` (memind-scrollytelling-rebuild P0-14).
 *
 * The FooterDrawer is a bottom-sticky 44px / 320px drawer with three tabs
 * (Developer Logs / On-chain Artifacts / Brain Console). It replaces the
 * older DevLogsDrawer and binds directly to `runState`.
 *
 * Tests run in the node env and verify structural output via
 * `renderToStaticMarkup`. Keyboard routing is tested through the pure
 * `routeFooterDrawerKey` helper so the activeElement guard is covered
 * without needing jsdom.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import { FooterDrawer, routeFooterDrawerKey } from '../footer-drawer.js';

const RUN_ID = 'run_footer_test';

function runningState(logs: LogEvent[] = []): RunState {
  return {
    phase: 'running',
    runId: RUN_ID,
    logs,
    artifacts: [],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    error: null,
  };
}

describe('<FooterDrawer />', () => {
  it('renders collapsed by default with the 44px footer bar and three tabs', () => {
    const out = renderToStaticMarkup(<FooterDrawer runState={IDLE_STATE} />);
    // Root uses the ported `.footer` class (44px collapsed).
    expect(out).toMatch(/class="[^"]*\bfooter\b[^"]*"/);
    // No `.footer.open` class in collapsed render.
    expect(out).not.toMatch(/class="[^"]*\bfooter\s+open\b[^"]*"/);
    // Three tab buttons present.
    expect(out).toContain('Developer Logs');
    expect(out).toContain('On-chain Artifacts');
    expect(out).toContain('Brain Console');
  });

  it('renders expanded with footer-body when initialOpen=true', () => {
    const out = renderToStaticMarkup(<FooterDrawer runState={IDLE_STATE} initialOpen />);
    // `.footer.open` class applied.
    expect(out).toMatch(/class="[^"]*\bfooter\s+open\b[^"]*"/);
    // Footer body region rendered.
    expect(out).toContain('footer-body');
  });

  it('defaults to the logs tab when open', () => {
    const out = renderToStaticMarkup(<FooterDrawer runState={IDLE_STATE} initialOpen />);
    // Logs pane (.logs-pane) present and active; console/artifacts panes absent.
    expect(out).toContain('logs-pane');
    expect(out).not.toContain('artifacts-pane');
    expect(out).not.toContain('console-pane');
    // The Developer Logs tab is marked active.
    expect(out).toMatch(
      /<button[^>]*class="[^"]*\bfooter-tab\s+active\b[^"]*"[^>]*>[^<]*<[^>]*><\/[^>]*>[^<]*<span>Developer Logs<\/span>/,
    );
  });

  it('shows the right-side LIVE indicator + caret in the collapsed bar', () => {
    const out = renderToStaticMarkup(<FooterDrawer runState={IDLE_STATE} />);
    expect(out).toContain('brain.tick');
    expect(out).toContain('LIVE');
    expect(out).toContain('footer-caret');
  });

  it('shows the logs empty-state copy when runState has no logs', () => {
    const out = renderToStaticMarkup(<FooterDrawer runState={IDLE_STATE} initialOpen />);
    expect(out).toContain('awaiting run');
  });

  it('renders artifact rows when tab=artifacts (via defaultTab prop)', () => {
    const state = runningState();
    const out = renderToStaticMarkup(
      <FooterDrawer runState={state} initialOpen defaultTab="artifacts" />,
    );
    expect(out).toContain('artifacts-pane');
    // Empty-state CTA when no artifacts.
    expect(out).toContain('no artifacts yet');
  });

  it('renders the Brain Console pane when tab=console', () => {
    const out = renderToStaticMarkup(
      <FooterDrawer runState={IDLE_STATE} initialOpen defaultTab="console" />,
    );
    expect(out).toContain('console-pane');
    // Prompt line rendered.
    expect(out).toContain('brain@memind');
    // status line rendered.
    expect(out).toContain('status');
  });

  it('routeFooterDrawerKey toggles on `D` / `d` when focus is not editable', () => {
    expect(routeFooterDrawerKey('d', null, false)).toBe('toggle');
    expect(routeFooterDrawerKey('D', null, false)).toBe('toggle');
    expect(routeFooterDrawerKey('d', 'DIV', false)).toBe('toggle');
  });

  it('routeFooterDrawerKey returns null when focus is an input, textarea, or contenteditable', () => {
    expect(routeFooterDrawerKey('d', 'INPUT', false)).toBe(null);
    expect(routeFooterDrawerKey('d', 'TEXTAREA', false)).toBe(null);
    expect(routeFooterDrawerKey('d', 'SELECT', false)).toBe(null);
    expect(routeFooterDrawerKey('d', 'DIV', true)).toBe(null);
  });

  it('routeFooterDrawerKey returns null for unrelated keys', () => {
    expect(routeFooterDrawerKey('a', null, false)).toBe(null);
    expect(routeFooterDrawerKey('Enter', null, false)).toBe(null);
    expect(routeFooterDrawerKey('Escape', null, false)).toBe(null);
  });
});
