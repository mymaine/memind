import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  creatorResultSchema,
  type Artifact,
  type AssistantDeltaEventPayload,
  type CreatorResult,
  type LogEvent,
  type Persona,
  type PersonaRunContext,
  type ToolUseEndEventPayload,
  type ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import type { ToolRegistry } from '../tools/registry.js';
import type { LoreStore } from '../state/lore-store.js';
import {
  runAgentLoop,
  type AgentLoopResult,
  type RuntimeAssistantDelta,
  type RuntimeToolUseEnd,
  type RuntimeToolUseStart,
} from './runtime.js';
import { extractJsonObject } from './_json.js';

export interface RunCreatorAgentParams {
  client: Anthropic;
  registry: ToolRegistry;
  theme: string;
  /** Defaults to a fast, tool-capable model suitable for hackathon demo. */
  model?: string;
  maxTurns?: number;
  onLog?: (event: LogEvent) => void;
  /** V2-P2 streaming hooks — forwarded to runAgentLoop. */
  onToolUseStart?: (event: RuntimeToolUseStart) => void;
  onToolUseEnd?: (event: RuntimeToolUseEnd) => void;
  onAssistantDelta?: (event: RuntimeAssistantDelta) => void;
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
  const {
    client,
    registry,
    theme,
    model = DEFAULT_MODEL,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
  } = params;

  const loop = await runAgentLoop({
    client,
    model,
    registry,
    systemPrompt: CREATOR_SYSTEM_PROMPT,
    userInput: `Theme: ${theme}\n\nExecute the four tools in order and return the final JSON.`,
    maxTurns,
    onLog,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    agentId: 'creator',
  });

  const json = extractJsonObject(loop.finalText, 'runCreatorAgent');
  const result = creatorResultSchema.parse(json);
  return { result, loop };
}

// ---------------------------------------------------------------------------
// Persona adapter — Brain positioning (2026-04-19).
// ---------------------------------------------------------------------------
// `creatorPersona` wraps `runCreatorAgent` in the generic `Persona<TInput,
// TOutput>` contract from `packages/shared/src/persona.ts`. No behaviour
// change: the adapter's `run(...)` forwards to the same runner the rest of
// the codebase already uses. Only purpose is to make the "pluggable persona"
// claim TRUE in code.
// ---------------------------------------------------------------------------

export const creatorPersonaInputSchema = z.object({
  theme: z.string().min(1),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
});
export type CreatorPersonaInput = z.infer<typeof creatorPersonaInputSchema>;

/**
 * Shape of a `meme_image_creator` tool call's output. Mirrors the ImageOutput
 * schema in `apps/server/src/tools/image.ts` but is declared locally here so
 * this module does not need a direct import of the tool implementation just
 * to narrow a tool-trace payload. Only the fields actually consumed by the
 * meme-image artifact emitter are listed.
 */
interface MemeImageToolOutput {
  status: 'ok' | 'upload-failed';
  cid: string | null;
  gatewayUrl: string | null;
  prompt: string;
  errorMessage?: string;
}

/**
 * Narrow an arbitrary tool-trace `output` value to the subset of
 * MemeImageToolOutput fields we need to emit the artifact. Returns undefined
 * when the trace shape does not match, which lets the caller skip emission
 * without crashing the run.
 */
function asMemeImageToolOutput(output: unknown): MemeImageToolOutput | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const o = output as Record<string, unknown>;
  if (o.status !== 'ok' && o.status !== 'upload-failed') return undefined;
  if (typeof o.prompt !== 'string') return undefined;
  const cid = typeof o.cid === 'string' ? o.cid : o.cid === null ? null : undefined;
  const gatewayUrl =
    typeof o.gatewayUrl === 'string' ? o.gatewayUrl : o.gatewayUrl === null ? null : undefined;
  if (cid === undefined || gatewayUrl === undefined) return undefined;
  const base: MemeImageToolOutput = {
    status: o.status,
    cid,
    gatewayUrl,
    prompt: o.prompt,
  };
  if (typeof o.errorMessage === 'string') base.errorMessage = o.errorMessage;
  return base;
}

/**
 * Shape of a `lore_writer` tool call's output. Mirrors the LoreOutput schema
 * in `apps/server/src/tools/lore.ts`. Declared locally so this module does
 * not have to import the tool implementation to narrow a tool-trace payload.
 */
interface LoreWriterToolOutput {
  loreText: string;
  ipfsCid: string;
  gatewayUrl: string;
}

/**
 * Narrow an arbitrary tool-trace `output` value to the `lore_writer` output
 * subset. Returns undefined when the shape does not match, which lets the
 * caller skip the LoreStore upsert without crashing the run.
 */
function asLoreWriterOutput(output: unknown): LoreWriterToolOutput | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const o = output as Record<string, unknown>;
  if (
    typeof o.loreText !== 'string' ||
    typeof o.ipfsCid !== 'string' ||
    typeof o.gatewayUrl !== 'string'
  ) {
    return undefined;
  }
  return { loreText: o.loreText, ipfsCid: o.ipfsCid, gatewayUrl: o.gatewayUrl };
}

