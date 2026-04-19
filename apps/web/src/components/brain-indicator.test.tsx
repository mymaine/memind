/**
 * Red tests for <BrainIndicatorView /> — the pure presentational Brain
 * indicator shipped inside the slim Header as part of
 * immersive-single-page P1 Task 3 / AC-ISP-6.
 *
 * The runtime <BrainIndicator /> is a client shell that subscribes to the
 * RunStateContext and wires a click handler into <BrainDetailModal />. Tests
 * exercise the pure <BrainIndicatorView /> directly — this mirrors the
 * <HeaderView /> / <BrainStatusBarView /> split convention so all
 * assertions run under node-env vitest via renderToStaticMarkup.
 *
 * Five behaviours per the V4.7-P5 brief (inherited from the old
 * BrainStatusBar tests + new click / aria-label contract):
 *   1. Idle state renders the TOKEN BRAIN label + "idle" status.
 *   2. Running state flips the status to "online" and surfaces the active
 *      persona label (from `deriveActivePersonaLabel`).
 *   3. The click handler is wired onto a native <button> (keyboard
 *      activatable via Enter + Space without extra plumbing).
 *   4. The button exposes an accessible name via aria-label so screen
 *      readers announce "Open Token Brain detail".
 *   5. aria-haspopup="dialog" + aria-expanded follows the modal state so
 *      assistive tech knows the control opens a dialog.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import { BrainIndicatorView } from './brain-indicator.js';

function runningState(logs: LogEvent[]): RunState {
  return {
    phase: 'running',
    logs,
    artifacts: [],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: 'run_test_brain_indicator',
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

describe('<BrainIndicatorView />', () => {
  it('renders the TOKEN BRAIN label + idle status when no run is in flight', () => {
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(out).toContain('TOKEN BRAIN');
    expect(out).toContain('idle');
  });

  it('flips the status to "online" and surfaces the active persona during a running run', () => {
    const state = runningState([
      log('creator', 'drafting lore chapter 1'),
      log('narrator', 'continuing lore chapter 2'),
    ]);
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={state} modalOpen={false} onOpen={() => {}} />,
    );
    expect(out).toContain('online');
    expect(out.toLowerCase()).toContain('narrator');
  });

  it('is a native <button type="button"> so Enter + Space activate via the browser default', () => {
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(out).toMatch(/<button[^>]*type="button"/);
  });

  it('exposes an explicit aria-label so assistive tech announces the control', () => {
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(out).toMatch(/aria-label="Open Token Brain detail"/);
  });

  it('binds aria-haspopup="dialog" + aria-expanded to the modal state', () => {
    const closed = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} modalOpen={false} onOpen={() => {}} />,
    );
    expect(closed).toMatch(/aria-haspopup="dialog"/);
    expect(closed).toContain('aria-expanded="false"');

    const open = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} modalOpen={true} onOpen={() => {}} />,
    );
    expect(open).toContain('aria-expanded="true"');
  });
});
