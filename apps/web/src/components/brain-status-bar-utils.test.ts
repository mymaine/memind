/**
 * Tests for the pure derivation helpers behind the Brain surface.
 *
 * Covers the new BrainChatActivity-aware overload introduced to keep the
 * TopBar <BrainIndicator /> and right-side <BrainPanel /> meta rows reactive
 * while the BrainChat SSE stream is in flight — before this change both
 * surfaces only watched `useRun()`'s phase so a brain-chat run left them
 * pinned to IDLE even though the transcript was actively streaming.
 *
 * Three routing paths the derivation is responsible for:
 *   1. useRun is running → online / last-log persona (pre-existing behaviour)
 *   2. useRun idle but brain-chat activity sending/streaming → online +
 *      activity.currentAgent persona
 *   3. Both idle → idle + null persona
 */
import { describe, it, expect } from 'vitest';
import type { LogEvent } from '@hack-fourmeme/shared';
import {
  EMPTY_ASSISTANT_TEXT,
  EMPTY_TOOL_CALLS,
  IDLE_STATE,
  type RunState,
} from '@/hooks/useRun-state';
import { EMPTY_BRAIN_CHAT_ACTIVITY, type BrainChatActivity } from '@/hooks/useRunStateContext';
import { deriveActivePersonaLabel, deriveBrainStatus } from './brain-status-bar-utils.js';

function log(agent: LogEvent['agent'], message: string): LogEvent {
  return {
    ts: '2026-04-20T00:00:00.000Z',
    agent,
    tool: 'x.tool',
    level: 'info',
    message,
  };
}

function runningState(logs: LogEvent[] = []): RunState {
  return {
    phase: 'running',
    logs,
    artifacts: [],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: 'run-test',
    error: null,
  };
}

function activity(partial: Partial<BrainChatActivity> = {}): BrainChatActivity {
  return { ...EMPTY_BRAIN_CHAT_ACTIVITY, ...partial };
}

describe('deriveBrainStatus', () => {
  it('returns idle for IDLE_STATE without activity', () => {
    expect(deriveBrainStatus(IDLE_STATE)).toBe('idle');
  });

  it('returns online when useRun is running regardless of activity', () => {
    expect(deriveBrainStatus(runningState())).toBe('online');
    expect(deriveBrainStatus(runningState(), activity({ status: 'idle' }))).toBe('online');
  });

  it('returns online when brain-chat is sending even with idle useRun', () => {
    expect(deriveBrainStatus(IDLE_STATE, activity({ status: 'sending' }))).toBe('online');
  });

  it('returns online when brain-chat is streaming even with idle useRun', () => {
    expect(deriveBrainStatus(IDLE_STATE, activity({ status: 'streaming' }))).toBe('online');
  });

  it('returns idle when both useRun and activity are idle', () => {
    expect(deriveBrainStatus(IDLE_STATE, EMPTY_BRAIN_CHAT_ACTIVITY)).toBe('idle');
  });

  it('returns idle when activity.status is error (online reserved for live traffic)', () => {
    expect(deriveBrainStatus(IDLE_STATE, activity({ status: 'error' }))).toBe('idle');
  });
});

describe('deriveActivePersonaLabel', () => {
  it('returns null in the fully-idle baseline', () => {
    expect(deriveActivePersonaLabel(IDLE_STATE)).toBeNull();
    expect(deriveActivePersonaLabel(IDLE_STATE, EMPTY_BRAIN_CHAT_ACTIVITY)).toBeNull();
  });

  it('falls back to the last-log agent when useRun is running without activity', () => {
    expect(deriveActivePersonaLabel(runningState([log('creator', 'x')]))).toBe('Creator');
  });

  it('prefers activity.currentAgent while brain-chat is streaming', () => {
    // Even if the published run has a creator log, the brain-chat's live
    // currentAgent wins because the ONLINE pill is driven by the chat run.
    const state = runningState([log('creator', 'older log')]);
    expect(
      deriveActivePersonaLabel(state, activity({ status: 'streaming', currentAgent: 'narrator' })),
    ).toBe('Narrator');
  });

  it('uses activity.currentAgent while sending even with idle useRun', () => {
    expect(
      deriveActivePersonaLabel(
        IDLE_STATE,
        activity({ status: 'sending', currentAgent: 'shiller' }),
      ),
    ).toBe('Shiller');
  });

  it('falls back to run logs when activity.currentAgent is null', () => {
    const state = runningState([log('heartbeat', 'tick 1')]);
    expect(
      deriveActivePersonaLabel(state, activity({ status: 'streaming', currentAgent: null })),
    ).toBe('Heartbeat');
  });

  it('returns null when both run is idle and activity.currentAgent is null', () => {
    expect(
      deriveActivePersonaLabel(IDLE_STATE, activity({ status: 'streaming', currentAgent: null })),
    ).toBeNull();
  });
});
