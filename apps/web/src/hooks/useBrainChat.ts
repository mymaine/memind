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
import {
  EMPTY_BRAIN_CHAT_ACTIVITY,
  useRunStateMirror,
  type BrainChatActivity,
} from './useRunStateContext';

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
  /**
   * Append an arbitrary pre-built turn (user / assistant / heartbeat) to the
   * transcript without touching the server. Used by SSE-driven surfaces such
   * as the Heartbeat stream, which pushes tick results as new bubbles while
   * the Brain run itself has already finished.
   */
  appendTurn(turn: BrainChatTurn): void;
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
  // UAT bug fix (Memind demo): mirror SSE logs + artifacts into the
  // shared RunStateContext so the FooterDrawer tabs (Logs / Artifacts /
  // Brain Console) reflect brain-chat activity. useBrainChat runs a
  // dedicated run that useRun never sees; without this bridge the demo
  // footer stays empty while the panel is busy streaming.
  const mirror = useRunStateMirror();
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
  // Latest BrainChat activity snapshot. We keep it in a ref so per-event
  // mutations (incrementing eventCount on every SSE event) do not churn
  // React state or re-render the transcript rows — the activity only
  // needs to reach the context subscribers (BrainIndicator / BrainPanel).
  const activityRef = useRef<BrainChatActivity>(EMPTY_BRAIN_CHAT_ACTIVITY);
  const publishActivity = useCallback(
    (next: BrainChatActivity): void => {
      activityRef.current = next;
      mirror.setBrainChatActivity(next);
    },
    [mirror],
  );

  // Mirror `state.turns` into a ref so `send()` can read the latest committed
  // transcript synchronously. React 18 batches state updates and does NOT
  // guarantee that a `setState(prev => ...)` updater runs synchronously within
  // the calling scope — the previous pattern (assigning `prev.turns` to an
  // outer `priorTurns` variable from inside the updater) relied on an eager
  // bailout path that only fires when there are no other pending updates. In
  // the Memind demo this silently dropped the whole transcript on every
  // follow-up send, so the Brain LLM saw just the latest user turn and
  // "forgot" the token it had just deployed (2026-04-20 UAT regression).
  const turnsRef = useRef<readonly BrainChatTurn[]>(EMPTY_BRAIN_CHAT_STATE.turns);
  useEffect(() => {
    turnsRef.current = state.turns;
  }, [state.turns]);

  // Keep the latest mirror in a ref so the unmount cleanup below can call
  // into it without subscribing to mirror identity changes. The provider's
  // `setBrainChatActivity` is a stable useCallback reference, but the
  // surrounding `mirror` object is re-created on every context value
  // update — including ones we trigger ourselves when we publish activity.
  // Subscribing the cleanup effect to `mirror` would therefore re-fire on
  // every SSE event we handle and close the EventSource we just opened,
  // leaving the chat in a perma-thinking state (regression observed on
  // first send after this file shipped).
  const mirrorRef = useRef(mirror);
  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);

  // Close any live EventSource on unmount — same leak guard as useRun. We
  // also reset the published activity so the indicator drops back to IDLE
  // when the BrainPanel host tree is torn down mid-stream. Deps MUST stay
  // empty so this only fires on real unmount.
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      activityRef.current = EMPTY_BRAIN_CHAT_ACTIVITY;
      mirrorRef.current.setBrainChatActivity(EMPTY_BRAIN_CHAT_ACTIVITY);
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
    // Clear the ref synchronously so a `send` that fires in the same tick
    // (e.g. /reset immediately followed by a new command) doesn't replay the
    // stale transcript.
    turnsRef.current = EMPTY_BRAIN_CHAT_STATE.turns;
    setState(EMPTY_BRAIN_CHAT_STATE);
    // Drop the published activity so the indicator / panel meta rows
    // collapse back to IDLE + `idle` TICK immediately on reset.
    activityRef.current = EMPTY_BRAIN_CHAT_ACTIVITY;
    mirror.setBrainChatActivity(EMPTY_BRAIN_CHAT_ACTIVITY);
  }, [mirror]);

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

      // Reset activity to `sending` on every new turn. currentAgent
      // defaults to null — we pick it up from the first `tool_use:start`
      // or `assistant:delta` event coming off the stream. eventCount
      // restarts at zero so the TICK row tracks per-send rhythm, not
      // a cumulative lifetime count.
      publishActivity({ status: 'sending', currentAgent: null, eventCount: 0 });

      // Snapshot the prior transcript from the ref BEFORE scheduling the
      // state update. The ref reflects the latest committed `state.turns`
      // via the mirror effect above, so we never rely on React invoking the
      // setState updater synchronously (see the turnsRef comment).
      const priorTurns = turnsRef.current;
      // Keep the ref in lockstep with the turns we are about to append so a
      // rapid back-to-back `send` (before the next commit / effect flush)
      // still sees the freshly-added pair.
      turnsRef.current = [...priorTurns, userTurn, assistantTurn];

      setState((prev) => ({
        ...prev,
        turns: [...prev.turns, userTurn, assistantTurn],
        status: 'sending',
        errorMessage: null,
      }));

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
        // Flip activity to streaming the moment POST resolves. The SSE
        // stream may not have delivered its first event yet, but the
        // EventSource is open and we want the indicator to reflect "wire
        // is live". We intentionally preserve the (still zero) eventCount
        // instead of incrementing — events themselves bump the counter.
        publishActivity({
          status: 'streaming',
          currentAgent: activityRef.current.currentAgent,
          eventCount: activityRef.current.eventCount,
        });

        const es = new EventSource(`${SSE_ORIGIN}/api/runs/${runId}/events`);
        esRef.current = es;

        // Per-event activity bookkeeping. Bumps eventCount by 1 and, when
        // the event carries an agent id, rotates currentAgent to that
        // persona so the indicator + BrainPanel meta row stay in sync
        // with whoever the run is routing through. Artifact envelopes
        // (no agent) pass `null` and the previous currentAgent sticks.
        const bumpActivity = (agent: AgentId | null): void => {
          const prev = activityRef.current;
          // Guard against late-arriving events after `status:done` /
          // `status:error` — never reopen the ONLINE pill.
          if (prev.status !== 'sending' && prev.status !== 'streaming') return;
          publishActivity({
            status: 'streaming',
            currentAgent: agent ?? prev.currentAgent,
            eventCount: prev.eventCount + 1,
          });
        };

        es.addEventListener('assistant:delta', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as AssistantDeltaEventPayload;
            updateActiveTurn((turn) => applyAssistantDelta(turn, data));
            bumpActivity(data.agent);
          } catch {
            // Malformed payload — ignore; schema guarantees server well-formed.
          }
        });

        es.addEventListener('tool_use:start', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as ToolUseStartEventPayload;
            toolAgentByIdRef.current.set(data.toolUseId, data.agent);
            updateActiveTurn((turn) => applyToolUseStart(turn, data));
            bumpActivity(data.agent);
          } catch {
            // Ignore malformed tool_use:start payloads.
          }
        });

        es.addEventListener('tool_use:end', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as ToolUseEndEventPayload;
            toolAgentByIdRef.current.set(data.toolUseId, data.agent);
            updateActiveTurn((turn) => applyToolUseEnd(turn, data));
            bumpActivity(data.agent);
          } catch {
            // Ignore malformed tool_use:end payloads.
          }
        });

        es.addEventListener('log', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as LogEvent;
            // Mirror EVERY log (including brain-own) into the shared
            // RunStateContext so the FooterDrawer Logs tab shows the full
            // brain-chat activity stream — the user explicitly wants to
            // see what the brain is thinking mid-run.
            mirror.pushLog(data);
            // Only nest persona logs (agent != brain) in the BrainChat
            // transcript. Brain-own logs are opaque (its own thinking
            // output) and we prefer the user sees tool_use pills +
            // assistant:delta content instead of duplicating the reply.
            if (data.agent !== 'brain') {
              updateActiveTurn((turn) => applyPersonaLog(turn, data));
            }
            bumpActivity(data.agent);
          } catch {
            // Ignore malformed log payloads.
          }
        });

        es.addEventListener('artifact', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data as string) as Artifact;
            // Mirror every artifact into the shared RunStateContext so the
            // FooterDrawer Artifacts tab renders brain-chat pills alongside
            // useRun-sourced ones.
            mirror.pushArtifact(data);
            // Artifacts come without an agent tag on the envelope; we use the
            // most recent persona the ActiveRunStore observed (approximated by
            // the `toolAgentByIdRef` map). Fallback to 'brain' if we never
            // saw a tool event — a legal edge case for synthetic tests.
            const lastAgent =
              Array.from(toolAgentByIdRef.current.values()).pop() ?? ('brain' as const);
            updateActiveTurn((turn) => applyPersonaArtifact(turn, data, lastAgent));
            // Artifact envelopes carry no agent id, so we carry forward the
            // last known currentAgent (same semantics as the turn renderer).
            bumpActivity(null);
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
              // Reset activity so the indicator / TICK row drops back to
              // IDLE once the run wraps.
              publishActivity(EMPTY_BRAIN_CHAT_ACTIVITY);
            } else if (data.status === 'error') {
              const message = data.errorMessage ?? 'run failed';
              setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
              es.close();
              esRef.current = null;
              activeAssistantIdRef.current = null;
              // Surface the error to the status bar but keep the last
              // eventCount so the user can see the cadence at the
              // moment of failure. currentAgent drops to null because
              // the run is no longer routing through any persona.
              publishActivity({
                status: 'error',
                currentAgent: null,
                eventCount: activityRef.current.eventCount,
              });
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
        // Surface the failure to the indicator so it doesn't stay pinned
        // at ONLINE after a POST / open-handshake failure.
        publishActivity({
          status: 'error',
          currentAgent: null,
          eventCount: activityRef.current.eventCount,
        });
      } finally {
        sendingRef.current = false;
      }
    },
    [updateActiveTurn, mirror, publishActivity],
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
    // Keep the ref in sync so a follow-up `send` in the same tick still
    // carries this local echo in the transcript payload.
    turnsRef.current = [...turnsRef.current, synthetic];
    setState((prev) => ({ ...prev, turns: [...prev.turns, synthetic] }));
  }, []);

  const appendTurn = useCallback((turn: BrainChatTurn): void => {
    // Keep the ref in sync so a follow-up `send` in the same tick sees the
    // newly-appended turn in the prior-transcript snapshot.
    turnsRef.current = [...turnsRef.current, turn];
    setState((prev) => ({ ...prev, turns: [...prev.turns, turn] }));
  }, []);

  return {
    turns: state.turns,
    status: state.status,
    errorMessage: state.errorMessage,
    send,
    reset,
    appendLocalAssistant,
    appendTurn,
  };
}
