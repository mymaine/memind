import type { z } from 'zod';

export interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute(input: TInput): Promise<TOutput>;
}

export type AnyAgentTool = AgentTool<unknown, unknown>;
