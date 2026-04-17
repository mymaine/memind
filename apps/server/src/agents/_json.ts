/**
 * Shared fence-tolerant JSON extractor for agent "final message" contracts.
 *
 * Every agent whose system prompt requires a single JSON object as its final
 * message uses this helper. Claude sometimes emits the object wrapped in a
 * ```json ... ``` fence (especially under tool-use pressure), and some prompt
 * iterations leak surrounding whitespace — this helper absorbs those shapes
 * so individual agents don't each reinvent the regex.
 *
 * On failure the thrown Error always carries `agentName` in its message so
 * the original call-site remains visible in logs. Returns Record<string,
 * unknown> because every current agent's schema is an object at the top
 * level; callers run their own zod parse on the result.
 */
export function extractJsonObject(text: string, agentName: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fenceMatch?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `${agentName}: final message JSON was not an object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`,
      );
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${agentName}: final message was not valid JSON (${message}): ${candidate}`);
  }
}
