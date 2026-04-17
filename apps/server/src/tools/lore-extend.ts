import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool } from '@hack-fourmeme/shared';
import { extractText } from './_anthropic.js';

/**
 * extend_lore — generate the NEXT chapter for a token's lore, pin it to
 * Pinata IPFS as a plain-text file, and return { chapterNumber, chapterText,
 * ipfsHash, ipfsUri }.
 *
 * Modes:
 *  - First chapter (previousChapters empty): ~600 chars, opening tone.
 *  - Continuation (>=1 previous chapters): 300-500 chars, continues the
 *    timeline without reintroducing the setting or repeating prior plot
 *    points.
 *
 * Upload shape: uses Pinata's `pinFileToIPFS` HTTP endpoint directly via a
 * DI-friendly `fetchImpl`, so unit tests can stub the network without
 * booting the Pinata SDK. File name is `<tokenSymbol>-ch<N>.txt`.
 */

const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const GATEWAY_BASE = 'https://gateway.pinata.cloud';

/**
 * Defensive caps on the `previousChapters` context passed to the LLM. Without
 * these, a caller stuffing 50+ long chapters into the continuation prompt
 * would blow past the model context window and surface as an opaque upstream
 * 400. We keep only the last MAX_CONTEXT_CHAPTERS entries, then shrink that
 * set from oldest-to-drop-first until cumulative char count fits under
 * MAX_CONTEXT_CHARS. If even a single most-recent chapter exceeds
 * MAX_CONTEXT_CHARS, it is truncated with a trailing `…[truncated]` marker
 * so the LLM can still ingest the opening and preserve timeline continuity.
 *
 * Truncation is a silent operation — the output schema has no `warnings`
 * field. Operators reading the code can see the contract here.
 */
const MAX_CONTEXT_CHAPTERS = 5;
const MAX_CONTEXT_CHARS = 12_000;
const TRUNCATION_SUFFIX = '…[truncated]';

export const loreExtendInputSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenName: z.string().min(1),
  tokenSymbol: z.string().min(1),
  previousChapters: z.array(z.string()).default([]),
  targetChapterNumber: z.number().int().positive().optional(),
});
// We intentionally use the *output* type (post-default) as the tool's
// LoreExtendInput so `AgentTool<TInput, TOutput>` stays internally consistent
// (inputSchema produces values of type LoreExtendInput). Callers may still
// omit `previousChapters` — the default kicks in during parse.
export type LoreExtendInput = z.output<typeof loreExtendInputSchema>;

export const loreExtendOutputSchema = z.object({
  chapterNumber: z.number().int().positive(),
  chapterText: z.string().min(1),
  ipfsHash: z.string().min(1),
  ipfsUri: z.string().url(),
});
export type LoreExtendOutput = z.infer<typeof loreExtendOutputSchema>;

export const FIRST_CHAPTER_SYSTEM_PROMPT = `You are a mythographer opening a token's on-chain saga.
Produce the FIRST chapter: a compact mythic vignette, roughly 600 characters long.
Tone: ancient myth crossed with internet-era irony. Third person. Present tense preferred.

Hard constraints:
- Return ONLY the chapter prose. No title, no "Chapter 1:" header, no preamble, no markdown, no bullet lists, no JSON.
- Do not use emoji, hashtags, or URLs.
- Do not repeat the token name more than twice.`;

export const CONTINUATION_SYSTEM_PROMPT = `You are a mythographer continuing an ongoing on-chain saga.
Write the NEXT chapter only, roughly 300-500 characters long.
Preserve the established voice and timeline from the chapters provided.

Hard constraints:
- Return ONLY the new chapter's prose. No title, no "Chapter N:" header, no preamble, no markdown, no bullet lists, no JSON.
- Do NOT reintroduce the setting, characters, or premise already established in prior chapters.
- Do NOT repeat plot points already present in the provided chapters — advance the story.
- Do not use emoji, hashtags, or URLs.`;

function buildFirstChapterUserPrompt(input: LoreExtendInput): string {
  return [
    `Token name: ${input.tokenName}`,
    `Token symbol: ${input.tokenSymbol}`,
    `Token address: ${input.tokenAddr}`,
    '',
    'Write Chapter 1 now.',
  ].join('\n');
}

/**
 * Trim `previousChapters` to fit the context-window budget described at the
 * top of this file. Returned chapters preserve timeline ordering (oldest
 * first) so the numbering rendered in the user prompt stays contiguous.
 */
export function capPreviousChapters(chapters: readonly string[]): string[] {
  // Step 1: bounded count — keep only the last MAX_CONTEXT_CHAPTERS entries.
  const recent = chapters.slice(-MAX_CONTEXT_CHAPTERS);
  if (recent.length === 0) return [];

  // Step 2: char budget — newest first, accumulate until adding the next
  // older chapter would exceed MAX_CONTEXT_CHARS. Surviving chapters are
  // then reversed back to oldest-first so the prompt reads chronologically.
  const kept: string[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const body = recent[i]!;
    if (kept.length === 0 && body.length > MAX_CONTEXT_CHARS) {
      // Truncate the head of the most recent chapter: preserve the opening,
      // append a visible marker so the LLM treats the rest as missing.
      const head = body.slice(0, MAX_CONTEXT_CHARS - TRUNCATION_SUFFIX.length);
      kept.push(head + TRUNCATION_SUFFIX);
      total += MAX_CONTEXT_CHARS;
      continue;
    }
    if (total + body.length > MAX_CONTEXT_CHARS) {
      break;
    }
    kept.push(body);
    total += body.length;
  }
  return kept.reverse();
}