/**
 * Translate a `meme_image_creator` tool-trace into a `meme-image` artifact.
 * Matches the emission logic already used by `runs/creator-phase.ts` so the
 * Brain-driven persona path produces the same artifact shape as the direct
 * `/runs?kind=creator` phase path.
 */
function memeImageArtifactFromToolOutput(out: MemeImageToolOutput): Artifact | undefined {
  if (out.status === 'ok' && out.cid !== null && out.gatewayUrl !== null) {
    return {
      kind: 'meme-image',
      status: 'ok',
      cid: out.cid,
      gatewayUrl: out.gatewayUrl,
      prompt: out.prompt,
    };
  }
  if (out.status === 'upload-failed') {
    return {
      kind: 'meme-image',
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: out.prompt,
      errorMessage: out.errorMessage ?? 'unknown pinata error',
    };
  }
  return undefined;
}

export const creatorPersona: Persona<CreatorPersonaInput, CreatorResult> = {
  id: 'creator',
  description:
    'Creator persona — turns a user theme into a live BSC-mainnet meme token with on-chain lore via the narrative → image → deployer → lore tool chain.',
  inputSchema: creatorPersonaInputSchema,
  outputSchema: creatorResultSchema,
  async run(input, ctx: PersonaRunContext) {
    const parsed = creatorPersonaInputSchema.parse(input);
    // Brain-driven runs wire their RunStore forwarders onto `ctx.onLog` etc.
    // so the nested tool loop (`narrative_generator` / `meme_image_creator` /
    // `onchain_deployer` / `lore_writer`) surfaces progress via SSE. Callers
    // that don't care (standalone `/runs?kind=creator` phase) simply omit the
    // callbacks and pay nothing.
    const onLog = ctx.onLog as ((event: LogEvent) => void) | undefined;
    const onArtifact = ctx.onArtifact as ((artifact: Artifact) => void) | undefined;
    const onToolUseStart = ctx.onToolUseStart as
      | ((event: ToolUseStartEventPayload) => void)
      | undefined;
    const onToolUseEnd = ctx.onToolUseEnd as ((event: ToolUseEndEventPayload) => void) | undefined;
    const onAssistantDelta = ctx.onAssistantDelta as
      | ((event: AssistantDeltaEventPayload) => void)
      | undefined;
    const { result, loop } = await runCreatorAgent({
      client: ctx.client as Anthropic,
      registry: ctx.registry as ToolRegistry,
      theme: parsed.theme,
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
      ...(parsed.maxTurns !== undefined ? { maxTurns: parsed.maxTurns } : {}),
      ...(onLog !== undefined ? { onLog } : {}),
      ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
      ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
      ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
    });
    // Emit the meme-image artifact derived from the `meme_image_creator`
    // tool trace. Mirrors `runs/creator-phase.ts` so both entry points —
    // direct `/runs?kind=creator` phase and Brain-driven `invoke_creator` —
    // produce the same 4-artifact set (bsc-token + token-deploy-tx +
    // lore-cid + meme-image). Walk from the most-recent successful call so
    // a retried run only emits the winning image.
    if (onArtifact) {
      for (let i = loop.toolCalls.length - 1; i >= 0; i -= 1) {
        const call = loop.toolCalls[i];
        if (!call || call.name !== 'meme_image_creator' || call.isError) continue;
        const out = asMemeImageToolOutput(call.output);
        if (out === undefined) break;
        const artifact = memeImageArtifactFromToolOutput(out);
        if (artifact !== undefined) onArtifact(artifact);
        break;
      }
    }
    // Upsert Chapter 1 into the LoreStore so downstream personas (Narrator
    // on `/lore`, Shiller on `/order`, Heartbeat ticks) can find the opening
    // chapter and stitch continuations from it. The LoreStore is threaded
    // through `ctx.store` by the Brain orchestrator; non-Brain callers
    // (direct `persona.run(...)` usage in tests) may omit it and we silently
    // skip the upsert — the persona's primary contract is to return the
    // CreatorResult, the LoreStore hand-off is an adjunct for continuity.
    const loreStore = ctx.store as LoreStore | undefined;
    if (loreStore !== undefined) {
      for (let i = loop.toolCalls.length - 1; i >= 0; i -= 1) {
        const call = loop.toolCalls[i];
        if (!call || call.name !== 'lore_writer' || call.isError) continue;
        const out = asLoreWriterOutput(call.output);
        if (out === undefined) break;
        // Fire-and-forget upsert — see the persistence spec's "await vs
        // fire-and-forget" matrix. The persona's primary job is to return
        // the CreatorResult; a slow pg write should not block the UI
        // pipeline. Failures warn-log so they still surface in Railway logs.
        void loreStore
          .upsert({
            tokenAddr: result.tokenAddr,
            chapterNumber: 1,
            chapterText: out.loreText,
            ipfsHash: out.ipfsCid,
            ipfsUri: out.gatewayUrl,
            tokenName: result.metadata.name,
            tokenSymbol: result.metadata.symbol,
            publishedAt: new Date().toISOString(),
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[lore] creator chapter 1 upsert failed: ${message}`);
          });
        break;
      }
    }
    return result;
  },
};
