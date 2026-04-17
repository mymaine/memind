import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  createLoreExtendTool,
  loreExtendInputSchema,
  loreExtendOutputSchema,
  FIRST_CHAPTER_SYSTEM_PROMPT,
  CONTINUATION_SYSTEM_PROMPT,
} from './lore-extend.js';

/**
 * DI helpers for Anthropic + Pinata. Mirrors the lore.test.ts mock pattern but
 * uses a fetch stub for Pinata because the extend_lore tool uploads directly
 * over HTTP (DI-friendly via `fetchImpl`) instead of through the Pinata SDK.
 */

function mockAnthropic(text: string): Anthropic {
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
  const client = {
    messages: {
      create: vi.fn().mockResolvedValue(message),
    },
  };
  return client as unknown as Anthropic;
}

function mockAnthropicReject(err: Error): Anthropic {
  const client = {
    messages: {
      create: vi.fn().mockRejectedValue(err),
    },
  };
  return client as unknown as Anthropic;
}

function mockFetchOk(ipfsHash: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return { IpfsHash: ipfsHash, PinSize: 123, Timestamp: '2026-04-18T00:00:00Z' };
    },
    async text() {
      return JSON.stringify({ IpfsHash: ipfsHash });
    },
  }) as unknown as typeof fetch;
}

function mockFetchReject(err: Error): typeof fetch {
  return vi.fn().mockRejectedValue(err) as unknown as typeof fetch;
}

const BASE_INPUT = {
  tokenAddr: '0x1234567890abcdef1234567890abcdef12345678',
  tokenName: 'HBNB2026-StarCat',
  tokenSymbol: 'HBNB2026-STAR',
};

describe('createLoreExtendTool factory', () => {
  it('throws when pinataJwt is empty', () => {
    expect(() => createLoreExtendTool({ anthropic: mockAnthropic('x'), pinataJwt: '' })).toThrow(
      /pinataJwt/,
    );
  });

  it('throws when pinataJwt is whitespace only', () => {
    expect(() => createLoreExtendTool({ anthropic: mockAnthropic('x'), pinataJwt: '   ' })).toThrow(
      /pinataJwt/,
    );
  });
});

describe('loreExtendInputSchema', () => {
  it('defaults previousChapters to an empty array', () => {
    const parsed = loreExtendInputSchema.parse({ ...BASE_INPUT });
    expect(parsed.previousChapters).toEqual([]);
  });

  it('rejects a malformed tokenAddr', () => {
    const out = loreExtendInputSchema.safeParse({ ...BASE_INPUT, tokenAddr: '0xNOTHEX' });
    expect(out.success).toBe(false);
  });
});

describe('loreExtendOutputSchema', () => {
  it('accepts a valid success output', () => {
    const ok = loreExtendOutputSchema.safeParse({
      chapterNumber: 1,
      chapterText: 'chapter body',
      ipfsHash: 'bafyHash',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafyHash',
    });
    expect(ok.success).toBe(true);
  });
});

describe('extend_lore.execute — first chapter mode', () => {
  it('produces chapter 1 when previousChapters is empty and uses the first-chapter prompt', async () => {
    const anthropic = mockAnthropic(
      'In the first hour the Star Cat blinked awake above the chain.',
    );
    const fetchImpl = mockFetchOk('bafyFIRST');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt-test', fetchImpl });

    const out = await tool.execute({ ...BASE_INPUT, previousChapters: [] });

    expect(out.chapterNumber).toBe(1);
    expect(out.chapterText).toMatch(/Star Cat/);
    expect(out.ipfsHash).toBe('bafyFIRST');
    expect(out.ipfsUri).toBe('https://gateway.pinata.cloud/ipfs/bafyFIRST');

    // System prompt must be the first-chapter variant.
    const createMock = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
    const callArg = createMock.mock.calls[0]?.[0] as { system: string } | undefined;
    expect(callArg?.system).toBe(FIRST_CHAPTER_SYSTEM_PROMPT);
  });
});

describe('extend_lore.execute — continuation mode', () => {
  it('uses continuation prompt with prior chapters embedded and honours targetChapterNumber', async () => {
    const priorA = 'Chapter one body about the void.';
    const priorB = 'Chapter two body about the comet.';
    const anthropic = mockAnthropic('A new tremor ran across the ledger sky.');
    const fetchImpl = mockFetchOk('bafyCONT');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt-test', fetchImpl });

    const out = await tool.execute({
      ...BASE_INPUT,
      previousChapters: [priorA, priorB],
      targetChapterNumber: 5,
    });

    expect(out.chapterNumber).toBe(5);
    expect(out.ipfsHash).toBe('bafyCONT');

    const createMock = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
    const callArg = createMock.mock.calls[0]?.[0] as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArg.system).toBe(CONTINUATION_SYSTEM_PROMPT);
    // Both prior chapter bodies must appear in the user prompt so the LLM can
    // continue the timeline without reintroducing the setting.
    expect(callArg.messages[0]?.content).toContain(priorA);
    expect(callArg.messages[0]?.content).toContain(priorB);
    // Target chapter number should be surfaced to the LLM.
    expect(callArg.messages[0]?.content).toContain('5');
  });
});

