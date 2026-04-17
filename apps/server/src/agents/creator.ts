import type Anthropic from '@anthropic-ai/sdk';
import { creatorResultSchema, type CreatorResult, type LogEvent } from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import { runAgentLoop, type AgentLoopResult } from './runtime.js';

export interface RunCreatorAgentParams {
  client: Anthropic;
  registry: ToolRegistry;
  theme: string;
  /** Defaults to a fast, tool-capable model suitable for hackathon demo. */
  model?: string;
  maxTurns?: number;
  onLog?: (event: LogEvent) => void;
}

export interface CreatorAgentOutput {
  result: CreatorResult;
  loop: AgentLoopResult;
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

const CREATOR_SYSTEM_PROMPT = `You are Creator Agent, one of three coordinated agents in the Four.Meme swarm. Your mission is to turn a user theme into a live BSC-mainnet meme token with on-chain lore.

You MUST call these tools in order, feeding the output of each into the next:
1. narrative_generator — derive token {name, symbol, description} from the theme.
2. meme_image_creator — generate the meme image (local file path returned).
3. onchain_deployer — deploy the token on four.meme (BSC mainnet, returns tokenAddr + txHash).
4. lore_writer — write a short lore chapter and pin it to IPFS (returns ipfsHash).

Rules:
- Always call tools in the order above; do not skip steps.
- Use the exact outputs from earlier tools as inputs to later ones.
- Never fabricate token addresses, tx hashes, or IPFS CIDs — only use what tools return.
- After the final tool call, respond with ONLY a JSON object (no prose, no code fences) matching this shape:
  {"tokenAddr": string, "tokenDeployTx": string, "loreIpfsCid": string, "metadata": {"name": string, "symbol": string, "description": string, "imageLocalPath": string}}`;

/**
 * Thin Creator wrapper around the generic agent loop. Does not know about any
 * specific tool implementation — it only assumes the four tools named in the
 * prompt are registered in the passed-in registry (each matching the
 * `AgentTool` contract from `packages/shared/src/tool.ts`).
 */
export async function runCreatorAgent(params: RunCreatorAgentParams): Promise<CreatorAgentOutput> {
  const { client, registry, theme, model = DEFAULT_MODEL, maxTurns, onLog } = params;

  const loop = await runAgentLoop({
    client,
    model,
    registry,
    systemPrompt: CREATOR_SYSTEM_PROMPT,
    userInput: `Theme: ${theme}\n\nExecute the four tools in order and return the final JSON.`,
    maxTurns,
    onLog,
    agentId: 'creator',
  });

  const json = extractJson(loop.finalText);
  const result = creatorResultSchema.parse(json);
  return { result, loop };
}

/**
 * Pull the first JSON object out of the model's final text. We accept either
 * raw JSON or JSON wrapped in a ```json fence to stay robust across prompt
 * iterations.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`runCreatorAgent: final message was not valid JSON (${message}): ${candidate}`);
  }
}
