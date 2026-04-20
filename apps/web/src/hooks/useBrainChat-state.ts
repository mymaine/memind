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
  ChatMessageToolInvocation,
  HeartbeatSessionAction,
  HeartbeatTickEvent,
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

/**
 * Heartbeat turn payload — a self-contained snapshot of one tick event as
 * received over SSE. Rendered as a distinct bubble kind so the user can
 * distinguish background-scheduled Heartbeat output from Brain replies.
 */
export interface BrainChatHeartbeatPayload {
  readonly tokenAddr: string;
  readonly tickId: string;
  /** 1-indexed tick number (mirrors snapshot.tickCount after this tick). */
  readonly tickNumber: number;
  readonly maxTicks: number;
  readonly success: boolean;
  readonly action: HeartbeatSessionAction | null;
  readonly error?: string | null;
  readonly artifacts?: ReadonlyArray<Artifact>;
  readonly tickAt: string;
  /** Mirrors `snapshot.running`; `false` on the terminal tick (auto-stop). */
  readonly running: boolean;
}

export interface BrainChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'heartbeat';
  /**
   * For user turns: the literal typed text.
   * For assistant turns: accumulated Brain-authored `assistant:delta` text.
   * For heartbeat turns: a short human-readable summary of the tick result.
   */
  readonly content: string;
  /**
   * Present on assistant turns; `undefined` on user + heartbeat turns. An
   * empty array is a legal assistant turn state (no persona events yet).
   */
  readonly brainEvents?: readonly BrainChatEvent[];
  /**
   * Present on heartbeat turns only. Carries the structured tick payload so
   * the bubble can render a status chip + tokenAddr chip without re-parsing
   * the Markdown summary in `content`.
   */
  readonly heartbeat?: BrainChatHeartbeatPayload;
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
 * Build a heartbeat turn from one live SSE tick event. The `content` string
 * is a short, Markdown-friendly summary so the bubble reads naturally (tweet
 * URLs + IPFS gateway links become clickable) while the structured payload
 * on `heartbeat` drives the status chip / tokenAddr chip UI.
 *
 * Summary format by outcome:
 *   - success + action=post       + tweet-url artifact → `"Heartbeat tick N/M: posted tweet [link](<url>)"`
 *   - success + action=extend_lore + lore-cid artifact → `"Heartbeat tick N/M: wrote Chapter <n> ([ipfs://<cid>](<gateway>))"` (falls back to `ipfs://<cid>` if the gateway link is missing)
 *   - success + action=idle                              → `"Heartbeat tick N/M: idle"`
 *   - error                                              → `"Heartbeat tick N/M failed: <error>"`
 *   - running=false on this event                        → appends ` — loop auto-stopped at cap`
 */
export function buildHeartbeatTurn(id: string, payload: HeartbeatTickEvent): BrainChatTurn {
  const { snapshot, delta, artifacts } = payload;
  const combinedArtifacts: readonly Artifact[] = artifacts ?? delta.artifacts ?? [];
  const tickNumber = snapshot.tickCount;
  const maxTicks = snapshot.maxTicks;
  const action = delta.action ?? null;
  // LLM-authored rationale for this tick's decision. Empty / missing on
  // unparseable final text; treat that as "no reason" and skip the
  // em-dash suffix so the bubble stays clean.
  const rawReason = typeof delta.reason === 'string' ? delta.reason.trim() : '';
  const reason = rawReason !== '' && rawReason !== 'no reason provided' ? rawReason : null;
  const reasonSuffix = reason !== null ? ` — ${reason}` : '';
  const header = `Heartbeat tick ${tickNumber.toString()}/${maxTicks.toString()}`;

  let body: string;
  if (!delta.success) {
    const message = delta.error ?? snapshot.lastError ?? 'unknown error';
    body = `${header} failed: ${message}`;
  } else if (action === 'post') {
    const tweet = combinedArtifacts.find((a) => a.kind === 'tweet-url');
    if (tweet && tweet.kind === 'tweet-url') {
      body = `${header}: posted tweet [link](${tweet.url})${reasonSuffix}`;
    } else {
      body = `${header}: posted tweet${reasonSuffix}`;
    }
  } else if (action === 'extend_lore') {
    const lore = combinedArtifacts.find((a) => a.kind === 'lore-cid');
    if (lore && lore.kind === 'lore-cid') {
      const chapter = lore.chapterNumber ?? null;
      const label = chapter !== null ? `Chapter ${chapter.toString()}` : 'new chapter';
      body = `${header}: wrote ${label} ([ipfs://${lore.cid}](${lore.gatewayUrl}))${reasonSuffix}`;
    } else {
      body = `${header}: wrote new lore chapter${reasonSuffix}`;
    }
  } else if (action === 'idle') {
    body = `${header}: idle${reasonSuffix}`;
  } else {
    // Defensive fallback: the server contract says action is one of the
    // three above, but `action` is optional on `heartbeatTickDeltaSchema`
    // so a success without an action tag is technically legal (e.g. the
    // LLM's final text was unparseable).
    body = `${header}: ok${reasonSuffix}`;
  }

  if (snapshot.running === false) {
    body = `${body} — loop auto-stopped at cap`;
  }

  return {
    id,
    role: 'heartbeat',
    content: body,
    heartbeat: {
      tokenAddr: payload.tokenAddr,
      tickId: delta.tickId,
      tickNumber,
      maxTicks,
      success: delta.success,
      action,
      error: delta.error ?? null,
      ...(combinedArtifacts.length > 0 ? { artifacts: combinedArtifacts } : {}),
      tickAt: delta.tickAt,
      running: snapshot.running,
    },
  };
}

