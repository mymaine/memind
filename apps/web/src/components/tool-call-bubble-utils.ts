/**
 * Pure helpers extracted from ToolCallBubble so the rendering logic can be
 * unit-tested without React / jsdom.
 */
import type { ToolCallState } from '@/hooks/useRun-state';

export type ToolBubbleTone = 'running' | 'ok' | 'error';

export function toolBubbleTone(call: ToolCallState): ToolBubbleTone {
  if (call.status === 'running') return 'running';
  return call.isError ? 'error' : 'ok';
}

/**
 * Serialise an input/output payload for display. Truncates very long values
 * so a 10KB image metadata blob doesn't overflow the bubble. Returns a
 * human-readable string — not JSON guarantee-round-trip.
 */
const MAX_PREVIEW_CHARS = 600;

export function formatToolPayload(payload: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2);
  } catch {
    text = String(payload);
  }
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  return (
    text.slice(0, MAX_PREVIEW_CHARS) +
    `\n… (${(text.length - MAX_PREVIEW_CHARS).toString()} more chars truncated)`
  );
}
