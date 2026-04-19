/**
 * Red tests for `<OrderPanel />` (V4.7-P4 Task 5 / AC-P4.7-5).
 *
 * OrderPanel composes the 5 order states (idle / processing / posted /
 * failed / error) around the existing RunProgress + TweetPreviewCard +
 * ResultPills building blocks, wired to `useRun()` for live SSE state and
 * `resetRun()` for the `Order another` button.
 *
 * Tests drive the component through the optional `runController` prop so we
 * can stay in node / renderToStaticMarkup (no jsdom, no EventSource, no
 * real fetch). Each controller is a plain shape matching `UseRunResult`.
 *
 * Pinned contract:
 *   - Outer <section id="order"> exists in every state (CTA anchor).
 *   - Idle renders the "Step 2 · Order a shill" overline + token address
 *     input + `Order Shill · 0.01 USDC` submit + no progressbar.
 *   - Processing (no artifact) shows role=progressbar at 0/4 and disables
 *     form inputs.
 *   - Processing + x402 shows paying step 'done' (aria-valuenow=1).
 *   - Posted shows the tweet body, `Order another`, and x402 settlement
 *     pill (shill-tweet is rendered inline via TweetPreviewCard and
 *     deliberately excluded from the pill row by isPillArtifact).
 *   - Failed shows the skip message with warning-colour styling plus
 *     `Order another`.
 *   - Error shows the server error message + `Order another`.
 *   - Invalid token address disables the Order Shill button.
 *   - `initialTokenAddr` prop pre-populates the form input.
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
import { OrderPanel } from './order-panel.js';

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const X402_TX = `0x${'c'.repeat(64)}`;
const PAID_TX = `0x${'d'.repeat(64)}`;
const RUN_ID = 'run_order_1';

function noopAsync(): Promise<void> {
  return Promise.resolve();
}

function noop(): void {
  /* no-op */
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

function buildShillOrder(
  status: 'queued' | 'processing' | 'done' | 'failed',
): Extract<Artifact, { kind: 'shill-order' }> {
  return {
    kind: 'shill-order',
    orderId: 'order_test',
    targetTokenAddr: TOKEN_ADDR,
    paidTxHash: PAID_TX,
    paidAmountUsdc: '0.01',
    status,
    ts: '2026-04-20T10:00:00.000Z',
  };
}

