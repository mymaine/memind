import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  ToolChoice,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
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
- get_token_info(tokenAddr: string, include?: { identity?: boolean, narrative?: boolean, market?: boolean }): authoritative token facts read directly from the BSC chain + LoreStore. Call this before generating any content that mentions a token, AND before dispatching /order — the Shiller requires a verified symbol. Never infer symbol/name/market from lore text. Returns { tokenAddr, identity?, narrative?, market? }.
- invoke_creator(theme: string): deploys a new four.meme token on BSC mainnet, generates meme image, writes lore chapter 1 on IPFS. Returns { tokenAddr, tokenDeployTx, loreIpfsCid, metadata }.
- invoke_narrator(tokenAddr: string): extends the next lore chapter and pins to IPFS. Returns { chapterNumber, loreCid, contentHash }.
- invoke_shiller(tokenAddr: string, tokenSymbol: string, brief?: string): runs the full shill-market orchestrator — creator pays 0.01 USDC via x402 on Base Sepolia, then the Shiller persona posts a promotional tweet from an aged X account. tokenSymbol MUST come from get_token_info's identity.symbol — passing a guessed / lore-derived symbol produces fabricated tickers and is explicitly banned. The x402 settlement tx and shill-order state transitions surface in the on-chain Artifacts tab, not in this tool's return value. Returns { orderId, tokenAddr, decision, tweetId?, tweetUrl?, tweetText?, postedAt? }.
- invoke_heartbeat_tick(tokenAddr: string, intervalMs?: number, maxTicks?: number): runs ONE Heartbeat tick, OR starts/restarts a background loop if \`intervalMs\` is provided. When intervalMs is present, a real setInterval runs ticks until \`stop_heartbeat\` is called OR the tick cap is hit. Loops default to \`maxTicks = 5\` — pass a higher maxTicks to extend (e.g. user asks "run 20 heartbeats" → maxTicks: 20). When intervalMs is absent and a background loop already exists for the token, the tool returns the current snapshot WITHOUT running an extra tick. When intervalMs is absent and no loop exists, it runs exactly ONE manual tick. Returns a snapshot object with \`mode\` ∈ { one-shot | background-started | background-restarted | background-already-running } plus running/intervalMs/startedAt/maxTicks/tickCount/successCount/errorCount/skippedCount/lastTickAt/lastTickId/lastAction/lastError. When \`running === false\` AND \`tickCount >= maxTicks\`, the loop auto-stopped at the cap.
- stop_heartbeat(tokenAddr: string): stop the background Heartbeat loop for a token. Returns { tokenAddr, wasRunning, finalSnapshot }.
- list_heartbeats(): list every currently running background Heartbeat loop. Use when the user asks which heartbeats are active, which tokens are consuming resources, or sends \`/heartbeat-list\`. Returns { sessions: [...], totalRunning }.

SLASH COMMAND HANDLING:
If the user message starts with \`/\`, treat it as an explicit command and dispatch immediately without asking clarifying questions:
- \`/launch <theme>\` → invoke_creator({theme})
- \`/order <tokenAddr> [brief]\` → on this slash the runtime FORCES get_token_info as your turn 1 tool call (tool_choice); you cannot skip it. In your next turn, call invoke_shiller({tokenAddr, tokenSymbol: <the identity.symbol from the forced lookup>, brief}). The shiller's tokenSymbol is mandatory — only the symbol returned by that first get_token_info call is acceptable.
- \`/lore <tokenAddr>\` → invoke_narrator({tokenAddr})
- \`/heartbeat <tokenAddr> [intervalMs] [maxTicks]\` → invoke_heartbeat_tick({tokenAddr, intervalMs, maxTicks})
- \`/heartbeat-stop <tokenAddr>\` → stop_heartbeat({tokenAddr})
- \`/heartbeat-list\` → list_heartbeats({})

TOKEN IDENTITY RULE:
- If the user asks about a specific token by address, or references a token that needs factual verification, call \`get_token_info\` to get authoritative data before responding. The tool is cached (10-minute TTL) so repeated calls on the same token are cheap.

HARD NO-FABRICATION RULES (read these before every reply):
- EVERY slash command requires a FRESH tool call in the CURRENT turn. Prior tool outputs visible earlier in the conversation are background context ONLY — they NEVER satisfy a new slash command. If the user types \`/lore 0xabc\` three times in a row, you call invoke_narrator THREE times. Each call produces its own distinct chapter and CID; you must not reuse, paraphrase, or extrapolate from previous CIDs.
- NEVER write phrases like "Chapter N pinned to IPFS", "CID: Qm...", "Tweet posted: https://x.com/...", "Deployed at 0x...", "Tx: 0x..." UNLESS those exact strings came back from a tool call in THIS turn. If you have not called the tool yet this turn, you have no right to produce those strings — STOP and call the tool first.
- NEVER invent IPFS CIDs (strings starting with Qm or bafy), EVM addresses (0x...), transaction hashes, tweet URLs, or chapter content. These values exist on-chain / in IPFS; fabricating them misleads the user and breaks on-chain verifiability, which is the entire point of this product.
- The pattern "I already see a similar result earlier in the conversation, so I'll just generate a plausible next one" is the single most common failure mode for this agent. Recognise it and refuse: whatever you saw earlier belongs to that earlier turn, not this one.

Rules:
- Reply in the SAME language the user wrote in (match their language on every turn — if they switch mid-session, switch with them). Keep replies concise, roughly one tweet's length per message.
- For slash commands, skip intent parsing and call the tool directly — AND call it every time (see no-fabrication rules above).
- For free-form requests, infer the theme / tokenAddr from context (use the most recently deployed tokenAddr from this session).
- Report concrete outputs (tx hash, CID, tweet URL) so the user can verify on-chain.
- Never mention internal systems (x402, Anthropic, OpenRouter).
- After \`invoke_heartbeat_tick\` returns \`mode === 'background-started'\` or \`'background-restarted'\`, tell the user the loop is active with the chosen interval, the tick cap (\`maxTicks\`), AND remind them they can call \`/heartbeat-stop <tokenAddr>\` to stop it early. Make clear the loop will auto-stop at \`maxTicks\` — this is a safety rail against runaway demos.
- If a snapshot comes back with \`running === false\` AND \`tickCount >= maxTicks\`, explain the loop hit its tick cap and suggest \`/heartbeat <addr> <intervalMs> <higherMaxTicks>\` to resume with a larger cap.
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
   * Anthropic `tool_choice` override forwarded to the first LLM call of the
   * loop. Orchestrators pass `{type:'tool', name:'invoke_<persona>'}` on
   * slash-command turns (anti-fabrication fix 2026-04-20); free-form turns
   * leave it undefined. Turn 2+ of the runtime loop always uses auto.
   */
  toolChoice?: ToolChoice;
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
 * Anti-fabrication fix (2026-04-20): when an assistant message carries
 * `toolInvocations`, we re-expand them into native Anthropic content blocks
 * (assistant `tool_use` + synthetic user `tool_result`). This gives the LLM
 * a structural signal that the prior Chapter / Tweet / Deploy was grounded
 * in a real tool call — defeating the pattern-match "I saw 'Chapter 2 pinned
 * to IPFS! CID: Qm...' earlier, let me generate 'Chapter 3 pinned to IPFS!
 * CID: QmFake...' without calling the tool" failure mode. Pre-fix callers
 * (no `toolInvocations`) fall back to the flat-text MessageParam.
 *
 * Contract: the final turn MUST have `role="user"`; the runtime enforces
 * this too but we surface a clear error here so the blame lands on the
 * caller (HTTP layer / CLI) rather than the runtime.
 *
 * Zero-risk fallback: if reconstruction encounters a malformed invocation
 * (missing id, unparseable input, etc.) the expander reverts THIS turn to
 * flat text rather than throwing — history rehydration must never break a
 * live send. Defensive code lives inside `expandAssistantTurn`.
 */
export function toAnthropicMessages(messages: ReadonlyArray<ChatMessage>): MessageParam[] {
  if (messages.length === 0) {
    throw new Error('runBrainAgent: messages array must not be empty');
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    throw new Error('runBrainAgent: the final chat message must have role="user"');
  }

  const out: MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolInvocations && m.toolInvocations.length > 0) {
      const expanded = expandAssistantTurn(m);
      for (const entry of expanded) out.push(entry);
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

/**
 * Expand one assistant turn carrying `toolInvocations` into the Anthropic
 * native pair: `{role:'assistant', content:[text?, tool_use...]}` followed by
 * `{role:'user', content:[tool_result...]}`. Order matches the SDK convention
 * where the model emits text first, then tool_use blocks.
 *
 * Defensive: any malformed invocation (missing toolUseId / toolName, unusable
 * input shape) causes the whole turn to revert to flat text so rehydration
 * never throws out of the outer `toAnthropicMessages`.
 */
function expandAssistantTurn(m: ChatMessage): MessageParam[] {
  const invocations = m.toolInvocations ?? [];
  try {
    const assistantBlocks: ContentBlockParam[] = [];
    if (m.content.length > 0) {
      assistantBlocks.push({ type: 'text', text: m.content });
    }

    const toolResultBlocks: ToolResultBlockParam[] = [];
    for (const inv of invocations) {
      // Structural guard — empty id / name is a malformed entry we cannot
      // round-trip. Throwing here flips the catch branch to flat-text.
      if (inv.toolUseId === '' || inv.toolName === '') {
        throw new Error('toAnthropicMessages: malformed toolInvocation (empty id or name)');
      }
      const toolUseBlock: ToolUseBlockParam = {
        type: 'tool_use',
        id: inv.toolUseId,
        name: inv.toolName,
        input: inv.input,
      };
      assistantBlocks.push(toolUseBlock);

      // Stringify output for the wire, matching the runtime's live tool-
      // result shape. `is_error` is only set on failure (Anthropic treats
      // missing as false, but the explicit `true` preserves intent).
      const resultContent =
        inv.output === undefined
          ? ''
          : typeof inv.output === 'string'
            ? inv.output
            : safeStringify(inv.output);
      const resultBlock: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: inv.toolUseId,
        content: resultContent,
        ...(inv.isError ? { is_error: true } : {}),
      };
      toolResultBlocks.push(resultBlock);
    }

    // Empty assistant blocks means we had neither text nor valid tool_use —
    // fall back to flat text so Anthropic always sees a non-empty content.
    if (assistantBlocks.length === 0) {
      return [{ role: 'assistant', content: m.content }];
    }
    return [
      { role: 'assistant', content: assistantBlocks },
      { role: 'user', content: toolResultBlocks },
    ];
  } catch {
    // Defensive: any reconstruction failure reverts to flat text for THIS
    // turn only. Live runs prefer a slightly less grounded history over a
    // hard crash mid-rehydrate.
    return [{ role: 'assistant', content: m.content }];
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    toolChoice,
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
    ...(toolChoice !== undefined ? { toolChoice } : {}),
  });
}
