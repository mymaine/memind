/**
 * V2-P2 Task 1 — Spike / red test.
 *
 * Goal: lock in the Anthropic SDK `messages.stream()` chunk shape we assume
 * in the runtime upgrade, BEFORE switching the real runtime over. If this
 * test compiles + passes against the SDK's public types then we know the
 * assumptions hold and the P2 plan is viable end-to-end; if it fails we
 * downgrade to tool_use:start/end only and skip assistant:delta.
 *
 * This file deliberately exercises the helper module directly with fake
 * `RawMessageStreamEvent` payloads. We do NOT call the real SDK here — the
 * point of the spike is to validate our mapping of the SDK's documented chunk
 * shape, not the SDK's own behaviour.
 */
import { describe, it, expect } from 'vitest';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { createStreamEventMapper } from './_stream-map.js';
import type { StreamMappedEvent } from './_stream-map.js';

function contentBlockStartToolUse(index: number, id: string, name: string): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id,
      name,
      input: {},
    },
  };
}

function contentBlockStartText(index: number): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'text',
      text: '',
    },
  };
}

function contentBlockDeltaText(index: number, text: string): RawMessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  };
}

function contentBlockDeltaJson(index: number, partial: string): RawMessageStreamEvent {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partial },
  };
}

function contentBlockStop(index: number): RawMessageStreamEvent {
  return { type: 'content_block_stop', index };
}

describe('createStreamEventMapper', () => {
  it('emits tool_use:start with parsed input once the JSON deltas close on block_stop', () => {
    const mapper = createStreamEventMapper();
    const out: StreamMappedEvent[] = [];

    mapper(contentBlockStartToolUse(0, 'tu_1', 'add'), (ev) => out.push(ev));
    // Partial JSON arrives in fragments — the mapper must buffer and only
    // surface the finished input on content_block_stop.
    mapper(contentBlockDeltaJson(0, '{"a":'), (ev) => out.push(ev));
    mapper(contentBlockDeltaJson(0, ' 2, "b": 3}'), (ev) => out.push(ev));
    expect(out).toEqual([]);

    mapper(contentBlockStop(0), (ev) => out.push(ev));

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      type: 'tool_use:start',
      toolUseId: 'tu_1',
      toolName: 'add',
      input: { a: 2, b: 3 },
    });
  });

  it('emits tool_use:start with empty-object input when no json deltas arrive', () => {
    const mapper = createStreamEventMapper();
    const out: StreamMappedEvent[] = [];
    mapper(contentBlockStartToolUse(0, 'tu_noop', 'ping'), (ev) => out.push(ev));
    mapper(contentBlockStop(0), (ev) => out.push(ev));
    expect(out).toEqual([
      {
        type: 'tool_use:start',
        toolUseId: 'tu_noop',
        toolName: 'ping',
        input: {},
      },
    ]);
  });

  it('emits assistant:delta for each text_delta and never for tool blocks', () => {
    const mapper = createStreamEventMapper();
    const out: StreamMappedEvent[] = [];
    mapper(contentBlockStartText(0), (ev) => out.push(ev));
    mapper(contentBlockDeltaText(0, 'Hello '), (ev) => out.push(ev));
    mapper(contentBlockDeltaText(0, 'world'), (ev) => out.push(ev));
    mapper(contentBlockStop(0), (ev) => out.push(ev));

    expect(out).toEqual([
      { type: 'assistant:delta', delta: 'Hello ' },
      { type: 'assistant:delta', delta: 'world' },
    ]);
  });

  it('handles parallel content blocks (tool_use at index 0, text at index 1)', () => {
    const mapper = createStreamEventMapper();
    const out: StreamMappedEvent[] = [];

    mapper(contentBlockStartText(0), (ev) => out.push(ev));
    mapper(contentBlockDeltaText(0, 'thinking...'), (ev) => out.push(ev));
    mapper(contentBlockStartToolUse(1, 'tu_5', 'lookup'), (ev) => out.push(ev));
    mapper(contentBlockDeltaJson(1, '{"q":"hi"}'), (ev) => out.push(ev));
    mapper(contentBlockStop(0), (ev) => out.push(ev));
    mapper(contentBlockStop(1), (ev) => out.push(ev));

    expect(out).toEqual([
      { type: 'assistant:delta', delta: 'thinking...' },
      {
        type: 'tool_use:start',
        toolUseId: 'tu_5',
        toolName: 'lookup',
        input: { q: 'hi' },
      },
    ]);
  });

  it('falls back to raw accumulated string when JSON deltas do not parse (lossy but safe)', () => {
    const mapper = createStreamEventMapper();
    const out: StreamMappedEvent[] = [];
    mapper(contentBlockStartToolUse(0, 'tu_bad', 'deploy'), (ev) => out.push(ev));
    mapper(contentBlockDeltaJson(0, '{"a": 1, '), (ev) => out.push(ev));
    mapper(contentBlockStop(0), (ev) => out.push(ev));

    // Parse failure must still surface a tool_use:start so the UI can draw a
    // spinner — input degrades to a `{ _raw: '<acc>' }` escape hatch.
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('tool_use:start');
    if (out[0]?.type !== 'tool_use:start') throw new Error('unreachable');
    expect(out[0].toolUseId).toBe('tu_bad');
    expect(out[0].input).toEqual({ _raw: '{"a": 1, ' });
  });

  it('ignores message_start / message_delta / message_stop envelope events', () => {
    const mapper = createStreamEventMapper();
    const out: StreamMappedEvent[] = [];
    mapper(
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'test',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        },
      },
      (ev) => out.push(ev),
    );
    mapper(
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      (ev) => out.push(ev),
    );
    mapper({ type: 'message_stop' }, (ev) => out.push(ev));

    expect(out).toEqual([]);
  });
});
