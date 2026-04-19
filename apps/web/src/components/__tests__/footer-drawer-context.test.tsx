/**
 * Integration test: FooterDrawer subscribes to RunStateContext
 * (Memind UAT critical bug fix).
 *
 * Root cause this test guards: before the fix `<FooterDrawer runState=
 * {hookResult.state} />` in `app/page.tsx` passed the useRun-owned state
 * by prop. That state never observes BrainChat's dedicated SSE run, so
 * logs + artifacts pushed through the RunState mirror API by
 * `useBrainChat` never reached the Logs / Artifacts / Console tabs even
 * though the provider merged them correctly. Fix: FooterDrawer's
 * `runState` prop became optional and the drawer now subscribes via
 * `useRunState()` when the caller omits it (the production path from
 * `page.tsx`).
 *
 * Test strategy: the vitest config is node-only (no jsdom) so we cannot
 * exercise real setState transitions end-to-end. Instead we assert the
 * integration contract between `RunStateContext` and `<FooterDrawer />`
 * directly by standing up a minimal fixture context value that carries
 * the merged state produced by `mergeRunState` (the same helper the
 * provider uses) — then render the drawer with NO `runState` prop and
 * confirm mirror-pushed logs and artifacts surface in the markup.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { IDLE_STATE, type RunState } from '@/hooks/useRun-state.js';
import { RunStateContext, mergeRunState } from '@/hooks/useRunStateContext.js';
import { FooterDrawer } from '@/components/footer-drawer.js';

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

/**
 * Minimal RunStateContext wrapper. We only care about `runState` for
 * these tests; `publish` / `pushLog` / `pushArtifact` / `resetMirror`
 * are no-ops — the FooterDrawer never calls them.
 */
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
  } as const;
  return <RunStateContext.Provider value={value}>{children}</RunStateContext.Provider>;
}

describe('<FooterDrawer /> ↔ RunStateContext integration (UAT bug guard)', () => {
  it('renders mirror-pushed logs from the context when no runState prop is given', () => {
    // Simulates the provider state after `pushLog` fires twice:
    // published stays IDLE, extraLogs carries the brain-chat events.
    const merged = mergeRunState(
      IDLE_STATE,
      [makeLog('planning launch flow', 'brain'), makeLog('deploying token', 'creator')],
      [],
    );

    const out = renderToStaticMarkup(
      withContext(merged, <FooterDrawer initialOpen defaultTab="logs" />),
    );
    expect(out).toContain('planning launch flow');
    expect(out).toContain('deploying token');
    // Source column renders `${agent}.${tool}` — confirms we actually
    // walked `runState.logs` end-to-end, not just a substring match on
    // the message.
    expect(out).toContain('brain.think');
    expect(out).toContain('creator.think');
    // Tab chip reflects the merged length (2 mirror logs, 0 published).
    expect(out).toMatch(/Developer Logs[\s\S]*· 2/);
  });

  it('renders mirror-pushed artifacts from the context when no runState prop is given', () => {
    const merged = mergeRunState(IDLE_STATE, [], [makeLoreCid('bafy-brain-mirror')]);

    const out = renderToStaticMarkup(
      withContext(merged, <FooterDrawer initialOpen defaultTab="artifacts" />),
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
      withContext(merged, <FooterDrawer initialOpen defaultTab="console" />),
    );
    expect(out).toMatch(/logs.count[\s\S]*>2</);
    expect(out).toMatch(/artifacts.count[\s\S]*>3</);
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
        <FooterDrawer runState={propOverride} initialOpen defaultTab="logs" />,
      ),
    );
    // Prop wins — context log is suppressed, prop log is rendered.
    expect(out).toContain('from-prop');
    expect(out).not.toContain('from-context');
  });

  it('falls back to IDLE_STATE outside a provider (empty-state copy)', () => {
    const out = renderToStaticMarkup(<FooterDrawer initialOpen defaultTab="logs" />);
    // Useful for routes that forget to wrap in <RunStateProvider /> —
    // the drawer degrades gracefully instead of throwing.
    expect(out).toContain('awaiting run');
  });
});
