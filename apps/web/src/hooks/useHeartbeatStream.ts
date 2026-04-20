'use client';

/**
 * useHeartbeatStream — owns a single EventSource subscription against the
 * server's heartbeat SSE endpoint (`GET /api/heartbeats/:tokenAddr/events`).
 *
 * The server contract (frozen) emits three named events:
 *   - `initial`       : sent once right after connect; carries the current
 *                        `HeartbeatSessionState | null` snapshot.
 *   - `tick`          : sent on every fire (success / error / overlap-skip /
 *                        auto-stop); payload matches `HeartbeatTickEvent`.
 *   - `session-ended` : sent once after the last tick when the server closes
 *                        the session cleanly. We close the EventSource on
 *                        receipt so the browser does not auto-reconnect.
 *
 * The hook is intentionally minimal:
 *   - tokenAddr === null             → no connection, status stays 'idle'.
 *   - tokenAddr changes              → close prior source, open a new one.
 *   - session-ended                  → close + transition to 'ended'. The
 *                                       caller is responsible for deciding
 *                                       whether to swap in another tokenAddr.
 *   - transport `error` while open   → flip to 'error' and let the browser's
 *                                       native EventSource reconnect handle
 *                                       transient network issues. We do NOT
 *                                       manually retry — the server only ends
 *                                       the stream cleanly via session-ended.
 *
 * A `createEventSource` test seam is accepted so the node-env vitest suite
 * (no jsdom, no `EventSource` global) can inject a MockEventSource.
 */
import { useEffect, useRef, useState } from 'react';
import type { HeartbeatSessionState, HeartbeatTickEvent } from '@hack-fourmeme/shared';

// Mirrors the SSE_ORIGIN rule in useRun / useBrainChat: the Next.js dev
// rewrite proxy buffers SSE bodies, so EventSource must hit the origin
// directly. Kept as a module constant (not a hook dep) so the ref is stable.
const SSE_ORIGIN =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SERVER_ORIGIN
    ? process.env.NEXT_PUBLIC_SERVER_ORIGIN
    : 'http://localhost:4000';

export type HeartbeatStreamStatus = 'idle' | 'connecting' | 'open' | 'ended' | 'error';

export interface UseHeartbeatStreamOptions {
  /** `null` = no subscription; setting a string (re-)opens the stream. */
  readonly tokenAddr: string | null;
  /** Override the server origin — defaults to the same SSE_ORIGIN as useRun. */
  readonly baseUrl?: string;
  readonly onInitial?: (snapshot: HeartbeatSessionState | null) => void;
  readonly onTick: (event: HeartbeatTickEvent) => void;
  readonly onEnded?: (snapshot: HeartbeatSessionState) => void;
  readonly onError?: (err: Event) => void;
  /**
   * Test seam: inject a factory so the vitest node env (no global
   * EventSource) can pass in a MockEventSource. Production callers omit this
   * and get the browser built-in.
   */
  readonly createEventSource?: (url: string) => EventSource;
}

export interface UseHeartbeatStreamResult {
  readonly status: HeartbeatStreamStatus;
}

export function useHeartbeatStream(options: UseHeartbeatStreamOptions): UseHeartbeatStreamResult {
  const { tokenAddr, baseUrl, onInitial, onTick, onEnded, onError, createEventSource } = options;

  const [status, setStatus] = useState<HeartbeatStreamStatus>('idle');

  // Stash the latest callbacks on refs so the subscription effect only
  // re-runs when `tokenAddr` / `baseUrl` change — not on every render that
  // refreshes inline arrow functions passed by the parent.
  const onInitialRef = useRef(onInitial);
  const onTickRef = useRef(onTick);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  onInitialRef.current = onInitial;
  onTickRef.current = onTick;
  onEndedRef.current = onEnded;
  onErrorRef.current = onError;

  useEffect(() => {
    if (tokenAddr === null) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');

    const origin = baseUrl ?? SSE_ORIGIN;
    const url = `${origin}/api/heartbeats/${tokenAddr}/events`;
    const factory = createEventSource ?? ((u: string): EventSource => new EventSource(u));
    const es = factory(url);

    let closed = false;
    const safeClose = (): void => {
      if (closed) return;
      closed = true;
      try {
        es.close();
      } catch {
        // Never throw out of cleanup — the browser close() is synchronous.
      }
    };

    es.addEventListener('open', () => {
      setStatus('open');
    });

    es.addEventListener('initial', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as {
          tokenAddr: string;
          snapshot: HeartbeatSessionState | null;
        };
        onInitialRef.current?.(data.snapshot);
      } catch {
        // Malformed payload — ignore; schema guarantees the server shape.
      }
    });

    es.addEventListener('tick', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as HeartbeatTickEvent;
        onTickRef.current(data);
      } catch {
        // Ignore malformed tick payloads.
      }
    });

    es.addEventListener('session-ended', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as {
          tokenAddr: string;
          snapshot: HeartbeatSessionState;
        };
        onEndedRef.current?.(data.snapshot);
      } catch {
        // Ignore malformed session-ended payloads — still close the source.
      }
      safeClose();
      setStatus('ended');
    });

    es.addEventListener('error', (event: Event) => {
      onErrorRef.current?.(event);
      // EventSource.CLOSED === 2. When the browser has abandoned the
      // connection, mark the hook errored so the caller can render a fallback.
      // Transient drops surface as readyState === CONNECTING (1); leave the
      // browser's built-in reconnect to handle those.
      if (es.readyState === 2) {
        setStatus('error');
      }
    });

    return () => {
      safeClose();
    };
  }, [tokenAddr, baseUrl, createEventSource]);

  return { status };
}
