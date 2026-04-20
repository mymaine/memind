/**
 * Integration test: LogsDrawer subscribes to RunStateContext
 * (Memind UAT bridge — ported from the legacy footer-drawer-context +
 * useRunStateContext-bridge tests when FooterDrawer was deleted).
 *
 * Root cause this test guards: before the bridge fix the drawer only
 * read the `useRun`-owned state by prop, so BrainChat SSE events pushed
 * through the RunState mirror API never surfaced in the Logs / Artifacts
 * / Console tabs. The fix made `runState` optional and let the drawer
 * subscribe via `useRunState()` when callers omit it (the production
 * path from `app/page.tsx`).
 *
 * Test strategy mirrors the original bridge test pair: stand up a
 * minimal `RunStateContext` fixture carrying a merged state produced by
 * the pure `mergeRunState` helper (the provider's own kernel), render
 * the drawer with NO `runState` prop, and assert mirror-pushed logs +
 * artifacts surface in the SSR markup.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { IDLE_STATE, type RunState } from '@/hooks/useRun-state.js';
import {
  EMPTY_BRAIN_CHAT_ACTIVITY,
  RunStateContext,
  mergeRunState,
} from '@/hooks/useRunStateContext.js';
import { LogsDrawer } from '@/components/logs-drawer.js';

function makeLog(message: string, agent: LogEvent['agent'] = 'brain'): LogEvent {
  return {
    ts: '2026-04-20T12:34:56.000Z',
    level: 'info',
    agent,
    tool: 'think',
    message,
  };
}

function makeLoreCid(cid: string): Artifact {
  return {
    kind: 'lore-cid',
    cid,
    gatewayUrl: `https://ipfs.example/${cid}`,
    author: 'narrator',
  };
}

function withContext(runState: RunState, children: ReactNode): ReactElement {
  const value = {
    runState,
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
    brainChatActivity: EMPTY_BRAIN_CHAT_ACTIVITY,
    setBrainChatActivity: () => {
      /* noop */
    },
  } as const;
  return <RunStateContext.Provider value={value}>{children}</RunStateContext.Provider>;
}

describe('<LogsDrawer /> ↔ RunStateContext integration (UAT bridge guard)', () => {
  it('renders mirror-pushed logs from the context when no runState prop is given', () => {
    const merged = mergeRunState(
      IDLE_STATE,
      [makeLog('planning launch flow', 'brain'), makeLog('deploying token', 'creator')],
      [],
    );

    const out = renderToStaticMarkup(
      withContext(merged, <LogsDrawer initialOpen defaultTab="logs" />),
    );
    expect(out).toContain('planning launch flow');
    expect(out).toContain('deploying token');
    expect(out).toContain('brain.think');
    expect(out).toContain('creator.think');
    expect(out).toMatch(/Developer Logs[\s\S]*· 2/);
  });

  it('renders mirror-pushed artifacts from the context when no runState prop is given', () => {
    const merged = mergeRunState(IDLE_STATE, [], [makeLoreCid('bafy-brain-mirror')]);

    const out = renderToStaticMarkup(
      withContext(merged, <LogsDrawer initialOpen defaultTab="artifacts" />),
    );
    expect(out).toContain('IPFS');
    expect(out).toContain('bafy-b..rror');
    expect(out).toMatch(/On-chain Artifacts[\s\S]*· 1/);
  });

  it('reflects mirror counts in the Brain Console tab when subscribed via context', () => {
    const merged = mergeRunState(
      IDLE_STATE,
      [makeLog('a'), makeLog('b')],
      [makeLoreCid('bafy-1'), makeLoreCid('bafy-2'), makeLoreCid('bafy-3')],
    );

    const out = renderToStaticMarkup(
      withContext(merged, <LogsDrawer initialOpen defaultTab="console" />),
    );
    expect(out).toMatch(/logs.count[\s\S]*>2</);
    expect(out).toMatch(/artifacts.count[\s\S]*>3</);
  });

  it('preserves published order then mirror order in the Logs tab', () => {
    const publishedLog = makeLog('useRun log', 'market-maker');
    const mirrorLog = makeLog('brainchat log', 'brain');
    const running: RunState = {
      phase: 'running',
      runId: 'run-1',
      logs: [publishedLog],
      artifacts: [],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      error: null,
    };
    const merged = mergeRunState(running, [mirrorLog], []);

    const out = renderToStaticMarkup(
      withContext(merged, <LogsDrawer initialOpen defaultTab="logs" />),
    );
    const publishedIdx = out.indexOf('useRun log');
    const mirrorIdx = out.indexOf('brainchat log');
    expect(publishedIdx).toBeGreaterThanOrEqual(0);
    expect(mirrorIdx).toBeGreaterThan(publishedIdx);
  });

  it('props.runState override wins over the context (test / SSR fixture escape hatch)', () => {
    const contextState = mergeRunState(IDLE_STATE, [makeLog('from-context')], []);
    const propOverride: RunState = {
      phase: 'running',
      runId: 'run-prop',
      logs: [makeLog('from-prop', 'narrator')],
      artifacts: [],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      error: null,
    };

    const out = renderToStaticMarkup(
      withContext(
        contextState,
        <LogsDrawer runState={propOverride} initialOpen defaultTab="logs" />,
      ),
    );
    expect(out).toContain('from-prop');
    expect(out).not.toContain('from-context');
  });

  it('falls back to IDLE_STATE outside a provider (empty-state copy)', () => {
    const out = renderToStaticMarkup(<LogsDrawer initialOpen defaultTab="logs" />);
    expect(out).toContain('awaiting run');
  });
});
