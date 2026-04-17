import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { createImageTool, imageInputSchema, imageOutputSchema } from './image.js';

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
  it('requires a non-empty localPath', () => {
    expect(imageOutputSchema.safeParse({ localPath: '' }).success).toBe(false);
    expect(imageOutputSchema.safeParse({ localPath: '/tmp/x.png' }).success).toBe(true);
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

    const tool = createImageTool({ client, outputDir: scratchDir });
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

  it('skips leading text parts and picks the first inlineData part', async () => {
    const fakeBytes = Buffer.from([1, 2, 3, 4]);
    const response = imageResponse(fakeBytes.toString('base64'), [{ text: 'here is your image:' }]);
    const { client } = mockGemini(response);

    const tool = createImageTool({ client, outputDir: scratchDir });
    const out = await tool.execute({ prompt: 'p', name: 'n' });

    const written = await readFile(out.localPath);
    expect(Buffer.compare(written, fakeBytes)).toBe(0);
  });

  it('throws when the Gemini response has no inlineData parts', async () => {
    const response = {
      candidates: [{ content: { parts: [{ text: 'sorry, no image' }] } }],
    };
    const { client } = mockGemini(response);

    const tool = createImageTool({ client, outputDir: scratchDir });
    await expect(tool.execute({ prompt: 'p', name: 'n' })).rejects.toThrow(/no inlineData image/);
  });

  it('throws when candidates is missing entirely', async () => {
    const { client } = mockGemini({});
    const tool = createImageTool({ client, outputDir: scratchDir });
    await expect(tool.execute({ prompt: 'p', name: 'n' })).rejects.toThrow(/no inlineData image/);
  });

  it('rejects invalid input via zod before calling Gemini', async () => {
    const { client, generateContent } = mockGemini(imageResponse('AAAA'));
    const tool = createImageTool({ client, outputDir: scratchDir });

    await expect(tool.execute({ prompt: '', name: 'x' })).rejects.toThrow();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('honours a custom model option', async () => {
    const fakeBytes = Buffer.from([9, 9, 9]);
    const { client, generateContent } = mockGemini(imageResponse(fakeBytes.toString('base64')));

    const tool = createImageTool({
      client,
      outputDir: scratchDir,
      model: 'gemini-3.1-flash-image-preview',
    });
    await tool.execute({ prompt: 'p', name: 'n' });

    const call = generateContent.mock.calls[0]?.[0] as { model: string };
    expect(call.model).toBe('gemini-3.1-flash-image-preview');
  });
});
