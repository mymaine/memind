import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool } from '@hack-fourmeme/shared';
import {
  createPostShillForTool,
  postShillForInputSchema,
  postShillForOutputSchema,
} from './post-shill-for.js';
import type { AnthropicMessagesClient } from './_anthropic.js';
import type { XPostInput, XPostOutput } from './x-post.js';

/**
 * post_shill_for tests
 * --------------------
 * Same injection pattern as narrative.test.ts: a `mockAnthropic` helper
 * stubs `messages.create`, and a `stubPostToXTool` helper stands in for
 * the real OAuth-signing x-post tool so this suite never touches the
 * network. All tweet text is provided verbatim by the stub so we can
 * drive the guard/retry branches deterministically.
 */

/**
 * Build a fake Anthropic client whose `messages.create` resolves to a
 * sequence of responses (one per call). Also exposes `spy` so tests can
 * assert how many times it was called and with what arguments. Each entry
 * is either a plain string (treated as `end_turn`) or an object giving
 * explicit text + stop_reason so tests can drive the truncation branch.
 */
type MockResponse = string | { text: string; stopReason: Anthropic.Message['stop_reason'] };

function mockAnthropicSequence(entries: MockResponse[]): {
  client: AnthropicMessagesClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn();
  for (const entry of entries) {
    const text = typeof entry === 'string' ? entry : entry.text;
    const stopReason = typeof entry === 'string' ? 'end_turn' : entry.stopReason;
    const message: Anthropic.Message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4-5',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    };
    spy.mockResolvedValueOnce(message);
  }
  const client: AnthropicMessagesClient = {
    messages: {
      create: spy as unknown as AnthropicMessagesClient['messages']['create'],
    },
  };
  return { client, spy };
}

interface StubPostToXOptions {
  tweetId?: string;
  url?: string;
  postedAt?: string;
  throwError?: Error;
}

/**
 * Fake `post_to_x` tool that records every `execute` input. Keeps the
 * suite independent of OAuth signing + X API surface.
 */
function stubPostToXTool(opts: StubPostToXOptions = {}): {
  tool: AgentTool<XPostInput, XPostOutput>;
  executeSpy: ReturnType<typeof vi.fn>;
} {
  const executeSpy = vi.fn(async (input: XPostInput): Promise<XPostOutput> => {
    if (opts.throwError !== undefined) throw opts.throwError;
    return {
      tweetId: opts.tweetId ?? '999',
      text: input.text,
      postedAt: opts.postedAt ?? '2026-04-19T00:00:00.000Z',
      url: opts.url ?? 'https://x.com/shiller/status/999',
    };
  });
  const tool: AgentTool<XPostInput, XPostOutput> = {
    name: 'post_to_x',
    description: 'stub',
    // `as unknown as` because we don't need the zod schemas in the stub.
    inputSchema: {} as unknown as AgentTool<XPostInput, XPostOutput>['inputSchema'],
    outputSchema: {} as unknown as AgentTool<XPostInput, XPostOutput>['outputSchema'],
    execute: executeSpy,
  };
  return { tool, executeSpy };
}

const VALID_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

