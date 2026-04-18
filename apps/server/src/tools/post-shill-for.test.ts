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
 * assert how many times it was called and with what arguments.
 */
function mockAnthropicSequence(texts: string[]): {
  client: AnthropicMessagesClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn();
  for (const text of texts) {
    const message: Anthropic.Message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'anthropic/claude-sonnet-4-5',
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
    // Second call must feed the LLM the violation hint so it can self-correct.
    const secondCallArgs = spy.mock.calls[1]?.[0] as { system?: string } | undefined;
    expect(secondCallArgs?.system).toMatch(/violated these rules/i);
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

  it('throws when both attempts violate the guard', async () => {
    const dirty1 = '$BAT check bscscan.com 🦇';
    const dirty2 = '$BAT visit https://four.meme/token 🦇';
    const { client, spy } = mockAnthropicSequence([dirty1, dirty2]);
    const { tool: postToXTool, executeSpy } = stubPostToXTool();

    const tool = createPostShillForTool({ anthropicClient: client, postToXTool });

    await expect(
      tool.execute({
        orderId: 'order_exhausted',
        tokenAddr: VALID_ADDR,
        tokenSymbol: 'HBNB2026-BAT',
        loreSnippet: 'lore',
      }),
    ).rejects.toThrow(/violated content guard after 2 attempts/);

    expect(spy).toHaveBeenCalledTimes(2);
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
});
