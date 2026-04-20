import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';
import { type AnthropicMessagesClient, extractText } from './_anthropic.js';
import type { XPostInput, XPostOutput } from './x-post.js';
import { BASE_RULES_NO_URL, BASE_RULES_WITH_URL, checkTweetGuard } from './tweet-guard.js';

/**
 * post_shill_for — paid-shill tweet generator.
 *
 * Flow: LLM drafts one tweet → post-generation regex guard → on violation,
 * retry the LLM once with the violation list injected into the system prompt
 * → on pass, delegate the OAuth 1.0a post to an injected `post_to_x` tool.
 *
 * Why delegate posting instead of re-implementing signing:
 *   OAuth 1.0a signing is intricate (RFC 3986 percent-encoding, sorted base
 *   string, HMAC-SHA1 retry with fresh nonce) and already lives in
 *   `x-post.ts`. Duplicating it here would double the audit surface and
 *   drift risk. Dependency-injecting the tool honours SOLID (single
 *   responsibility — this file owns text generation + safety; x-post.ts
 *   owns signing + transport) and keeps this module free of `node:crypto`.
 *
 * Why only one retry (not N):
 *   Each LLM round is ~2s + $. Two total attempts gives the model one
 *   chance to self-correct with explicit violation feedback, which is
 *   enough in practice. Beyond that, failures are usually a persistent
 *   prompt or model issue that more retries cannot fix — we'd rather the
 *   caller (ShillOrderStore.markFailed) surface the problem than silently
 *   burn credits.
 */

// -------------------- schemas ----------------------------------------------

