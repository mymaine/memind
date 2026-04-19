/**
 * Integration test for the BrainChat → FooterDrawer bridge (Memind UAT
 * critical bug fix).
 *
 * Verifies the end-to-end contract the provider + mirror API promises:
 * a log pushed through `pushLog` flows through `mergeRunState` and
 * lands in the FooterDrawer Logs tab markup, and the same for artifacts
 * in the Artifacts tab. The vitest config is node-only (no jsdom), so
 * instead of driving React state transitions we exercise the pure merge
 * kernel and render the resulting RunState through FooterDrawer via
 * `renderToStaticMarkup` — the exact pattern the rest of the repo uses.
 *
 * This guards the regression: before the fix FooterDrawer only saw
 * useRun-published state, and brain-chat runs never contributed to it.
 * The test simulates the hand-off by building a merged RunState that
 * mimics what the provider yields when BrainChat pushes live SSE events
 * into the mirror.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { IDLE_STATE } from './useRun-state.js';
import { mergeRunState } from './useRunStateContext.js';
import { FooterDrawer } from '@/components/footer-drawer.js';

function makeLog(message: string, agent: LogEvent['agent'] = 'brain'): LogEvent {
  return {
    ts: '2026-04-20T12:00:00.000Z',
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

describe('BrainChat → FooterDrawer bridge (bug fix UAT guard)', () => {
  it('renders mirror-pushed log messages inside the Logs tab body', () => {
    const brainThinking = makeLog('planning launch flow', 'brain');
    const creatorAction = makeLog('deploying token', 'creator');
    const merged = mergeRunState(IDLE_STATE, [brainThinking, creatorAction], []);

    const out = renderToStaticMarkup(
      <FooterDrawer runState={merged} initialOpen defaultTab="logs" />,
    );
    // Both messages surface as log rows.
    expect(out).toContain('planning launch flow');
    expect(out).toContain('deploying token');
    // The source column renders `${agent}.${tool}`.
    expect(out).toContain('brain.think');
    expect(out).toContain('creator.think');
    // Tab button count chip reflects the merged length.
    expect(out).toMatch(/Developer Logs[\s\S]*· 2/);
  });

  it('renders mirror-pushed artifacts inside the Artifacts tab body', () => {
    const brainArtifact = makeLoreCid('bafy-brain-mirror');
    const merged = mergeRunState(IDLE_STATE, [], [brainArtifact]);

    const out = renderToStaticMarkup(
      <FooterDrawer runState={merged} initialOpen defaultTab="artifacts" />,
    );
    // IPFS row label + short hash both present.
    expect(out).toContain('IPFS');
    // shortenRef = `${slice(0,6)}..${slice(-4)}` = `bafy-b..rror`.
    expect(out).toContain('bafy-b..rror');
    // On-chain Artifacts chip count reflects one artifact.
    expect(out).toMatch(/On-chain Artifacts[\s\S]*· 1/);
  });

  it('reflects mirror counts in the Brain Console tab', () => {
    const merged = mergeRunState(
      IDLE_STATE,
      [makeLog('a'), makeLog('b'), makeLog('c')],
      [makeLoreCid('bafy-1'), makeLoreCid('bafy-2')],
    );

    const out = renderToStaticMarkup(
      <FooterDrawer runState={merged} initialOpen defaultTab="console" />,
    );
    expect(out).toContain('logs.count');
    expect(out).toContain('artifacts.count');
    // Console rows render `<label>${value}` in a flex row — both values
    // appear as standalone spans.
    expect(out).toMatch(/logs.count[\s\S]*>3</);
    expect(out).toMatch(/artifacts.count[\s\S]*>2</);
  });

  it('preserves published order then mirror order in the Logs tab', () => {
    const publishedLog = makeLog('useRun log', 'market-maker');
    const mirrorLog = makeLog('brainchat log', 'brain');
    const running = {
      phase: 'running' as const,
      runId: 'run-1',
      logs: [publishedLog],
      artifacts: [],
      toolCalls: IDLE_STATE.toolCalls,
      assistantText: IDLE_STATE.assistantText,
      error: null,
    };
    const merged = mergeRunState(running, [mirrorLog], []);

    const out = renderToStaticMarkup(
      <FooterDrawer runState={merged} initialOpen defaultTab="logs" />,
    );
    const publishedIdx = out.indexOf('useRun log');
    const mirrorIdx = out.indexOf('brainchat log');
    expect(publishedIdx).toBeGreaterThanOrEqual(0);
    expect(mirrorIdx).toBeGreaterThan(publishedIdx);
  });
});
