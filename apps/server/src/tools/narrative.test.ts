import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createNarrativeTool, narrativeInputSchema, narrativeOutputSchema } from './narrative.js';
import type { AnthropicMessagesClient } from './_anthropic.js';

/**
 * Build a fake Anthropic client whose `messages.create` resolves to a Message
 * containing a single text block with `text`. Satisfies the minimal surface
 * defined by `AnthropicMessagesClient`.
 */
function mockAnthropic(text: string): AnthropicMessagesClient {
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
  return {
    messages: {
      // `create` is heavily overloaded — asserting through `unknown` keeps us
      // honest while still exercising the real contract.
      create: vi
        .fn()
        .mockResolvedValue(message) as unknown as AnthropicMessagesClient['messages']['create'],
    },
  };
}

describe('narrativeInputSchema', () => {
  it('accepts a reasonable theme', () => {
    expect(narrativeInputSchema.safeParse({ theme: 'cat astronaut apocalypse' }).success).toBe(
      true,
    );
  });

  it('rejects a theme shorter than 3 chars', () => {
    expect(narrativeInputSchema.safeParse({ theme: 'hi' }).success).toBe(false);
  });

  it('rejects a theme longer than 280 chars', () => {
    expect(narrativeInputSchema.safeParse({ theme: 'x'.repeat(281) }).success).toBe(false);
  });
});

describe('narrativeOutputSchema', () => {
  it('rejects a name without the HBNB2026- prefix', () => {
    const result = narrativeOutputSchema.safeParse({
      name: 'CatCoin',
      symbol: 'HBNB2026-CAT',
      description: 'a coin about cats',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a symbol without the HBNB2026- prefix', () => {
    const result = narrativeOutputSchema.safeParse({
      name: 'HBNB2026-CatCoin',
      symbol: 'CAT',
      description: 'a coin about cats',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a symbol suffix with lowercase letters', () => {
    const result = narrativeOutputSchema.safeParse({
      name: 'HBNB2026-CatCoin',
      symbol: 'HBNB2026-cat',
      description: 'a coin about cats',
    });
    expect(result.success).toBe(false);
  });
});

describe('createNarrativeTool.execute', () => {
  it('returns structured output when Claude returns clean JSON', async () => {
    const client = mockAnthropic(
      JSON.stringify({
        name: 'HBNB2026-StarCat',
        symbol: 'HBNB2026-STAR',
        description: 'A feline voyager memecoin for the BNB Chain frontier.',
      }),
    );
    const tool = createNarrativeTool({ client });

    const out = await tool.execute({ theme: 'space cats on BNB Chain' });
    expect(out.name).toBe('HBNB2026-StarCat');
    expect(out.symbol).toBe('HBNB2026-STAR');
    expect(out.description).toMatch(/feline/);
  });

  it('strips a ```json fence before parsing', async () => {
    const client = mockAnthropic(
      '```json\n' +
        JSON.stringify({
          name: 'HBNB2026-Fenced',
          symbol: 'HBNB2026-FEN',
          description: 'A coin wrapped in fences.',
        }) +
        '\n```',
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'fenced memes' });
    expect(out.symbol).toBe('HBNB2026-FEN');
  });

  it('throws when Claude returns malformed JSON', async () => {
    const client = mockAnthropic('not-json-at-all');
    const tool = createNarrativeTool({ client });
    await expect(tool.execute({ theme: 'broken parser' })).rejects.toThrow(/not valid JSON/);
  });

  it('throws when Claude omits the HBNB2026- prefix on name', async () => {
    const client = mockAnthropic(
      JSON.stringify({
        name: 'PlainCoin',
        symbol: 'HBNB2026-OK',
        description: 'no prefix on name',
      }),
    );
    const tool = createNarrativeTool({ client });
    await expect(tool.execute({ theme: 'missing prefix' })).rejects.toThrow();
  });

  it('rejects invalid input via zod before any network call', async () => {
    const client = mockAnthropic('unused');
    const tool = createNarrativeTool({ client });
    await expect(tool.execute({ theme: 'x' })).rejects.toThrow();
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});
