import { z } from 'zod';
import type { PinataSDK } from 'pinata';
import type { AgentTool } from '@hack-fourmeme/shared';
import { type AnthropicMessagesClient, extractText } from './_anthropic.js';

/**
 * lore_writer — generate a mythic-tone backstory for the token, pin it to
 * Pinata IPFS as a markdown file, and return both the CID and a public
 * gateway URL so the x402 `/lore/:addr` endpoint can serve the document.
 *
 * This tool encapsulates both the LLM call and the IPFS upload so the Creator
 * agent doesn't have to orchestrate two primitives. Lore length target is
 * 400-800 words (see spec.md Phase 2 Task 5). We don't parse JSON here — the
 * LLM returns raw markdown content and we wrap it with the token header.
 */

const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud';

export const loreInputSchema = z.object({
  tokenName: z.string().min(1).max(80),
  tokenSymbol: z.string().min(1).max(40),
  tokenDescription: z.string().min(1).max(400),
  theme: z.string().min(3).max(280),
});
export type LoreInput = z.infer<typeof loreInputSchema>;

export const loreOutputSchema = z.object({
  loreText: z.string().min(1),
  ipfsCid: z.string().min(1),
  gatewayUrl: z.string().url(),
});
export type LoreOutput = z.infer<typeof loreOutputSchema>;

const SYSTEM_PROMPT = `You are a mythographer writing lore for a memecoin.
Produce 2-3 paragraphs of mythic, narrative-voice prose (400-800 words total).
Tone: ancient myth crossed with internet-era irony. Write in third person.

Hard constraints:
- Return ONLY the lore prose. No title, no preamble, no markdown headers, no bullet lists, no JSON.
- Do not repeat the token name more than 3 times across the whole passage.
- No hashtags, no emoji, no URLs.`;

function buildUserPrompt(input: LoreInput): string {
  return [
    `Token name: ${input.tokenName}`,
    `Token symbol: ${input.tokenSymbol}`,
    `Pitch: ${input.tokenDescription}`,
    `User theme seed: ${input.theme}`,
    '',
    'Write the lore now.',
  ].join('\n');
}

function buildMarkdown(tokenName: string, loreText: string): string {
  return `# ${tokenName}\n\n${loreText.trim()}\n`;
}

export interface CreateLoreToolOptions {
  anthropic: AnthropicMessagesClient;
  pinata: PinataSDK;
  /**
   * Public IPFS gateway base (no trailing slash, no `/ipfs`). Defaults to
   * the Pinata public gateway which matches probe-pinata.ts.
   */
  publicGateway?: string;
  model?: string;
  maxTokens?: number;
}

export function createLoreTool(options: CreateLoreToolOptions): AgentTool<LoreInput, LoreOutput> {
  const model = options.model ?? 'anthropic/claude-sonnet-4-5';
  const maxTokens = options.maxTokens ?? 1500;
  const gatewayBase = options.publicGateway ?? DEFAULT_GATEWAY;

  return {
    name: 'lore_writer',
    description:
      'Generate mythic-tone lore prose (~400-800 words) for the token, wrap it in a ' +
      'markdown file, pin to IPFS via Pinata, and return the CID plus a public gateway ' +
      'URL. Call after narrative_generator once name, symbol, and description are final. ' +
      'The resulting CID is what the x402 /lore/:tokenAddr endpoint serves.',
    inputSchema: loreInputSchema,
    outputSchema: loreOutputSchema,
    async execute(input) {
      const parsed = loreInputSchema.parse(input);

      const response = await options.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(parsed) }],
      });

      if (!('content' in response)) {
        throw new Error('lore_writer: expected non-streaming Message response');
      }

      const loreText = extractText(response).trim();
      if (loreText.length === 0) {
        throw new Error('lore_writer: LLM returned empty lore body');
      }

      const markdown = buildMarkdown(parsed.tokenName, loreText);
      const filename = `lore-${parsed.tokenSymbol}-${Date.now().toString()}.md`;
      const file = new File([markdown], filename, { type: 'text/markdown' });

      // `upload.public.file` returns a builder; awaiting it resolves to the
      // upload response (which includes `cid`). Matches probe-pinata.ts.
      const upload = await options.pinata.upload.public.file(file);
      const cid = upload.cid;
      if (!cid || cid.trim() === '') {
        throw new Error('lore_writer: Pinata upload returned no CID');
      }

      const gatewayUrl = `${gatewayBase.replace(/\/$/, '')}/ipfs/${cid}`;

      return loreOutputSchema.parse({
        loreText,
        ipfsCid: cid,
        gatewayUrl,
      });
    },
  };
}
