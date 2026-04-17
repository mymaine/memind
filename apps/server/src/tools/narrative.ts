import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';
import { type AnthropicMessagesClient, extractText, parseJsonFromText } from './_anthropic.js';

/**
 * narrative_generator — given a user-supplied theme, ask Claude for a
 * four.meme-compatible token narrative.
 *
 * four.meme token rules enforced here:
 *   - name  <= 50 chars
 *   - symbol 3-8 uppercase letters/digits
 *   - description <= 200 chars
 *
 * Hackathon hard rule (AGENTS.md #4b): both `name` and `symbol` MUST start
 * with `HBNB2026-` so the demo tokens are not mistaken for real project
 * tokens. We instruct the model to do this AND verify it in-code — models
 * occasionally drop prefixes.
 */

const HBNB_PREFIX = 'HBNB2026-';

// Symbol body (after the `HBNB2026-` prefix) must still fit within the 3-8 char
// four.meme rule? Actually four.meme allows up to 8 chars total; we relax the
// rule for hackathon tokens — the literal `HBNB2026-` prefix is longer than
// that on its own. Accept up to 32 chars total so the prefix plus a short
// identifier fits. Document clearly below.
const SYMBOL_MAX = 32;
const NAME_MAX = 50;
const DESC_MAX = 200;

export const narrativeInputSchema = z.object({
  theme: z.string().min(3, 'theme must be at least 3 chars').max(280, 'theme must be <= 280 chars'),
});
export type NarrativeInput = z.infer<typeof narrativeInputSchema>;

export const narrativeOutputSchema = z.object({
  name: z
    .string()
    .min(HBNB_PREFIX.length + 1)
    .max(NAME_MAX)
    .regex(/^HBNB2026-/, 'name must start with HBNB2026-'),
  symbol: z
    .string()
    .min(HBNB_PREFIX.length + 1)
    .max(SYMBOL_MAX)
    .regex(/^HBNB2026-[A-Z0-9]{1,8}$/, 'symbol must match HBNB2026-[A-Z0-9]{1,8}'),
  description: z.string().min(1).max(DESC_MAX),
});
export type NarrativeOutput = z.infer<typeof narrativeOutputSchema>;

const SYSTEM_PROMPT = `You generate token metadata for a hackathon memecoin.

Return ONLY a JSON object with these fields and no extra commentary:
{
  "name":        string,  // <= ${String(NAME_MAX)} chars, MUST start with literal "${HBNB_PREFIX}"
  "symbol":      string,  // format: ${HBNB_PREFIX}<SUFFIX> where <SUFFIX> is 1-8 uppercase A-Z0-9
  "description": string   // <= ${String(DESC_MAX)} chars, punchy, 1-2 sentences
}

Rules:
- The "${HBNB_PREFIX}" prefix on both name and symbol is MANDATORY. This is a hackathon identifier to keep demo tokens distinguishable from real tokens. Do not omit it.
- Keep the suffix short and memorable — a single word or acronym is ideal.
- Do not wrap the JSON in markdown fences. Return raw JSON only.`;

function buildUserPrompt(theme: string): string {
  return `Theme: ${theme}\n\nGenerate the token metadata JSON now.`;
}

export interface CreateNarrativeToolOptions {
  client: AnthropicMessagesClient;
  model?: string;
  maxTokens?: number;
}

export function createNarrativeTool(
  options: CreateNarrativeToolOptions,
): AgentTool<NarrativeInput, NarrativeOutput> {
  const model = options.model ?? 'claude-sonnet-4-5';
  const maxTokens = options.maxTokens ?? 512;

  return {
    name: 'narrative_generator',
    description:
      'Generate four.meme-compatible token metadata (name, symbol, description) from a ' +
      'free-form theme. Use this first in the Creator flow to anchor the token identity ' +
      'before image generation and lore. Output is pre-validated to enforce the hackathon ' +
      'HBNB2026- prefix on name and symbol.',
    inputSchema: narrativeInputSchema,
    outputSchema: narrativeOutputSchema,
    async execute(input) {
      const { theme } = narrativeInputSchema.parse(input);

      const response = await options.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(theme) }],
      });

      // Anthropic's non-streaming `create` resolves to `Message`; the
      // overloaded return type includes `Stream` too, so narrow by shape.
      if (!('content' in response)) {
        throw new Error('narrative_generator: expected non-streaming Message response');
      }

      const text = extractText(response);
      const parsed = parseJsonFromText(text);
      // Final output-shape validation — also catches missing HBNB2026- prefix
      // even if the LLM ignored the system prompt rule.
      return narrativeOutputSchema.parse(parsed);
    },
  };
}
