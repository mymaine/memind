/**
 * Red tests for `<LaunchPanel />` (V4.7-P4 Task 4 / AC-P4.7-5).
 *
 * LaunchPanel composes the 4 launch states (idle / running / success /
 * error) around the existing ThemeInput + RunProgress + MemeImageCard +
 * ResultPills building blocks, wired to `useRun()` for live SSE state
 * and `resetRun()` for the `Run another` button.
 *
 * Tests drive the component through the optional `runController` prop so we
 * can stay in node / renderToStaticMarkup (no jsdom, no EventSource, no
 * real fetch). Each controller is a plain shape matching `UseRunResult`.
 *
 * Pinned contract:
 *   - Outer <section id="launch-panel"> exists in every state (CTA anchor).
 *   - Idle renders the "Step 1 · Launch a token" overline + ThemeInput +
 *     no progressbar.
 *   - Running shows role=progressbar with aria-valuenow reflecting done
 *     milestones; meme thumb renders as soon as the meme-image artifact
 *     lands.
 *   - Success shows `Run another` button + 5 explorer pills + `$SYMBOL`
 *     chip derived from bsc-token label.
 *   - Error shows the server error message + `Run another` button.
 *   - No runController → component falls back to useRun() and renders the
 *     idle markup without crashing during SSR.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact } from '@hack-fourmeme/shared';
import {
  EMPTY_ASSISTANT_TEXT,
  EMPTY_TOOL_CALLS,
  IDLE_STATE,
  type RunState,
} from '@/hooks/useRun-state';
import type { UseRunResult } from '@/hooks/useRun';
import { LaunchPanel } from './launch-panel.js';

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEPLOY_TX = `0x${'a'.repeat(64)}`;
const X402_TX = `0x${'b'.repeat(64)}`;
const RUN_ID = 'run_test_1';

function noopAsync(): Promise<void> {
  return Promise.resolve();
}

function noop(): void {
  /* no-op */
}

function buildMemeImage(): Extract<Artifact, { kind: 'meme-image' }> {
  return {
    kind: 'meme-image',
    status: 'ok',
    cid: 'bafymeme',
    gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafymeme',
    prompt: 'ascii nyan cat with shades',
  };
}

function buildBscToken(): Extract<Artifact, { kind: 'bsc-token' }> {
  return {
    kind: 'bsc-token',
    chain: 'bsc-mainnet',
    address: TOKEN_ADDR,
    explorerUrl: `https://bscscan.com/token/${TOKEN_ADDR}`,
    label: 'HBNB2026-NYAN',
  };
}

function buildDeployTx(): Extract<Artifact, { kind: 'token-deploy-tx' }> {
  return {
    kind: 'token-deploy-tx',
    chain: 'bsc-mainnet',
    txHash: DEPLOY_TX,
    explorerUrl: `https://bscscan.com/tx/${DEPLOY_TX}`,
  };
}

function buildLoreCid(author: 'creator' | 'narrator'): Extract<Artifact, { kind: 'lore-cid' }> {
  return {
    kind: 'lore-cid',
    cid: `bafylore-${author}`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/bafylore-${author}`,
    author,
  };
}

function buildX402Tx(): Extract<Artifact, { kind: 'x402-tx' }> {
  return {
    kind: 'x402-tx',
    chain: 'base-sepolia',
    txHash: X402_TX,
    explorerUrl: `https://sepolia.basescan.org/tx/${X402_TX}`,
    amountUsdc: '0.01',
  };
}

function makeController(state: RunState): UseRunResult {
  return {
    state,
    startRun: noopAsync,
    resetRun: noop,
  };
}

function idleController(): UseRunResult {
  return makeController(IDLE_STATE);
}

function runningController(artifacts: readonly Artifact[] = []): UseRunResult {
  return makeController({
    phase: 'running',
    logs: [],
    artifacts: [...artifacts],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: RUN_ID,
    error: null,
  });
}

function successController(): UseRunResult {
  const artifacts: Artifact[] = [
    buildMemeImage(),
    buildBscToken(),
    buildDeployTx(),
    buildLoreCid('creator'),
    buildLoreCid('narrator'),
    buildX402Tx(),
  ];
  return makeController({
    phase: 'done',
    logs: [],
    artifacts,
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: RUN_ID,
    error: null,
  });
}

function errorController(message = 'creator failed: pinata 502'): UseRunResult {
  return makeController({
    phase: 'error',
    logs: [],
    artifacts: [],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    runId: RUN_ID,
    error: message,
  });
}

describe('<LaunchPanel /> static markup', () => {
  it('idle controller → section#launch-panel + "Launch a token" overline + no progressbar', () => {
    const out = renderToStaticMarkup(<LaunchPanel runController={idleController()} />);
    expect(out).toContain('id="launch-panel"');
    expect(out).toContain('Launch a token');
    expect(out).not.toMatch(/role="progressbar"/);
  });

  it('running controller without artifacts → progressbar with aria-valuenow=0', () => {
    const out = renderToStaticMarkup(<LaunchPanel runController={runningController()} />);
    expect(out).toMatch(/role="progressbar"/);
    expect(out).toContain('aria-valuenow="0"');
    expect(out).toContain('aria-valuemax="3"');
  });

  it('running + meme-image artifact → meme thumbnail + aria-valuenow=1', () => {
    const out = renderToStaticMarkup(
      <LaunchPanel runController={runningController([buildMemeImage()])} />,
    );
    expect(out).toContain('aria-valuenow="1"');
    expect(out).toContain('https://gateway.pinata.cloud/ipfs/bafymeme');
  });

  it('success controller → `Run another` button + 5 explorer pills', () => {
    const out = renderToStaticMarkup(<LaunchPanel runController={successController()} />);
    expect(out).toContain('Run another');
    // 5 pill <a> tags: bsc-token + deploy tx + creator lore + narrator lore + x402.
    // meme-image is rendered as a big thumbnail instead of a pill.
    const anchors = out.match(/<a\b/g) ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(5);
  });

  it('success state surfaces the bsc-token label as the $SYMBOL chip', () => {
    const out = renderToStaticMarkup(<LaunchPanel runController={successController()} />);
    // bsc-token label = 'HBNB2026-NYAN' (see buildBscToken above). The chip
    // prepends a `$` so the demo viewer reads it as a ticker symbol.
    expect(out).toContain('$HBNB2026-NYAN');
  });

  it('error controller → error message + `Run another` button', () => {
    const out = renderToStaticMarkup(
      <LaunchPanel runController={errorController('creator failed: pinata 502')} />,
    );
    expect(out).toContain('creator failed: pinata 502');
    expect(out).toContain('Run another');
  });

  it('no runController → falls back to useRun() and renders idle without crashing (SSR)', () => {
    // The component must not throw when mounted without an injected
    // controller; useRun()'s initial state is IDLE_STATE so the idle
    // markup should render.
    const out = renderToStaticMarkup(<LaunchPanel />);
    expect(out).toContain('id="launch-panel"');
    expect(out).toContain('Launch a token');
  });
});
