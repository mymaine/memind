/**
 * Unit tests for the V2-P2 fine-grained SSE state reducers. We test the pure
 * helpers, not the React hook — the hook merely plumbs these into setState
 * functional updates, which is verified by hand and by the broader e2e SSE
 * round-trip test.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_ASSISTANT_TEXT,
  EMPTY_TOOL_CALLS,
  applyAssistantDelta,
  applyToolUseEnd,
  applyToolUseStart,
  describeStartRunError,
} from './useRun-state.js';

describe('applyToolUseStart', () => {
  it('appends a running entry to the correct agent bucket', () => {
    const next = applyToolUseStart(EMPTY_TOOL_CALLS, {
      agent: 'creator',
      toolName: 'narrative_generator',
      toolUseId: 'tu_1',
      input: { theme: 'shiba' },
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(next.creator).toEqual([
      {
        id: 'tu_1',
        toolName: 'narrative_generator',
        input: { theme: 'shiba' },
        status: 'running',
      },
    ]);
    // Other agents remain unchanged and the object reference is new.
    expect(next.narrator).toEqual([]);
    expect(next).not.toBe(EMPTY_TOOL_CALLS);
  });

  it('preserves prior entries in the same agent bucket', () => {
    const seed = applyToolUseStart(EMPTY_TOOL_CALLS, {
      agent: 'narrator',
      toolName: 'extend_lore',
      toolUseId: 'tu_a',
      input: {},
      ts: '2026-04-20T10:00:00.000Z',
    });
    const next = applyToolUseStart(seed, {
      agent: 'narrator',
      toolName: 'extend_lore',
      toolUseId: 'tu_b',
      input: {},
      ts: '2026-04-20T10:00:01.000Z',
    });
    expect(next.narrator.map((c) => c.id)).toEqual(['tu_a', 'tu_b']);
  });
});

describe('applyToolUseEnd', () => {
  it('flips the matching running entry to done with output', () => {
    const started = applyToolUseStart(EMPTY_TOOL_CALLS, {
      agent: 'creator',
      toolName: 'meme_image_creator',
      toolUseId: 'tu_img',
      input: { prompt: 'shiba' },
      ts: '2026-04-20T10:00:00.000Z',
    });
    const ended = applyToolUseEnd(started, {
      agent: 'creator',
      toolName: 'meme_image_creator',
      toolUseId: 'tu_img',
      output: { cid: 'bafy', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy' },
      isError: false,
      ts: '2026-04-20T10:00:01.000Z',
    });
    expect(ended.creator).toEqual([
      {
        id: 'tu_img',
        toolName: 'meme_image_creator',
        input: { prompt: 'shiba' },
        output: { cid: 'bafy', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy' },
        isError: false,
        status: 'done',
      },
    ]);
  });

  it('appends a synthetic done entry when end arrives without a matching start', () => {
    // Simulates reconnect where the start event was missed.
    const ended = applyToolUseEnd(EMPTY_TOOL_CALLS, {
      agent: 'market-maker',
      toolName: 'x402_fetch_lore',
      toolUseId: 'tu_orphan',
      output: { error: 'timeout' },
      isError: true,
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(ended['market-maker']).toHaveLength(1);
    expect(ended['market-maker'][0]).toMatchObject({
      id: 'tu_orphan',
      isError: true,
      status: 'done',
    });
  });

  it('leaves unrelated agents untouched', () => {
    const started = applyToolUseStart(EMPTY_TOOL_CALLS, {
      agent: 'creator',
      toolName: 'lore_writer',
      toolUseId: 'tu_c',
      input: {},
      ts: '2026-04-20T10:00:00.000Z',
    });
    const next = applyToolUseEnd(started, {
      agent: 'creator',
      toolName: 'lore_writer',
      toolUseId: 'tu_c',
      output: {},
      isError: false,
      ts: '2026-04-20T10:00:01.000Z',
    });
    expect(next.narrator).toBe(started.narrator);
    expect(next['market-maker']).toBe(started['market-maker']);
  });
});

describe('applyAssistantDelta', () => {
  it('concatenates deltas into per-agent text buckets', () => {
    const after1 = applyAssistantDelta(EMPTY_ASSISTANT_TEXT, {
      agent: 'creator',
      delta: 'Hello ',
      ts: '2026-04-20T10:00:00.000Z',
    });
    const after2 = applyAssistantDelta(after1, {
      agent: 'creator',
      delta: 'world',
      ts: '2026-04-20T10:00:00.500Z',
    });
    expect(after2.creator).toBe('Hello world');
    // Narrator never received a delta.
    expect(after2.narrator).toBe('');
  });

  it('keeps per-agent streams independent', () => {
    const after = applyAssistantDelta(
      applyAssistantDelta(EMPTY_ASSISTANT_TEXT, {
        agent: 'creator',
        delta: 'C',
        ts: '2026-04-20T10:00:00.000Z',
      }),
      { agent: 'narrator', delta: 'N', ts: '2026-04-20T10:00:00.000Z' },
    );
    expect(after.creator).toBe('C');
    expect(after.narrator).toBe('N');
  });
});

// V2-P5 Task 6 — 409 toast formatting.
describe('describeStartRunError', () => {
  it('formats 409 run_in_progress into a user-facing toast string', () => {
    const msg = describeStartRunError(409, {
      error: 'run_in_progress',
      existingRunId: 'run_abc',
    });
    expect(msg).toMatch(/already in progress/i);
  });

  it('falls back to the server error field on a plain 400', () => {
    const msg = describeStartRunError(400, { error: 'invalid request' });
    expect(msg).toMatch(/bad request/i);
    expect(msg).toMatch(/invalid request/);
  });

  it('emits a generic server-error message on 5xx', () => {
    const msg = describeStartRunError(503, null);
    expect(msg).toMatch(/server error/i);
    expect(msg).toMatch(/503/);
  });
});
