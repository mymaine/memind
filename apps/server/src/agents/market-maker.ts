import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool, LogEvent } from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import {
  runAgentLoop,
  type RuntimeAssistantDelta,
  type RuntimeToolUseEnd,
  type RuntimeToolUseStart,
  type ToolCallTrace,
} from './runtime.js';
import type { TokenStatusOutput } from '../tools/token-status.js';
import type { XFetchLoreOutput } from '../tools/x-fetch-lore.js';
import type { PostShillForInput, PostShillForOutput } from '../tools/post-shill-for.js';
import { extractJsonObject } from './_json.js';

/**
 * Market-maker Agent
 * ------------------
 * Reads a token's on-chain state via `check_token_status`, then decides
 * whether to pay 0.01 USDC via x402 for the latest lore chapter. This is the
 * agent-to-agent (A2A) commerce demonstration: one agent pays another for
 * alpha-bearing content.
 *
 * The decision policy lives in the system prompt (not hardcoded here) so the
 * model retains full agency. This wrapper only orchestrates the loop and
 * projects the tool-call trace into a structured result.
 */

export interface RunMarketMakerAgentParams {
  client: Anthropic;
  registry: ToolRegistry;
  /** Token whose on-chain state is being inspected. */
  tokenAddr: string;
  /** Fully-qualified URL for the x402-protected lore endpoint. */
  loreEndpointUrl: string;
  model?: string;
  maxTurns?: number;
  onLog?: (event: LogEvent) => void;
  /** V2-P2 streaming hooks — forwarded to runAgentLoop. */
  onToolUseStart?: (event: RuntimeToolUseStart) => void;
  onToolUseEnd?: (event: RuntimeToolUseEnd) => void;
  onAssistantDelta?: (event: RuntimeAssistantDelta) => void;
}

