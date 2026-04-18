import { describe, it, expect } from 'vitest';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { ToolCallState, ToolCallsByAgent } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';
import { deriveOrderState, type DeriveOrderInput } from './derive-order-state';

/**
 * OrderPanel (AC-P4.7-5) derive-function coverage. The happy-path and skip-
 * path artifact sequences emitted by apps/server/src/runs/shill-market.ts
 * (verified against the orchestrator source) are:
 *
 *   happy:  x402-tx → shill-order(queued) → shill-tweet → shill-order(done)
 *   skip:   x402-tx → shill-order(queued) → shill-order(failed)     ← no tweet
 *
 * 4-step processing mapping (spec AC-P4.7-5):
 *   ① Paying    ← x402-tx arrives
 *   ② Queued    ← shill-order with status='queued'
 *   ③ Drafting  ← market-maker assistantText accumulates, OR
 *                 tool_use:end for post_shill_for on market-maker
 *   ④ Posted    ← shill-tweet arrives
 *
 * The skip path terminates at phase='done' with only a failed shill-order
 * and no shill-tweet; the derive function surfaces this as kind='failed'.
 */

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const X402_TX = `0x${'c'.repeat(64)}`;
const PAID_TX = `0x${'d'.repeat(64)}`;

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
  overrides: Partial<Extract<Artifact, { kind: 'shill-order' }>> = {},
): Extract<Artifact, { kind: 'shill-order' }> {
  return {
    kind: 'shill-order',
    orderId: 'order_test',
    targetTokenAddr: TOKEN_ADDR,
    paidTxHash: PAID_TX,
    paidAmountUsdc: '0.01',
    status,
    ts: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

function buildShillTweet(): Extract<Artifact, { kind: 'shill-tweet' }> {
  return {
    kind: 'shill-tweet',
    orderId: 'order_test',
    targetTokenAddr: TOKEN_ADDR,
    tweetId: '1800000000000000001',
    tweetUrl: 'https://x.com/shiller/status/1800000000000000001',
    tweetText: '$HBNB2026-NYAN feels like the start of something.',
    ts: '2026-04-20T10:01:30.000Z',
  };
}

function toolCallsWith(agent: keyof ToolCallsByAgent, call: ToolCallState): ToolCallsByAgent {
  return { ...EMPTY_TOOL_CALLS, [agent]: [call] };
}

function baseInput(overrides: Partial<DeriveOrderInput> = {}): DeriveOrderInput {
  return {
    phase: 'idle',
    artifacts: [] as Artifact[],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    logs: [] as LogEvent[],
    error: null,
    ...overrides,
  };
}

describe('deriveOrderState', () => {
  it('returns idle when phase is idle and no artifacts exist', () => {
    const result = deriveOrderState(baseInput());
    expect(result).toEqual({ kind: 'idle' });
  });

  it('returns processing with paying step running when phase=running and no artifacts arrived', () => {
    const result = deriveOrderState(baseInput({ phase: 'running' }));
    expect(result.kind).toBe('processing');
    if (result.kind !== 'processing') throw new Error('expected processing');
    expect(result.steps).toEqual({
      paying: 'running',
      queued: 'idle',
      drafting: 'idle',
      posted: 'idle',
    });
    expect(result.latestToolUse).toBeNull();
  });

  it('marks paying done + queued running once x402-tx arrives', () => {
    const result = deriveOrderState(baseInput({ phase: 'running', artifacts: [buildX402Tx()] }));
    expect(result.kind).toBe('processing');
    if (result.kind !== 'processing') throw new Error('expected processing');
    expect(result.steps).toEqual({
      paying: 'done',
      queued: 'running',
      drafting: 'idle',
      posted: 'idle',
    });
  });

  it('marks queued done + drafting running once shill-order(queued) arrives', () => {
    const result = deriveOrderState(
      baseInput({
        phase: 'running',
        artifacts: [buildX402Tx(), buildShillOrder('queued')],
      }),
    );
    expect(result.kind).toBe('processing');
    if (result.kind !== 'processing') throw new Error('expected processing');
    expect(result.steps).toEqual({
      paying: 'done',
      queued: 'done',
      drafting: 'running',
      posted: 'idle',
    });
  });

  it('keeps drafting running when market-maker assistantText accumulates (without tool_use:end)', () => {
    const result = deriveOrderState(
      baseInput({
        phase: 'running',
        artifacts: [buildX402Tx(), buildShillOrder('queued')],
        assistantText: { ...EMPTY_ASSISTANT_TEXT, 'market-maker': 'drafting a tweet...' },
      }),
    );
    expect(result.kind).toBe('processing');
    if (result.kind !== 'processing') throw new Error('expected processing');
    // assistantText accumulating is a stronger signal than the queued-only
    // fallback but the visible step status stays 'running' until the terminal
    // shill-tweet lands. This test pins that the assistantText signal alone
    // does not prematurely advance the step to 'done'.
    expect(result.steps.drafting).toBe('running');
    expect(result.steps.posted).toBe('idle');
  });

  it('marks drafting done + posted running once tool_use:end post_shill_for has fired', () => {
    const toolCalls = toolCallsWith('market-maker', {
      id: 'tu_post',
      toolName: 'post_shill_for',
      input: {},
      output: { ok: true },
      isError: false,
      status: 'done',
    });
    const result = deriveOrderState(
      baseInput({
        phase: 'running',
        artifacts: [buildX402Tx(), buildShillOrder('queued')],
        toolCalls,
      }),
    );
    expect(result.kind).toBe('processing');
    if (result.kind !== 'processing') throw new Error('expected processing');
    expect(result.steps).toEqual({
      paying: 'done',
      queued: 'done',
      drafting: 'done',
      posted: 'running',
    });
    expect(result.latestToolUse).toEqual({
      agent: 'market-maker',
      toolName: 'post_shill_for',
    });
  });

  it('returns kind=posted with shill-tweet + x402-tx when phase=done and tweet exists', () => {
    const tweet = buildShillTweet();
    const x402 = buildX402Tx();
    const result = deriveOrderState(
      baseInput({
        phase: 'done',
        artifacts: [x402, buildShillOrder('queued'), tweet, buildShillOrder('done')],
      }),
    );
    expect(result.kind).toBe('posted');
    if (result.kind !== 'posted') throw new Error('expected posted');
    expect(result.shillTweetArtifact).toEqual(tweet);
    expect(result.x402TxArtifact).toEqual(x402);
  });

  it('returns kind=failed for the skip path (shill-order failed, no shill-tweet)', () => {
    const failed = buildShillOrder('failed');
    const result = deriveOrderState(
      baseInput({
        phase: 'done',
        artifacts: [buildX402Tx(), buildShillOrder('queued'), failed],
      }),
    );
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('expected failed');
    expect(result.message).toMatch(/skip/i);
    expect(result.shillOrderFailed).toEqual(failed);
  });

  it('returns kind=error with input.error when phase=error', () => {
    const result = deriveOrderState(
      baseInput({ phase: 'error', error: 'shill-market failed: x402 invalid tx' }),
    );
    expect(result).toEqual({
      kind: 'error',
      message: 'shill-market failed: x402 invalid tx',
    });
  });

  it('falls back to a generic error message when phase=error but error string is null', () => {
    const result = deriveOrderState(baseInput({ phase: 'error', error: null }));
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns idle after reset (phase back to idle + collections cleared)', () => {
    // Mirrors the shape delivered by useRun().resetRun().
    const result = deriveOrderState(baseInput());
    expect(result).toEqual({ kind: 'idle' });
  });

  it('does not crash when multiple x402-tx artifacts appear (defensive: picks first match)', () => {
    const firstX402 = buildX402Tx();
    const secondX402: Extract<Artifact, { kind: 'x402-tx' }> = {
      ...firstX402,
      txHash: `0x${'e'.repeat(64)}`,
    };
    const result = deriveOrderState(
      baseInput({ phase: 'running', artifacts: [firstX402, secondX402] }),
    );
    expect(result.kind).toBe('processing');
    if (result.kind !== 'processing') throw new Error('expected processing');
    expect(result.steps.paying).toBe('done');
  });
});
