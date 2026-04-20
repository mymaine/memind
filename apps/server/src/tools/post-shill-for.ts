import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';
import type Anthropic from '@anthropic-ai/sdk';
import { type AnthropicMessagesClient, extractText } from './_anthropic.js';
import type { XPostInput, XPostOutput } from './x-post.js';
import {
  BASE_RULES_NO_URL,
  BASE_RULES_WITH_URL,
  TWEET_HARD_CAP,
  checkTweetGuard,
} from './tweet-guard.js';

/**
 * post_shill_for — paid-shill tweet generator.
 *
 * Flow: LLM drafts one tweet → post-generation regex guard → on violation,
 * feed the draft back as an assistant message and ask the model to trim
 * (or revise) the existing text; repeat up to MAX_ATTEMPTS. On pass,
 * delegate the OAuth 1.0a post to an injected `post_to_x` tool.
 *
 * Why delegate posting instead of re-implementing signing:
 *   OAuth 1.0a signing is intricate (RFC 3986 percent-encoding, sorted base
 *   string, HMAC-SHA1 retry with fresh nonce) and already lives in
 *   `x-post.ts`. Duplicating it here would double the audit surface and
 *   drift risk. Dependency-injecting the tool honours SOLID (single
 *   responsibility — this file owns text generation + safety; x-post.ts
 *   owns signing + transport) and keeps this module free of `node:crypto`.
 *
 * Why multi-turn correction (not rewrite-from-scratch):
 *   An over-length or URL-bearing draft is usually "almost right" — the
 *   model just needs to shorten or swap a clause. Passing the bad draft
 *   back as an assistant message and asking for a trim preserves the
 *   good parts and converges in 1-2 more rounds. Rewriting from scratch
 *   via system-prompt feedback discards that state and often regresses
 *   on the same rule a second time.
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
// preamble.

const PERSONA_PREAMBLE =
  'You are a promotional agent. A creator has paid you to shill their token on your X account. Read the lore below and write ONE tweet.';

// Target length used in trim instructions — leaves headroom under the 280
// hard cap so a single extra emoji does not re-trip the guard.
const TARGET_CHAR_CAP = 250;

function buildSystemPrompt(includeFourMemeUrl: boolean): string {
  const rules = includeFourMemeUrl ? BASE_RULES_WITH_URL : BASE_RULES_NO_URL;
  return `${PERSONA_PREAMBLE}\n\n${rules}\n\nOutput: tweet text only.`;
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

/**
 * Build the follow-up user message that asks the model to trim or revise
 * the previous draft. The previous draft itself is threaded as an
 * assistant message by the caller — this helper only produces the new
 * user-side instruction.
 *
 * Three branches:
 *   - length overshoot: explicit char-count + overshoot number + "trim"
 *   - truncated (stop_reason=max_tokens): ask for a complete, tighter rewrite
 *   - other guard labels only: "revise" the existing draft (do not trim)
 */
function buildCorrectionPrompt(previousDraft: string, violations: readonly string[]): string {
  const length = previousDraft.length;
  const lengthLabel = `length>${String(TWEET_HARD_CAP)}`;
  const hasLength = violations.includes(lengthLabel);
  const hasTruncated = violations.includes('truncated');
  const otherViolations = violations.filter((v) => v !== lengthLabel && v !== 'truncated');
  const otherList = otherViolations.length > 0 ? otherViolations.join(', ') : 'none';

  if (hasTruncated) {
    // Truncation and length overshoot can co-occur: the model overshot the
    // 280 cap AND got cut off by max_tokens. Surface both numbers so the
    // correction is grounded in the hard signal instead of just "you were cut".
    const overshoot = hasLength ? length - TWEET_HARD_CAP : 0;
    const lengthHint = hasLength
      ? ` The draft also ran ${String(overshoot)} chars over the ${String(TWEET_HARD_CAP)} cap before being cut.`
      : '';
    return `Your previous draft was truncated mid-sentence by the token limit (${String(length)} chars before cutoff).${lengthHint} Violations: ${otherList}. Rewrite as a complete, tighter tweet <= ${String(TARGET_CHAR_CAP)} characters while keeping the core hook and $SYMBOL. Do NOT leave a sentence unfinished.`;
  }

  if (hasLength) {
    const overshoot = length - TWEET_HARD_CAP;
    return `Your draft is ${String(length)} characters (${String(overshoot)} over the ${String(TWEET_HARD_CAP)} cap). Violations: ${violations.join(', ')}. Trim the tweet above to <= ${String(TARGET_CHAR_CAP)} characters while keeping the core hook and $SYMBOL. Do NOT rewrite from scratch — shorten the existing draft.`;
  }

  return `Your draft violated these rules: ${otherList}. Revise the tweet above to remove those violations while keeping the core hook and $SYMBOL, length <= ${String(TARGET_CHAR_CAP)} characters. Do NOT rewrite from scratch — edit the existing draft.`;
}

