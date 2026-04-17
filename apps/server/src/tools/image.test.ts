import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Replicate from 'replicate';
import { createImageTool, imageInputSchema, imageOutputSchema } from './image.js';

/**
 * Build a fake Replicate client whose `run` resolves to the given value.
 */
function mockReplicate(runResult: unknown): Replicate {
  const client = {
    run: vi.fn().mockResolvedValue(runResult),
  };
  return client as unknown as Replicate;
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
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'image-tool-test-'));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(scratchDir, { recursive: true, force: true });
  });

  it('downloads the Replicate URL and writes the PNG to disk', async () => {
    const fakeImageUrl = 'https://replicate.example.com/out.png';
    const fakeBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe(fakeImageUrl);
      return new Response(fakeBytes, { status: 200 });
    }) as unknown as typeof fetch;

    const client = mockReplicate([fakeImageUrl]);
    const tool = createImageTool({ client, outputDir: scratchDir });

    const out = await tool.execute({ prompt: 'a cool meme', name: 'HBNB2026-Test' });
    expect(out.localPath).toContain(scratchDir);
    expect(out.localPath.endsWith('.png')).toBe(true);

    const written = await readFile(out.localPath);
    expect(new Uint8Array(written)).toEqual(fakeBytes);
  });

  it('accepts a Replicate FileOutput-like response (url() method)', async () => {
    const fakeImageUrl = 'https://replicate.example.com/fo.png';
    const fileOutput = {
      url: () => new URL(fakeImageUrl),
    };

    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(fakeBytes, { status: 200 })) as unknown as typeof fetch;

    const client = mockReplicate([fileOutput]);
    const tool = createImageTool({ client, outputDir: scratchDir });

    const out = await tool.execute({ prompt: 'p', name: 'n' });
    expect(out.localPath).toContain('.png');
  });

  it('throws when the download fails', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('nope', { status: 500, statusText: 'Server Error' }),
      ) as unknown as typeof fetch;

    const client = mockReplicate(['https://replicate.example.com/bad.png']);
    const tool = createImageTool({ client, outputDir: scratchDir });

    await expect(tool.execute({ prompt: 'p', name: 'n' })).rejects.toThrow(/HTTP 500/);
  });

  it('throws when the Replicate response has no extractable URL', async () => {
    const client = mockReplicate({});
    const tool = createImageTool({ client, outputDir: scratchDir });
    await expect(tool.execute({ prompt: 'p', name: 'n' })).rejects.toThrow(/could not extract URL/);
  });

  it('rejects invalid input via zod before calling Replicate', async () => {
    const client = mockReplicate(['https://x']);
    const tool = createImageTool({ client, outputDir: scratchDir });

    await expect(tool.execute({ prompt: '', name: 'x' })).rejects.toThrow();
    expect(client.run).not.toHaveBeenCalled();
  });
});
