/**
 * Shared fence-tolerant JSON extractor for agent "final message" contracts.
 *
 * Every agent whose system prompt requires a single JSON object as its final
 * message uses this helper. Supported response shapes (in priority order):
 *
 *   1. Plain JSON object                           `{"decision":"skip"}`
 *   2. JSON inside a fenced code block              ```json\n{...}\n```
 *   3. Prose + JSON object (no fence)               The token shows... {"decision":"skip"}
 *   4. JSON + trailing prose                        {"decision":"skip"} That's my call.
 *
 * Shapes 3 and 4 arise when the model ignores the prompt's "no prose" rule
 * under reasoning pressure. Rather than crash the entire run, we fall back to
 * a balanced-brace scan and keep the last parseable top-level object.
 *
 * On failure the thrown Error always carries `agentName` in its message so
 * the original call-site remains visible in logs. Returns Record<string,
 * unknown> because every current agent's schema is an object at the top
 * level; callers run their own zod parse on the result.
 */
export function extractJsonObject(text: string, agentName: string): Record<string, unknown> {
  const trimmed = text.trim();

  // Shape 2: fenced code block — extract the inner content first.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const fenced = fenceMatch?.[1]?.trim();

  // Try in priority: fenced (if any) → trimmed as-is → balanced-brace scan.
  const candidates: string[] = [];
  if (fenced !== undefined && fenced !== '') candidates.push(fenced);
  candidates.push(trimmed);
  const scanned = findLastBalancedObject(trimmed);
  if (scanned !== null && !candidates.includes(scanned)) candidates.push(scanned);

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(
          `${agentName}: final message JSON was not an object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`,
        );
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      lastError = err;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${agentName}: final message was not valid JSON (${message}): ${trimmed.slice(0, 200)}`,
  );
}

/**
 * Scan `text` for all top-level `{...}` substrings (balanced braces, string
 * literals respected) and return the last one, or null if none found. Used
 * as a fallback when the model prepends reasoning prose or appends a
 * commentary line.
 */
function findLastBalancedObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  let last: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          last = text.slice(start, i + 1);
          start = -1;
        }
      }
    }
  }
  return last;
}
