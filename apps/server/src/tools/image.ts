import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import type Replicate from 'replicate';
import type { AgentTool } from '@hack-fourmeme/shared';

/**
 * meme_image_creator — generate a meme image for the freshly-minted token and
 * save it to a local tmp directory so later tools (IPFS upload, four.meme
 * deploy) can read from disk.
 *
 * Model choice: `black-forest-labs/flux-schnell`. Why:
 *   - fastest Replicate image model (~2s latency on their infra)
 *   - cheapest in class at ~$0.003/image, safe for Phase 2 iterations
 *   - output quality is more than enough for a meme-style square thumbnail
 *   - API returns one image URL per call with sensible defaults
 *
 * SDXL / flux-dev would look nicer but cost 5-20x more and run slower, which
 * matters for the 90-second AC1 total-flow budget in spec.md.
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

// Replicate's Flux schnell model identifier. Not pinned to a version hash so
// we always get the published latest — acceptable for hackathon; pin here if
// drift ever becomes an issue.
const FLUX_SCHNELL = 'black-forest-labs/flux-schnell';

export interface CreateImageToolOptions {
  client: Replicate;
  /**
   * Directory that will receive generated PNGs. Defaults to `./tmp/meme`
   * under the current working directory. Caller may override for tests.
   */
  outputDir?: string;
  /**
   * Replicate model identifier — exposed for tests / experiments.
   */
  model?: `${string}/${string}` | `${string}/${string}:${string}`;
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
 * Normalise whatever shape Replicate returns into a plain URL string. The
 * model returns an array of outputs; each item may be a `string` URL or a
 * `FileOutput` (ReadableStream with a `.url()` method). We handle both.
 */
function extractImageUrl(output: unknown): string {
  const pick = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'url' in value) {
      const u = (value as { url: unknown }).url;
      if (typeof u === 'function') {
        const result = (u as () => unknown).call(value);
        if (result instanceof URL) return result.toString();
        if (typeof result === 'string') return result;
      }
      if (u instanceof URL) return u.toString();
      if (typeof u === 'string') return u;
    }
    return null;
  };

  if (Array.isArray(output)) {
    for (const item of output) {
      const url = pick(item);
      if (url) return url;
    }
  }
  const single = pick(output);
  if (single) return single;
  throw new Error(
    `meme_image_creator: could not extract URL from Replicate output: ${String(output)}`,
  );
}

export function createImageTool(
  options: CreateImageToolOptions,
): AgentTool<ImageInput, ImageOutput> {
  const outputDir = options.outputDir ?? resolve(process.cwd(), 'tmp', 'meme');
  const model = options.model ?? FLUX_SCHNELL;

  return {
    name: 'meme_image_creator',
    description:
      'Generate a meme-style image for a token using Flux schnell and save it locally. ' +
      'Call after narrative_generator so the prompt can reference the finalised token ' +
      'name. Returns the absolute local file path; subsequent tools can upload it to ' +
      'IPFS or attach it to the four.meme deploy payload.',
    inputSchema: imageInputSchema,
    outputSchema: imageOutputSchema,
    async execute(input) {
      const { prompt, name } = imageInputSchema.parse(input);

      const prediction = await options.client.run(model, {
        input: {
          prompt,
          // Flux schnell defaults are already tuned; we only opt into PNG
          // output so binary download stays lossless.
          output_format: 'png',
          num_outputs: 1,
        },
      });

      const url = extractImageUrl(prediction);

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `meme_image_creator: failed to download image (HTTP ${String(res.status)} ${res.statusText})`,
        );
      }
      const bytes = new Uint8Array(await res.arrayBuffer());

      await mkdir(outputDir, { recursive: true });
      const timestamp = Date.now().toString();
      const filename = `${timestamp}-${sanitiseNameForFilename(name)}.png`;
      const localPath = join(outputDir, filename);
      await writeFile(localPath, bytes);

      return imageOutputSchema.parse({ localPath });
    },
  };
}
