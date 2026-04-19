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

  it('rejects a name longer than 20 chars (four.meme create-api limit)', () => {
    const result = narrativeOutputSchema.safeParse({
      name: 'HBNB2026-DictatorDecree', // 21 chars
      symbol: 'HBNB2026-DECREE',
      description: 'a coin',
    });
    expect(result.success).toBe(false);
  });

  it('strips shell-unsafe punctuation from description (apostrophe bug)', () => {
    const result = narrativeOutputSchema.safeParse({
      name: 'HBNB2026-Cat',
      symbol: 'HBNB2026-CAT',
      description: `Supreme Leader's "official" \`coin\` for $cats`,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // all of ', ", `, $, \ gone; plain letters remain
      expect(result.data.description).not.toMatch(/['"`\\$]/);
      expect(result.data.description).toContain('Supreme Leaders');
      expect(result.data.description).toContain('official');
    }
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

  it('coerces missing HBNB2026- prefix on name rather than throwing', async () => {
    // Coerce helper re-attaches the prefix so a common LLM slip (dropping the
    // literal "HBNB2026-" prefix) no longer breaks the whole Creator flow.
    const client = mockAnthropic(
      JSON.stringify({
        name: 'PlainCoin',
        symbol: 'HBNB2026-OK',
        description: 'no prefix on name',
      }),
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'missing prefix' });
    expect(out.name).toBe('HBNB2026-PlainCoin');
  });

  it('coerces over-long symbol suffix to 8 chars max', async () => {
    // LLM seen emitting `HBNB2026-SHIBANAUT` (9-char suffix). Schema limit is
    // 8; coerce trims to salvage the run instead of bubbling a zod error.
    const client = mockAnthropic(
      JSON.stringify({
        name: 'HBNB2026-Shiba',
        symbol: 'HBNB2026-SHIBANAUT',
        description: 'shiba on mars',
      }),
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'shiba astronaut mars' });
    expect(out.symbol).toBe('HBNB2026-SHIBANAU');
  });

  it('coerces lowercase + special chars in symbol suffix', async () => {
    const client = mockAnthropic(
      JSON.stringify({
        name: 'HBNB2026-Neko',
        symbol: 'HBNB2026-ne_ko!',
        description: 'cyberpunk neko',
      }),
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'cyberpunk neko' });
    expect(out.symbol).toBe('HBNB2026-NEKO');
  });

  it('coerces missing prefix on symbol', async () => {
    const client = mockAnthropic(
      JSON.stringify({
        name: 'HBNB2026-Coin',
        symbol: 'SHIBA',
        description: 'no prefix on symbol',
      }),
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'no prefix' });
    expect(out.symbol).toBe('HBNB2026-SHIBA');
  });

  it('falls back to MEME when symbol body strips to empty', async () => {
    // All-punctuation suffix — strip leaves nothing; fallback keeps zod's
    // min-length happy so the Creator flow still proceeds.
    const client = mockAnthropic(
      JSON.stringify({
        name: 'HBNB2026-Mystery',
        symbol: 'HBNB2026-___',
        description: 'empty suffix fallback',
      }),
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'all punctuation' });
    expect(out.symbol).toBe('HBNB2026-MEME');
  });

  it('clamps over-long name suffix to fit the 20-char cap', async () => {
    // four.meme hard-caps name at 20 chars; prefix is 9 chars so suffix must
    // be <= 11. A 15-char suffix gets trimmed without dropping the prefix.
    const client = mockAnthropic(
      JSON.stringify({
        name: 'HBNB2026-SupremeLeaderCoin',
        symbol: 'HBNB2026-SLC',
        description: 'over-long name body',
      }),
    );
    const tool = createNarrativeTool({ client });
    const out = await tool.execute({ theme: 'over long name' });
    expect(out.name.length).toBeLessThanOrEqual(20);
    expect(out.name.startsWith('HBNB2026-')).toBe(true);
  });

  it('rejects invalid input via zod before any network call', async () => {
    const client = mockAnthropic('unused');
    const tool = createNarrativeTool({ client });
    await expect(tool.execute({ theme: 'x' })).rejects.toThrow();
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});