/**
 * Normalise a BrainChatTurn into the OpenAI-shaped ChatMessage payload the
 * server expects in POST /api/runs `{kind:'brain-chat', params:{messages}}`.
 * Drops UI-only fields (id, brainEvents) so the wire format matches the
 * Brain runtime's `chatMessageSchema`.
 *
 * Anti-fabrication fix (2026-04-20): assistant turns that recorded
 * Brain-level (agent='brain') tool_use events via their `brainEvents` list
 * round-trip their invocations on `toolInvocations`. The server re-expands
 * these into Anthropic-native `tool_use` + `tool_result` blocks so the LLM
 * sees the prior Chapter / Tweet / Deploy as a grounded tool call — not as
 * flat "Chapter 2 pinned! CID: Qm..." text it can pattern-match into
 * fabricated Chapter 3 CIDs. Persona-level tool events (agent!='brain',
 * e.g. narrator's internal `extend_lore`) are intentionally excluded: those
 * belong to the persona's private execution, not to the Brain's
 * conversational context.
 *
 * Heartbeat turns are folded back into `assistant` messages with a
 * `[heartbeat] ` prefix so the Brain LLM sees them as prior context on a
 * follow-up user turn, without confusing them with real user input.
 */
export function turnToApiMessage(turn: BrainChatTurn): ChatMessage {
  if (turn.role === 'heartbeat') {
    return { role: 'assistant', content: `[heartbeat] ${turn.content}` };
  }
  if (turn.role === 'assistant') {
    const toolInvocations = extractBrainToolInvocations(turn);
    if (toolInvocations.length > 0) {
      return { role: 'assistant', content: turn.content, toolInvocations };
    }
    return { role: 'assistant', content: turn.content };
  }
  return { role: turn.role, content: turn.content };
}

/**
 * Walk an assistant turn's `brainEvents` and return the matched
 * `tool-use-start` + `tool-use-end` pairs for Brain-level tool calls only.
 * Ignores persona-level events (agent != 'brain') and orphaned ends
 * (tool-use-end with no matching start). Never throws — any malformed state
 * collapses to an empty array so a rehydrate can never break a live send.
 */
function extractBrainToolInvocations(turn: BrainChatTurn): ChatMessageToolInvocation[] {
  const events = turn.brainEvents ?? [];
  if (events.length === 0) return [];
  try {
    const startById = new Map<string, { toolName: string; input: Record<string, unknown> }>();
    const out: ChatMessageToolInvocation[] = [];
    for (const ev of events) {
      if (ev.kind === 'tool-use-start' && ev.agent === 'brain') {
        startById.set(ev.toolUseId, { toolName: ev.toolName, input: ev.input });
        continue;
      }
      if (ev.kind === 'tool-use-end' && ev.agent === 'brain') {
        const match = startById.get(ev.toolUseId);
        if (match === undefined) continue;
        out.push({
          toolUseId: ev.toolUseId,
          toolName: match.toolName,
          input: match.input,
          output: ev.output,
          isError: ev.isError,
        });
        startById.delete(ev.toolUseId);
      }
    }
    return out;
  } catch {
    return [];
  }
}
