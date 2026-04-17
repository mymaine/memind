import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { GoogleGenAI } from '@google/genai';
import type { AgentTool } from '@hack-fourmeme/shared';

/**
 * meme_image_creator — generate a meme image for the freshly-minted token and
 * save it to a local tmp directory so later tools (IPFS upload, four.meme
 * deploy) can read from disk.
 *
 * Backend: Google Gemini API via `@google/genai`. The model
 * `gemini-2.5-flash-image` returns image bytes as base64 in
 * response.candidates[0].content.parts[i].inlineData.data. Why Gemini here:
 *   - one Google billing account covers narrative LLM + image (simpler ops)
 *   - 2.5-flash-image is fast (~2-4s) and produces solid meme-style output
 *   - no separate image host — we get bytes directly, no second HTTP hop
 *
 * Square 1:1 aspect ratio is requested so the image works as a token logo in
 * the four.meme UI without client-side cropping.
 */

export const imageInputSchema = z.object({
  prompt: z.string().min(1, 'prompt must be non-empty').max(1000),
  // Used to name the output file; kept lax because callers may pass the
  // HBNB2026-prefixed token name which contains a dash. We sanitise below.
  name: z.string().min(1).max(100),
});
export type ImageInput = z.infer<typeof imageInputSchema>;

export const imageOutputSchema = z.object({
  localPath: z.string().min(1),
});
export type ImageOutput = z.infer<typeof imageOutputSchema>;

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

export interface CreateImageToolOptions {
  client: GoogleGenAI;
  /**
   * Directory that will receive generated PNGs. Defaults to `./tmp/meme`
   * under the current working directory. Caller may override for tests.
   */
  outputDir?: string;
  /**
   * Gemini model identifier — exposed for tests / experiments.
   */
  model?: string;
}

/**
 * Slug-safe filename segment: keep alphanumerics, collapse everything else
 * into single dashes, trim leading/trailing dashes.
 */
function sanitiseNameForFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'meme'
  );
}

/**
 * Walk response.candidates[0].content.parts and return the first
 * inlineData.data (base64) we find. Gemini may return text commentary
 * alongside the image, so we skip text parts.
 */
function extractImageBase64(response: unknown): string {
  const r = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  };
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const b64 = part.inlineData?.data;
    if (typeof b64 === 'string' && b64.length > 0) return b64;
  }
  throw new Error(
    'meme_image_creator: Gemini response had no inlineData image — model may have returned only text',
  );
}

export function createImageTool(
  options: CreateImageToolOptions,
): AgentTool<ImageInput, ImageOutput> {
  const outputDir = options.outputDir ?? resolve(process.cwd(), 'tmp', 'meme');
  const model = options.model ?? GEMINI_IMAGE_MODEL;

  return {
    name: 'meme_image_creator',
    description:
      'Generate a square meme-style image for a token using Google Gemini 2.5 Flash Image ' +
      'and save it locally as PNG. Call after narrative_generator so the prompt can reference ' +
      'the finalised token name. Returns the absolute local file path; subsequent tools can ' +
      'upload it to IPFS or attach it to the four.meme deploy payload.',
    inputSchema: imageInputSchema,
    outputSchema: imageOutputSchema,
    async execute(input) {
      const { prompt, name } = imageInputSchema.parse(input);

      const response = await options.client.models.generateContent({
        model,
        contents: [{ text: prompt }],
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '1:1' },
        },
      });

      const base64 = extractImageBase64(response);
      const bytes = Buffer.from(base64, 'base64');

      await mkdir(outputDir, { recursive: true });
      const timestamp = Date.now().toString();
      const filename = `${timestamp}-${sanitiseNameForFilename(name)}.png`;
      const localPath = join(outputDir, filename);
      await writeFile(localPath, bytes);

      return imageOutputSchema.parse({ localPath });
    },
  };
}
