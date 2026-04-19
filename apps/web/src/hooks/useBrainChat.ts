'use client';

/**
 * useBrainChat — BRAIN-P4 Task 1 client hook for the conversational surface.
 *
 * Owns the full lifecycle of a multi-turn Brain conversation:
 *   1. `send(content)` — append a user turn + seed an assistant turn, POST
 *      the accumulated messages to `/api/runs` with `kind: 'brain-chat'`,
 *      open an EventSource on `/api/runs/:id/events`, and dispatch SSE
 *      events into the most-recent assistant turn via the pure reducers in
 *      `useBrainChat-state.ts`.
 *   2. `reset()` — close any live EventSource + push the empty state back.
 *
 * Why a separate hook (not reuse `useRun`): `useRun` is one-shot (single run,
 * emphasises launch / order / heartbeat as exclusive states). BrainChat is
 * persistently multi-turn; every `send` opens a NEW run, then closes it when
 * the Brain returns `status: done`. State accumulates across runs in the
 * same hook instance.
 *
 * Per-scope instances: callers pass a `scope` parameter. The hook does NOT
 * share state between instances — each `useBrainChat('launch')` /
 * `useBrainChat('order')` call gets its own in-memory transcript. Same scope
 * twice in the same tree is a caller bug (and would produce two independent
 * histories); we don't memoise on scope because React's hooks rules guarantee
 * stable call sites anyway.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentId,
  Artifact,
  AssistantDeltaEventPayload,
  ChatMessage,
  CreateRunRequest,
  CreateRunResponse,
  LogEvent,
  StatusEventPayload,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import {
  applyAssistantDelta,
  applyPersonaArtifact,
  applyPersonaLog,
  applyToolUseEnd,
  applyToolUseStart,
  buildAssistantTurn,
  buildUserTurn,
  EMPTY_BRAIN_CHAT_STATE,
  turnToApiMessage,
  type BrainChatState,
  type BrainChatStatus,
  type BrainChatTurn,
} from './useBrainChat-state';

// Same SSE origin rule as useRun: the Next.js dev rewrite proxy buffers SSE,
// so EventSource hits the server origin directly. POST goes through the
// proxy (single JSON response, buffering is fine).
const SSE_ORIGIN =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SERVER_ORIGIN
    ? process.env.NEXT_PUBLIC_SERVER_ORIGIN
    : 'http://localhost:4000';

export type BrainChatScope = 'launch' | 'order' | 'heartbeat' | 'global';

export interface UseBrainChatResult {
  readonly turns: readonly BrainChatTurn[];
  readonly status: BrainChatStatus;
  readonly errorMessage: string | null;
  send(content: string): Promise<void>;
  reset(): void;
  /**
   * Append a synthesised assistant message WITHOUT contacting the server.
   * Used by client-side slash commands (`/status`, `/help`) to echo a reply
   * into the transcript. The resulting turn carries `brainEvents: []` so it
   * renders as a plain-text Memind reply (no pills, no nested blocks).
   */
  appendLocalAssistant(content: string): void;
}

/**
 * Generate a monotonically-unique turn id. `crypto.randomUUID()` is available
 * in modern browsers and node; fall back to a timestamp + counter in the rare
 * environment where it is not (avoids a crash during SSR-time imports).
 */
let turnIdCounter = 0;
function makeTurnId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through — some jsdom-less node envs expose crypto but not randomUUID.
  }
  turnIdCounter += 1;
  return `turn-${Date.now().toString()}-${turnIdCounter.toString()}`;
}

