import type Anthropic from '@anthropic-ai/sdk';

/**
 * Shared Anthropic helper for Creator-agent tools.
 *
 * Kept intentionally small: callers pass in their own `Anthropic` client
 * (constructed by the caller with an API key loaded from config) and this
 * module only handles the "ask Claude for JSON and parse it" shape common to
 * `narrative_generator` and `lore_writer`.
 *
 * Tools must NOT read `process.env` directly — inject the client through the
 * factory functions in each tool file. This keeps tools unit-testable with
 * mock clients that conform to `AnthropicMessagesClient`.
 */

// Minimal surface area we actually use. Typing against the full `Anthropic`
// class in tests would force tests to construct a real client; this lets a
// plain `{ messages: { create: vi.fn() } }` satisfy the signature.
export interface AnthropicMessagesClient {
  messages: {
    create: Anthropic['messages']['create'];
  };
}

/**
 * Extract the first text block's content from an Anthropic non-streaming
 * response. Throws if the response carries no text block (e.g. only tool_use).
 */
export function extractText(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  throw new Error('anthropic response contained no text block');
}

/**
 * Pull a JSON object out of a Claude text response. We instruct Claude to
 * reply with JSON only, but models sometimes still wrap it in ```json fences
 * or add a preamble, so we scan for the outermost balanced `{...}` region.
 */
export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  // Strip a leading ```json ... ``` fence if present.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch?.[1] ?? trimmed;

  // Fast path: candidate already parses.
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    // Fall through to bracket scan.
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`anthropic response was not valid JSON: ${candidate.slice(0, 200)}`);
  }
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch (err) {
    throw new Error(
      `anthropic response was not valid JSON after bracket scan: ${(err as Error).message}`,
    );
  }
}
