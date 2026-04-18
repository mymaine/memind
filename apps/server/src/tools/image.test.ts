import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import type { PinataSDK } from 'pinata';
import { createImageTool, imageInputSchema, imageOutputSchema } from './image.js';

/**
 * Build a fake Pinata SDK whose `upload.public.file(...)` resolves to
 * `{ cid }`. Mirrors the helper in tools/lore.test.ts. When `cid` is omitted
 * we honour the `behaviour` argument: 'reject' forces a rejected promise;
 * 'hang' returns a never-resolving promise so callers can exercise the timeout
 * path; 'reject-async' rejects after a microtask delay.
 */
function mockPinata(
  cidOrBehaviour:
    | string
    | { behaviour: 'reject'; error: Error }
    | { behaviour: 'hang' }
    | { behaviour: 'reject-async'; error: Error; delayMs: number },
): PinataSDK {
  // Build the return value lazily on each `file()` call so a 'reject' variant
  // does not produce an immediate unhandled rejection when no caller has yet
  // attached a `.catch()` (e.g. when the test file is being collected but the
  // tool execute() hasn't been awaited yet).
  const buildResult = (): unknown => {
    if (typeof cidOrBehaviour === 'string') {
      return Promise.resolve({ cid: cidOrBehaviour });
    }
    if (cidOrBehaviour.behaviour === 'reject') {
      return Promise.reject(cidOrBehaviour.error);
    }
    if (cidOrBehaviour.behaviour === 'reject-async') {
      return new Promise((_, reject) =>
        setTimeout(() => reject(cidOrBehaviour.error), cidOrBehaviour.delayMs),
      );
    }
    return new Promise(() => {
      /* never resolves */
    });
  };
  const pinata = {
    upload: {
      public: {
        file: vi.fn().mockImplementation(() => buildResult()),
      },
    },
  };
  return pinata as unknown as PinataSDK;
}

/**
 * Build a fake GoogleGenAI client whose `models.generateContent` resolves to
 * the given response shape.
 */
function mockGemini(response: unknown): {
  client: GoogleGenAI;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn().mockResolvedValue(response);
  const client = {
    models: { generateContent },
  };
  return { client: client as unknown as GoogleGenAI, generateContent };
}

function imageResponse(base64: string, extraParts: Array<{ text?: string }> = []): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [...extraParts, { inlineData: { mimeType: 'image/png', data: base64 } }],
        },
      },
    ],
  };
}

