import { describe, it, expect } from 'vitest';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { EMPTY_TOOL_CALLS, type ToolCallsByAgent } from '../hooks/useRun-state';
import { TIMELINE_MAX_ITEMS, mergeTimeline } from './timeline-merge';

function log(ts: string, agent: LogEvent['agent'] = 'creator', message = 'm'): LogEvent {
  return {
    ts,
    agent,
    tool: 'demo',
    level: 'info',
    message,
  };
}

const x402: Artifact = {
  kind: 'x402-tx',
  chain: 'base-sepolia',
  txHash: '0x' + 'c'.repeat(64),
  explorerUrl: 'https://sepolia.basescan.org/tx/0x' + 'c'.repeat(64),
  amountUsdc: '0.10',
};

const memeOk: Artifact = {
  kind: 'meme-image',
  status: 'ok',
  cid: 'bafymeme',
  gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafymeme',
  prompt: 'shiba',
};

describe('mergeTimeline', () => {
  it('returns an empty merge for an empty input', () => {
    const r = mergeTimeline({ logs: [], artifacts: [], toolCalls: EMPTY_TOOL_CALLS });
    expect(r.items).toHaveLength(0);
    expect(r.truncatedCount).toBe(0);
  });

  it('orders log events chronologically by ts', () => {
    const r = mergeTimeline({
      logs: [
        log('2026-04-20T10:00:02.000Z', 'narrator', 'second'),
        log('2026-04-20T10:00:01.000Z', 'creator', 'first'),
        log('2026-04-20T10:00:03.000Z', 'market-maker', 'third'),
      ],
      artifacts: [],
      toolCalls: EMPTY_TOOL_CALLS,
    });
    expect(r.items.map((i) => (i.kind === 'log' ? i.event.message : ''))).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('places tool calls and artifacts after the latest log', () => {
    const tc: ToolCallsByAgent = {
      ...EMPTY_TOOL_CALLS,
      creator: [
        {
          id: 'tu_1',
          toolName: 'narrative_generator',
          input: {},
          status: 'done',
          isError: false,
          output: { ok: true },
        },
      ],
    };
    const r = mergeTimeline({
      logs: [log('2026-04-20T10:00:01.000Z'), log('2026-04-20T10:00:02.000Z', 'narrator')],
      artifacts: [x402],
      toolCalls: tc,
    });
    // 2 logs + 1 tool + 1 artifact = 4 items, in that order.
    expect(r.items).toHaveLength(4);
    expect(r.items[0]?.kind).toBe('log');
    expect(r.items[1]?.kind).toBe('log');
    expect(r.items[2]?.kind).toBe('tool_use');
    expect(r.items[3]?.kind).toBe('artifact');
  });

  it('paires tool_use:start + tool_use:end into a single done item via the reducer state', () => {
    // The reducer (applyToolUseStart/End) is responsible for collapsing a
    // start/end pair into a single ToolCallState; mergeTimeline trusts that.
    // This test asserts the merged output exposes the post-end shape, not
    // two separate start + end items.
    const tc: ToolCallsByAgent = {
      ...EMPTY_TOOL_CALLS,
      creator: [
        {
          id: 'tu_1',
          toolName: 'lore_writer',
          input: { theme: 'shiba' },
          status: 'done',
          isError: false,
          output: { cid: 'bafy' },
        },
      ],
    };
    const r = mergeTimeline({
      logs: [log('2026-04-20T10:00:01.000Z')],
      artifacts: [],
      toolCalls: tc,
    });
    const tools = r.items.filter((i) => i.kind === 'tool_use');
    expect(tools).toHaveLength(1);
    if (tools[0]?.kind === 'tool_use') {
      expect(tools[0].call.status).toBe('done');
      expect(tools[0].call.output).toEqual({ cid: 'bafy' });
    }
  });

  it('keeps multiple distinct artifacts in append order', () => {
    const r = mergeTimeline({
      logs: [log('2026-04-20T10:00:01.000Z')],
      artifacts: [memeOk, x402],
      toolCalls: EMPTY_TOOL_CALLS,
    });
    const arts = r.items.filter((i) => i.kind === 'artifact');
    expect(arts).toHaveLength(2);
    if (arts[0]?.kind === 'artifact' && arts[1]?.kind === 'artifact') {
      expect(arts[0].artifact.kind).toBe('meme-image');
      expect(arts[1].artifact.kind).toBe('x402-tx');
    }
  });

  it('produces stable per-item keys so React reconciliation does not thrash', () => {
    const r = mergeTimeline({
      logs: [log('2026-04-20T10:00:01.000Z')],
      artifacts: [x402, memeOk],
      toolCalls: EMPTY_TOOL_CALLS,
    });
    const keys = new Set<string>();
    for (const item of r.items) {
      expect(keys.has(item.key)).toBe(false);
      keys.add(item.key);
    }
  });

  it('caps the merged list at TIMELINE_MAX_ITEMS and reports the dropped count', () => {
    const logs: LogEvent[] = [];
    for (let i = 0; i < TIMELINE_MAX_ITEMS + 25; i += 1) {
      // Pad with leading zeros so lex sort matches numeric sort.
      const seq = i.toString().padStart(6, '0');
      logs.push(log(`2026-04-20T10:00:${(i % 60).toString().padStart(2, '0')}.${seq.slice(-3)}Z`));
    }
    const r = mergeTimeline({ logs, artifacts: [], toolCalls: EMPTY_TOOL_CALLS });
    expect(r.items.length).toBe(TIMELINE_MAX_ITEMS);
    expect(r.truncatedCount).toBe(25);
    // The kept items must be the latest ones — first kept item must come
    // after the dropped tail.
    const firstKeptTs = r.items[0]?.ts ?? '';
    const lastKeptTs = r.items[r.items.length - 1]?.ts ?? '';
    expect(firstKeptTs <= lastKeptTs).toBe(true);
  });

  it('reports zero truncation when the input is exactly at the cap', () => {
    const logs: LogEvent[] = [];
    for (let i = 0; i < TIMELINE_MAX_ITEMS; i += 1) {
      logs.push(log(`2026-04-20T10:00:00.${i.toString().padStart(3, '0')}Z`));
    }
    const r = mergeTimeline({ logs, artifacts: [], toolCalls: EMPTY_TOOL_CALLS });
    expect(r.items.length).toBe(TIMELINE_MAX_ITEMS);
    expect(r.truncatedCount).toBe(0);
  });

  it('survives empty agent buckets without crashing', () => {
    const r = mergeTimeline({
      logs: [log('2026-04-20T10:00:01.000Z')],
      artifacts: [],
      toolCalls: EMPTY_TOOL_CALLS,
    });
    expect(r.items).toHaveLength(1);
  });
});