export interface MarketMakerAgentOutput {
  tokenAddr: string;
  tokenStatus: TokenStatusOutput;
  decision: 'buy-lore' | 'skip';
  /** Populated iff decision === 'buy-lore'. */
  loreFetch?: XFetchLoreOutput;
  toolCalls: ToolCallTrace[];
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

const MARKET_MAKER_SYSTEM_PROMPT = `You are Market-maker Agent, one of three coordinated agents in the Four.Meme swarm. Your role is to decide whether it is worth paying 0.01 USDC for the latest lore chapter of a given token.

Workflow:
1. Call check_token_status with the provided token address to read live on-chain state (deployedOnChain, bonding curve progress, holder count, etc.).
2. Apply this policy (demo-tuned: any real deployed four.meme token has narrative worth inspecting, even pre-trading; production deployment would raise thresholds on holderCount / curve progress):
   - If deployedOnChain is true, call x402_fetch_lore with the provided lore URL to purchase the latest chapter. The chapter is alpha for positioning.
   - Otherwise (contract bytecode missing from the chain), skip the purchase — the token does not actually exist.
3. Do NOT fabricate tool outputs. Only use what tools return.

After you have applied the policy, respond with EXACTLY one JSON object and nothing else (no prose, no code fences, no markdown):
  {"decision": "buy-lore" | "skip", "reason": string}

Use "buy-lore" only if you actually invoked x402_fetch_lore. Use "skip" if you did not.

Respond with the JSON object only. No preamble, no explanation, no code fences — just the object.`;

const DECISION_ENUM = ['buy-lore', 'skip'] as const;

const decisionResultSchema = z.object({
  decision: z.enum(DECISION_ENUM),
  reason: z.string().min(1),
});

export async function runMarketMakerAgent(
  params: RunMarketMakerAgentParams,
): Promise<MarketMakerAgentOutput> {
  const {
    client,
    registry,
    tokenAddr,
    loreEndpointUrl,
    model = DEFAULT_MODEL,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
  } = params;

  const userInput = [
    `Token address: ${tokenAddr}`,
    `Lore endpoint URL: ${loreEndpointUrl}`,
    '',
    'Read the token status, apply the policy, and return the final JSON decision.',
  ].join('\n');

  const loop = await runAgentLoop({
    client,
    model,
    registry,
    systemPrompt: MARKET_MAKER_SYSTEM_PROMPT,
    userInput,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    agentId: 'market-maker',
  });

  const json = extractJsonObject(loop.finalText, 'runMarketMakerAgent');
  const decisionResult = decisionResultSchema.parse(json);

  // Grounding: the decision must be backed by a real check_token_status call.
  // Without this guard a model that hallucinated a JSON response could slip a
  // fake decision through.
  const statusCall = loop.toolCalls.find((c) => c.name === 'check_token_status' && !c.isError);
  if (!statusCall) {
    throw new Error(
      'runMarketMakerAgent: check_token_status was not invoked successfully — decision is not grounded in on-chain state',
    );
  }
  const tokenStatus = statusCall.output as TokenStatusOutput;

  let loreFetch: XFetchLoreOutput | undefined;
  if (decisionResult.decision === 'buy-lore') {
    const fetchCall = loop.toolCalls.find((c) => c.name === 'x402_fetch_lore' && !c.isError);
    if (!fetchCall) {
      throw new Error(
        'runMarketMakerAgent: decision was "buy-lore" but x402_fetch_lore was not invoked successfully',
      );
    }
    loreFetch = fetchCall.output as XFetchLoreOutput;
  }

  // Soft policy enforcement: the system prompt advertises a single threshold
  // (deployedOnChain === true; demo-tuned) but the runtime does not reject a
  // non-conforming decision — the demo must still surface something
  // observable even when the model rationalises a buy on a contract that is
  // not actually on chain. Emit a warn LogEvent so the deviation is visible
  // in the demo transcript.
  if (decisionResult.decision === 'buy-lore') {
    const meetsThreshold = tokenStatus.deployedOnChain === true;
    if (!meetsThreshold && onLog) {
      onLog({
        ts: new Date().toISOString(),
        agent: 'market-maker',
        tool: 'policy',
        level: 'warn',
        message: 'policy violation: bought lore below threshold',
        meta: {
          decision: decisionResult.decision,
          reason: decisionResult.reason,
          deployedOnChain: tokenStatus.deployedOnChain,
          bondingCurveProgress: tokenStatus.bondingCurveProgress,
          holderCount: tokenStatus.holderCount,
        },
      });
    }
  }

  return {
    tokenAddr,
    tokenStatus,
    decision: decisionResult.decision,
    ...(loreFetch ? { loreFetch } : {}),
    toolCalls: loop.toolCalls,
  };
}

// ---------------------------------------------------------------------------
// Shill persona — Phase 4.6
// ---------------------------------------------------------------------------
//
// `runShillerAgent` is the Market-maker agent's second persona. Conceptually
// one agent identity ("market-maker") with two personas dispatched at the
// caller level: the a2a persona (above) and the shill persona (below). We
// keep both in this file so the two personas share the same module boundary
// and the a2a call site stays untouched by the shill addition.
//
// Why NOT an LLM decision loop (runAgentLoop) for shill persona:
//   1. The decision to shill was already made at x402 payment time. Creator
//      paid 0.01 USDC; the agent MUST attempt to post. Running another LLM
//      "should I shill?" pass would duplicate work and risk hallucinating
//      skip against a paid order (bad UX, possibly refund-triggering).
//   2. The LLM intelligence this flow needs is inside `post_shill_for`
//      itself (drafting + guarding the tweet). Wrapping it in a second LLM
//      loop adds cost and failure surface without adding judgment.
//   3. MVP hard deadline 2026-04-21 — every additional loop = more things
//      to stabilise for the demo recording window.
//
// The `toolCalls` shape mirrors the a2a persona's trace entries so the
// dashboard's ToolCallBubble UI renders both modes identically.
// ---------------------------------------------------------------------------

export interface RunShillerAgentParams {
  /**
   * Injected `post_shill_for` tool. Wired by the caller (typically the
   * shill-market orchestrator) from the tool registry, or by tests with a
   * direct stub. Dependency-injection keeps this persona free of Anthropic /
   * X API concerns — it only orchestrates.
   */
  postShillForTool: AgentTool<PostShillForInput, PostShillForOutput>;
  orderId: string;
  tokenAddr: string;
  tokenSymbol?: string;
  loreSnippet: string;
  /**
   * Free-form text the Creator attached when ordering the shill. Logged for
   * observability but NOT passed to `post_shill_for` — the tweet is grounded
   * in lore, not creator marketing copy, to keep the organic voice.
   */
  creatorBrief?: string;
  /**
   * Log hook — emits with `agent: 'market-maker'`. The shill persona shares
   * the market-maker agent identity for UI/trace simplicity; callers that
   * need to distinguish personas can inspect the `[shill mode]` message
   * prefix or the `tool: 'post_shill_for'` field.
   */
  onLog?: (event: LogEvent) => void;
}

export interface ShillerAgentOutput {
  orderId: string;
  tokenAddr: string;
  /**
   * `skip` is only reachable when the injected `post_shill_for` tool throws
   * (e.g. guard exhausted after retry, OAuth 401). The orchestrator is then
   * expected to call `ShillOrderStore.markFailed(orderId, errorMessage)`.
   */
  decision: 'shill' | 'skip';
  // Populated when decision === 'shill'.
  tweetId?: string;
  tweetUrl?: string;
  tweetText?: string;
  postedAt?: string;
  /**
   * Trace entries compatible with the a2a persona's `ToolCallTrace` shape
   * (name / input / output / isError). Minimal by design — the shill flow
   * issues exactly one tool call, so the trace always has length 1.
   */
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    isError: boolean;
  }>;
  /** Populated when the tool throws — mirrors what the orchestrator persists. */
  errorMessage?: string;
}

