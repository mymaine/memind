import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import { runAgentLoop, type ToolCallTrace } from './runtime.js';
import type { TokenStatusOutput } from '../tools/token-status.js';
import type { XFetchLoreOutput } from '../tools/x-fetch-lore.js';
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