function buildContinuationUserPrompt(input: LoreExtendInput, chapterNumber: number): string {
  const capped = capPreviousChapters(input.previousChapters);
  // Renumber from the first surviving chapter: if MAX_CONTEXT_CHAPTERS /
  // char budget drops older entries, the remaining tail is still logically
  // the most recent N. We label them Chapter 1..N within the prompt so the
  // LLM reads them as a contiguous block; the real `chapterNumber` in the
  // sign-off line still tells the model which chapter it is writing.
  const priorBlock = capped
    .map((body, idx) => `--- Chapter ${(idx + 1).toString()} ---\n${body.trim()}`)
    .join('\n\n');

  return [
    `Token name: ${input.tokenName}`,
    `Token symbol: ${input.tokenSymbol}`,
    `Token address: ${input.tokenAddr}`,
    `Target chapter number: ${chapterNumber.toString()}`,
    '',
    'Prior chapters (for continuity only — do NOT restate):',
    priorBlock,
    '',
    `Write Chapter ${chapterNumber.toString()} now.`,
  ].join('\n');
}

export interface LoreExtendToolConfig {
  anthropic: Anthropic;
  pinataJwt: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface PinataPinResponse {
  IpfsHash: string;
  PinSize?: number;
  Timestamp?: string;
}

async function uploadToPinata(args: {
  fetchImpl: typeof fetch;
  jwt: string;
  file: File;
}): Promise<string> {
  const form = new FormData();
  form.append('file', args.file);

  const response = await args.fetchImpl(PINATA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.jwt}`,
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `extend_lore: pinata upload failed: HTTP ${response.status.toString()} ${response.statusText}${
        detail ? ` — ${detail}` : ''
      }`,
    );
  }

  const json = (await response.json()) as PinataPinResponse;
  if (!json.IpfsHash || json.IpfsHash.trim() === '') {
    throw new Error('extend_lore: pinata upload returned no IpfsHash');
  }
  return json.IpfsHash;
}

export function createLoreExtendTool(
  cfg: LoreExtendToolConfig,
): AgentTool<LoreExtendInput, LoreExtendOutput> {
  if (!cfg.pinataJwt || cfg.pinataJwt.trim() === '') {
    throw new Error('createLoreExtendTool: pinataJwt must be a non-empty string');
  }

  const model = cfg.model ?? 'anthropic/claude-sonnet-4-5';
  const fetchImpl = cfg.fetchImpl ?? fetch;

  return {
    name: 'extend_lore',
    description:
      'Given a token and its previously written lore chapters, write the NEXT chapter ' +
      '(first chapter ~600 chars; continuation 300-500 chars, advancing the timeline ' +
      'without reintroducing the setting), pin it to IPFS via Pinata, and return ' +
      '{ chapterNumber, chapterText, ipfsHash, ipfsUri }.',
    // Cast: zod `.default([])` produces a schema whose input type differs
    // from its output type (`string[] | undefined` vs `string[]`), but the
    // AgentTool contract expects a single type T. We expose the
    // post-default (output) shape as LoreExtendInput — this is safe because
    // `execute()` always runs `loreExtendInputSchema.parse(input)` before
    // touching fields.
    inputSchema: loreExtendInputSchema as unknown as z.ZodType<LoreExtendInput>,
    outputSchema: loreExtendOutputSchema,
    async execute(input) {
      const parsed = loreExtendInputSchema.parse(input);
      const isFirst = parsed.previousChapters.length === 0;
      const chapterNumber = parsed.targetChapterNumber ?? parsed.previousChapters.length + 1;

      const systemPrompt = isFirst ? FIRST_CHAPTER_SYSTEM_PROMPT : CONTINUATION_SYSTEM_PROMPT;
      const userPrompt = isFirst
        ? buildFirstChapterUserPrompt(parsed)
        : buildContinuationUserPrompt(parsed, chapterNumber);

      const response = await cfg.anthropic.messages.create({
        model,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      if (!('content' in response)) {
        throw new Error('extend_lore: expected non-streaming Message response');
      }

      const chapterText = extractText(response).trim();
      if (chapterText.length === 0) {
        throw new Error('extend_lore: LLM returned empty chapter body');
      }

      const filename = `${parsed.tokenSymbol}-ch${chapterNumber.toString()}.txt`;
      const file = new File([chapterText], filename, { type: 'text/plain' });

      const ipfsHash = await uploadToPinata({
        fetchImpl,
        jwt: cfg.pinataJwt,
        file,
      });

      const ipfsUri = `${GATEWAY_BASE}/ipfs/${ipfsHash}`;

      return loreExtendOutputSchema.parse({
        chapterNumber,
        chapterText,
        ipfsHash,
        ipfsUri,
      });
    },
  };
}