export function useBrainChat(scope: BrainChatScope): UseBrainChatResult {
  // Scope is reserved for future server-side branching (suggestion chips live
  // on the view layer). Kept in the signature so callers type the instance
  // deliberately and future expansion is non-breaking.
  void scope;

  const [state, setState] = useState<BrainChatState>(EMPTY_BRAIN_CHAT_STATE);
  const esRef = useRef<EventSource | null>(null);
  // Tracks the assistant-turn id the live SSE stream is writing into. We
  // identify the target turn by id (not "last element") so races between a
  // late-arriving event and a concurrent `send` never corrupt the wrong turn.
  const activeAssistantIdRef = useRef<string | null>(null);
  // Map toolUseId → agent, so `log` / `artifact` events arriving from the
  // server can be attributed back to the correct persona for rendering.
  // Rebuilt every run (the server-side run is a fresh toolUseId namespace).
  const toolAgentByIdRef = useRef<Map<string, AgentId>>(new Map());
  const sendingRef = useRef(false);

  // Close any live EventSource on unmount — same leak guard as useRun.
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  /**
   * Mutate the currently-active assistant turn via a reducer fn. Identified by
   * id so concurrent turns never clash. If the active id was cleared (reset
   * mid-stream), the update is a no-op.
   */
  const updateActiveTurn = useCallback((reducer: (turn: BrainChatTurn) => BrainChatTurn): void => {
    const targetId = activeAssistantIdRef.current;
    if (targetId === null) return;
    setState((prev) => ({
      ...prev,
      turns: prev.turns.map((t) => (t.id === targetId ? reducer(t) : t)),
    }));
  }, []);

  const reset = useCallback((): void => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    sendingRef.current = false;
    activeAssistantIdRef.current = null;
    toolAgentByIdRef.current = new Map();
    setState(EMPTY_BRAIN_CHAT_STATE);
  }, []);

  const send = useCallback(
    async (content: string): Promise<void> => {
      const trimmed = content.trim();
      if (trimmed === '') return;
      if (sendingRef.current) return;
      if (esRef.current) return;
      sendingRef.current = true;

      // Append user + seed assistant turn synchronously so the UI reflects
      // the send immediately. Capture the built messages payload from the
      // same snapshot we mutate state with — avoids racing `setState` with
      // the POST body composition.
      const userTurn = buildUserTurn(makeTurnId(), trimmed);
      const assistantTurn = buildAssistantTurn(makeTurnId());
      activeAssistantIdRef.current = assistantTurn.id;
      toolAgentByIdRef.current = new Map();

      let priorTurns: readonly BrainChatTurn[] = [];
      setState((prev) => {
        priorTurns = prev.turns;
        return {
          turns: [...prev.turns, userTurn, assistantTurn],
          status: 'sending',
          errorMessage: null,
        };
      });

      // Build the API payload from the prior transcript + new user turn.
      // We intentionally drop empty-content assistant turns (e.g. the seed
      // we just added) so the server never sees an assistant message with
      // `content: ''` (which `chatMessageSchema` rejects via `.min(1)`).
      const messages: ChatMessage[] = [...priorTurns, userTurn]
        .filter((t) => t.content.trim() !== '')
        .map(turnToApiMessage);

      try {
        const req: CreateRunRequest = {
          kind: 'brain-chat',
          params: { messages },
        };
        const res = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!res.ok) {
          let body: unknown = null;
          try {
            body = (await res.json()) as unknown;
          } catch {
            // body may be empty / non-JSON — fall through with null.
          }
          const reason =
            body !== null &&
            typeof body === 'object' &&
            'error' in body &&
            typeof (body as { error: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `POST /api/runs failed (${res.status.toString()})`;
          throw new Error(reason);
        }
        const json = (await res.json()) as CreateRunResponse;
        const { runId } = json;
        if (!runId) throw new Error('server returned empty runId');

        setState((prev) => ({ ...prev, status: 'streaming' }));

        const es = new EventSource(`${SSE_ORIGIN}/api/runs/${runId}/events`);
        esRef.current = es;

        es.addEventListener('assistant:delta', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as AssistantDeltaEventPayload;
            updateActiveTurn((turn) => applyAssistantDelta(turn, data));
          } catch {
            // Malformed payload — ignore; schema guarantees server well-formed.
          }
        });

        es.addEventListener('tool_use:start', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as ToolUseStartEventPayload;
            toolAgentByIdRef.current.set(data.toolUseId, data.agent);
            updateActiveTurn((turn) => applyToolUseStart(turn, data));
          } catch {
            // Ignore malformed tool_use:start payloads.
          }
        });

        es.addEventListener('tool_use:end', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as ToolUseEndEventPayload;
            toolAgentByIdRef.current.set(data.toolUseId, data.agent);
            updateActiveTurn((turn) => applyToolUseEnd(turn, data));
          } catch {
            // Ignore malformed tool_use:end payloads.
          }
        });

        es.addEventListener('log', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as LogEvent;
            // Only nest persona logs (agent != brain). Brain-own logs are
            // opaque (its own thinking output) and we prefer the user sees
            // tool_use pills + assistant:delta content instead.
            if (data.agent === 'brain') return;
            updateActiveTurn((turn) => applyPersonaLog(turn, data));
          } catch {
            // Ignore malformed log payloads.
          }
        });

        es.addEventListener('artifact', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as Artifact;
            // Artifacts come without an agent tag on the envelope; we use the
            // most recent persona the ActiveRunStore observed (approximated by
            // the `toolAgentByIdRef` map). Fallback to 'brain' if we never
            // saw a tool event — a legal edge case for synthetic tests.
            const lastAgent =
              Array.from(toolAgentByIdRef.current.values()).pop() ?? ('brain' as const);
            updateActiveTurn((turn) => applyPersonaArtifact(turn, data, lastAgent));
          } catch {
            // Ignore malformed artifact payloads.
          }
        });

        es.addEventListener('status', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as StatusEventPayload;
            if (data.status === 'done') {
              setState((prev) => ({ ...prev, status: 'idle' }));
              es.close();
              esRef.current = null;
              activeAssistantIdRef.current = null;
            } else if (data.status === 'error') {
              const message = data.errorMessage ?? 'run failed';
              setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
              es.close();
              esRef.current = null;
              activeAssistantIdRef.current = null;
            }
          } catch {
            // Ignore malformed status payloads.
          }
        });

        // Transport-level error (socket drop). EventSource retries on its
        // own; we surface only a closed stream so the hook never wedges.
        es.addEventListener('error', () => {
          if (es.readyState === EventSource.CLOSED) {
            esRef.current = null;
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
      } finally {
        sendingRef.current = false;
      }
    },
    [updateActiveTurn],
  );

  const appendLocalAssistant = useCallback((content: string): void => {
    // A local assistant echo is fully owned by the client — no SSE run, no
    // server touch. We synthesise a fresh turn id and freeze content so the
    // message renderer treats it like any other finished assistant turn.
    const synthetic: BrainChatTurn = {
      id: makeTurnId(),
      role: 'assistant',
      content,
      brainEvents: [],
    };
    setState((prev) => ({ ...prev, turns: [...prev.turns, synthetic] }));
  }, []);

  return {
    turns: state.turns,
    status: state.status,
    errorMessage: state.errorMessage,
    send,
    reset,
    appendLocalAssistant,
  };
}