// -------------------- factory ----------------------------------------------

// Five rounds: one initial draft + up to four trim/revise corrections. Each
// round is ~2s + $, but trimming converges fast in practice and we'd rather
// spend four rounds on a recoverable draft than fail the whole order.
const MAX_ATTEMPTS = 5;

export function createPostShillForTool(
  opts: CreatePostShillForToolOptions,
): AgentTool<PostShillForInput, PostShillForOutput> {
  const model = opts.model ?? 'anthropic/claude-sonnet-4-5';
  // 280 chars ≈ 70-90 tokens; give the model just enough headroom to finish
  // a tight single-line tweet so it physically cannot ramble off-spec.
  const maxTokens = opts.maxTokens ?? 90;

  return {
    name: 'post_shill_for',
    description:
      'Generate a promotional tweet for a creator-paid shill order and post it from the Shiller ' +
      'X account. Input: { orderId, tokenAddr, tokenSymbol?, loreSnippet }. Output: { orderId, ' +
      'tokenAddr, tweetId, tweetUrl, tweetText, postedAt }. Runs a regex guard to reject drafts ' +
      'that leak "paid/sponsored", embed URLs, or exceed 280 chars; retries via multi-turn trim ' +
      'on violation. Delegates OAuth 1.0a posting to the injected post_to_x tool.',
    inputSchema: postShillForInputSchema,
    outputSchema: postShillForOutputSchema,
    async execute(input): Promise<PostShillForOutput> {
      const parsed = postShillForInputSchema.parse(input);
      // Default to safe mode (no URL) when the caller omits the flag — the
      // hackathon demo window overlaps X's 7-day post-OAuth cooldown.
      const includeFourMemeUrl = parsed.includeFourMemeUrl ?? false;
      const userPrompt = buildUserPrompt(parsed);
      const system = buildSystemPrompt(includeFourMemeUrl);

      // Accumulate the full conversation so the model sees previous drafts
      // when asked to trim. System prompt is sent once per call (unchanged).
      // Context grows O(MAX_ATTEMPTS × 280 chars) — safe at 5 rounds, re-evaluate
      // before raising the ceiling.
      type MsgParam = { role: 'user' | 'assistant'; content: string };
      const messages: MsgParam[] = [{ role: 'user', content: userPrompt }];

      let lastViolations: string[] = [];
      let tweetText: string | null = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const response = (await opts.anthropicClient.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
        })) as Anthropic.Message;

        if (!('content' in response)) {
          throw new Error('post_shill_for: expected non-streaming Message response');
        }

        const candidate = extractText(response).trim();
        const guard = checkTweetGuard(candidate, { includeFourMemeUrl });
        const violations: string[] = [...guard.violations];
        // A max_tokens stop is a truncation signal even when regex guards
        // pass — the draft is likely a half-sentence.
        if (response.stop_reason === 'max_tokens') {
          violations.push('truncated');
        }

        if (violations.length === 0) {
          tweetText = candidate;
          break;
        }

        lastViolations = violations;
        // Thread the bad draft as an assistant turn, then append the
        // correction instruction. Next iteration sees the full history.
        messages.push({ role: 'assistant', content: candidate });
        messages.push({ role: 'user', content: buildCorrectionPrompt(candidate, violations) });
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
