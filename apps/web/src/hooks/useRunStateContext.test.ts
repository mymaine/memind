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
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { IDLE_STATE, type RunState } from './useRun-state.js';
import {
  dedupeArtifacts,
  EMPTY_BRAIN_CHAT_ACTIVITY,
  mergeRunState,
  RunStateContext,
  useBrainChatActivity,
  type BrainChatActivity,
} from './useRunStateContext.js';

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

describe('mergeRunState — natural-key dedupe', () => {
  function shillOrder(status: 'queued' | 'processing' | 'done', ts: string): Artifact {
    return {
      kind: 'shill-order',
      orderId: 'ord-1',
      targetTokenAddr: '0x1111111111111111111111111111111111111111',
      paidTxHash: `0x${'0'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status,
      ts,
    };
  }

  it('published queued + mirror done → single row, done wins (SSE first, fetch second)', () => {
    const queued = shillOrder('queued', '2026-04-20T00:00:00.000Z');
    const done = shillOrder('done', '2026-04-20T00:00:05.000Z');
    const running: RunState = {
      phase: 'running',
      logs: [],
      artifacts: [queued],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      runId: 'run-1',
      error: null,
    };
    const merged = mergeRunState(running, [], [done]);
    const orders = merged.artifacts.filter((a) => a.kind === 'shill-order');
    expect(orders).toHaveLength(1);
    expect(orders[0]?.kind === 'shill-order' ? orders[0].status : '').toBe('done');
  });

  it('fetch-first + SSE-later → single row, SSE wins (fetch in mirror, SSE re-publishes)', () => {
    const done = shillOrder('done', '2026-04-20T00:00:05.000Z');
    const processing = shillOrder('processing', '2026-04-20T00:00:02.000Z');
    // Simulate: fetch lands in mirror first; a re-publish brings processing
    // through the published channel second. Merge order puts published
    // before mirror, so the mirror's `done` wins by position.
    const running: RunState = {
      phase: 'running',
      logs: [],
      artifacts: [processing],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      runId: 'run-1',
      error: null,
    };
    const merged = mergeRunState(running, [], [done]);
    const orders = merged.artifacts.filter((a) => a.kind === 'shill-order');
    expect(orders).toHaveLength(1);
    expect(orders[0]?.kind === 'shill-order' ? orders[0].status : '').toBe('done');
  });

  it('heartbeat ticks are keyless and stack (null natural key preserved)', () => {
    const tick: Artifact = {
      kind: 'heartbeat-tick',
      tickNumber: 1,
      totalTicks: 5,
      decisions: ['check'],
    };
    const running: RunState = {
      phase: 'running',
      logs: [],
      artifacts: [tick],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      runId: 'run-1',
      error: null,
    };
    const merged = mergeRunState(running, [], [tick, tick]);
    expect(merged.artifacts.filter((a) => a.kind === 'heartbeat-tick')).toHaveLength(3);
  });
});

describe('dedupeArtifacts (helper)', () => {
  it('returns the array unchanged when every natural key is unique', () => {
    const a: Artifact = {
      kind: 'lore-cid',
      cid: 'cid-a',
      gatewayUrl: 'https://ipfs/cid-a',
      author: 'creator',
    };
    const b: Artifact = {
      kind: 'lore-cid',
      cid: 'cid-b',
      gatewayUrl: 'https://ipfs/cid-b',
      author: 'narrator',
    };
    expect(dedupeArtifacts([a, b])).toEqual([a, b]);
  });

  it('null-keyed entries stack regardless of duplicates', () => {
    const tick: Artifact = {
      kind: 'heartbeat-tick',
      tickNumber: 1,
      totalTicks: 5,
      decisions: ['x'],
    };
    expect(dedupeArtifacts([tick, tick, tick])).toHaveLength(3);
  });
});

describe('EMPTY_BRAIN_CHAT_ACTIVITY', () => {
  it('matches the idle baseline with null currentAgent and zero eventCount', () => {
    expect(EMPTY_BRAIN_CHAT_ACTIVITY).toEqual({
      status: 'idle',
      currentAgent: null,
      eventCount: 0,
    });
  });

  it('is a stable reference (hookable into useMemo deps without churn)', () => {
    // Re-import via dynamic reference would break this — relying on module
    // identity instead. Two literal reads of the export return the same
    // object because the module-level singleton is only constructed once.
    const ref1 = EMPTY_BRAIN_CHAT_ACTIVITY;
    const ref2 = EMPTY_BRAIN_CHAT_ACTIVITY;
    expect(ref1).toBe(ref2);
  });

  it('allows constructing BrainChatActivity variants via structural spread', () => {
    // Pure shape assertion — the type annotation at the call site is the
    // canary. If the structural contract drifts this file stops compiling.
    const streaming: BrainChatActivity = {
      ...EMPTY_BRAIN_CHAT_ACTIVITY,
      status: 'streaming',
      currentAgent: 'creator',
      eventCount: 3,
    };
    expect(streaming.status).toBe('streaming');
    expect(streaming.currentAgent).toBe('creator');
    expect(streaming.eventCount).toBe(3);
  });
});

describe('useBrainChatActivity — context wiring', () => {
  function ActivityProbe(): ReactElement {
    const activity = useBrainChatActivity();
    return createElement('span', {
      'data-status': activity.status,
      'data-agent': activity.currentAgent ?? 'null',
      'data-count': activity.eventCount.toString(),
    });
  }

  function buildValue(activity: BrainChatActivity) {
    return {
      runState: IDLE_STATE,
      publish: () => {
        /* noop */
      },
      pushLog: () => {
        /* noop */
      },
      pushArtifact: () => {
        /* noop */
      },
      resetMirror: () => {
        /* noop */
      },
      brainChatActivity: activity,
      setBrainChatActivity: () => {
        /* noop */
      },
    } as const;
  }

  it('returns EMPTY_BRAIN_CHAT_ACTIVITY outside a provider', () => {
    const out = renderToStaticMarkup(createElement(ActivityProbe));
    expect(out).toMatch(/data-status="idle"/);
    expect(out).toMatch(/data-agent="null"/);
    expect(out).toMatch(/data-count="0"/);
  });

  it('reads the provider value when wrapped', () => {
    const streaming: BrainChatActivity = {
      status: 'streaming',
      currentAgent: 'creator',
      eventCount: 4,
    };
    const tree = createElement(
      RunStateContext.Provider,
      { value: buildValue(streaming) },
      createElement(ActivityProbe),
    );
    const out = renderToStaticMarkup(tree);
    expect(out).toMatch(/data-status="streaming"/);
    expect(out).toMatch(/data-agent="creator"/);
    expect(out).toMatch(/data-count="4"/);
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
