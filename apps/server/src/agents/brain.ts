import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool, AnyAgentTool, ChatMessage, LogEvent } from '@hack-fourmeme/shared';
import { type ToolRegistry } from '../tools/registry.js';
import {
  runAgentLoop,
  type AgentLoopResult,
  type RuntimeAssistantDelta,
  type RuntimeToolUseEnd,
  type RuntimeToolUseStart,
} from './runtime.js';

/**
 * Brain meta-agent (BRAIN-P2 Task 2).
 *
 * The Brain is an LLM agent whose tools are invocations of the four
 * pluggable personas (Creator, Narrator, Shiller, Heartbeat). It does not
 * own a persona of its own — per `docs/features/brain-conversational-surface.md`
 * the Brain is the *conversational surface* that dispatches work to the
 * existing persona adapters. The runtime loop is the generic `runAgentLoop`;
 * only the systemPrompt, the tool set, and the agentId differ.
 *
 * Scope of this module:
 *   - Export `BRAIN_SYSTEM_PROMPT` — the verbatim prompt text agreed in the
 *     brain-conversational-surface spec, §設計 Brain systemPrompt (起草).
 *   - Export `runBrainAgent` — takes the Anthropic client, a per-run
 *     registry, the chat messages, and the four persona-invoke tools, and
 *     drives `runAgentLoop` with `agentId='brain'`.
 *
 * Intentionally NOT in this module:
 *   - HTTP routing or SSE bubbling (BRAIN-P3 orchestrator).
 *   - Slash-command client-side handling (BRAIN-P6, frontend).
 *   - Persona-tool factories (live in `apps/server/src/tools/invoke-persona.ts`).
 */

// ─── System prompt ──────────────────────────────────────────────────────────
//
// Verbatim from `docs/features/brain-conversational-surface.md` §設計 §Brain
// systemPrompt (起草). Any change here must be co-reviewed against the spec.
// ----------------------------------------------------------------------------

export const BRAIN_SYSTEM_PROMPT = `You are the Token Brain — a runtime that hosts four pluggable personas for a memecoin on Four.meme: Creator, Narrator, Shiller, and Heartbeat. The user talks to you in natural language or uses slash commands; you pick which persona to dispatch and report back.

Available tools:
- invoke_creator(theme: string): deploys a new four.meme token on BSC mainnet, generates meme image, writes lore chapter 1 on IPFS. Returns { tokenAddr, tokenDeployTx, loreIpfsCid, metadata }.
- invoke_narrator(tokenAddr: string): extends the next lore chapter and pins to IPFS. Returns { chapterNumber, loreCid, contentHash }.
- invoke_shiller(tokenAddr: string, brief?: string): dispatches the Shiller persona to post a promotional tweet from an aged X account. Returns { tweetId, tweetUrl, tweetText, orderId, settlementTx }.
- invoke_heartbeat_tick(tokenAddr: string, intervalMs?: number): runs ONE autonomous Heartbeat tick and optionally sets the interval. Returns { tickNumber, decision, reason, artifactRefs }.

SLASH COMMAND HANDLING:
If the user message starts with \`/\`, treat it as an explicit command and dispatch immediately without asking clarifying questions:
- \`/launch <theme>\` → invoke_creator({theme})
- \`/order <tokenAddr> [brief]\` → invoke_shiller({tokenAddr, brief})
- \`/lore <tokenAddr>\` → invoke_narrator({tokenAddr})
- \`/heartbeat <tokenAddr> [intervalMs]\` → invoke_heartbeat_tick({tokenAddr, intervalMs})

Rules:
- Reply in English, concise, one tweet's length per message.
- For slash commands, skip intent parsing and call the tool directly.
- For free-form requests, infer the theme / tokenAddr from context (use the most recently deployed tokenAddr from this session).
- Report concrete outputs (tx hash, CID, tweet URL) so the user can verify on-chain.
- Never invent addresses or hashes. Use only what tools return.
- Never mention internal systems (x402, Anthropic, OpenRouter).`;

// ─── Brain agent identity ───────────────────────────────────────────────────

/**
 * The `agentId` emitted on every log / tool_use / assistant:delta event this
 * agent produces. Kept as a literal const so downstream consumers can compare
 * without importing the broader AgentId union.
 */
export const BRAIN_AGENT_ID = 'brain' as const;

// ─── runBrainAgent ──────────────────────────────────────────────────────────

