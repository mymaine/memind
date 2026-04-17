import { z, type ZodTypeAny } from 'zod';
import type { AnyAgentTool } from '@hack-fourmeme/shared';

/**
 * Anthropic Tool shape (subset). Mirrors `Anthropic.Messages.Tool` from the SDK,
 * kept local so the registry does not import SDK types directly.
 */
export interface AnthropicToolShape {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/**
 * In-memory tool registry shared by every agent runtime in the process.
 *
 * - `register(tool)` throws on duplicate names (fail-fast; duplicates are almost
 *   always a wiring bug).
 * - `get(name)` throws when missing so callers never silently dispatch to a
 *   noop tool.
 * - `toAnthropicTools()` converts registered tools into the shape Anthropic's
 *   `messages.create` expects. We hand-convert zod schemas to JSON Schema to
 *   avoid pulling in `zod-to-json-schema` as a new dependency.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyAgentTool>();

  register(tool: AnyAgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry: duplicate tool name "${tool.name}"`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyAgentTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`ToolRegistry: unknown tool "${name}"`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): AnyAgentTool[] {
    return Array.from(this.tools.values());
  }

  toAnthropicTools(): AnthropicToolShape[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToAnthropicInputSchema(tool.inputSchema),
    }));
  }
}

/**
 * Minimal zod -> JSON Schema converter scoped to tool input shapes.
 *
 * Supported: ZodObject of ZodString | ZodNumber | ZodBoolean | ZodEnum |
 * ZodArray | ZodOptional | nested ZodObject. Anything outside this set falls
 * back to `{}` so we never generate an invalid schema; richer coverage can be
 * added when a tool actually needs it.
 *
 * Why hand-written: the Anthropic SDK expects `type: 'object'` at the root for
 * every tool. Restricting inputs to that shape keeps the conversion tiny and
 * avoids a new dependency (`zod-to-json-schema`).
 */
export function zodToAnthropicInputSchema(schema: ZodTypeAny): AnthropicToolShape['input_schema'] {
  // Unwrap ZodEffects (e.g. from `.refine`) to reach the underlying object.
  const unwrapped = unwrapEffects(schema);
  if (!(unwrapped instanceof z.ZodObject)) {
    throw new Error(
      'ToolRegistry: tool inputSchema must be a ZodObject at the root (Anthropic requires type: object)',
    );
  }
  return zodObjectToSchema(unwrapped);
}

function unwrapEffects(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current._def.schema as ZodTypeAny;
  }
  return current;
}

function zodObjectToSchema(schema: z.ZodObject<z.ZodRawShape>): AnthropicToolShape['input_schema'] {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const key of Object.keys(shape)) {
    const field = shape[key];
    if (!field) continue;
    const { jsonSchema, isOptional } = zodFieldToJsonSchema(field);
    properties[key] = jsonSchema;
    if (!isOptional) required.push(key);
  }

  const result: AnthropicToolShape['input_schema'] = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) result.required = required;
  return result;
}

interface FieldConversion {
  jsonSchema: Record<string, unknown>;
  isOptional: boolean;
}

function zodFieldToJsonSchema(field: ZodTypeAny): FieldConversion {
  let isOptional = false;
  let current: ZodTypeAny = field;

  // Peel ZodOptional / ZodDefault / ZodNullable so we reach the actual type.
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
      isOptional = true;
    }
    current = current._def.innerType as ZodTypeAny;
  }

  const description = extractDescription(field);
  const jsonSchema = zodTypeToJsonSchema(current);
  if (description) jsonSchema.description = description;
  return { jsonSchema, isOptional };
}

function extractDescription(field: ZodTypeAny): string | undefined {
  const desc = field.description;
  return typeof desc === 'string' && desc.length > 0 ? desc : undefined;
}

function zodTypeToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const unwrapped = unwrapEffects(schema);

  if (unwrapped instanceof z.ZodString) return { type: 'string' };
  if (unwrapped instanceof z.ZodNumber) return { type: 'number' };
  if (unwrapped instanceof z.ZodBoolean) return { type: 'boolean' };
  if (unwrapped instanceof z.ZodEnum) {
    return { type: 'string', enum: [...(unwrapped._def.values as string[])] };
  }
  if (unwrapped instanceof z.ZodArray) {
    const inner = unwrapped._def.type as ZodTypeAny;
    return { type: 'array', items: zodTypeToJsonSchema(inner) };
  }
  if (unwrapped instanceof z.ZodObject) {
    return zodObjectToSchema(unwrapped);
  }
  if (unwrapped instanceof z.ZodLiteral) {
    const value = unwrapped._def.value as unknown;
    const jsonType =
      typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
    return { type: jsonType, const: value };
  }
  if (unwrapped instanceof z.ZodUnion) {
    const options = unwrapped._def.options as ZodTypeAny[];
    return { anyOf: options.map((opt) => zodTypeToJsonSchema(opt)) };
  }
  // Fallback: accept anything. LLM will see no constraint but we stay valid.
  return {};
}
