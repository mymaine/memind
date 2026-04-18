'use client';

/**
 * Owns the full lifecycle of a single run on the client:
 *   1. POST /api/runs → receive runId
 *   2. Open EventSource at /api/runs/:id/events
 *   3. Dispatch native SSE event types (log / artifact / status) to React state
 *   4. Close the stream on terminal status (done / error)
 *
 * Wire protocol: docs/decisions/2026-04-20-sse-and-runs-api.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Artifact,
  CreateRunRequest,
  CreateRunResponse,
  LogEvent,
  StatusEventPayload,
} from '@hack-fourmeme/shared';

export type RunState =
  | { phase: 'idle'; logs: []; artifacts: []; runId: null; error: null }
  | { phase: 'running'; logs: LogEvent[]; artifacts: Artifact[]; runId: string; error: null }
  | { phase: 'done'; logs: LogEvent[]; artifacts: Artifact[]; runId: string; error: null }
  | { phase: 'error'; logs: LogEvent[]; artifacts: Artifact[]; runId: string; error: string };

const IDLE_STATE: RunState = {
  phase: 'idle',
  logs: [],
  artifacts: [],
  runId: null,
  error: null,
};

export interface UseRunResult {
  state: RunState;
  startRun: (input: CreateRunRequest) => Promise<void>;
}

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
        const text = await res.text().catch(() => '');
        throw new Error(`POST /api/runs failed: ${res.status} ${text || res.statusText}`);
      }
      const body = (await res.json()) as CreateRunResponse;
      const { runId } = body;
      if (!runId) throw new Error('server returned empty runId');

      setState({
        phase: 'running',
        logs: [],
        artifacts: [],
        runId,
        error: null,
      });

      const es = new EventSource(`/api/runs/${runId}/events`);
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
        runId: prev.phase === 'idle' ? '' : (prev.runId ?? ''),
        error: message,
      }));
    } finally {
      startingRef.current = false;
    }
  }, []);

  return { state, startRun };
}