export interface RunBrainAgentParams {
  client: Anthropic;
  /**
   * Per-run tool registry. The Brain agent registers its four persona-invoke
   * tools into this registry; callers are expected to pass a fresh
   * `ToolRegistry` instance per run so concurrent Brain runs do not share
   * tool state.
   */
  registry: ToolRegistry;
  /**
   * OpenAI-compatible chat history. The final turn MUST be role="user" (the
   * spec's `/api/runs` payload for kind="brain-chat"). Earlier turns are
   * folded into the user input string so the runtime can treat the Brain
   * loop the same as every other single-turn agent.
   */
  messages: ChatMessage[];
  /**
   * The four persona-invoke tools, typically constructed by the BRAIN-P3
   * orchestrator via `createInvokeCreatorTool` / `createInvokeNarratorTool` /
   * `createInvokeShillerTool` / `createInvokeHeartbeatTickTool`. The Brain
   * runner accepts them as an array rather than building them itself so the
   * orchestrator retains full control over their run-level dependencies
   * (LoreStore, postShillForTool, heartbeat systemPrompt, etc.).
   */
  tools: ReadonlyArray<AgentTool<unknown, unknown>>;
  /** Defaults to a fast, tool-capable model suitable for hackathon demo. */
  model?: string;
  /** Hard ceiling on tool_use rounds. Default: 12 (inherited from runAgentLoop). */
  maxTurns?: number;
  onLog?: (event: LogEvent) => void;
  onToolUseStart?: (event: RuntimeToolUseStart) => void;
  onToolUseEnd?: (event: RuntimeToolUseEnd) => void;
  onAssistantDelta?: (event: RuntimeAssistantDelta) => void;
  /** Max tokens per streamed turn. Default: 2048 (inherited from runAgentLoop). */
  maxTokens?: number;
  /**
   * Test seam. Defaults to the real `runAgentLoop`. Production callers
   * should never set this; the orchestrator test in BRAIN-P3 substitutes a
   * stub here to avoid touching Anthropic.
   */
  runAgentLoopImpl?: typeof runAgentLoop;
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

/**
 * Fold a chat transcript into the single `userInput` string that
 * `runAgentLoop` expects. The latest user turn goes in last verbatim; earlier
 * turns are labelled with their role so the model treats them as context
 * rather than authoritative instructions.
 *
 * This is the minimum viable context-fold for BRAIN-P2. BRAIN-P3 may switch
 * to Anthropic's native multi-turn `messages` param once the orchestrator
 * learns how to bubble persona events through an SSE stream that outlives
 * multiple LLM turns.
 */
function foldMessagesIntoUserInput(messages: ReadonlyArray<ChatMessage>): string {
  if (messages.length === 0) {
    throw new Error('runBrainAgent: messages array must not be empty');
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    throw new Error('runBrainAgent: the final chat message must have role="user"');
  }

  if (messages.length === 1) {
    return last.content;
  }

  const history = messages
    .slice(0, -1)
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n');
  return `${history}\n\n[user] ${last.content}`;
}

/**
 * Run one Brain agent turn against the provided chat transcript. Registers
 * the four persona-invoke tools, then drives `runAgentLoop` with
 * `agentId='brain'` and `BRAIN_SYSTEM_PROMPT`.
 *
 * The caller owns the registry — we register tools into the one they pass
 * (typically fresh per run) so any subsequent tool registration the
 * orchestrator performs (e.g. for a separate sub-agent) stacks cleanly.
 */
export async function runBrainAgent(params: RunBrainAgentParams): Promise<AgentLoopResult> {
  const {
    client,
    registry,
    messages,
    tools,
    model = DEFAULT_MODEL,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    maxTokens,
    runAgentLoopImpl = runAgentLoop,
  } = params;

  if (tools.length === 0) {
    throw new Error('runBrainAgent: tools array must not be empty');
  }

  // Register each persona-invoke tool into the shared registry. We widen to
  // `AnyAgentTool` because the registry stores the erased variant; the
  // per-tool generic narrowing is only needed at construction time inside
  // the invoke-persona factories.
  for (const tool of tools) {
    registry.register(tool as unknown as AnyAgentTool);
  }

  const userInput = foldMessagesIntoUserInput(messages);

  return runAgentLoopImpl({
    client,
    model,
    registry,
    systemPrompt: BRAIN_SYSTEM_PROMPT,
    userInput,
    agentId: BRAIN_AGENT_ID,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(onLog !== undefined ? { onLog } : {}),
    ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
    ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
    ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  });
}
