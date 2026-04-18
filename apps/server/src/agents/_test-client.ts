/**
 * Shared test helper — build a fake Anthropic client that satisfies the V2-P2
 * streaming runtime contract.
 *
 * After V2-P2 the runtime drives `client.messages.stream(...)` rather than
 * `messages.create(...)`, so every agent-level test needs a fake that returns
 * an async-iterable producing `RawMessageStreamEvent` chunks, and whose
 * `finalMessage()` resolves to the canonical `Message`. Three agent test
 * suites (runtime / narrator / market-maker) all need the same skeleton —
 * this module keeps it in one place.
 *
 * NOT intended for production use. Lives next to the runtime so test imports
 * are short and so the fake's shape visibly tracks the runtime's expectations.
 */
import { vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  RawMessageStreamEvent,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

/**
 * One scripted turn. `chunks` is the sequence of raw SSE events the runtime
 * iterates through; `final` is what `finalMessage()` resolves to.
 */
export interface ScriptedStream {
  chunks: RawMessageStreamEvent[];
  final: Message;
}

/**
 * Construct a fake `Anthropic` client. The returned `stream` vi.fn spies each
 * invocation and the `snapshots` array captures a deep-clone of the messages
 * payload so tests can assert the runtime's message-history evolution.
 */
export function makeStreamingClient(scripts: ScriptedStream[]): {
  client: Anthropic;
  stream: ReturnType<typeof vi.fn>;
  snapshots: Array<{ messages: unknown[] }>;
} {
  const queue = [...scripts];
  const snapshots: Array<{ messages: unknown[] }> = [];
  const stream = vi.fn((params: { messages: unknown[] }) => {
    snapshots.push(JSON.parse(JSON.stringify({ messages: params.messages })));
    const next = queue.shift();
    if (!next) throw new Error('makeStreamingClient: no more streams queued');
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<RawMessageStreamEvent> {
        for (const chunk of next.chunks) yield chunk;
      },
      finalMessage(): Promise<Message> {
        return Promise.resolve(next.final);
      },
    };
  });
  const client = { messages: { stream } } as unknown as Anthropic;
  return { client, stream, snapshots };
}

/** Convenience: wrap a plain `Message` value in a scripted stream. */
export function msg(content: Message['content'], stopReason: Message['stop_reason']): Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'test',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

/** Scripted stream that yields a single text chunk and stops with end_turn. */
export function textStream(text: string): ScriptedStream {
  return {
    chunks: [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
    ],
    final: msg([{ type: 'text', text }], 'end_turn'),
  };
}

/**
 * Scripted stream that emits one tool_use block per entry (parallel when
 * multiple are provided) and stops with stop_reason='tool_use'.
 */
export function toolUseStream(
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>,
): ScriptedStream {
  const chunks: RawMessageStreamEvent[] = [];
  toolUses.forEach((t, idx) => {
    chunks.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} },
    });
    chunks.push({
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) },
    });
    chunks.push({ type: 'content_block_stop', index: idx });
  });
  const blocks: ToolUseBlock[] = toolUses.map((t) => ({
    type: 'tool_use',
    id: t.id,
    name: t.name,
    input: t.input,
  }));
  return { chunks, final: msg(blocks, 'tool_use') };
}

/**
 * Produce a `ScriptedStream` from an already-built `Message`. Used when an
 * existing test was written against the legacy non-streaming client and just
 * needs the message passed back as a final — we synthesise minimal chunks
 * (content_block_start/stop per block) so the runtime's stream iterator still
 * sees structurally-valid chunks.
 */
export function streamFromMessage(message: Message): ScriptedStream {
  const chunks: RawMessageStreamEvent[] = [];
  message.content.forEach((block, idx) => {
    if (block.type === 'text') {
      chunks.push({ type: 'content_block_start', index: idx, content_block: block });
      if (block.text.length > 0) {
        chunks.push({
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'text_delta', text: block.text },
        });
      }
      chunks.push({ type: 'content_block_stop', index: idx });
      return;
    }
    if (block.type === 'tool_use') {
      chunks.push({
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      chunks.push({
        type: 'content_block_delta',
        index: idx,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(block.input ?? {}),
        },
      });
      chunks.push({ type: 'content_block_stop', index: idx });
      return;
    }
    // Other block kinds are forwarded as content_block_start+stop; the runtime
    // ignores anything it doesn't know how to map.
    chunks.push({ type: 'content_block_start', index: idx, content_block: block as never });
    chunks.push({ type: 'content_block_stop', index: idx });
  });
  return { chunks, final: message };
}