function buildShillTweet(): Extract<Artifact, { kind: 'shill-tweet' }> {
  return {
    kind: 'shill-tweet',
    orderId: 'order_test',
    targetTokenAddr: TOKEN_ADDR,
    tweetId: '1800000000000000001',
    tweetUrl: 'https://x.com/shiller_x/status/1800000000000000001',
    tweetText: '$HBNB2026-NYAN feels like the start of something.',
    ts: '2026-04-20T10:01:30.000Z',
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

function processingController(artifacts: readonly Artifact[] = []): UseRunResult {
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

function postedController(): UseRunResult {
  const artifacts: Artifact[] = [
    buildX402Tx(),
    buildShillOrder('queued'),
    buildShillTweet(),
    buildShillOrder('done'),
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

function failedController(): UseRunResult {
  const artifacts: Artifact[] = [
    buildX402Tx(),
    buildShillOrder('queued'),
    buildShillOrder('failed'),
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

function errorController(message = 'market-maker failed: x api 500'): UseRunResult {
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

describe('<OrderPanel /> static markup', () => {
  it('idle controller → section#order + "Order a shill" overline + submit button + no progressbar', () => {
    const out = renderToStaticMarkup(<OrderPanel runController={idleController()} />);
    expect(out).toContain('id="order"');
    expect(out).toContain('Order a shill');
    // Primary CTA copy (spec AC-P4.7-5 idle state).
    expect(out).toContain('Order Shill');
    expect(out).toContain('0.01 USDC');
    // Default token address prefill renders as an input value.
    expect(out).toContain(TOKEN_ADDR);
    expect(out).not.toMatch(/role="progressbar"/);
  });

  it('processing controller (no artifacts) → progressbar at 0/4 + disabled form inputs', () => {
    const out = renderToStaticMarkup(<OrderPanel runController={processingController()} />);
    expect(out).toMatch(/role="progressbar"/);
    expect(out).toContain('aria-valuenow="0"');
    expect(out).toContain('aria-valuemax="4"');
    // Form inputs must be disabled during processing — `disabled` in React
    // serialises to the boolean-attribute form `disabled=""` in static markup.
    expect(out).toMatch(/<input[^>]*disabled=""/);
  });

  it('processing + x402-tx artifact → paying done + queued running (aria-valuenow=1)', () => {
    const out = renderToStaticMarkup(
      <OrderPanel runController={processingController([buildX402Tx()])} />,
    );
    expect(out).toContain('aria-valuenow="1"');
    expect(out).toContain('aria-valuemax="4"');
  });

  it('posted controller → tweet body + `Order another` + x402 settlement pill', () => {
    const out = renderToStaticMarkup(<OrderPanel runController={postedController()} />);
    // TweetPreviewCard renders the body verbatim.
    expect(out).toContain('$HBNB2026-NYAN feels like the start of something.');
    expect(out).toContain('Order another');
    // x402 pill: at least one <a> tag pointing at basescan.
    expect(out).toMatch(/sepolia\.basescan\.org\/tx\/0x[c]+/);
    // shill-tweet is surfaced via TweetPreviewCard only — it must not
    // appear inside the <ul data-testid="result-pills"> list. The tweet's
    // own "View on X ↗" anchor (in TweetPreviewCard's footer) is allowed.
    const pillsMatch = out.match(/data-testid="result-pills"[^>]*>([\s\S]*?)<\/ul>/);
    expect(pillsMatch).not.toBeNull();
    expect(pillsMatch?.[1] ?? '').not.toContain('x.com');
  });

  it('failed controller → "Shiller skipped" message + warning accent + `Order another`', () => {
    const out = renderToStaticMarkup(<OrderPanel runController={failedController()} />);
    expect(out).toContain('Shiller skipped');
    // Visual distinction from error: warning colour, not danger.
    expect(out).toContain('--color-warning');
    expect(out).toContain('Order another');
  });

  it('error controller → error message + `Order another` button', () => {
    const out = renderToStaticMarkup(
      <OrderPanel runController={errorController('market-maker failed: x api 500')} />,
    );
    expect(out).toContain('market-maker failed: x api 500');
    expect(out).toContain('Order another');
    // Error branch uses the danger colour token (separate from warning).
    expect(out).toContain('--color-danger');
  });

  it('initialTokenAddr prop overrides the default prefill', () => {
    const custom = '0x1111111111111111111111111111111111111111';
    const out = renderToStaticMarkup(
      <OrderPanel runController={idleController()} initialTokenAddr={custom} />,
    );
    expect(out).toContain(custom);
  });

  it('renders the tweet-mode radio group with safe mode pre-selected by default', () => {
    const out = renderToStaticMarkup(<OrderPanel runController={idleController()} />);
    // Legend + both labels must be rendered so the form is discoverable.
    expect(out).toMatch(/Tweet mode/i);
    expect(out).toMatch(/Safe mode/i);
    expect(out).toMatch(/four\.meme click-through URL/i);
    // Radio group contract: two radios sharing the `tweetMode` name.
    expect(out).toMatch(/type="radio"[^>]*name="tweetMode"[^>]*value="safe"/);
    expect(out).toMatch(/type="radio"[^>]*name="tweetMode"[^>]*value="with-url"/);
    // Safe mode is the default pre-selection (production safe-during-cooldown
    // posture). React SSR emits `checked=""` as a boolean attribute; it may
    // appear before or after `value="safe"` in the rendered <input>. We
    // check both orderings explicitly so the assertion is attribute-order
    // agnostic.
    expect(/value="safe"[^>]*checked=""/.test(out) || /checked=""[^>]*value="safe"/.test(out)).toBe(
      true,
    );
    // The with-url radio must NOT carry `checked=""` in the default render.
    expect(
      /value="with-url"[^>]*checked=""/.test(out) || /checked=""[^>]*value="with-url"/.test(out),
    ).toBe(false);
  });

  it('radios become disabled while the run is processing', () => {
    const out = renderToStaticMarkup(<OrderPanel runController={processingController()} />);
    // In processing state the OrderPanel swaps to the read-only ProcessingView
    // which no longer mounts the radio group — it's form-level state, not
    // run-level. The negative assertion locks that in so we don't
    // accidentally start re-rendering the radios mid-run.
    expect(out).not.toMatch(/name="tweetMode"/);
  });

  it('invalid token address disables the Order Shill submit button', () => {
    const out = renderToStaticMarkup(
      <OrderPanel runController={idleController()} initialTokenAddr="0xdeadbeef" />,
    );
    // Submit button must carry the boolean `disabled=""` attribute when the
    // token address fails the EVM 0x+40-hex regex.
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it('no runController → falls back to useRun() and renders idle without crashing (SSR)', () => {
    const out = renderToStaticMarkup(<OrderPanel />);
    expect(out).toContain('id="order"');
    expect(out).toContain('Order a shill');
  });
});
