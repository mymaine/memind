/**
 * Red tests for the RunState mirror API (Memind UAT critical bug fix).
 *
 * The RunStateProvider owns both:
 *   1. A published RunState pushed by `publish(state)` from the page-level
 *      `useRun()` instance.
 *   2. A mirrored logs / artifacts collection pushed by `pushLog` /
 *      `pushArtifact` from external SSE consumers (specifically
 *      `useBrainChat` — its POST /api/runs {kind:'brain-chat'} opens a run
 *      whose events are not visible to useRun).
 *
 * Consumers read the merged view via `useRunState()`. The merge kernel is
 * extracted into a pure helper `mergeRunState(published, extraLogs,
 * extraArtifacts)` so the behaviour is unit-testable in the node env
 * (vitest config has no jsdom). The provider just plumbs setState calls
 * into this helper.
 *
 * Covered cases:
 *   1. idle published + no extras → identical to IDLE_STATE
 *   2. running published + extra logs → merged logs preserve published
 *      first then append extras in insertion order
 *   3. running published + extra artifacts → same ordering contract
 *   4. extras survive a re-publish (so mid-stream updates to useRun state
 *      never wipe BrainChat mirror data)
 *   5. idle + extras only → phase stays idle; logs/artifacts carry extras
 *      even though IDLE_STATE's literal types insist they're `[]`
 */
import { describe, it, expect } from 'vitest';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { IDLE_STATE, type RunState } from './useRun-state.js';
import { mergeRunState } from './useRunStateContext.js';

function makeLog(msg: string): LogEvent {
  return {
    ts: '2026-04-20T10:00:00.000Z',
    level: 'info',
    agent: 'brain',
    tool: 'think',
    message: msg,
  };
}

function makeArtifact(cid: string): Artifact {
  return {
    kind: 'lore-cid',
    cid,
    gatewayUrl: `https://ipfs.example/${cid}`,
    author: 'narrator',
  };
}

describe('mergeRunState — idle + no extras', () => {
  it('returns a structurally-idle state identical to IDLE_STATE', () => {
    const merged = mergeRunState(IDLE_STATE, [], []);
    expect(merged.phase).toBe('idle');
    expect(merged.logs).toEqual([]);
    expect(merged.artifacts).toEqual([]);
    expect(merged.runId).toBeNull();
    expect(merged.error).toBeNull();
  });
});

describe('mergeRunState — running + extras', () => {
  it('appends extra logs AFTER published logs in insertion order', () => {
    const publishedLog = makeLog('published');
    const running: RunState = {
      phase: 'running',
      logs: [publishedLog],
      artifacts: [],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      runId: 'run-123',
      error: null,
    };
    const extra1 = makeLog('extra-1');
    const extra2 = makeLog('extra-2');
    const merged = mergeRunState(running, [extra1, extra2], []);
    expect(merged.logs).toEqual([publishedLog, extra1, extra2]);
    expect(merged.phase).toBe('running');
  });

  it('appends extra artifacts AFTER published artifacts in insertion order', () => {
    const publishedArt = makeArtifact('bafy-published');
    const running: RunState = {
      phase: 'running',
      logs: [],
      artifacts: [publishedArt],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      runId: 'run-123',
      error: null,
    };
    const extraA = makeArtifact('bafy-a');
    const extraB = makeArtifact('bafy-b');
    const merged = mergeRunState(running, [], [extraA, extraB]);
    expect(merged.artifacts).toEqual([publishedArt, extraA, extraB]);
  });
});

describe('mergeRunState — idle + extras (BrainChat-only scenario)', () => {
  it('keeps phase=idle but still surfaces mirror logs for the FooterDrawer', () => {
    const extra = makeLog('brain thinking');
    const merged = mergeRunState(IDLE_STATE, [extra], []);
    expect(merged.phase).toBe('idle');
    // The merge function lets mirror-only logs flow through even when the
    // published state is idle — this is the BrainChat-only scenario where
    // the page never started a run via useRun but BrainPanel is streaming.
    expect(merged.logs).toEqual([extra]);
  });

  it('surfaces mirror artifacts in the idle scenario too', () => {
    const extra = makeArtifact('bafy-brain');
    const merged = mergeRunState(IDLE_STATE, [], [extra]);
    expect(merged.phase).toBe('idle');
    expect(merged.artifacts).toEqual([extra]);
  });
});

describe('mergeRunState — re-publish preserves extras', () => {
  it('does not wipe mirrored logs/artifacts when the published state changes', () => {
    const extraLog = makeLog('mirror-log');
    const extraArt = makeArtifact('bafy-mirror');

    // First publish: running with no published data.
    const runningEmpty: RunState = {
      phase: 'running',
      logs: [],
      artifacts: [],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      runId: 'run-1',
      error: null,
    };
    const merged1 = mergeRunState(runningEmpty, [extraLog], [extraArt]);
    expect(merged1.logs).toEqual([extraLog]);
    expect(merged1.artifacts).toEqual([extraArt]);

    // Second publish: useRun emitted its own log; mirror extras remain.
    const runLog = makeLog('use-run-log');
    const runningWithPublished: RunState = {
      ...runningEmpty,
      logs: [runLog],
    };
    const merged2 = mergeRunState(runningWithPublished, [extraLog], [extraArt]);
    expect(merged2.logs).toEqual([runLog, extraLog]);
    expect(merged2.artifacts).toEqual([extraArt]);
  });
});
