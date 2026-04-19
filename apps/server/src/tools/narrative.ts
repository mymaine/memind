import { z } from 'zod';
import type { AgentTool } from '@hack-fourmeme/shared';
import { type AnthropicMessagesClient, extractText, parseJsonFromText } from './_anthropic.js';

/**
 * narrative_generator — given a user-supplied theme, ask Claude for a
 * four.meme-compatible token narrative.
 *
 * four.meme token rules enforced here:
 *   - name  <= 20 chars (four.meme create-api: "size must be between 0 and 20")
 *   - symbol 3-8 uppercase letters/digits
 *   - description <= 200 chars, shell-safe (no apostrophes / quotes /
 *     backticks / backslashes) because the downstream four-meme-ai CLI pipes
 *     the description into an inner shell invocation that does not escape it
 *     — an unbalanced quote crashes the deploy with `unexpected EOF`.
 *
 * Hackathon hard rule: both `name` and `symbol` MUST start with `HBNB2026-`
 * so the demo tokens are not mistaken for real project tokens. We instruct the
 * model to do this AND verify it in-code — models occasionally drop prefixes.
 */

const HBNB_PREFIX = 'HBNB2026-';

/**
 * LLMs occasionally ignore the system-prompt constraints (e.g. return a
 * 9-char suffix like `SHIBANAUT`, lowercase letters, or drop the
 * `HBNB2026-` prefix entirely). Rather than bubble the zod error up to the
 * dashboard — which blocks the whole Creator flow and kills the demo — we
 * coerce the model output into the canonical shape before validation. Only
 * deterministic, content-preserving edits: case up, strip disallowed chars,
 * clamp to 8-char suffix, re-attach prefix. A completely empty body falls
 * back to `MEME` so zod's min-length check still has something to bite on.
 */
function coerceSymbolValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let body = raw.trim();
  if (body.startsWith(HBNB_PREFIX)) body = body.slice(HBNB_PREFIX.length);
  body = body.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (body.length > 8) body = body.slice(0, 8);
  if (body.length < 1) body = 'MEME';
  return `${HBNB_PREFIX}${body}`;
}

/**
 * Mirror guard for `name`. Name allows mixed-case letters + digits + a few
 * punctuation marks per four.meme rules, but has a hard 20-char ceiling. We
 * only fix the two most common LLM slips: missing prefix and over-long
 * suffix. Leave the body as the model returned it so the human-readable
 * narrative survives.
 */
function coerceNameValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let body = raw.trim();
  if (body.startsWith(HBNB_PREFIX)) body = body.slice(HBNB_PREFIX.length);
  const suffixMax = NAME_MAX - HBNB_PREFIX.length;
  if (body.length > suffixMax) body = body.slice(0, suffixMax);
  if (body.length < 1) body = 'Meme';
  return `${HBNB_PREFIX}${body}`;
}

// four.meme create-api hard-fails with `"size must be between 0 and 20"` above
// 20 chars on `name`. The `HBNB2026-` prefix alone is 9 chars, leaving 11 for
// the suffix — keep names terse.
const NAME_MAX = 20;
// Symbol body (after the `HBNB2026-` prefix) still fits four.meme's 3-8 char
// rule in practice; we relax to 32 total so the literal `HBNB2026-` prefix
// plus a short identifier fits.
const SYMBOL_MAX = 32;
const DESC_MAX = 200;

// Shell-unsafe punctuation that the downstream four-meme-ai CLI fails to
// escape before re-invoking /bin/sh (observed: `Supreme Leader's` → unbalanced
// quote → `/bin/sh: unexpected EOF`). We strip rather than escape so the
// description remains plain readable text. Curly quotes are replaced with
// their straight equivalents so the sentence still reads well.
const SHELL_UNSAFE_CHARS = /['"`\\$]/g;
function sanitizeDescription(raw: string): string {
  return raw
    .replace(/[\u2018\u2019]/g, '')
    .replace(/[\u201c\u201d]/g, '')
    .replace(SHELL_UNSAFE_CHARS, '')
    .trim();
}

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
  description: z.string().min(1).max(DESC_MAX).transform(sanitizeDescription),
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
- Name has a HARD ${String(NAME_MAX)}-char cap. The prefix alone is ${String(HBNB_PREFIX.length)} chars, so the suffix has ${String(NAME_MAX - HBNB_PREFIX.length)} chars max — one short word, no spaces.
- Do NOT use apostrophes ('), quotes ("), backticks, or backslashes anywhere in the description. The downstream deploy pipeline is shell-unsafe. Use plain prose, e.g. "Supreme Leaders coin" not "Supreme Leader's coin".
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
  const model = options.model ?? 'anthropic/claude-sonnet-4-5';
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
      const parsed = parseJsonFromText(text) as Record<string, unknown>;
      // Coerce common LLM slips before zod so a 9-char suffix or missing
      // prefix does not blow up the whole Creator flow. See helpers above.
      if ('symbol' in parsed) parsed.symbol = coerceSymbolValue(parsed.symbol);
      if ('name' in parsed) parsed.name = coerceNameValue(parsed.name);
      // Final output-shape validation — catches anything the coercers miss
      // (wrong types, absent fields, description too long, etc.).
      return narrativeOutputSchema.parse(parsed);
    },
  };
}
