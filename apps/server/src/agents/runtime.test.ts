import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { AgentTool, AnyAgentTool, LogEvent } from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { runAgentLoop } from './runtime.js';

/**
 * Build a fake Anthropic client whose `messages.create` returns the next
 * response from a scripted queue. Each call consumes one entry and records a
 * deep snapshot of the messages passed in (runtime mutates its history array,
 * so a naive spy would only see the final state).
 */
function fakeClient(responses: Message[]): {
  client: Anthropic;
  create: ReturnType<typeof vi.fn>;
  snapshots: Array<{ messages: unknown[] }>;
} {
  const queue = [...responses];
  const snapshots: Array<{ messages: unknown[] }> = [];
  const create = vi.fn(async (params: { messages: unknown[] }) => {
    snapshots.push(JSON.parse(JSON.stringify({ messages: params.messages })));
    const next = queue.shift();
    if (!next) throw new Error('fakeClient: no more responses queued');
    return next;
  });
  const client = { messages: { create } } as unknown as Anthropic;
  return { client, create, snapshots };
}

function textOnlyResponse(text: string): Message {
  return {
    id: 'msg_end',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

function toolUseResponse(
  id: string,
  toolUses: { id: string; name: string; input: unknown }[],
): Message {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: toolUses.map((t) => ({
      type: 'tool_use',
      id: t.id,
      name: t.name,
      input: t.input,
    })),
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

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

describe('runAgentLoop', () => {
  it('invokes tools and returns final text on end_turn', async () => {
    const registry = new ToolRegistry();
    const addSpy = vi.fn(async (input: AddInput) => ({ sum: input.a + input.b }));
    registry.register(makeAddTool(addSpy) as unknown as AnyAgentTool);

    const { client, create, snapshots } = fakeClient([
      toolUseResponse('msg_1', [{ id: 'tu_1', name: 'add', input: { a: 2, b: 3 } }]),
      textOnlyResponse('the answer is 5'),
    ]);

    const result = await runAgentLoop({
      client,
      model: 'test-model',
      registry,
      systemPrompt: 'test',
      userInput: 'add 2 and 3',
    });

    expect(addSpy).toHaveBeenCalledWith({ a: 2, b: 3 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe('the answer is 5');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: 'add',
      input: { a: 2, b: 3 },
      output: { sum: 5 },
      isError: false,
    });

    // Verify tool_result was fed back to the model on turn 2.
    const secondCallMessages = snapshots[1]?.messages ?? [];
    expect(secondCallMessages).toHaveLength(3);
    const lastMessage = secondCallMessages[2] as {
      role: string;
      content: Array<{ type: string; tool_use_id: string; is_error?: boolean; content: string }>;
    };
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content[0]?.type).toBe('tool_result');
    expect(lastMessage.content[0]?.tool_use_id).toBe('tu_1');
    expect(lastMessage.content[0]?.is_error).toBeUndefined();
    expect(JSON.parse(lastMessage.content[0]?.content ?? '{}')).toEqual({ sum: 5 });
  });

  it('sends is_error tool_result when the tool throws and continues the loop', async () => {
    const registry = new ToolRegistry();
    const addSpy = vi.fn(async (_input: AddInput): Promise<AddOutput> => {
      throw new Error('boom');
    });
    registry.register(makeAddTool(addSpy) as unknown as AnyAgentTool);

    const { client, snapshots } = fakeClient([
      toolUseResponse('msg_1', [{ id: 'tu_1', name: 'add', input: { a: 1, b: 2 } }]),
      textOnlyResponse('sorry, failed'),
    ]);

    const result = await runAgentLoop({
      client,
      model: 'test-model',
      registry,
      systemPrompt: 'test',
      userInput: 'add',
    });

    expect(result.toolCalls[0]?.isError).toBe(true);
    expect(result.stopReason).toBe('end_turn');

    const secondCallMessages = snapshots[1]?.messages ?? [];
    const lastMessage = secondCallMessages[2] as {
      content: Array<{ type: string; is_error?: boolean; content: string }>;
    };
    expect(lastMessage.content[0]?.is_error).toBe(true);
    expect(JSON.parse(lastMessage.content[0]?.content ?? '{}')).toEqual({ error: 'boom' });
  });

  it('also sends is_error when input fails zod validation', async () => {
    const registry = new ToolRegistry();
    const addSpy = vi.fn(async (input: AddInput) => ({ sum: input.a + input.b }));
    registry.register(makeAddTool(addSpy) as unknown as AnyAgentTool);

    const { client } = fakeClient([
      toolUseResponse('msg_1', [{ id: 'tu_1', name: 'add', input: { a: 'nope', b: 2 } }]),
      textOnlyResponse('done'),
    ]);

    const result = await runAgentLoop({
      client,
      model: 'test-model',
      registry,
      systemPrompt: 'test',
      userInput: 'add',
    });

    expect(addSpy).not.toHaveBeenCalled();
    expect(result.toolCalls[0]?.isError).toBe(true);
  });

  it('throws when maxTurns is exceeded', async () => {
    const registry = new ToolRegistry();
    registry.register(makeAddTool(async (i) => ({ sum: i.a + i.b })) as unknown as AnyAgentTool);

    const loopingResponses = Array.from({ length: 5 }, (_, i) =>
      toolUseResponse(`msg_${i}`, [{ id: `tu_${i}`, name: 'add', input: { a: 1, b: 1 } }]),
    );
    const { client } = fakeClient(loopingResponses);

    await expect(
      runAgentLoop({
        client,
        model: 'test-model',
        registry,
        systemPrompt: 'test',
        userInput: 'loop',
        maxTurns: 2,
      }),
    ).rejects.toThrow(/exceeded maxTurns=2/);
  });

  it('emits LogEvents via onLog for every major action', async () => {
    const registry = new ToolRegistry();
    registry.register(makeAddTool(async (i) => ({ sum: i.a + i.b })) as unknown as AnyAgentTool);

    const logs: LogEvent[] = [];
    const { client } = fakeClient([
      toolUseResponse('msg_1', [{ id: 'tu_1', name: 'add', input: { a: 2, b: 3 } }]),
      textOnlyResponse('5'),
    ]);

    await runAgentLoop({
      client,
      model: 'test-model',
      registry,
      systemPrompt: 'test',
      userInput: 'add',
      onLog: (e) => logs.push(e),
      agentId: 'creator',
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((e) => e.agent === 'creator')).toBe(true);
    expect(logs.some((e) => e.tool === 'add' && e.level === 'info')).toBe(true);
    expect(logs.some((e) => e.tool === 'runtime' && e.message.includes('loop end'))).toBe(true);
  });

  it('handles parallel tool_use blocks in a single turn', async () => {
    const registry = new ToolRegistry();
    const addSpy = vi.fn(async (i: AddInput) => ({ sum: i.a + i.b }));
    registry.register(makeAddTool(addSpy) as unknown as AnyAgentTool);

    const { client, snapshots } = fakeClient([
      toolUseResponse('msg_1', [
        { id: 'tu_1', name: 'add', input: { a: 1, b: 2 } },
        { id: 'tu_2', name: 'add', input: { a: 10, b: 20 } },
      ]),
      textOnlyResponse('done'),
    ]);

    const result = await runAgentLoop({
      client,
      model: 'test-model',
      registry,
      systemPrompt: 'test',
      userInput: 'parallel add',
    });

    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(2);
    const secondMessages = snapshots[1]?.messages ?? [];
    const lastMessage = secondMessages[2] as { content: Array<{ tool_use_id: string }> };
    expect(lastMessage.content.map((c) => c.tool_use_id).sort()).toEqual(['tu_1', 'tu_2']);
  });
});
