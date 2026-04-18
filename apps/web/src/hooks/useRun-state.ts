/**
 * Pure state reducers for the V2-P2 fine-grained SSE events consumed by
 * useRun. Extracted so the logic is testable without spinning up React /
 * EventSource in the tests — the hook proper just plumbs these into
 * setState(prev => ...) callbacks.
 *
 * Each reducer takes the current `toolCalls` / `assistantText` map and the
 * incoming event payload, and returns the next map. They always return a
 * fresh object (never mutate) so React's referential comparison triggers a
 * re-render.
 *
 * V2-P5 Task 6 also lives here: `describeStartRunError` turns the POST
 * /api/runs failure body into a user-facing toast string so the UI layer
 * can stay declarative.
 */
import type {
  AgentId,
  AssistantDeltaEventPayload,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';

export interface ToolCallState {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  isError?: boolean;
  status: 'running' | 'done';
}

export type ToolCallsByAgent = Record<AgentId, ToolCallState[]>;
export type AssistantTextByAgent = Record<AgentId, string>;

export const EMPTY_TOOL_CALLS: ToolCallsByAgent = {
  creator: [],
  narrator: [],
  'market-maker': [],
  heartbeat: [],
};

export const EMPTY_ASSISTANT_TEXT: AssistantTextByAgent = {
  creator: '',
  narrator: '',
  'market-maker': '',
  heartbeat: '',
};

export function applyToolUseStart(
  prev: ToolCallsByAgent,
  data: ToolUseStartEventPayload,
): ToolCallsByAgent {
  const existing = prev[data.agent] ?? [];
  const entry: ToolCallState = {
    id: data.toolUseId,
    toolName: data.toolName,
    input: data.input,
    status: 'running',
  };
  return { ...prev, [data.agent]: [...existing, entry] };
}

export function applyToolUseEnd(
  prev: ToolCallsByAgent,
  data: ToolUseEndEventPayload,
): ToolCallsByAgent {
  const existing = prev[data.agent] ?? [];
  // If the server delivered `tool_use:end` without a matching start (e.g.
  // we missed events during reconnect), append a synthetic done-state entry
  // so the user still sees *something*; otherwise update in place.
  const hasMatch = existing.some((c) => c.id === data.toolUseId);
  const next: ToolCallState[] = hasMatch
    ? existing.map((call) =>
        call.id === data.toolUseId
          ? {
              ...call,
              output: data.output,
              isError: data.isError,
              status: 'done',
            }
          : call,
      )
    : [
        ...existing,
        {
          id: data.toolUseId,
          toolName: data.toolName,
          input: {},
          output: data.output,
          isError: data.isError,
          status: 'done',
        },
      ];
  return { ...prev, [data.agent]: next };
}

export function applyAssistantDelta(
  prev: AssistantTextByAgent,
  data: AssistantDeltaEventPayload,
): AssistantTextByAgent {
  return {
    ...prev,
    [data.agent]: (prev[data.agent] ?? '') + data.delta,
  };
}

/**
 * Translate a failed POST /api/runs response into a user-facing message.
 *
 * The server returns:
 *   409 + `{ error: 'run_in_progress', existingRunId }` when another run is
 *   already active for the same tokenAddress (see RunStore.tryCreate).
 *   400 + `{ error: <reason>, details? }` for bad request bodies.
 *   5xx / other: fallback generic message.
 *
 * Kept deliberately small — only formatting, no side effects. `body` is the
 * parsed JSON (or `null` if parsing failed / the response had no body).
 */
export function describeStartRunError(
  status: number,
  body: { error?: unknown; existingRunId?: unknown } | null,
): string {
  const errorKind = body && typeof body.error === 'string' ? body.error : null;
  if (status === 409 && errorKind === 'run_in_progress') {
    return 'Another run is already in progress for this token. Wait for it to finish, then try again.';
  }
  if (status === 400 && typeof errorKind === 'string' && errorKind.length > 0) {
    return `Bad request: ${errorKind}`;
  }
  if (status >= 500) {
    return `Server error (${status.toString()}). Check the server logs and retry.`;
  }
  return errorKind ?? `POST /api/runs failed (${status.toString()})`;
}
