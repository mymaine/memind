/**
 * V2-P2 Task 3 — red tests for the streaming runAgentLoop path.
 *
 * The runtime now drives tool-calling through `client.messages.stream` rather
 * than `client.messages.create`, so the dashboard can see per-token text +
 * tool_use spinners in real time. Four contract requirements we verify here:
 *
 *   1. `onAssistantDelta` fires once per non-empty `text_delta`.
 *   2. `onToolUseStart` fires as soon as a tool_use block closes, carrying
 *      the buffered input.
 *   3. `onToolUseEnd` fires AFTER the registered tool actually runs, with
 *      the parsed output and `isError=false`.
 *   4. A thrown tool still emits `onToolUseEnd` with `isError=true` and does
 *      not abort the loop (matches legacy `messages.create` path).
 *
 * The fake `Anthropic` client exposes a `messages.stream(...)` that returns
 * an object pretending to be `MessageStream`: async-iterable over scripted
 * chunks plus a `finalMessage()` promise the runtime awaits for the
 * `stop_reason` and tool_use blocks.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  RawMessageStreamEvent,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { AgentTool, AnyAgentTool } from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { runAgentLoop } from './runtime.js';

interface AddInput {
  a: number;
  b: number;
}
interface AddOutput {
  sum: number;
}

function makeAddTool(
  execute: (input: AddInput) => Promise<AddOutput>,
): AgentTool<AddInput, AddOutput> {
  return {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: z.object({ a: z.number(), b: z.number() }),
    outputSchema: z.object({ sum: z.number() }),
    execute,
  };
}

interface ScriptedStream {
  chunks: RawMessageStreamEvent[];
  finalMessage: Message;
}

/**
 * Build a fake Anthropic client whose `messages.stream` drains a queue of
 * scripted streams. Each stream yields its chunks via `Symbol.asyncIterator`
 * and resolves `finalMessage()` to the provided `Message`.
 */
function fakeStreamingClient(queue: ScriptedStream[]): {
  client: Anthropic;
  stream: ReturnType<typeof vi.fn>;
} {
  const remaining = [...queue];
  const stream = vi.fn(() => {
    const next = remaining.shift();
    if (!next) throw new Error('fakeStreamingClient: no more streams queued');
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<RawMessageStreamEvent> {
        for (const chunk of next.chunks) {
          // Yield synchronously on a resolved microtask so the runtime's
          // `for await` loop sees the chunks in order without real I/O.
          yield chunk;
        }
      },
      finalMessage(): Promise<Message> {
        return Promise.resolve(next.finalMessage);
      },
    };
  });
  const client = { messages: { stream } } as unknown as Anthropic;
  return { client, stream };
}

