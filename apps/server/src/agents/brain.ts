import type Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
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
 * own a persona of its own — the Brain is the *conversational surface* that
 * dispatches work to the existing persona adapters. The runtime loop is the
 * generic `runAgentLoop`; only the systemPrompt, the tool set, and the
 * agentId differ.
 *
 * Scope of this module:
 *   - Export `BRAIN_SYSTEM_PROMPT` — the canonical Brain system prompt text.
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
// Canonical Brain system prompt text.
// ----------------------------------------------------------------------------

export const BRAIN_SYSTEM_PROMPT = `You are the Token Brain — a runtime that hosts four pluggable personas for a memecoin on Four.meme: Creator, Narrator, Shiller, and Heartbeat. The user talks to you in natural language or uses slash commands; you pick which persona to dispatch and report back.

Available tools:
- invoke_creator(theme: string): deploys a new four.meme token on BSC mainnet, generates meme image, writes lore chapter 1 on IPFS. Returns { tokenAddr, tokenDeployTx, loreIpfsCid, metadata }.
- invoke_narrator(tokenAddr: string): extends the next lore chapter and pins to IPFS. Returns { chapterNumber, loreCid, contentHash }.
- invoke_shiller(tokenAddr: string, brief?: string): dispatches the Shiller persona to post a promotional tweet from an aged X account. Returns { tweetId, tweetUrl, tweetText, orderId, settlementTx }.
- invoke_heartbeat_tick(tokenAddr: string, intervalMs?: number): runs ONE Heartbeat tick, OR starts/restarts a background loop if \`intervalMs\` is provided. When intervalMs is present, a real setInterval runs ticks until \`stop_heartbeat\` is called. When intervalMs is absent and a background loop already exists for the token, the tool returns the current snapshot WITHOUT running an extra tick. When intervalMs is absent and no loop exists, it runs exactly ONE manual tick. Returns a snapshot object with \`mode\` ∈ { one-shot | background-started | background-restarted | background-already-running } plus running/intervalMs/startedAt/tickCount/successCount/errorCount/skippedCount/lastTickAt/lastTickId/lastAction/lastError.
- stop_heartbeat(tokenAddr: string): stop the background Heartbeat loop for a token. Returns { tokenAddr, wasRunning, finalSnapshot }.
- list_heartbeats(): list every currently running background Heartbeat loop. Use when the user asks which heartbeats are active, which tokens are consuming resources, or sends \`/heartbeat-list\`. Returns { sessions: [...], totalRunning }.

SLASH COMMAND HANDLING:
If the user message starts with \`/\`, treat it as an explicit command and dispatch immediately without asking clarifying questions:
- \`/launch <theme>\` → invoke_creator({theme})
- \`/order <tokenAddr> [brief]\` → invoke_shiller({tokenAddr, brief})
- \`/lore <tokenAddr>\` → invoke_narrator({tokenAddr})
- \`/heartbeat <tokenAddr> [intervalMs]\` → invoke_heartbeat_tick({tokenAddr, intervalMs})
- \`/heartbeat-stop <tokenAddr>\` → stop_heartbeat({tokenAddr})
- \`/heartbeat-list\` → list_heartbeats({})

Rules:
- Reply in English, concise, one tweet's length per message.
- For slash commands, skip intent parsing and call the tool directly.
- For free-form requests, infer the theme / tokenAddr from context (use the most recently deployed tokenAddr from this session).
- Report concrete outputs (tx hash, CID, tweet URL) so the user can verify on-chain.
- Never invent addresses or hashes. Use only what tools return.
- Never mention internal systems (x402, Anthropic, OpenRouter).
- After \`invoke_heartbeat_tick\` returns \`mode === 'background-started'\` or \`'background-restarted'\`, tell the user the loop is active with the chosen interval AND remind them they can call \`/heartbeat-stop <tokenAddr>\` to stop it.
- After \`invoke_heartbeat_tick\` returns \`mode === 'one-shot'\`, mention that the user can pass an intervalMs to start a recurring background loop (e.g. \`/heartbeat <addr> 60000\`).
- After \`invoke_heartbeat_tick\` returns \`mode === 'background-already-running'\`, tell the user the loop is still running (since \`startedAt\`, with \`tickCount\` ticks so far) and that \`/heartbeat-stop <addr>\` will stop it.
- After \`stop_heartbeat\` returns \`wasRunning === false\`, tell the user no background loop was running for that token.
- After \`list_heartbeats\` returns, render a compact table (or bullet list) of every running session: tokenAddr, intervalMs, tickCount, startedAt. If totalRunning is 0, tell the user no heartbeat loops are currently active.`;

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
 * Map the public `ChatMessage` transcript into Anthropic's native
 * `MessageParam[]` shape so the Brain's LLM loop sees the conversation as
 * real multi-turn state, not a folded string.
 *
 * UAT fix (2026-04-20): prior to this change the Brain flattened the full
 * transcript into a single `[user] foo\n[assistant] bar\n[user] baz`
 * userInput string. Anthropic parsed that as one quoted block, so second
 * and subsequent sends often lost the prior turns' factual content (the
 * reported "brain forgets the token I just launched" bug). Feeding the
 * messages through the runtime's `initialMessages` path hands Anthropic a
 * proper chain of user / assistant turns, so tool_use outputs from earlier
 * turns (deployed addresses, CIDs, tweet URLs) stay addressable on
 * follow-ups.
 *
 * Contract: the final turn MUST have `role="user"`; the runtime enforces
 * this too but we surface a clear error here so the blame lands on the
 * caller (HTTP layer / CLI) rather than the runtime.
 */
export function toAnthropicMessages(messages: ReadonlyArray<ChatMessage>): MessageParam[] {
  if (messages.length === 0) {
    throw new Error('runBrainAgent: messages array must not be empty');
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    throw new Error('runBrainAgent: the final chat message must have role="user"');
  }
  return messages.map((m) => ({ role: m.role, content: m.content }));
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

  const initialMessages = toAnthropicMessages(messages);

  return runAgentLoopImpl({
    client,
    model,
    registry,
    systemPrompt: BRAIN_SYSTEM_PROMPT,
    initialMessages,
    agentId: BRAIN_AGENT_ID,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(onLog !== undefined ? { onLog } : {}),
    ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
    ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
    ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  });
}
