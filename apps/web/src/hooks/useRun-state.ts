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
 *
 * V4.7-P4 Task 1 additions: the `RunState` shape, the canonical `IDLE_STATE`
 * singleton, and the imperative `performRunReset` helper that powers the
 * hook's new `resetRun()` method. Kept here (and not inside the hook) so we
 * can unit-test every reset side effect — EventSource.close(), ref nulling,
 * startingRef clearance, setState(IDLE_STATE) — without needing jsdom / RTL.
 */
import type {
  AgentId,
  Artifact,
  AssistantDeltaEventPayload,
  LogEvent,
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

/**
 * Full shape of a client-side run. Four discriminants keyed on `phase`:
 *   - idle:    no run has been started (runId null, no collections).
 *   - running: POST /api/runs resolved, SSE is open or about to be.
 *   - done:    server emitted `status: done`; SSE is closed.
 *   - error:   server emitted `status: error` or POST failed; SSE closed.
 *
 * Re-exported from useRun so existing `import { type RunState } from
 * '@/hooks/useRun'` consumers remain unchanged (spec §禁止改動 allows
 * internal moves, forbids external surface breakage).
 */
export type RunState =
  | {
      phase: 'idle';
      logs: [];
      artifacts: [];
      toolCalls: ToolCallsByAgent;
      assistantText: AssistantTextByAgent;
      runId: null;
      error: null;
    }
  | {
      phase: 'running';
      logs: LogEvent[];
      artifacts: Artifact[];
      toolCalls: ToolCallsByAgent;
      assistantText: AssistantTextByAgent;
      runId: string;
      error: null;
    }
  | {
      phase: 'done';
      logs: LogEvent[];
      artifacts: Artifact[];
      toolCalls: ToolCallsByAgent;
      assistantText: AssistantTextByAgent;
      runId: string;
      error: null;
    }
  | {
      phase: 'error';
      logs: LogEvent[];
      artifacts: Artifact[];
      toolCalls: ToolCallsByAgent;
      assistantText: AssistantTextByAgent;
      runId: string;
      error: string;
    };

/**
 * Canonical idle state. Reused by useRun's initial setState, by the reset
 * helper below, and directly in tests so there is one source of truth for
 * the idle shape.
 */
export const IDLE_STATE: RunState = {
  phase: 'idle',
  logs: [],
  artifacts: [],
  toolCalls: EMPTY_TOOL_CALLS,
  assistantText: EMPTY_ASSISTANT_TEXT,
  runId: null,
  error: null,
};

/**
 * Mutable ref shape matching React's useRef<T | null>.current contract but
 * decoupled from React so this module (and its tests) stay framework-free.
 */
export interface MutableRef<T> {
  current: T;
}

export interface PerformRunResetDeps {
  readonly esRef: MutableRef<EventSource | null>;
  readonly startingRef: MutableRef<boolean>;
  readonly setState: (next: RunState) => void;
}

/**
 * Imperative core of useRun's `resetRun()` method. Runs the three side
 * effects unconditionally regardless of the starting phase:
 *
 *   1. If an EventSource is still attached, close it and null the ref.
 *      The optional chain means idle / done / error starts (where the ref
 *      is already null) are a safe no-op on the transport.
 *   2. Clear the in-flight startRun guard so a subsequent startRun() can
 *      enter its critical section. The hook's try/finally already does
 *      this on the happy path, but reset enforces it unconditionally as a
 *      belt-and-braces measure for the interleaved-reset edge case.
 *   3. Push the canonical IDLE_STATE into React state.
 *
 * Covers the V4.7-P4 risk mitigation: "reset implementation must attempt
 * esRef.current?.close() and esRef.current = null regardless of current
 * phase" (see spec risk row for useRun.resetRun).
 */
export function performRunReset(deps: PerformRunResetDeps): void {
  if (deps.esRef.current) {
    deps.esRef.current.close();
    deps.esRef.current = null;
  }
  deps.startingRef.current = false;
  deps.setState(IDLE_STATE);
}

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
