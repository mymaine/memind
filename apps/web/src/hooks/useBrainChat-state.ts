/**
 * Pure state reducer + types for the `useBrainChat` hook (BRAIN-P4 Task 1).
 *
 * Extracted from the hook so the event-aggregation logic is unit-testable in
 * node (no jsdom / no React) — mirrors `useRun-state.ts` in spirit. The hook
 * wires these reducers into `setState(prev => ...)` callbacks; every function
 * here is pure (takes prev turn + payload, returns next turn) and never
 * mutates its inputs.
 *
 * BrainChat conceptual model:
 *   - A `BrainChatTurn` is either a user message (plain text, right-aligned
 *     bubble) or an assistant message whose `content` is the Brain LLM's own
 *     reply text, and whose `brainEvents[]` is an ordered inline stream of
 *     nested tool / persona / artifact events.
 *   - Brain-authored `assistant:delta` events append into `content`; every
 *     other agent's delta is routed into `brainEvents` as a
 *     `persona-delta` sub-event so the UI can render persona-level streaming
 *     as a distinct sub-block without polluting the main reply.
 *   - Every `tool_use:start|end`, `log`, and `artifact` event — regardless of
 *     which agent emitted it — is appended to `brainEvents` in wire order so
 *     the UI can render the exact sequence the Brain produced.
 *
 * Why `brainEvents` is optional on user turns: we tag the discriminant on
 * `role` so TypeScript keeps user / assistant rendering paths honest, and
 * because a user turn can never accumulate nested events.
 */
import type {
  AgentId,
  Artifact,
  AssistantDeltaEventPayload,
  ChatMessage,
  LogEvent,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';

/**
 * Inline event payloads embedded in an assistant turn's `brainEvents` list.
 * Discriminated on `kind` so the UI can render each variety as its own
 * sub-block (pill for tool-use, indent + border-colour for persona streams).
 */
export type BrainChatEvent =
  | {
      readonly kind: 'assistant-delta';
      readonly agent: AgentId;
      readonly delta: string;
    }
  | {
      readonly kind: 'tool-use-start';
      readonly agent: AgentId;
      readonly toolName: string;
      readonly toolUseId: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly kind: 'tool-use-end';
      readonly agent: AgentId;
      readonly toolName: string;
      readonly toolUseId: string;
      readonly output: Record<string, unknown>;
      readonly isError: boolean;
    }
  | {
      readonly kind: 'persona-log';
      readonly agent: AgentId;
      readonly tool: string;
      readonly message: string;
      readonly level: LogEvent['level'];
    }
  | {
      readonly kind: 'persona-artifact';
      readonly agent: AgentId;
      readonly artifact: Artifact;
    };

export interface BrainChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  /**
   * For user turns: the literal typed text.
   * For assistant turns: accumulated Brain-authored `assistant:delta` text.
   */
  readonly content: string;
  /**
   * Present on assistant turns; `undefined` on user turns. An empty array is
   * a legal assistant turn state (no persona events yet).
   */
  readonly brainEvents?: readonly BrainChatEvent[];
}

export type BrainChatStatus = 'idle' | 'sending' | 'streaming' | 'error';

export interface BrainChatState {
  readonly turns: readonly BrainChatTurn[];
  readonly status: BrainChatStatus;
  readonly errorMessage: string | null;
}

/**
 * Canonical empty state — also the target of `reset()`. Reused by the hook's
 * initial `useState` call and by tests pinning the reset contract.
 */
export const EMPTY_BRAIN_CHAT_STATE: BrainChatState = {
  turns: [],
  status: 'idle',
  errorMessage: null,
};

/** Build a new user turn ready to be appended to `state.turns`. */
export function buildUserTurn(id: string, content: string): BrainChatTurn {
  return { id, role: 'user', content };
}

/**
 * Build a new assistant turn seeded with empty content + empty brainEvents.
 * The hook creates one of these immediately after a user turn is appended so
 * incoming SSE events (which always target "the most recent assistant turn")
 * have a stable handle to mutate.
 */
export function buildAssistantTurn(id: string): BrainChatTurn {
  return { id, role: 'assistant', content: '', brainEvents: [] };
}

/** Internal: push an event onto an assistant turn's brainEvents list. */
function appendEvent(turn: BrainChatTurn, event: BrainChatEvent): BrainChatTurn {
  const prev = turn.brainEvents ?? [];
  return { ...turn, brainEvents: [...prev, event] };
}

/**
 * Apply an `assistant:delta` SSE payload to an assistant turn.
 *
 * Routing rule:
 *   - agent='brain'   → accumulate into `content` (the Brain's own reply).
 *   - agent != brain  → append as a persona-delta brainEvent sub-block.
 *
 * The two-path routing is what lets the UI render the Brain reply as the
 * "main message text" while still showing creator / narrator / shiller /
 * heartbeat streaming as inline nested blocks.
 */
export function applyAssistantDelta(
  turn: BrainChatTurn,
  payload: AssistantDeltaEventPayload,
): BrainChatTurn {
  if (payload.agent === 'brain') {
    return { ...turn, content: turn.content + payload.delta };
  }
  return appendEvent(turn, {
    kind: 'assistant-delta',
    agent: payload.agent,
    delta: payload.delta,
  });
}

export function applyToolUseStart(
  turn: BrainChatTurn,
  payload: ToolUseStartEventPayload,
): BrainChatTurn {
  return appendEvent(turn, {
    kind: 'tool-use-start',
    agent: payload.agent,
    toolName: payload.toolName,
    toolUseId: payload.toolUseId,
    input: payload.input,
  });
}

export function applyToolUseEnd(
  turn: BrainChatTurn,
  payload: ToolUseEndEventPayload,
): BrainChatTurn {
  return appendEvent(turn, {
    kind: 'tool-use-end',
    agent: payload.agent,
    toolName: payload.toolName,
    toolUseId: payload.toolUseId,
    output: payload.output,
    isError: payload.isError,
  });
}

export function applyPersonaLog(turn: BrainChatTurn, log: LogEvent): BrainChatTurn {
  return appendEvent(turn, {
    kind: 'persona-log',
    agent: log.agent,
    tool: log.tool,
    message: log.message,
    level: log.level,
  });
}

/**
 * `agent` is passed explicitly because `Artifact` itself does not carry the
 * emitting agent id — the SSE layer sends agent on the outer envelope. The
 * hook reads agent from the originating log event or the persona adapter
 * that produced the artifact.
 */
export function applyPersonaArtifact(
  turn: BrainChatTurn,
  artifact: Artifact,
  agent: AgentId,
): BrainChatTurn {
  return appendEvent(turn, {
    kind: 'persona-artifact',
    agent,
    artifact,
  });
}

/**
 * Normalise a BrainChatTurn into the OpenAI-shaped ChatMessage payload the
 * server expects in POST /api/runs `{kind:'brain-chat', params:{messages}}`.
 * Drops UI-only fields (id, brainEvents) so the wire format matches the
 * Brain runtime's `chatMessageSchema`.
 */
export function turnToApiMessage(turn: BrainChatTurn): ChatMessage {
  return { role: turn.role, content: turn.content };
}