function msg(content: Message['content'], stopReason: Message['stop_reason']): Message {
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

describe('runAgentLoop streaming', () => {
  it('emits assistant:delta for each text chunk before end_turn', async () => {
    const registry = new ToolRegistry();

    const stream: ScriptedStream = {
      chunks: [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
        { type: 'content_block_stop', index: 0 },
      ],
      finalMessage: msg([{ type: 'text', text: 'hello world' }], 'end_turn'),
    };
    const { client } = fakeStreamingClient([stream]);

    const deltas: string[] = [];
    const result = await runAgentLoop({
      client,
      model: 'test',
      registry,
      systemPrompt: 'sys',
      userInput: 'say hi',
      onAssistantDelta: (e) => deltas.push(e.delta),
    });

    expect(deltas).toEqual(['hello ', 'world']);
    expect(result.finalText).toBe('hello world');
    expect(result.stopReason).toBe('end_turn');
  });

  it('emits tool_use:start then tool_use:end when the tool succeeds', async () => {
    const registry = new ToolRegistry();
    const addSpy = vi.fn(async (input: AddInput) => ({ sum: input.a + input.b }));
    registry.register(makeAddTool(addSpy) as unknown as AnyAgentTool);

    const toolUseBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'tu_1',
      name: 'add',
      input: { a: 2, b: 3 },
    };

    const queue: ScriptedStream[] = [
      {
        chunks: [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tu_1', name: 'add', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"a":2,"b":3}' },
          },
          { type: 'content_block_stop', index: 0 },
        ],
        finalMessage: msg([toolUseBlock], 'tool_use'),
      },
      {
        chunks: [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
          { type: 'content_block_stop', index: 0 },
        ],
        finalMessage: msg([{ type: 'text', text: 'done' }], 'end_turn'),
      },
    ];
    const { client } = fakeStreamingClient(queue);

    const startEvents: Array<{ toolUseId: string; toolName: string; input: unknown }> = [];
    const endEvents: Array<{ toolUseId: string; isError: boolean; output: unknown }> = [];

    const result = await runAgentLoop({
      client,
      model: 'test',
      registry,
      systemPrompt: 'sys',
      userInput: 'add',
      onToolUseStart: (e) =>
        startEvents.push({ toolUseId: e.toolUseId, toolName: e.toolName, input: e.input }),
      onToolUseEnd: (e) =>
        endEvents.push({ toolUseId: e.toolUseId, isError: e.isError, output: e.output }),
    });

    expect(startEvents).toEqual([{ toolUseId: 'tu_1', toolName: 'add', input: { a: 2, b: 3 } }]);
    expect(endEvents).toEqual([{ toolUseId: 'tu_1', isError: false, output: { sum: 5 } }]);
    expect(result.toolCalls[0]?.output).toEqual({ sum: 5 });
    expect(addSpy).toHaveBeenCalledWith({ a: 2, b: 3 });
  });

  it('emits tool_use:end with isError=true when the tool throws', async () => {
    const registry = new ToolRegistry();
    const addSpy = vi.fn(async (_input: AddInput): Promise<AddOutput> => {
      throw new Error('boom');
    });
    registry.register(makeAddTool(addSpy) as unknown as AnyAgentTool);

    const toolUseBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'tu_err',
      name: 'add',
      input: { a: 1, b: 2 },
    };
    const queue: ScriptedStream[] = [
      {
        chunks: [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tu_err', name: 'add', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"a":1,"b":2}' },
          },
          { type: 'content_block_stop', index: 0 },
        ],
        finalMessage: msg([toolUseBlock], 'tool_use'),
      },
      {
        chunks: [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'sorry' },
          },
          { type: 'content_block_stop', index: 0 },
        ],
        finalMessage: msg([{ type: 'text', text: 'sorry' }], 'end_turn'),
      },
    ];
    const { client } = fakeStreamingClient(queue);

    const endEvents: Array<{ toolUseId: string; isError: boolean }> = [];
    await runAgentLoop({
      client,
      model: 'test',
      registry,
      systemPrompt: 'sys',
      userInput: 'add',
      onToolUseEnd: (e) => endEvents.push({ toolUseId: e.toolUseId, isError: e.isError }),
    });

    expect(endEvents).toEqual([{ toolUseId: 'tu_err', isError: true }]);
  });

  it('still emits the existing LogEvent summary (coarse layer kept alongside fine-grained)', async () => {
    const registry = new ToolRegistry();
    registry.register(makeAddTool(async (i) => ({ sum: i.a + i.b })) as unknown as AnyAgentTool);

    const toolUseBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'tu_2',
      name: 'add',
      input: { a: 4, b: 5 },
    };
    const queue: ScriptedStream[] = [
      {
        chunks: [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tu_2', name: 'add', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"a":4,"b":5}' },
          },
          { type: 'content_block_stop', index: 0 },
        ],
        finalMessage: msg([toolUseBlock], 'tool_use'),
      },
      {
        chunks: [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '9' } },
          { type: 'content_block_stop', index: 0 },
        ],
        finalMessage: msg([{ type: 'text', text: '9' }], 'end_turn'),
      },
    ];
    const { client } = fakeStreamingClient(queue);

    const logs: string[] = [];
    await runAgentLoop({
      client,
      model: 'test',
      registry,
      systemPrompt: 'sys',
      userInput: 'add',
      onLog: (e) => logs.push(e.message),
      agentId: 'creator',
    });

    expect(logs.some((m) => m.includes('invoke tool add'))).toBe(true);
    expect(logs.some((m) => m.includes('tool add ok'))).toBe(true);
    expect(logs.some((m) => m.includes('loop end'))).toBe(true);
  });
});
