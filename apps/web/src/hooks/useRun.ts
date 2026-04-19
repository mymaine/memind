'use client';

/**
 * Owns the full lifecycle of a single run on the client:
 *   1. POST /api/runs → receive runId
 *   2. Open EventSource at /api/runs/:id/events
 *   3. Dispatch native SSE event types (log / artifact / status) to React state
 *   4. Close the stream on terminal status (done / error)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Artifact,
  AssistantDeltaEventPayload,
  CreateRunRequest,
  CreateRunResponse,
  LogEvent,
  StatusEventPayload,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import {
  EMPTY_ASSISTANT_TEXT,
  EMPTY_TOOL_CALLS,
  IDLE_STATE,
  applyAssistantDelta,
  applyToolUseEnd,
  applyToolUseStart,
  describeStartRunError,
  performRunReset,
  type AssistantTextByAgent,
  type RunState,
  type ToolCallState,
  type ToolCallsByAgent,
} from './useRun-state';

// Re-export so existing consumers can import these from useRun.
export type { AssistantTextByAgent, RunState, ToolCallState, ToolCallsByAgent };

export interface UseRunResult {
  state: RunState;
  startRun: (input: CreateRunRequest) => Promise<void>;
  /**
   * V4.7-P4 Task 1: force the run lifecycle back to idle.
   *
   * Closes any live EventSource, nulls `esRef`, clears the in-flight
   * guard, and pushes IDLE_STATE into React state. Safe from every
   * starting phase (idle / running / done / error); idle is effectively
   * a no-op on the transport but still a state-reset on principle.
   *
   * Consumers: LaunchPanel `Run another`, OrderPanel `Order another`.
   */
  resetRun: () => void;
}

// Bypass the Next.js dev rewrite proxy for the SSE stream. The rewrite is
// implemented via undici fetch under the hood and buffers the response body,
// which kills the live log stream (events only flush after the run finishes).
// POST /api/runs still goes through the proxy — buffering a single JSON
// response is fine. EventSource needs to hit the origin server directly.
const SSE_ORIGIN =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SERVER_ORIGIN
    ? process.env.NEXT_PUBLIC_SERVER_ORIGIN
    : 'http://localhost:4000';

