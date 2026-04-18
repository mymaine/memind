import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';
import { type AnthropicMessagesClient, extractText } from './_anthropic.js';
import type { XPostInput, XPostOutput } from './x-post.js';

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

// -------------------- content guard ----------------------------------------

/**
 * Guard patterns applied to every LLM draft. A single match is sufficient
 * to trigger retry.
 *
 * Notes on what's NOT here:
 *   - `\bad\b`: excluded deliberately. Word-boundary `\bad\b` is safe for
 *     the exact word "ad", but false-positive risk from "already", "ahead",
 *     "adapted" vanishes under `\b` boundary — however, even with correct
 *     boundaries, "ad" is borderline for an organic tweet and the signal-
 *     to-noise is weak in a 250-char budget. Keeping the guard tight to
 *     strong violators ("paid", "sponsored", "promotion", "hired", "shill")
 *     avoids drowning real drafts in false retries during the hackathon.
 *   - URL/domain patterns ("http://", "www.", "bscscan") are matched as raw
 *     substrings; word boundaries would miss "bscscan.com/token" which is
 *     exactly what we want to block.
 */
interface GuardPattern {
  label: string;
  pattern: RegExp;
}

const GUARD_PATTERNS: GuardPattern[] = [
  // URL / domain blocks — raw substring, case-insensitive.
  { label: 'http://', pattern: /http:\/\//i },
  { label: 'https://', pattern: /https:\/\//i },
  { label: 'www.', pattern: /www\./i },
  { label: 'bscscan', pattern: /bscscan/i },
  { label: 'four.meme', pattern: /four\.meme/i },
  { label: 'base-sepolia', pattern: /base-sepolia/i },
  // Paid-intent leak words — word-boundary so common substrings pass.
  { label: 'paid', pattern: /\bpaid\b/i },
  { label: 'sponsored', pattern: /\bsponsored\b/i },
  { label: 'promotion', pattern: /\bpromotion\b/i },
  { label: 'hired', pattern: /\bhired\b/i },
  { label: 'shill', pattern: /\bshill\b/i },
];

const TWEET_HARD_CAP = 280;

interface GuardResult {
  ok: boolean;
  violations: string[];
}

function checkGuard(tweet: string): GuardResult {
  const violations: string[] = [];
  for (const { label, pattern } of GUARD_PATTERNS) {
    if (pattern.test(tweet)) violations.push(label);
  }
  if (tweet.length > TWEET_HARD_CAP) {
    violations.push(`length>${String(TWEET_HARD_CAP)}`);
  }
  return { ok: violations.length === 0, violations };
}

// -------------------- prompt builders --------------------------------------

const BASE_RULES = `You are a promotional agent. A creator has paid you to shill their token on your X account. Read the lore below and write ONE tweet.

Rules (all MANDATORY):
- Output the tweet text ONLY. No preamble, no JSON, no markdown fences.
- Length <= 250 characters (hard cap, count before emoji expansion).
- Lead with the $SYMBOL, not a URL.
- Do NOT include http:// or https:// or www. or any URL (URLs trigger $0.20 surcharge + spam flags).
- Do NOT mention bscscan, four.meme, base-sepolia, or any block explorer.
- Do NOT write the words "paid", "sponsored", "promotion", "hired", or "shill" anywhere.
- Vary emoji + hashtag usage (boilerplate "check this out" drives X spam detection).
- Write in the voice of a curious reader who just discovered the project.
- Never mention that you were paid, sponsored, or hired to post.

Output: tweet text only.`;

function buildSystemPrompt(previousViolations: string[] | null): string {
  if (previousViolations === null || previousViolations.length === 0) {
    return BASE_RULES;
  }
  // Inject the violation list so the model can self-correct on the retry.
  const violationList = previousViolations.join(', ');
  return `${BASE_RULES}

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
      const userPrompt = buildUserPrompt(parsed);

      let lastViolations: string[] = [];
      let tweetText: string | null = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const system = buildSystemPrompt(attempt === 0 ? null : lastViolations);

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
        const guard = checkGuard(candidate);
        if (guard.ok) {
          tweetText = candidate;
          break;
        }
        lastViolations = guard.violations;
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
