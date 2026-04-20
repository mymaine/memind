/**
 * Tests for the rewritten <BrainIndicatorView /> - the slim TopBar pill
 * that replaces the old modal-owning indicator
 * (memind-scrollytelling-rebuild AC-MSR-3).
 *
 * The new indicator does not own any modal state; clicking forwards to the
 * `onClick` prop which the TopBar wires to the BrainPanel open toggle
 * (panel mount lands in P0-15). We assert:
 *   1. Idle state renders TOKEN BRAIN + IDLE.
 *   2. Running state flips status to ONLINE.
 *   3. The button is a native <button type="button"> carrying the
 *      "Open brain panel" aria-label.
 *   4. Mood derivation from the latest log's agent (creator -> type-keyboard,
 *      narrator -> think, heartbeat -> walk-right).
 *   5. Idle state keeps the mascot at `mood=idle`.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import { EMPTY_BRAIN_CHAT_ACTIVITY, type BrainChatActivity } from '@/hooks/useRunStateContext';
import { BrainIndicatorView, deriveGlyphMood } from './brain-indicator.js';

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
  it('renders the TOKEN BRAIN label + IDLE status when no run is in flight', () => {
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} onClick={() => {}} />,
    );
    expect(out).toContain('TOKEN BRAIN');
    expect(out).toContain('IDLE');
  });

  it('flips the status to ONLINE during a running run', () => {
    const state = runningState([log('creator', 'drafting lore chapter 1')]);
    const out = renderToStaticMarkup(<BrainIndicatorView runState={state} onClick={() => {}} />);
    expect(out).toContain('ONLINE');
  });

  it('is a native <button type="button"> carrying the "Open brain panel" aria-label', () => {
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} onClick={() => {}} />,
    );
    expect(out).toMatch(/<button[^>]*type="button"/);
    expect(out).toMatch(/aria-label="Open brain panel"/);
  });

  it('renders the mascot at mood=idle when no run is in flight', () => {
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} onClick={() => {}} />,
    );
    expect(out).toMatch(/data-testid="brain-indicator-mascot"/);
    expect(out).toMatch(/data-testid="brain-indicator-mascot"[^]*?data-mood="idle"/);
  });

  it('swaps the mascot mood to match the latest active agent during a run', () => {
    const creatorOut = renderToStaticMarkup(
      <BrainIndicatorView
        runState={runningState([log('creator', 'deploying token')])}
        onClick={() => {}}
      />,
    );
    expect(creatorOut).toMatch(
      /data-testid="brain-indicator-mascot"[^]*?data-mood="type-keyboard"/,
    );

    const heartbeatOut = renderToStaticMarkup(
      <BrainIndicatorView
        runState={runningState([log('heartbeat', 'ticking')])}
        onClick={() => {}}
      />,
    );
    expect(heartbeatOut).toMatch(/data-testid="brain-indicator-mascot"[^]*?data-mood="walk-right"/);
  });
});

describe('deriveGlyphMood', () => {
  it('returns `idle` for IDLE_STATE', () => {
    expect(deriveGlyphMood(IDLE_STATE)).toBe('idle');
  });

  it('maps the latest log agent to its persona mood', () => {
    expect(deriveGlyphMood(runningState([log('creator', 'x')]))).toBe('type-keyboard');
    expect(deriveGlyphMood(runningState([log('narrator', 'x')]))).toBe('think');
    expect(deriveGlyphMood(runningState([log('market-maker', 'x')]))).toBe('megaphone');
    expect(deriveGlyphMood(runningState([log('shiller', 'x')]))).toBe('megaphone');
    expect(deriveGlyphMood(runningState([log('brain', 'x')]))).toBe('think');
    expect(deriveGlyphMood(runningState([log('heartbeat', 'x')]))).toBe('walk-right');
  });

  it('falls back to `work` for a running run with no logs yet', () => {
    expect(deriveGlyphMood(runningState([]))).toBe('work');
  });

  it('keeps `idle` when activity is also idle', () => {
    expect(deriveGlyphMood(IDLE_STATE, EMPTY_BRAIN_CHAT_ACTIVITY)).toBe('idle');
  });

  it('picks the activity.currentAgent mood while streaming even with idle run', () => {
    const streaming: BrainChatActivity = {
      status: 'streaming',
      currentAgent: 'creator',
      eventCount: 1,
    };
    expect(deriveGlyphMood(IDLE_STATE, streaming)).toBe('type-keyboard');
  });

  it('prefers activity persona over useRun log when both present', () => {
    const streaming: BrainChatActivity = {
      status: 'streaming',
      currentAgent: 'heartbeat',
      eventCount: 2,
    };
    expect(deriveGlyphMood(runningState([log('creator', 'x')]), streaming)).toBe('walk-right');
  });

  it('falls back to `work` when streaming but agent is null and no logs', () => {
    const streaming: BrainChatActivity = {
      status: 'streaming',
      currentAgent: null,
      eventCount: 1,
    };
    expect(deriveGlyphMood(runningState([]), streaming)).toBe('work');
  });
});

describe('<BrainIndicatorView /> — activity-driven', () => {
  it('flips to ONLINE when activity is streaming even while runState is idle', () => {
    const streaming: BrainChatActivity = {
      status: 'streaming',
      currentAgent: 'creator',
      eventCount: 1,
    };
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} activity={streaming} onClick={() => {}} />,
    );
    expect(out).toContain('ONLINE');
    // Mood should follow the activity persona.
    expect(out).toMatch(/data-testid="brain-indicator-mascot"[^]*?data-mood="type-keyboard"/);
  });

  it('flips to ONLINE when activity is sending (POST in flight before SSE opens)', () => {
    const sending: BrainChatActivity = {
      status: 'sending',
      currentAgent: null,
      eventCount: 0,
    };
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} activity={sending} onClick={() => {}} />,
    );
    expect(out).toContain('ONLINE');
  });

  it('stays IDLE when activity.status is error', () => {
    const errored: BrainChatActivity = {
      status: 'error',
      currentAgent: null,
      eventCount: 2,
    };
    const out = renderToStaticMarkup(
      <BrainIndicatorView runState={IDLE_STATE} activity={errored} onClick={() => {}} />,
    );
    expect(out).toContain('IDLE');
  });
});
