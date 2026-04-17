import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { AgentTool, AnyAgentTool } from '@hack-fourmeme/shared';
import { ToolRegistry, zodToAnthropicInputSchema } from './registry.js';

interface EchoInput {
  text: string;
  count?: number;
}
interface EchoOutput {
  echoed: string;
}

function makeEchoTool(name = 'echo'): AgentTool<EchoInput, EchoOutput> {
  return {
    name,
    description: 'Echo the input text count times',
    inputSchema: z.object({
      text: z.string(),
      count: z.number().optional(),
    }),
    outputSchema: z.object({ echoed: z.string() }),
    execute: async (input) => ({ echoed: input.text.repeat(input.count ?? 1) }),
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const registry = new ToolRegistry();
    const tool = makeEchoTool();
    registry.register(tool as unknown as AnyAgentTool);
    expect(registry.has('echo')).toBe(true);
    expect(registry.get('echo').name).toBe('echo');
    expect(registry.list()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(makeEchoTool() as unknown as AnyAgentTool);
    expect(() => registry.register(makeEchoTool() as unknown as AnyAgentTool)).toThrow(
      /duplicate tool name/,
    );
  });

  it('throws on unknown tool lookup', () => {
    const registry = new ToolRegistry();
    expect(() => registry.get('nope')).toThrow(/unknown tool/);
  });

  it('toAnthropicTools converts registered tools with proper input_schema', () => {
    const registry = new ToolRegistry();
    registry.register(makeEchoTool() as unknown as AnyAgentTool);
    const [converted] = registry.toAnthropicTools();
    expect(converted).toBeDefined();
    if (!converted) throw new Error('expected converted tool');
    expect(converted.name).toBe('echo');
    expect(converted.description).toBe('Echo the input text count times');
    expect(converted.input_schema.type).toBe('object');
    expect(converted.input_schema.properties.text).toEqual({ type: 'string' });
    expect(converted.input_schema.properties.count).toEqual({ type: 'number' });
    expect(converted.input_schema.required).toEqual(['text']);
  });
});

describe('zodToAnthropicInputSchema', () => {
  it('converts primitives, enum, and array fields', () => {
    const schema = zodToAnthropicInputSchema(
      z.object({
        name: z.string(),
        age: z.number(),
        flag: z.boolean(),
        color: z.enum(['red', 'green']),
        tags: z.array(z.string()),
      }),
    );
    expect(schema.type).toBe('object');
    expect(schema.properties.name).toEqual({ type: 'string' });
    expect(schema.properties.age).toEqual({ type: 'number' });
    expect(schema.properties.flag).toEqual({ type: 'boolean' });
    expect(schema.properties.color).toEqual({ type: 'string', enum: ['red', 'green'] });
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(schema.required?.sort()).toEqual(['age', 'color', 'flag', 'name', 'tags']);
  });

  it('marks .optional() and .default() fields as not required', () => {
    const schema = zodToAnthropicInputSchema(
      z.object({
        required: z.string(),
        optional: z.string().optional(),
        defaulted: z.number().default(1),
      }),
    );
    expect(schema.required).toEqual(['required']);
  });

  it('preserves .describe() text on fields', () => {
    const schema = zodToAnthropicInputSchema(
      z.object({ prompt: z.string().describe('image prompt text') }),
    );
    const prompt = schema.properties.prompt as Record<string, unknown>;
    expect(prompt.description).toBe('image prompt text');
  });

  it('throws when root is not a ZodObject', () => {
    expect(() => zodToAnthropicInputSchema(z.string())).toThrow(/must be a ZodObject/);
  });
});