export async function runShillerAgent(params: RunShillerAgentParams): Promise<ShillerAgentOutput> {
  const { postShillForTool, orderId, tokenAddr, tokenSymbol, loreSnippet, creatorBrief, onLog } =
    params;

  // Build the tool input — `tokenSymbol` must be omitted (not set to
  // undefined) when the caller didn't supply it, so the downstream zod
  // schema's `.optional()` branch triggers and the LLM prompt falls back to
  // "infer the symbol from lore".
  const input: PostShillForInput = {
    orderId,
    tokenAddr,
    ...(tokenSymbol !== undefined && tokenSymbol !== '' ? { tokenSymbol } : {}),
    loreSnippet,
  };

  onLog?.({
    ts: new Date().toISOString(),
    agent: 'market-maker',
    tool: 'post_shill_for',
    level: 'info',
    message: `[shill mode] processing order ${orderId} for ${tokenAddr}`,
    meta: { creatorBrief: creatorBrief ?? null },
  });

  try {
    const result = await postShillForTool.execute(input);
    onLog?.({
      ts: new Date().toISOString(),
      agent: 'market-maker',
      tool: 'post_shill_for',
      level: 'info',
      message: `[shill mode] tweet posted: ${result.tweetUrl}`,
    });
    return {
      orderId,
      tokenAddr,
      decision: 'shill',
      tweetId: result.tweetId,
      tweetUrl: result.tweetUrl,
      tweetText: result.tweetText,
      postedAt: result.postedAt,
      toolCalls: [
        {
          name: 'post_shill_for',
          input: input as unknown as Record<string, unknown>,
          output: result as unknown as Record<string, unknown>,
          isError: false,
        },
      ],
    };
  } catch (err) {
    // Tool throws → decision=skip; caller (shill-market orchestrator) is
    // expected to translate this into ShillOrderStore.markFailed(orderId,
    // errorMessage). We never re-throw here because the agent's contract is
    // "tried and reported", not "tried and crashed" — a thrown exception
    // would bubble past the orchestrator's per-order error boundary.
    const errorMessage = err instanceof Error ? err.message : String(err);
    onLog?.({
      ts: new Date().toISOString(),
      agent: 'market-maker',
      tool: 'post_shill_for',
      level: 'error',
      message: `[shill mode] tool failed: ${errorMessage}`,
    });
    return {
      orderId,
      tokenAddr,
      decision: 'skip',
      toolCalls: [
        {
          name: 'post_shill_for',
          input: input as unknown as Record<string, unknown>,
          output: { error: errorMessage },
          isError: true,
        },
      ],
      errorMessage,
    };
  }
}