describe('extend_lore.execute — happy path wiring', () => {
  it('calls Pinata with multipart form containing <symbol>-ch<N>.txt and produces schema-valid output', async () => {
    const anthropic = mockAnthropic('A single-chapter myth of the Star Cat.');
    const fetchImpl = mockFetchOk('bafyWIRE') as unknown as typeof fetch;
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt-wire', fetchImpl });

    const out = await tool.execute({ ...BASE_INPUT, previousChapters: [] });

    // Output must satisfy the declared schema.
    const parsed = loreExtendOutputSchema.safeParse(out);
    expect(parsed.success).toBe(true);

    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('pinata.cloud');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-wire');
    // Body is FormData; look for a file named HBNB2026-STAR-ch1.txt.
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const filePart = body.get('file');
    expect(filePart).toBeInstanceOf(File);
    expect((filePart as File).name).toBe('HBNB2026-STAR-ch1.txt');
  });
});

describe('extend_lore.execute — error propagation', () => {
  it('propagates Anthropic errors without calling Pinata', async () => {
    const anthropic = mockAnthropicReject(new Error('llm down'));
    const fetchImpl = mockFetchOk('unused');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    await expect(tool.execute({ ...BASE_INPUT, previousChapters: [] })).rejects.toThrow(/llm down/);
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('propagates Pinata upload errors', async () => {
    const anthropic = mockAnthropic('a chapter body');
    const fetchImpl = mockFetchReject(new Error('pinata 500'));
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    await expect(tool.execute({ ...BASE_INPUT, previousChapters: [] })).rejects.toThrow(
      /pinata 500/,
    );
  });

  it('throws when Pinata responds with non-ok HTTP status', async () => {
    const anthropic = mockAnthropic('a chapter body');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      async text() {
        return 'bad jwt';
      },
    }) as unknown as typeof fetch;
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    await expect(tool.execute({ ...BASE_INPUT, previousChapters: [] })).rejects.toThrow(
      /401|Unauthorized|pinata/i,
    );
  });

  it('throws when the LLM returns an empty chapter', async () => {
    const anthropic = mockAnthropic('   ');
    const fetchImpl = mockFetchOk('unused');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    await expect(tool.execute({ ...BASE_INPUT, previousChapters: [] })).rejects.toThrow(/empty/i);
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

// --- Fix 4: defensive cap on previousChapters context window ---------------
describe('extend_lore.execute — previousChapters context cap', () => {
  it('keeps only the last 5 chapters when 6 are supplied', async () => {
    const anthropic = mockAnthropic('next chapter body');
    const fetchImpl = mockFetchOk('bafyCAP');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    // Six short, unique-shape chapters so we can see which made it into the
    // user prompt. The very first chapter must be dropped.
    const chapters = [
      'CH_ONE body',
      'CH_TWO body',
      'CH_THREE body',
      'CH_FOUR body',
      'CH_FIVE body',
      'CH_SIX body',
    ];

    await tool.execute({ ...BASE_INPUT, previousChapters: chapters });

    const createMock = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
    const call = createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = call.messages[0]!.content;
    expect(userPrompt).not.toContain('CH_ONE');
    expect(userPrompt).toContain('CH_TWO');
    expect(userPrompt).toContain('CH_THREE');
    expect(userPrompt).toContain('CH_FOUR');
    expect(userPrompt).toContain('CH_FIVE');
    expect(userPrompt).toContain('CH_SIX');
  });

  it('drops older chapters when cumulative chars exceed MAX_CONTEXT_CHARS', async () => {
    const anthropic = mockAnthropic('continuation');
    const fetchImpl = mockFetchOk('bafyCHARS');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    // Three chapters, each ~7_000 chars, unique sentinel prefix. The newest
    // alone fits. Adding the second pushes total past 12_000; the oldest
    // must be dropped.
    const fill = 'x'.repeat(6_950);
    const chapters = [
      `OLDEST_SENTINEL ${fill}`,
      `MIDDLE_SENTINEL ${fill}`,
      `NEWEST_SENTINEL ${fill}`,
    ];

    await tool.execute({ ...BASE_INPUT, previousChapters: chapters });

    const createMock = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
    const call = createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = call.messages[0]!.content;
    expect(userPrompt).toContain('NEWEST_SENTINEL');
    // At least one older chapter must be dropped to keep the cap.
    expect(userPrompt).not.toContain('OLDEST_SENTINEL');
  });

  it('truncates a single oversized chapter with a truncation marker', async () => {
    const anthropic = mockAnthropic('next chapter');
    const fetchImpl = mockFetchOk('bafyTRUNC');
    const tool = createLoreExtendTool({ anthropic, pinataJwt: 'jwt', fetchImpl });

    const giant = 'HEAD_SENTINEL ' + 'y'.repeat(15_000);
    await tool.execute({ ...BASE_INPUT, previousChapters: [giant] });

    const createMock = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
    const call = createMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = call.messages[0]!.content;
    // Start of the chapter must survive.
    expect(userPrompt).toContain('HEAD_SENTINEL');
    // Truncation marker appended.
    expect(userPrompt).toContain('…[truncated]');
    // Cap respected — the full 15k-char tail must not be present.
    expect(userPrompt.length).toBeLessThan(14_000);
  });
});
