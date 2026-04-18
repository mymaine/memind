import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { GoogleGenAI } from '@google/genai';
import type { PinataSDK } from 'pinata';
import type { AgentTool } from '@hack-fourmeme/shared';

/**
 * meme_image_creator — generate a meme image for the freshly-minted token,
 * persist the PNG to disk, and pin it to IPFS via Pinata so the dashboard can
 * render the resulting CID in the Creator column.
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
 *
 * Pinata behaviour (V2-P1):
 *   1. After writing the PNG locally, attempt to upload to Pinata with a 10s
 *      timeout (overridable via `pinataTimeoutMs` for tests).
 *   2. Success → return `status='ok'` + cid + gatewayUrl.
 *   3. Failure or timeout → return `status='upload-failed'` + null cid +
 *      errorMessage. Crucially we do NOT throw — the Creator agent must keep
 *      moving (deploy → lore writing). The dashboard renders a placeholder
 *      card from the failed-status artifact downstream.
 *   4. We never fall back to embedding the raw bytes as a base64 data URL;
 *      PNGs reach 1-2MB and would wedge SSE consumers.
 */

export const imageInputSchema = z.object({
  prompt: z.string().min(1, 'prompt must be non-empty').max(1000),
  // Used to name the output file; kept lax because callers may pass the
  // HBNB2026-prefixed token name which contains a dash. We sanitise below.
  name: z.string().min(1).max(100),
});
export type ImageInput = z.infer<typeof imageInputSchema>;

// Output mirrors the meme-image artifact's two-state shape so the calling
// agent can hand the result straight through to the SSE artifact emitter
// without re-massaging fields. `status='ok'` carries cid + gatewayUrl, and
// `status='upload-failed'` carries errorMessage with null cid/gatewayUrl.
export const imageOutputSchema = z
  .object({
    localPath: z.string().min(1),
    status: z.enum(['ok', 'upload-failed']),
    cid: z.string().min(1).nullable(),
    gatewayUrl: z.string().url().nullable(),
    prompt: z.string().min(1),
    errorMessage: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'ok') {
      if (value.cid === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cid'],
          message: 'cid required when status=ok',
        });
      }
      if (value.gatewayUrl === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gatewayUrl'],
          message: 'gatewayUrl required when status=ok',
        });
      }
    } else {
      if (value.errorMessage === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['errorMessage'],
          message: 'errorMessage required when status=upload-failed',
        });
      }
    }
  });
export type ImageOutput = z.infer<typeof imageOutputSchema>;

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_PINATA_GATEWAY = 'https://gateway.pinata.cloud';
const DEFAULT_PINATA_TIMEOUT_MS = 10_000;

export interface CreateImageToolOptions {
  client: GoogleGenAI;
  /** Pinata SDK used to pin the generated PNG to IPFS. */
  pinata: PinataSDK;
  /**
   * Directory that will receive generated PNGs. Defaults to `./tmp/meme`
   * under the current working directory. Caller may override for tests.
   */
  outputDir?: string;
  /** Gemini model identifier — exposed for tests / experiments. */
  model?: string;
  /**
   * Public IPFS gateway base (no trailing slash, no `/ipfs`). Defaults to
   * the Pinata public gateway which matches probe-pinata.ts.
   */
  publicGateway?: string;
  /**
   * Hard upper bound on the Pinata upload — past this we abandon the upload
   * and return `status='upload-failed'`. 10s by default; tests use a smaller
   * value with fake timers.
   */
  pinataTimeoutMs?: number;
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

/**
 * Race a promise against a timeout. On timeout, the returned promise rejects
 * with an Error whose message starts with `timed out`. We only race the
 * Pinata upload — Gemini and disk IO are not gated by this budget.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolveOuter, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: timed out after ${ms.toString()}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveOuter(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function createImageTool(
  options: CreateImageToolOptions,
): AgentTool<ImageInput, ImageOutput> {
  const outputDir = options.outputDir ?? resolve(process.cwd(), 'tmp', 'meme');
  const model = options.model ?? GEMINI_IMAGE_MODEL;
  const gatewayBase = (options.publicGateway ?? DEFAULT_PINATA_GATEWAY).replace(/\/$/, '');
  const pinataTimeoutMs = options.pinataTimeoutMs ?? DEFAULT_PINATA_TIMEOUT_MS;

  return {
    name: 'meme_image_creator',
    description:
      'Generate a square meme-style image for a token using Google Gemini 2.5 Flash Image, ' +
      'save it locally as PNG, and pin it to IPFS via Pinata. Call after narrative_generator ' +
      'so the prompt can reference the finalised token name. Returns the absolute local file ' +
      'path plus the IPFS cid and gateway URL on success; on Pinata failure it returns ' +
      'status="upload-failed" with null cid and an errorMessage so the calling agent does ' +
      'not have to wrap it in a try/catch.',
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
      const slug = sanitiseNameForFilename(name);
      const filename = `${timestamp}-${slug}.png`;
      const localPath = join(outputDir, filename);
      await writeFile(localPath, bytes);

      // Re-read from disk so the bytes we ship to Pinata exactly match the
      // file that downstream tools (four.meme deploy etc.) will read. This is
      // a cheap correctness check; the alternative `Buffer.from(base64,...)`
      // re-use is functionally equivalent on the happy path but masks any
      // future on-disk mutation we might add (e.g. PNG metadata stripping).
      const fileBytes = await readFile(localPath);
      const pinataFile = new File([fileBytes], filename, { type: 'image/png' });

      try {
        const upload = (await withTimeout(
          Promise.resolve(options.pinata.upload.public.file(pinataFile)),
          pinataTimeoutMs,
          'pinata upload',
        )) as { cid?: string };
        const cid = upload.cid;
        if (!cid || cid.trim() === '') {
          return imageOutputSchema.parse({
            localPath,
            status: 'upload-failed',
            cid: null,
            gatewayUrl: null,
            prompt,
            errorMessage: 'pinata returned empty cid',
          });
        }
        return imageOutputSchema.parse({
          localPath,
          status: 'ok',
          cid,
          gatewayUrl: `${gatewayBase}/ipfs/${cid}`,
          prompt,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return imageOutputSchema.parse({
          localPath,
          status: 'upload-failed',
          cid: null,
          gatewayUrl: null,
          prompt,
          errorMessage: message,
        });
      }
    },
  };
}