export function useRun(): UseRunResult {
  const [state, setState] = useState<RunState>(IDLE_STATE);
  // Hold the EventSource across renders so cleanup can close it, and so the
  // guard against a second concurrent startRun can see it.
  const esRef = useRef<EventSource | null>(null);
  // Track whether a startRun is in flight (from fetch through to SSE open).
  // State transitions in React 18/19 StrictMode are intentionally double
  // invoked on mount; fetch + POST are side effects we must not double-fire.
  const startingRef = useRef(false);

  // Cleanup on unmount: close any live EventSource so we do not leak a
  // connection or keep firing setState into an unmounted component.
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  const startRun = useCallback(async (input: CreateRunRequest): Promise<void> => {
    // Idempotent guard: a second call while one is in flight is a no-op.
    if (startingRef.current) return;
    if (esRef.current) return;
    startingRef.current = true;

    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        // V2-P5 Task 6: parse the server error body and turn it into a toast-
        // friendly message (concurrency 409 gets a specific phrase).
        let parsed: { error?: unknown; existingRunId?: unknown } | null = null;
        try {
          parsed = (await res.json()) as { error?: unknown; existingRunId?: unknown };
        } catch {
          parsed = null;
        }
        throw new Error(describeStartRunError(res.status, parsed));
      }
      const body = (await res.json()) as CreateRunResponse;
      const { runId } = body;
      if (!runId) throw new Error('server returned empty runId');

      setState({
        phase: 'running',
        logs: [],
        artifacts: [],
        toolCalls: EMPTY_TOOL_CALLS,
        assistantText: EMPTY_ASSISTANT_TEXT,
        runId,
        error: null,
      });

      const es = new EventSource(`${SSE_ORIGIN}/api/runs/${runId}/events`);
      esRef.current = es;

      es.addEventListener('log', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as LogEvent;
          setState((prev) => {
            if (prev.phase !== 'running' && prev.phase !== 'done' && prev.phase !== 'error') {
              return prev;
            }
            return { ...prev, logs: [...prev.logs, data] };
          });
        } catch {
          // Malformed payload — ignore; the server contract should prevent this.
        }
      });

      es.addEventListener('artifact', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Artifact;
          setState((prev) => {
            if (prev.phase !== 'running' && prev.phase !== 'done' && prev.phase !== 'error') {
              return prev;
            }
            return { ...prev, artifacts: [...prev.artifacts, data] };
          });
        } catch {
          // Ignore malformed artifact payloads — server contract should prevent.
        }
      });

      // V2-P2 fine-grained events. All three share the same "only mutate when
      // we have a live run record" guard as `log` and `artifact`.

      es.addEventListener('tool_use:start', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as ToolUseStartEventPayload;
          setState((prev) => {
            if (prev.phase !== 'running' && prev.phase !== 'done' && prev.phase !== 'error') {
              return prev;
            }
            return { ...prev, toolCalls: applyToolUseStart(prev.toolCalls, data) };
          });
        } catch {
          // Ignore malformed payloads.
        }
      });

      es.addEventListener('tool_use:end', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as ToolUseEndEventPayload;
          setState((prev) => {
            if (prev.phase !== 'running' && prev.phase !== 'done' && prev.phase !== 'error') {
              return prev;
            }
            return { ...prev, toolCalls: applyToolUseEnd(prev.toolCalls, data) };
          });
        } catch {
          // Ignore malformed payloads.
        }
      });

      es.addEventListener('assistant:delta', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as AssistantDeltaEventPayload;
          setState((prev) => {
            if (prev.phase !== 'running' && prev.phase !== 'done' && prev.phase !== 'error') {
              return prev;
            }
            return { ...prev, assistantText: applyAssistantDelta(prev.assistantText, data) };
          });
        } catch {
          // Ignore malformed payloads.
        }
      });

      es.addEventListener('status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as StatusEventPayload;
          if (data.status === 'done') {
            setState((prev) => {
              if (prev.phase === 'idle') return prev;
              return {
                phase: 'done',
                logs: prev.logs,
                artifacts: prev.artifacts,
                toolCalls: prev.toolCalls,
                assistantText: prev.assistantText,
                runId: prev.runId ?? runId,
                error: null,
              };
            });
            es.close();
            esRef.current = null;
          } else if (data.status === 'error') {
            const message = data.errorMessage ?? 'run failed';
            setState((prev) => {
              if (prev.phase === 'idle') return prev;
              return {
                phase: 'error',
                logs: prev.logs,
                artifacts: prev.artifacts,
                toolCalls: prev.toolCalls,
                assistantText: prev.assistantText,
                runId: prev.runId ?? runId,
                error: message,
              };
            });
            es.close();
            esRef.current = null;
          }
        } catch {
          // Ignore malformed status payloads.
        }
      });

      // Transport-level error (socket drop etc). EventSource will try to
      // reconnect on its own; we surface it only if the stream never opened.
      es.addEventListener('error', () => {
        if (es.readyState === EventSource.CLOSED) {
          esRef.current = null;
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        phase: 'error',
        logs: prev.phase === 'idle' ? [] : prev.logs,
        artifacts: prev.phase === 'idle' ? [] : prev.artifacts,
        toolCalls: prev.phase === 'idle' ? EMPTY_TOOL_CALLS : prev.toolCalls,
        assistantText: prev.phase === 'idle' ? EMPTY_ASSISTANT_TEXT : prev.assistantText,
        runId: prev.phase === 'idle' ? '' : (prev.runId ?? ''),
        error: message,
      }));
    } finally {
      startingRef.current = false;
    }
  }, []);

  // V4.7-P4 Task 1: imperative reset wired to the pure helper in
  // useRun-state.ts. The useCallback wrapper keeps the returned function
  // reference stable across renders so `Run another` button onClick
  // handlers don't remount.
  const resetRun = useCallback((): void => {
    performRunReset({ esRef, startingRef, setState });
  }, []);

  return { state, startRun, resetRun };
}
