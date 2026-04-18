import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';
import type { AnthropicMessagesClient } from './_anthropic.js';
import type { XPostInput, XPostOutput } from './x-post.js';

/**
 * post_shill_for — paid-shill tweet generator.
 *
 * Flow: LLM writes a promo tweet → regex guard (URLs / paid-keyword / length)
 * → retry once on violation → delegate OAuth 1.0a post to an injected
 * `post_to_x` tool. OAuth signing lives in `x-post.ts`; this file never
 * touches crypto so the two concerns stay decoupled.
 */

export const postShillForInputSchema = z.object({
  orderId: z.string().min(1),
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenSymbol: z.string().min(1).max(32).optional(),
  loreSnippet: z.string().min(1).max(4000),
});
export type PostShillForInput = z.infer<typeof postShillForInputSchema>;

export const postShillForOutputSchema = z.object({
  orderId: z.string().min(1),
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tweetId: z.string().min(1),
  tweetUrl: z.string().url(),
  tweetText: z.string().min(1).max(280),
  postedAt: z.string().datetime(),
});
export type PostShillForOutput = z.infer<typeof postShillForOutputSchema>;

export interface CreatePostShillForToolOptions {
  anthropicClient: AnthropicMessagesClient;
  model?: string;
  maxTokens?: number;
  postToXTool: AgentTool<XPostInput, XPostOutput>;
}

export function createPostShillForTool(
  _opts: CreatePostShillForToolOptions,
): AgentTool<PostShillForInput, PostShillForOutput> {
  throw new Error('post_shill_for: not implemented');
}