describe('imageInputSchema', () => {
  it('accepts a valid prompt + name pair', () => {
    const result = imageInputSchema.safeParse({
      prompt: 'a cat riding a rocket, neon, 4k',
      name: 'HBNB2026-RocketCat',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty prompt', () => {
    expect(imageInputSchema.safeParse({ prompt: '', name: 'x' }).success).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(imageInputSchema.safeParse({ prompt: 'ok' }).success).toBe(false);
  });
});

describe('imageOutputSchema', () => {
  it('requires a non-empty localPath when status=ok', () => {
    expect(
      imageOutputSchema.safeParse({
        localPath: '',
        status: 'ok',
        cid: 'bafy',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
        prompt: 'p',
      }).success,
    ).toBe(false);
    expect(
      imageOutputSchema.safeParse({
        localPath: '/tmp/x.png',
        status: 'ok',
        cid: 'bafy',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
        prompt: 'p',
      }).success,
    ).toBe(true);
  });

  it('accepts status=upload-failed with errorMessage and null cid', () => {
    expect(
      imageOutputSchema.safeParse({
        localPath: '/tmp/x.png',
        status: 'upload-failed',
        cid: null,
        gatewayUrl: null,
        prompt: 'p',
        errorMessage: 'pinata 500',
      }).success,
    ).toBe(true);
  });
});

describe('createImageTool.execute', () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'image-tool-test-'));
  });

  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it('writes the decoded Gemini image bytes to a PNG on disk', async () => {
    // PNG magic bytes
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { client, generateContent } = mockGemini(imageResponse(fakeBytes.toString('base64')));
    const pinata = mockPinata('bafyTESTCID');

    const tool = createImageTool({ client, pinata, outputDir: scratchDir });
    const out = await tool.execute({ prompt: 'a cool meme', name: 'HBNB2026-Test' });

    expect(out.localPath).toContain(scratchDir);
    expect(out.localPath.endsWith('.png')).toBe(true);

    const written = await readFile(out.localPath);
    expect(Buffer.compare(written, fakeBytes)).toBe(0);

    // Verify the SDK was called with the expected params.
    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: Array<{ text?: string }>;
      config?: { responseModalities?: string[]; imageConfig?: { aspectRatio?: string } };
    };
    expect(call.model).toBe('gemini-2.5-flash-image');
    expect(call.contents[0]?.text).toBe('a cool meme');
    expect(call.config?.responseModalities).toEqual(['IMAGE']);
    expect(call.config?.imageConfig?.aspectRatio).toBe('1:1');
  });

  it('uploads the PNG to Pinata and returns status=ok with cid + gatewayUrl', async () => {
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { client } = mockGemini(imageResponse(fakeBytes.toString('base64')));
    const pinata = mockPinata('bafyMEME123');

    const tool = createImageTool({ client, pinata, outputDir: scratchDir });
    const out = await tool.execute({ prompt: 'a cool meme', name: 'HBNB2026-Test' });

    expect(out.status).toBe('ok');
    expect(out.cid).toBe('bafyMEME123');
    expect(out.gatewayUrl).toBe('https://gateway.pinata.cloud/ipfs/bafyMEME123');
    expect(out.prompt).toBe('a cool meme');

    // Verify the file passed to pinata is named after the token (slug + .png).
    const fileArg = (pinata.upload.public.file as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as File | undefined;
    expect(fileArg).toBeDefined();
    expect(fileArg?.name.endsWith('.png')).toBe(true);
    expect(fileArg?.type).toBe('image/png');
  });

  it('returns status=upload-failed when Pinata rejects (non-fatal)', async () => {
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { client } = mockGemini(imageResponse(fakeBytes.toString('base64')));
    const pinata = mockPinata({
      behaviour: 'reject',
      error: new Error('HTTP 500: pinata internal error'),
    });

    const tool = createImageTool({ client, pinata, outputDir: scratchDir });
    const out = await tool.execute({ prompt: 'a cool meme', name: 'HBNB2026-Test' });

    expect(out.status).toBe('upload-failed');
    expect(out.cid).toBeNull();
    expect(out.gatewayUrl).toBeNull();
    expect(out.errorMessage).toMatch(/pinata internal error/);
    expect(out.localPath).toContain(scratchDir);
  });

  it('returns status=upload-failed when Pinata exceeds the configured timeout budget', async () => {
    // Real timers + a 50ms budget keep the test under ~80ms wall time without
    // wedging the fake-timer / fs-IO microtask interleaving that fake timers
    // would introduce. The production default is 10s; we exercise the timeout
    // path with an aggressive ceiling so the hung promise must lose the race.
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { client } = mockGemini(imageResponse(fakeBytes.toString('base64')));
    const pinata = mockPinata({ behaviour: 'hang' });

    const tool = createImageTool({
      client,
      pinata,
      outputDir: scratchDir,
      pinataTimeoutMs: 50,
    });
    const out = await tool.execute({ prompt: 'a cool meme', name: 'HBNB2026-Test' });

    expect(out.status).toBe('upload-failed');
    expect(out.errorMessage).toMatch(/timed out/i);
  });

  it('skips leading text parts and picks the first inlineData part', async () => {
    const fakeBytes = Buffer.from([1, 2, 3, 4]);
    const response = imageResponse(fakeBytes.toString('base64'), [{ text: 'here is your image:' }]);
    const { client } = mockGemini(response);
    const pinata = mockPinata('bafyXYZ');

    const tool = createImageTool({ client, pinata, outputDir: scratchDir });
    const out = await tool.execute({ prompt: 'p', name: 'n' });

    const written = await readFile(out.localPath);
    expect(Buffer.compare(written, fakeBytes)).toBe(0);
  });

  it('throws when the Gemini response has no inlineData parts', async () => {
    const response = {
      candidates: [{ content: { parts: [{ text: 'sorry, no image' }] } }],
    };
    const { client } = mockGemini(response);
    const pinata = mockPinata('unused');

    const tool = createImageTool({ client, pinata, outputDir: scratchDir });
    await expect(tool.execute({ prompt: 'p', name: 'n' })).rejects.toThrow(/no inlineData image/);
  });

  it('throws when candidates is missing entirely', async () => {
    const { client } = mockGemini({});
    const pinata = mockPinata('unused');
    const tool = createImageTool({ client, pinata, outputDir: scratchDir });
    await expect(tool.execute({ prompt: 'p', name: 'n' })).rejects.toThrow(/no inlineData image/);
  });

  it('rejects invalid input via zod before calling Gemini', async () => {
    const { client, generateContent } = mockGemini(imageResponse('AAAA'));
    const pinata = mockPinata('unused');
    const tool = createImageTool({ client, pinata, outputDir: scratchDir });

    await expect(tool.execute({ prompt: '', name: 'x' })).rejects.toThrow();
    expect(generateContent).not.toHaveBeenCalled();
    expect(pinata.upload.public.file).not.toHaveBeenCalled();
  });

  it('honours a custom model option', async () => {
    const fakeBytes = Buffer.from([9, 9, 9]);
    const { client, generateContent } = mockGemini(imageResponse(fakeBytes.toString('base64')));
    const pinata = mockPinata('bafyM');

    const tool = createImageTool({
      client,
      pinata,
      outputDir: scratchDir,
      model: 'gemini-3.1-flash-image-preview',
    });
    await tool.execute({ prompt: 'p', name: 'n' });

    const call = generateContent.mock.calls[0]?.[0] as { model: string };
    expect(call.model).toBe('gemini-3.1-flash-image-preview');
  });
});