describe('postShillForInputSchema', () => {
  it('accepts a valid input', () => {
    const result = postShillForInputSchema.safeParse({
      orderId: 'order_123',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'The bats rose from the cavern at dusk.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid tokenAddr', () => {
    const result = postShillForInputSchema.safeParse({
      orderId: 'order_123',
      tokenAddr: '0xnot-an-address',
      loreSnippet: 'some lore',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty loreSnippet', () => {
    const result = postShillForInputSchema.safeParse({
      orderId: 'order_123',
      tokenAddr: VALID_ADDR,
      loreSnippet: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tokenSymbol longer than 32 chars', () => {
    const result = postShillForInputSchema.safeParse({
      orderId: 'order_123',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'X'.repeat(33),
      loreSnippet: 'some lore',
    });
    expect(result.success).toBe(false);
  });

  it('accepts includeFourMemeUrl=true', () => {
    const result = postShillForInputSchema.safeParse({
      orderId: 'order_123',
      tokenAddr: VALID_ADDR,
      loreSnippet: 'some lore',
      includeFourMemeUrl: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts includeFourMemeUrl=false (default omitted)', () => {
    const result = postShillForInputSchema.safeParse({
      orderId: 'order_123',
      tokenAddr: VALID_ADDR,
      loreSnippet: 'some lore',
      includeFourMemeUrl: false,
    });
    expect(result.success).toBe(true);
  });
});

describe('postShillForOutputSchema', () => {
  it('rejects tweetText > 280 chars', () => {
    const result = postShillForOutputSchema.safeParse({
      orderId: 'o1',
      tokenAddr: VALID_ADDR,
      tweetId: '1',
      tweetUrl: 'https://x.com/a/status/1',
      tweetText: 'x'.repeat(281),
      postedAt: '2026-04-19T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('createPostShillForTool.execute', () => {
  it('happy path: clean tweet passes guard and is delegated to post_to_x', async () => {
    const cleanTweet =
      '$HBNB2026-BAT the cavern bats are back at dusk, and the lore reads like a fever dream. one to watch 👁';
    const { client, spy } = mockAnthropicSequence([cleanTweet]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool({
      tweetId: '777',
      url: 'https://x.com/shiller/status/777',
      postedAt: '2026-04-19T12:00:00.000Z',
    });

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    const out = await tool.execute({
      orderId: 'order_abc',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'The bats rose from the cavern at dusk.',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith({ text: cleanTweet });
    expect(out.orderId).toBe('order_abc');
    expect(out.tokenAddr).toBe(VALID_ADDR);
    expect(out.tweetId).toBe('777');
    expect(out.tweetUrl).toBe('https://x.com/shiller/status/777');
    expect(out.tweetText).toBe(cleanTweet);
    expect(out.postedAt).toBe('2026-04-19T12:00:00.000Z');
  });

  it('retries once when LLM emits a URL, then returns the clean retry', async () => {
    const dirty = '$BAT check bscscan.com/token/0xabc for details 🦇';
    const clean = '$HBNB2026-BAT cavern bats back at dusk. lore hits different 👁';
    const { client, spy } = mockAnthropicSequence([dirty, clean]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    const out = await tool.execute({
      orderId: 'order_retry_url',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'The bats rose from the cavern.',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    // Second call must carry the previous draft as an assistant message and
    // the trim/revise instruction as the new user message.
    const secondCallArgs = spy.mock.calls[1]?.[0] as
      | { system?: string; messages?: Array<{ role?: string; content?: string }> }
      | undefined;
    const secondMessages = secondCallArgs?.messages ?? [];
    const lastUserMsg = secondMessages[secondMessages.length - 1];
    expect(lastUserMsg?.role).toBe('user');
    expect(lastUserMsg?.content ?? '').toMatch(/trim|revise/i);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith({ text: clean });
    expect(out.tweetText).toBe(clean);
  });

  it('retries when LLM mentions "paid" (shill-intent leak)', async () => {
    const dirty = '$BAT I was paid to promote this, but it is genuinely cool 🦇';
    const clean = '$HBNB2026-BAT quietly curious about this one, lore feels rich 👁';
    const { client, spy } = mockAnthropicSequence([dirty, clean]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    const out = await tool.execute({
      orderId: 'order_retry_paid',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'The bats rose.',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(out.tweetText).toBe(clean);
  });

  it('throws when all five attempts violate the guard', async () => {
    // Five consecutive violating drafts exhaust MAX_ATTEMPTS. Mix violation
    // classes so we also exercise the non-length branch of the correction
    // helper (paid-intent + bscscan are guard-matched regardless of length).
    const drafts = [
      '$BAT check bscscan.com 🦇',
      '$BAT I was paid to post this 🦇',
      '$BAT bscscan.com has more 🦇',
      '$BAT was paid again 🦇',
      '$BAT bscscan once more 🦇',
    ];
    const { client, spy } = mockAnthropicSequence(drafts);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });

    await expect(
      tool.execute({
        orderId: 'order_exhausted',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      }),
    ).rejects.toThrow(/violated content guard after 5 attempts/);

    expect(spy).toHaveBeenCalledTimes(5);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('throws with length-class violation in the last error when all attempts overshoot', async () => {
    // Five consecutive over-length drafts exhaust MAX_ATTEMPTS on the
    // length branch specifically — belt-and-suspenders for the
    // correction helper's length-focused message.
    const overLength = '$BAT ' + 'a'.repeat(300);
    const drafts = Array.from({ length: 5 }, () => overLength);
    const { client, spy } = mockAnthropicSequence(drafts);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });

    await expect(
      tool.execute({
        orderId: 'order_overlen_exhausted',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      }),
    ).rejects.toThrow(/length>280/);

    expect(spy).toHaveBeenCalledTimes(5);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('retries when LLM exceeds 280 chars', async () => {
    const overLength = '$BAT ' + 'a'.repeat(300);
    const clean = '$HBNB2026-BAT concise dispatch from the cavern 👁';
    const { client, spy } = mockAnthropicSequence([overLength, clean]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    const out = await tool.execute({
      orderId: 'order_overlen',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'lore',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    // The second call must thread the previous over-length draft as an
    // assistant message — this is what lets the model "trim" instead of
    // rewriting from scratch.
    const secondCallArgs = spy.mock.calls[1]?.[0] as
      | { messages?: Array<{ role?: string; content?: string }> }
      | undefined;
    const messages = secondCallArgs?.messages ?? [];
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe(overLength);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(out.tweetText).toBe(clean);
  });

  it('works without tokenSymbol (falls back to inference from lore)', async () => {
    const clean = '$MYSTERY the cavern stirs, and the lore drops pay off 👁';
    const { client, spy } = mockAnthropicSequence([clean]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    const out = await tool.execute({
      orderId: 'order_no_symbol',
      tokenAddr: VALID_ADDR,
      loreSnippet: 'The bats rose, calling themselves MYSTERY.',
    });

    // User prompt should mention that the symbol is to be inferred from lore
    // when the caller omits it, so the LLM picks the right $TICKER.
    const firstCallArgs = spy.mock.calls[0]?.[0] as
      | { system?: string; messages?: Array<{ content?: string }> }
      | undefined;
    const systemPrompt = firstCallArgs?.system ?? '';
    const userContent = firstCallArgs?.messages?.[0]?.content ?? '';
    const combined = systemPrompt + '\n' + userContent;
    expect(combined).toMatch(/symbol from lore|infer/i);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(out.tweetText).toBe(clean);
  });

  it('propagates errors from the injected post_to_x tool', async () => {
    const clean = '$HBNB2026-BAT curious cavern find, lore hits 👁';
    const { client } = mockAnthropicSequence([clean]);
    const boom = new Error('X API returned 401 — auth failed');
    const { tool: postToXTool } = stubPostToXTool({ throwError: boom });

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    await expect(
      tool.execute({
        orderId: 'order_xpost_fail',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      }),
    ).rejects.toThrow(/401|auth failed/);
  });

  /**
   * Lock-in tests for the `\bpaid\b` guard's JavaScript-regex word-boundary
   * behaviour. A reviewer raised concern that `\bpaid\b` might false-match
   * on `unpaid`, `repaid`, `prepaid` (legitimate English where "paid" is a
   * substring). Per JS spec `\b` is the boundary between `\w` = [A-Za-z0-9_]
   * and non-`\w`, so inside `unpaid` the `n`→`p` transition is `\w`→`\w`
   * and `\b` does NOT match — the regex is safe. These tests nail that
   * behaviour down so a well-intentioned future refactor can't silently
   * regress (e.g. rewriting to `(?:^|[^a-z])paid` which DOES eat `unpaid`).
   */
  describe('paid-intent guard word boundary (lock-in)', () => {
    it('does not retry when LLM draft contains "unpaid" (substring, not whole word)', async () => {
      const draft = '$HBNB2026-BAT an unpaid thought: the cavern lore hits harder than expected 👁';
      const { client, spy } = mockAnthropicSequence([draft]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_unpaid',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      });

      // Single LLM call => guard passed => no retry triggered by "unpaid".
      expect(spy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(out.tweetText).toBe(draft);
    });

    it('does not retry when LLM draft contains "repaid" (substring, not whole word)', async () => {
      const draft = '$HBNB2026-BAT the cavern repaid its debt in strange echoes 👁';
      const { client, spy } = mockAnthropicSequence([draft]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_repaid',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(out.tweetText).toBe(draft);
    });

    it('does not retry when LLM draft contains "prepaid" (substring, not whole word)', async () => {
      const draft = '$HBNB2026-BAT a prepaid curiosity opens a door into the cavern 👁';
      const { client, spy } = mockAnthropicSequence([draft]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_prepaid',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(out.tweetText).toBe(draft);
    });

    it('DOES retry when LLM draft contains "paid" as a whole word', async () => {
      // Complement to the three above: the guard must still fire on the
      // actual violation — "paid" surrounded by word boundaries.
      const dirty = '$BAT being paid for this curious find, but lore is real 👁';
      const clean = '$HBNB2026-BAT a curious cavern find, lore stands on its own 👁';
      const { client, spy } = mockAnthropicSequence([dirty, clean]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_paid_whole',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      });

      expect(spy).toHaveBeenCalledTimes(2);
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(out.tweetText).toBe(clean);
    });
  });

  /**
   * 2026-04-19 X-API 7-day anti-spam cooldown toggle tests.
   *
   * Default (`includeFourMemeUrl=false`): tweet must NOT contain any URL or
   * raw crypto address — X blocks both for the first 7 days after OAuth
   * token regeneration. Hackathon demo-day falls inside that cooldown so
   * safe mode is the default.
   *
   * Opt-in (`includeFourMemeUrl=true`): the four.meme token URL is allowed
   * (and required by the prompt) at the tail; other explorer URLs stay
   * banned. Retained for post-cooldown click-through campaigns.
   */
  describe('includeFourMemeUrl toggle', () => {
    it('includeFourMemeUrl=true: four.meme URL + raw address both pass the guard', async () => {
      const clean =
        '$HBNB2026-BAT cavern bats at dusk, lore hits 👁 https://four.meme/token/' + VALID_ADDR;
      const { client, spy } = mockAnthropicSequence([clean]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_with_url',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'The bats rose from the cavern.',
        includeFourMemeUrl: true,
      });

      // System prompt must steer the LLM to include the four.meme URL.
      const firstCallArgs = spy.mock.calls[0]?.[0] as { system?: string } | undefined;
      expect(firstCallArgs?.system ?? '').toMatch(/four\.meme\/token/i);
      // Guard accepts the URL + address, no retry, posts the tweet verbatim.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith({ text: clean });
      expect(out.tweetText).toBe(clean);
    });

    it('includeFourMemeUrl=false (default): URL in first draft triggers retry', async () => {
      // First draft has a URL (banned in safe mode) → retry produces
      // a URL-free / address-free body and the tool posts that.
      const dirty = '$HBNB2026-BAT visit https://four.meme/token/' + VALID_ADDR + ' for more 👁';
      const clean = '$HBNB2026-BAT cavern bats back at dusk. lore hits different 👁';
      const { client, spy } = mockAnthropicSequence([dirty, clean]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_safe_url_retry',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'The bats rose from the cavern.',
        // includeFourMemeUrl omitted ⇒ default false (safe mode).
      });

      expect(spy).toHaveBeenCalledTimes(2);
      // Retry must reuse the multi-turn correction shape: previous draft as
      // assistant message + trim/revise instruction as the new user message.
      const secondCallArgs = spy.mock.calls[1]?.[0] as
        | { messages?: Array<{ role?: string; content?: string }> }
        | undefined;
      const lastUserMsg = secondCallArgs?.messages?.[secondCallArgs.messages.length - 1];
      expect(lastUserMsg?.role).toBe('user');
      expect(lastUserMsg?.content ?? '').toMatch(/trim|revise/i);
      expect(executeSpy).toHaveBeenCalledWith({ text: clean });
      expect(out.tweetText).toBe(clean);
    });

    it('includeFourMemeUrl=false: raw 0x…40-hex address triggers retry', async () => {
      // Safe mode blocks the raw crypto address too — X's cooldown catches
      // bare hex addresses regardless of URL wrapping.
      const dirty = '$HBNB2026-BAT contract ' + VALID_ADDR + ' curious find 👁';
      const clean = '$HBNB2026-BAT curious cavern find, lore stands on its own 👁';
      const { client, spy } = mockAnthropicSequence([dirty, clean]);
      const { tool: postToXTool, executeSpy } = stubPostToXTool();

      const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
      const out = await tool.execute({
        orderId: 'order_safe_addr_retry',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
        includeFourMemeUrl: false,
      });

      expect(spy).toHaveBeenCalledTimes(2);
      expect(executeSpy).toHaveBeenCalledWith({ text: clean });
      expect(out.tweetText).toBe(clean);
    });
  });

  it('rejects invalid input via zod before any LLM call', async () => {
    const { client, spy } = mockAnthropicSequence(['unused']);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    await expect(
      tool.execute({
        orderId: 'o1',
        tokenAddr: '0xbad',
        loreSnippet: 'lore',
      } as unknown as Parameters<typeof tool.execute>[0]),
    ).rejects.toThrow();

    expect(spy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  /**
   * Messages-API lever tests covering the 2026-04-21 convergence rewrite:
   *   1. tight max_tokens (physical length cap)
   *   2. stop_reason=max_tokens surfaced as a "truncated" violation
   *   3. multi-turn correction (accumulate assistant + user pairs)
   *   4. trim prompt carries actual overshoot numbers
   */
  it('max_tokens default is 90', async () => {
    const clean = '$HBNB2026-BAT cavern at dusk, lore hits 👁';
    const { client, spy } = mockAnthropicSequence([clean]);
    const { tool: postToXTool } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    await tool.execute({
      orderId: 'order_max_tokens_default',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'lore',
    });

    const firstCallArgs = spy.mock.calls[0]?.[0] as { max_tokens?: number } | undefined;
    expect(firstCallArgs?.max_tokens).toBe(90);
  });

  it('treats stop_reason=max_tokens as truncation violation and retries', async () => {
    // Short text that clears every regex + length guard, but stop_reason
    // signals the model ran out of token budget mid-sentence. The tool
    // must still treat it as a violation ("truncated") and retry.
    const truncated = '$BAT curious about the cavern tha';
    const clean = '$HBNB2026-BAT cavern bats at dusk, lore hits 👁';
    const { client, spy } = mockAnthropicSequence([
      { text: truncated, stopReason: 'max_tokens' },
      clean,
    ]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    const out = await tool.execute({
      orderId: 'order_truncated',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'lore',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    const secondCallArgs = spy.mock.calls[1]?.[0] as
      | { messages?: Array<{ role?: string; content?: string }> }
      | undefined;
    const lastUserMsg = secondCallArgs?.messages?.[secondCallArgs.messages.length - 1];
    expect(lastUserMsg?.content ?? '').toMatch(/truncat/i);
    expect(executeSpy).toHaveBeenCalledWith({ text: clean });
    expect(out.tweetText).toBe(clean);
  });

  it('multi-turn correction: second call carries previous draft as assistant message', async () => {
    const overLength = '$BAT ' + 'x'.repeat(300);
    const clean = '$HBNB2026-BAT tight dispatch from the cavern 👁';
    const { client, spy } = mockAnthropicSequence([overLength, clean]);
    const { tool: postToXTool } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    await tool.execute({
      orderId: 'order_multi_turn',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'lore',
    });

    const secondCallArgs = spy.mock.calls[1]?.[0] as
      | { messages?: Array<{ role?: string; content?: string }> }
      | undefined;
    const messages = secondCallArgs?.messages ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.content).toBe(overLength);
    expect(messages[2]?.role).toBe('user');
  });

  it('multi-turn correction: third call accumulates both prior drafts in history', async () => {
    // Two consecutive violating drafts, then a clean one — the 3rd call's
    // messages array must include BOTH prior assistant drafts to prove
    // history accumulates across rounds instead of being replaced.
    const bad1 = '$BAT ' + 'a'.repeat(300);
    const bad2 = '$BAT ' + 'b'.repeat(300);
    const clean = '$HBNB2026-BAT tight dispatch 👁';
    const { client, spy } = mockAnthropicSequence([bad1, bad2, clean]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    await tool.execute({
      orderId: 'order_accumulate',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'lore',
    });

    expect(spy).toHaveBeenCalledTimes(3);
    const thirdCallArgs = spy.mock.calls[2]?.[0] as
      | { messages?: Array<{ role?: string; content?: string }> }
      | undefined;
    const messages = thirdCallArgs?.messages ?? [];
    // Round 3 structure: user(initial) + assistant(bad1) + user(correction1)
    //                 + assistant(bad2) + user(correction2) = 5 messages
    expect(messages).toHaveLength(5);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.content).toBe(bad1);
    expect(messages[2]?.role).toBe('user');
    expect(messages[3]?.role).toBe('assistant');
    expect(messages[3]?.content).toBe(bad2);
    expect(messages[4]?.role).toBe('user');
    expect(executeSpy).toHaveBeenCalledWith({ text: clean });
  });

  it('multi-turn correction: trim prompt mentions actual char count and overshoot', async () => {
    // 312 chars total ⇒ 32 over the 280 hard cap. The trim instruction
    // must surface both numbers so the model knows the exact delta.
    const overshoot = '$BAT ' + 'y'.repeat(307); // 5 + 307 = 312 chars
    expect(overshoot.length).toBe(312);
    const clean = '$HBNB2026-BAT tight 312-char lesson learned 👁';
    const { client, spy } = mockAnthropicSequence([overshoot, clean]);
    const { tool: postToXTool } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });
    await tool.execute({
      orderId: 'order_overshoot_numbers',
      tokenAddr: VALID_ADDR,
      tokenSymbol: 'HBNB2026-BAT',
      loreSnippet: 'lore',
    });

    const secondCallArgs = spy.mock.calls[1]?.[0] as
      | { messages?: Array<{ role?: string; content?: string }> }
      | undefined;
    const lastUserMsg = secondCallArgs?.messages?.[secondCallArgs.messages.length - 1];
    const content = lastUserMsg?.content ?? '';
    expect(content).toContain('312');
    expect(content).toContain('32 over');
  });
});
