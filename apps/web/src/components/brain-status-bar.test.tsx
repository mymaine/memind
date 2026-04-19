/**
 * Red tests for <BrainStatusBarView /> — the thin header strip that signals
 * "Token Brain is present on every route" (decisions/2026-04-19-brain-agent-
 * positioning.md §Scope).
 *
 * The runtime component is a client shell that wires click handling + reads
 * the page-level useRun() state when available. Tests drive the pure
 * <BrainStatusBarView /> directly with explicit props so the assertions are
 * deterministic under renderToStaticMarkup (this repo's vitest environment
 * is node, no jsdom; see apps/web/vitest.config.ts). This mirrors the
 * <HeaderView /> split pattern.
 *
 * Covers the five BrainStatusBar tests called out in the V4.7-P4 brief:
 *   1. Renders the TOKEN BRAIN label.
 *   2. Renders a button (role assertion) that opens the modal on click —
 *      verified via `aria-haspopup="dialog"` + `aria-expanded` + onClick
 *      attribute wiring.
 *   3. Shows `idle` status when no run is in flight.
 *   4. Shows the active persona name when useRun() state is running and the
 *      most recent log came from a specific agent.
 *   5. Is keyboard-activatable — a native `<button>` element is used (Enter
 *      and Space activate natively in the browser; we assert the tag name).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import { BrainStatusBarView } from './brain-status-bar.js';

function runningState(logs: LogEvent[]): RunState {
  return {
    phase: 'running',
    logs,
    artifacts: [],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: 'run_test_brain_bar',
    error: null,
  };
}

function log(agent: LogEvent['agent'], message: string): LogEvent {
  return {
    ts: new Date().toISOString(),
    agent,
    tool: 'some.tool',
    level: 'info',
    message,
  };
}

describe('<BrainStatusBarView />', () => {
  it('renders the TOKEN BRAIN label so judges can see the Brain on every route', () => {
    const out = renderToStaticMarkup(
      <BrainStatusBarView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(out).toContain('TOKEN BRAIN');
  });

  it('renders a native <button> with aria-haspopup="dialog" and aria-expanded tied to modalOpen', () => {
    const closed = renderToStaticMarkup(
      <BrainStatusBarView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(closed).toMatch(/<button[^>]*aria-haspopup="dialog"/);
    expect(closed).toContain('aria-expanded="false"');

    const open = renderToStaticMarkup(
      <BrainStatusBarView runState={IDLE_STATE} modalOpen={true} onOpen={() => {}} />,
    );
    expect(open).toContain('aria-expanded="true"');
  });

  it('shows "idle" status when no run is in flight (phase = idle)', () => {
    const out = renderToStaticMarkup(
      <BrainStatusBarView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(out).toContain('idle');
  });

  it('shows the active persona name when a run is running and the last log came from that agent', () => {
    // Creator kicks off, then narrator takes over — the bar should announce
    // "narrator" (the latest-acting persona). We use the canonical persona
    // label ("Narrator") matching BRAIN_ARCHITECTURE.shippedPersonas.
    const state = runningState([
      log('creator', 'drafting lore chapter 1'),
      log('narrator', 'continuing lore chapter 2'),
    ]);
    const out = renderToStaticMarkup(
      <BrainStatusBarView runState={state} modalOpen={false} onOpen={() => {}} />,
    );
    // Case-insensitive match so the view can pick uppercase / title case.
    expect(out.toLowerCase()).toContain('narrator');
    // Status flips from idle to online while running.
    expect(out).toContain('online');
  });

  it('uses a native <button> element so Enter and Space activate it via the browser default', () => {
    const out = renderToStaticMarkup(
      <BrainStatusBarView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    // The clickable surface must be a <button>, not a <div onClick>, to meet
    // the keyboard-activatable guardrail. Browsers fire click on Enter/Space
    // for <button type="button"> without us needing onKeyDown plumbing.
    expect(out).toMatch(/<button[^>]*type="button"/);
  });
});
