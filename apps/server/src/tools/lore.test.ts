import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { PinataSDK } from 'pinata';
import { createLoreTool, loreInputSchema, loreOutputSchema } from './lore.js';
import type { AnthropicMessagesClient } from './_anthropic.js';

/**
 * Build a fake Anthropic client whose `messages.create` resolves to a Message
 * with a single text block. Same shape helper as narrative.test.ts.
 */
function mockAnthropic(text: string): AnthropicMessagesClient {
  const message: Anthropic.Message = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
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
      create: vi
        .fn()
        .mockResolvedValue(message) as unknown as AnthropicMessagesClient['messages']['create'],
    },
  };
}

/**
 * Build a fake Pinata SDK that returns `{ cid }` from `upload.public.file(...)`.
 * The real SDK returns an `UploadBuilder` that is thenable; a plain Promise
 * satisfies `await` so we keep the mock minimal.
 */
function mockPinata(cid: string): PinataSDK {
  const builder = { cid } as unknown;
  const pinata = {
    upload: {
      public: {
        file: vi.fn().mockReturnValue(Promise.resolve(builder)),
      },
    },
  };
  return pinata as unknown as PinataSDK;
}

const GOOD_INPUT = {
  tokenName: 'HBNB2026-StarCat',
  tokenSymbol: 'HBNB2026-STAR',
  tokenDescription: 'A feline voyager memecoin on BNB Chain.',
  theme: 'space cats on BNB Chain',
};

describe('loreInputSchema', () => {
  it('accepts a valid input', () => {
    expect(loreInputSchema.safeParse(GOOD_INPUT).success).toBe(true);
  });

  it('rejects an empty tokenName', () => {
    expect(loreInputSchema.safeParse({ ...GOOD_INPUT, tokenName: '' }).success).toBe(false);
  });

  it('rejects a too-short theme', () => {
    expect(loreInputSchema.safeParse({ ...GOOD_INPUT, theme: 'x' }).success).toBe(false);
  });
});

describe('loreOutputSchema', () => {
  it('accepts a valid output', () => {
    expect(
      loreOutputSchema.safeParse({
        loreText: 'ancient prose ...',
        ipfsCid: 'bafytestcid',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafytestcid',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-URL gatewayUrl', () => {
    expect(
      loreOutputSchema.safeParse({
        loreText: 'x',
        ipfsCid: 'bafy',
        gatewayUrl: 'not-a-url',
      }).success,
    ).toBe(false);
  });
});

describe('createLoreTool.execute', () => {
  it('generates lore, pins markdown, and returns cid + gateway URL', async () => {
    const anthropic = mockAnthropic(
      'In the age before silicon, the Star Cat prowled the vault of heaven...',
    );
    const pinata = mockPinata('bafyFAKECID123');
    const tool = createLoreTool({ anthropic, pinata });

    const out = await tool.execute(GOOD_INPUT);
    expect(out.ipfsCid).toBe('bafyFAKECID123');
    expect(out.gatewayUrl).toBe('https://gateway.pinata.cloud/ipfs/bafyFAKECID123');
    expect(out.loreText).toMatch(/Star Cat/);

    // Verify the file name we sent to pinata embeds the token symbol.
    const fileArg = (pinata.upload.public.file as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as File | undefined;
    expect(fileArg).toBeDefined();
    expect(fileArg?.name).toContain(GOOD_INPUT.tokenSymbol);
    expect(fileArg?.type).toBe('text/markdown');
  });

  it('honours a custom public gateway', async () => {
    const anthropic = mockAnthropic('lore body');
    const pinata = mockPinata('bafyCUSTOM');
    const tool = createLoreTool({
      anthropic,
      pinata,
      publicGateway: 'https://my-gateway.example.com',
    });

    const out = await tool.execute(GOOD_INPUT);
    expect(out.gatewayUrl).toBe('https://my-gateway.example.com/ipfs/bafyCUSTOM');
  });

  it('throws when the LLM returns empty lore', async () => {
    const anthropic = mockAnthropic('   ');
    const pinata = mockPinata('irrelevant');
    const tool = createLoreTool({ anthropic, pinata });

    await expect(tool.execute(GOOD_INPUT)).rejects.toThrow(/empty lore/);
  });

  it('throws when Pinata returns no CID', async () => {
    const anthropic = mockAnthropic('lore body');
    const pinata = mockPinata('');
    const tool = createLoreTool({ anthropic, pinata });

    await expect(tool.execute(GOOD_INPUT)).rejects.toThrow(/no CID/);
  });

  it('rejects invalid input via zod before any network call', async () => {
    const anthropic = mockAnthropic('unused');
    const pinata = mockPinata('unused');
    const tool = createLoreTool({ anthropic, pinata });

    await expect(tool.execute({ ...GOOD_INPUT, tokenName: '' })).rejects.toThrow();
    expect(anthropic.messages.create).not.toHaveBeenCalled();
    expect(pinata.upload.public.file).not.toHaveBeenCalled();
  });
});