export const postShillForInputSchema = z.object({
  orderId: z.string().min(1),
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // Symbol **including** the `HBNB2026-` prefix (e.g. `HBNB2026-BAT`).
  // Optional because some callers only have the lore snippet handy; when
  // omitted the LLM is instructed to infer the symbol from the lore.
  tokenSymbol: z.string().min(1).max(32).optional(),
  // Latest lore chapter — the LLM grounds the tweet in this text.
  loreSnippet: z.string().min(1).max(4000),
  /**
   * Cross-cutting toggle (added 2026-04-19) that flips the prompt + guard
   * between two modes:
   *   - `false` (default, "safe mode"): body-only tweet — no URL, no raw
   *     `0x…40-hex` crypto address. Required for the first 7 days after
   *     X OAuth token regeneration; X's 2026 anti-spam rail blocks any
   *     crypto-address-bearing post during that cooldown window.
   *   - `true` ("with URL"): appends the four.meme token URL so readers
   *     land on the sponsor page. Works outside the 7-day cooldown.
   * The UI surface (OrderPanel) and orchestrator layers thread this flag
   * end-to-end so the hackathon demo can record a live post during
   * cooldown while still showcasing the URL-bearing click-through path.
   */
  includeFourMemeUrl: z.boolean().optional(),
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

// -------------------- options ----------------------------------------------

export interface CreatePostShillForToolOptions {
  anthropicClient: AnthropicMessagesClient;
  model?: string;
  maxTokens?: number;
  // Inject the post_to_x tool (or any compatible AgentTool) — keeps OAuth
  // signing responsibility inside x-post.ts and honours SOLID dep inversion.
  postToXTool: AgentTool<XPostInput, XPostOutput>;
}

// -------------------- prompt builders --------------------------------------
//
// Guard patterns, prompt-rule fragments, and the 280-char cap live in
// ./tweet-guard.ts — three tweet-emitting surfaces share the same contract.
// Here we just wrap the imported rule blocks with the paid-shill persona
// preamble and the optional retry-feedback footer.

const PERSONA_PREAMBLE =
  'You are a promotional agent. A creator has paid you to shill their token on your X account. Read the lore below and write ONE tweet.';

function buildSystemPrompt(
  includeFourMemeUrl: boolean,
  previousViolations: string[] | null,
): string {
  const rules = includeFourMemeUrl ? BASE_RULES_WITH_URL : BASE_RULES_NO_URL;
  const base = `${PERSONA_PREAMBLE}\n\n${rules}\n\nOutput: tweet text only.`;
  if (previousViolations === null || previousViolations.length === 0) {
    return base;
  }
  // Inject the violation list so the model can self-correct on the retry.
  const violationList = previousViolations.join(', ');
  return `${base}

Your previous draft violated these rules: ${violationList}. Rewrite from scratch, strictly obeying all rules above.`;
}

function buildUserPrompt(input: PostShillForInput): string {
  // When `tokenSymbol` is provided we give it explicitly; otherwise we
  // instruct the LLM to pull the ticker from the lore itself — callers
  // sometimes only have the lore snippet in hand.
  const symbolLine =
    input.tokenSymbol !== undefined && input.tokenSymbol !== ''
      ? `TOKEN: ${input.tokenSymbol}`
      : 'TOKEN: (infer the symbol from lore)';
  return `${symbolLine}
ADDRESS: ${input.tokenAddr}
LORE:
${input.loreSnippet}

Write the tweet now.`;
}

// -------------------- factory ----------------------------------------------

const MAX_ATTEMPTS = 2;

export function createPostShillForTool(
  opts: CreatePostShillForToolOptions,
): AgentTool<PostShillForInput, PostShillForOutput> {
  const model = opts.model ?? 'anthropic/claude-sonnet-4-5';
  // Tweets are short — default token budget stays tight so a malformed
  // model doesn't ramble on our dime.
  const maxTokens = opts.maxTokens ?? 256;

  return {
    name: 'post_shill_for',
    description:
      'Generate a promotional tweet for a creator-paid shill order and post it from the Shiller ' +
      'X account. Input: { orderId, tokenAddr, tokenSymbol?, loreSnippet }. Output: { orderId, ' +
      'tokenAddr, tweetId, tweetUrl, tweetText, postedAt }. Runs a regex guard to reject drafts ' +
      'that leak "paid/sponsored", embed URLs, or exceed 280 chars; retries once on violation. ' +
      'Delegates OAuth 1.0a posting to the injected post_to_x tool.',
    inputSchema: postShillForInputSchema,
    outputSchema: postShillForOutputSchema,
    async execute(input): Promise<PostShillForOutput> {
      const parsed = postShillForInputSchema.parse(input);
      // Default to safe mode (no URL) when the caller omits the flag — the
      // hackathon demo window overlaps X's 7-day post-OAuth cooldown.
      const includeFourMemeUrl = parsed.includeFourMemeUrl ?? false;
      const userPrompt = buildUserPrompt(parsed);

      let lastViolations: string[] = [];
      let tweetText: string | null = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const system = buildSystemPrompt(includeFourMemeUrl, attempt === 0 ? null : lastViolations);

        const response = await opts.anthropicClient.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: userPrompt }],
        });

        if (!('content' in response)) {
          throw new Error('post_shill_for: expected non-streaming Message response');
        }

        const candidate = extractText(response).trim();
        const guard = checkTweetGuard(candidate, { includeFourMemeUrl });
        if (guard.ok) {
          tweetText = candidate;
          break;
        }
        lastViolations = [...guard.violations];
      }

      if (tweetText === null) {
        const lastLabel = lastViolations.join(', ');
        throw new Error(
          `post_shill_for: generated tweet violated content guard after ${String(MAX_ATTEMPTS)} attempts (last violation: ${lastLabel})`,
        );
      }

      // Delegate OAuth posting to the injected tool. Errors from the
      // downstream tool propagate untouched — ShillOrderStore.markFailed
      // expects the original message for observability.
      const posted = await opts.postToXTool.execute({ text: tweetText });

      return postShillForOutputSchema.parse({
        orderId: parsed.orderId,
        tokenAddr: parsed.tokenAddr,
        tweetId: posted.tweetId,
        tweetUrl: posted.url,
        tweetText,
        postedAt: posted.postedAt,
      });
    },
  };
}
