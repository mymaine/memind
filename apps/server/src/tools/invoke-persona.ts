import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AgentTool, CreatorResult, Persona, PersonaRunContext } from '@hack-fourmeme/shared';
import type { ToolRegistry } from './registry.js';
import type { CreatorPersonaInput } from '../agents/creator.js';
import type { NarratorPersonaInput, NarratorPersonaOutput } from '../agents/narrator.js';
import type { ShillerPersonaInput, ShillerPersonaOutput } from '../agents/market-maker.js';
import type { HeartbeatPersonaInput, HeartbeatPersonaOutput } from '../agents/heartbeat.js';
import type { PostShillForInput, PostShillForOutput } from './post-shill-for.js';
import type { LoreStore } from '../state/lore-store.js';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { runAgentLoop } from '../agents/runtime.js';

/**
 * Brain meta-agent persona-invoke tools (BRAIN-P2).
 *
 * The Brain agent (see `apps/server/src/agents/brain.ts`) exposes four tools
 * to the LLM: `invoke_creator`, `invoke_narrator`, `invoke_shiller`,
 * `invoke_heartbeat_tick`. Each one is a thin wrapper around the matching
 * persona adapter in `apps/server/src/agents/*.ts` — the wrappers carry only
 * the inputs the Brain LLM can sensibly derive from conversation context
 * (theme / tokenAddr / brief / intervalMs), and depend on the orchestrator
 * (`runs/brain-chat.ts`, landed in BRAIN-P3) to supply the remaining persona
 * inputs via the factory's `dependencies` argument.
 *
 * Why the factory-with-dependencies shape:
 *
 *  - `AgentTool.execute(input)` is single-argument by interface; we cannot
 *    thread per-run state (LoreStore, postShillForTool, tokenName lookups)
 *    into the tool post-construction. The factory closes over them at
 *    instantiation time.
 *  - The four personas have wildly different TInput contracts (compare
 *    `NarratorPersonaInput` with `HeartbeatPersonaInput`). Forcing the Brain
 *    LLM to hand-craft all of those fields would bloat the system prompt and
 *    leak internal plumbing. The factory decides what the LLM sees.
 *  - Orchestrator-side enrichers (`resolveTokenMeta`, `resolveOrder`) are
 *    pure synchronous lookups against run-local state. The factory accepts
 *    them as callbacks so the Brain tool layer stays free of LoreStore /
 *    ShillOrderStore imports.
 *
 * This file deliberately does NOT touch persona internals: every tool ends
 * with a single `persona.run(input, ctx)` call.
 */

// ─── Tool name constants ────────────────────────────────────────────────────

export const INVOKE_CREATOR_TOOL_NAME = 'invoke_creator';
export const INVOKE_NARRATOR_TOOL_NAME = 'invoke_narrator';
export const INVOKE_SHILLER_TOOL_NAME = 'invoke_shiller';
export const INVOKE_HEARTBEAT_TICK_TOOL_NAME = 'invoke_heartbeat_tick';

// ─── Shared LLM-facing input schemas ────────────────────────────────────────
//
// These match the shapes advertised in the Brain systemPrompt so the Anthropic
// tool schema exposed to the model lines up with the in-prompt docstring.
// ----------------------------------------------------------------------------

const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;

export const invokeCreatorInputSchema = z.object({
  theme: z.string().min(3).max(280),
});
export type InvokeCreatorInput = z.infer<typeof invokeCreatorInputSchema>;

export const invokeNarratorInputSchema = z.object({
  tokenAddr: z.string().regex(evmAddressRegex),
});
export type InvokeNarratorInput = z.infer<typeof invokeNarratorInputSchema>;

export const invokeShillerInputSchema = z.object({
  tokenAddr: z.string().regex(evmAddressRegex),
  brief: z.string().optional(),
});
export type InvokeShillerInput = z.infer<typeof invokeShillerInputSchema>;

export const invokeHeartbeatTickInputSchema = z.object({
  tokenAddr: z.string().regex(evmAddressRegex),
  intervalMs: z.number().int().positive().optional(),
});
export type InvokeHeartbeatTickInput = z.infer<typeof invokeHeartbeatTickInputSchema>;

// ─── invoke_creator ─────────────────────────────────────────────────────────

export interface CreateInvokeCreatorToolDeps {
  persona: Persona<CreatorPersonaInput, CreatorResult>;
  client: Anthropic;
  registry: ToolRegistry;
}

export function createInvokeCreatorTool(
  deps: CreateInvokeCreatorToolDeps,
): AgentTool<InvokeCreatorInput, CreatorResult> {
  const { persona, client, registry } = deps;
  return {
    name: INVOKE_CREATOR_TOOL_NAME,
    description:
      'Deploy a new four.meme token on BSC mainnet, generate a meme image, and write lore chapter 1 to IPFS. Input: { theme }. Returns { tokenAddr, tokenDeployTx, loreIpfsCid, metadata }.',
    inputSchema: invokeCreatorInputSchema,
    // Output schema is intentionally permissive here — the creator persona
    // already validates its own output via `creatorResultSchema`, so a second
    // round of zod here would only duplicate the contract for no behavioural
    // gain. We keep the downstream type narrowed by the generic `TOutput`.
    outputSchema: z.any() as unknown as z.ZodType<CreatorResult>,
    async execute(input): Promise<CreatorResult> {
      const parsed = invokeCreatorInputSchema.parse(input);
      const ctx: PersonaRunContext = { client, registry };
      return persona.run({ theme: parsed.theme }, ctx);
    },
  };
}

// ─── invoke_narrator ────────────────────────────────────────────────────────

export interface NarratorTokenMeta {
  tokenName: string;
  tokenSymbol: string;
  previousChapters?: string[];
  targetChapterNumber?: number;
}

export interface CreateInvokeNarratorToolDeps {
  persona: Persona<NarratorPersonaInput, NarratorPersonaOutput>;
  client: Anthropic;
  registry: ToolRegistry;
  /**
   * LoreStore the narrator persona upserts into. Threaded through
   * `PersonaRunContext.store` — the narrator adapter reads it off the ctx
   * escape-hatch rather than TInput.
   */
  store: LoreStore;
  /**
   * Orchestrator-supplied lookup: given a tokenAddr, return the narrative
   * metadata needed by the narrator persona. The Brain LLM only supplies the
   * address; everything else (name, symbol, previous chapters, target
   * chapter number) comes from run-local state.
   */
  resolveTokenMeta: (tokenAddr: string) => NarratorTokenMeta;
}

export function createInvokeNarratorTool(
  deps: CreateInvokeNarratorToolDeps,
): AgentTool<InvokeNarratorInput, NarratorPersonaOutput> {
  const { persona, client, registry, store, resolveTokenMeta } = deps;
  return {
    name: INVOKE_NARRATOR_TOOL_NAME,
    description:
      'Extend the next lore chapter for a deployed token and pin it to IPFS. Input: { tokenAddr }. Returns { tokenAddr, chapterNumber, ipfsHash, ipfsUri, chapterText }.',
    inputSchema: invokeNarratorInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<NarratorPersonaOutput>,
    async execute(input): Promise<NarratorPersonaOutput> {
      const parsed = invokeNarratorInputSchema.parse(input);
      const meta = resolveTokenMeta(parsed.tokenAddr);
      const personaInput: NarratorPersonaInput = {
        tokenAddr: parsed.tokenAddr,
        tokenName: meta.tokenName,
        tokenSymbol: meta.tokenSymbol,
        ...(meta.previousChapters !== undefined ? { previousChapters: meta.previousChapters } : {}),
        ...(meta.targetChapterNumber !== undefined
          ? { targetChapterNumber: meta.targetChapterNumber }
          : {}),
      };
      const ctx: PersonaRunContext = { client, registry, store };
      return persona.run(personaInput, ctx);
    },
  };
}

// ─── invoke_shiller ─────────────────────────────────────────────────────────

export interface ShillerOrderContext {
  orderId: string;
  loreSnippet: string;
  tokenSymbol?: string;
  includeFourMemeUrl?: boolean;
}

export interface CreateInvokeShillerToolDeps {
  persona: Persona<ShillerPersonaInput, ShillerPersonaOutput>;
  /**
   * Injected `post_shill_for` tool. Threaded directly onto the persona's
   * TInput; the shiller persona is post-payment deterministic and does not
   * go through the Anthropic client or tool registry.
   */
  postShillForTool: AgentTool<PostShillForInput, PostShillForOutput>;
  /**
   * Orchestrator-supplied lookup: given the tokenAddr (and the optional
   * Brain-provided `brief`), resolve the order-level context — orderId,
   * latest lore snippet, tokenSymbol, and the URL mode toggle. `brief` is
   * forwarded separately so it reaches the shiller persona's `creatorBrief`
   * slot verbatim.
   */
  resolveOrder: (tokenAddr: string, brief: string | undefined) => ShillerOrderContext;
}

export function createInvokeShillerTool(
  deps: CreateInvokeShillerToolDeps,
): AgentTool<InvokeShillerInput, ShillerPersonaOutput> {
  const { persona, postShillForTool, resolveOrder } = deps;
  return {
    name: INVOKE_SHILLER_TOOL_NAME,
    description:
      'Dispatch the Shiller persona to post a promotional tweet for a token. Input: { tokenAddr, brief? }. Returns { orderId, tokenAddr, decision, tweetId?, tweetUrl?, tweetText?, postedAt?, toolCalls, errorMessage? }.',
    inputSchema: invokeShillerInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<ShillerPersonaOutput>,
    async execute(input): Promise<ShillerPersonaOutput> {
      const parsed = invokeShillerInputSchema.parse(input);
      const order = resolveOrder(parsed.tokenAddr, parsed.brief);
      const personaInput: ShillerPersonaInput = {
        postShillForTool,
        orderId: order.orderId,
        tokenAddr: parsed.tokenAddr,
        loreSnippet: order.loreSnippet,
        ...(order.tokenSymbol !== undefined ? { tokenSymbol: order.tokenSymbol } : {}),
        ...(parsed.brief !== undefined ? { creatorBrief: parsed.brief } : {}),
        ...(order.includeFourMemeUrl !== undefined
          ? { includeFourMemeUrl: order.includeFourMemeUrl }
          : {}),
      };
      // Shiller persona's run method ignores ctx.client / ctx.registry — the
      // post_shill_for tool carries the only side-effect path. We still pass
      // empty stubs so the PersonaRunContext shape stays uniform for future
      // bubbling hooks.
      const ctx: PersonaRunContext = {
        client: {} as unknown,
        registry: {} as unknown,
      };
      return persona.run(personaInput, ctx);
    },
  };
}

// ─── invoke_heartbeat_tick ──────────────────────────────────────────────────

export interface CreateInvokeHeartbeatTickToolDeps {
  persona: Persona<HeartbeatPersonaInput, HeartbeatPersonaOutput>;
  client: Anthropic;
  registry: ToolRegistry;
  /** Heartbeat persona's LLM model id (e.g. `anthropic/claude-sonnet-4-5`). */
  model: string;
  /** Heartbeat systemPrompt (orchestrator-owned). */
  systemPrompt: string;
  /** Builds the user input for each tick from tick identity. */
  buildUserInput: (ctx: { tickId: string; tickAt: string }) => string;
  /** Default intervalMs when the Brain does not override per-call. */
  defaultIntervalMs?: number;
  onLog?: (event: LogEvent) => void;
  /** Optional test seam — pass through to the persona adapter. */
  runAgentLoopImpl?: typeof runAgentLoop;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

export function createInvokeHeartbeatTickTool(
  deps: CreateInvokeHeartbeatTickToolDeps,
): AgentTool<InvokeHeartbeatTickInput, HeartbeatPersonaOutput> {
  const {
    persona,
    client,
    registry,
    model,
    systemPrompt,
    buildUserInput,
    defaultIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    onLog,
    runAgentLoopImpl,
  } = deps;
  return {
    name: INVOKE_HEARTBEAT_TICK_TOOL_NAME,
    description:
      'Run exactly ONE autonomous Heartbeat tick for a token, optionally adjusting the interval. Input: { tokenAddr, intervalMs? }. Returns { lastTickAt, lastTickId, successCount, errorCount, skippedCount, lastError }.',
    inputSchema: invokeHeartbeatTickInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<HeartbeatPersonaOutput>,
    async execute(input): Promise<HeartbeatPersonaOutput> {
      const parsed = invokeHeartbeatTickInputSchema.parse(input);
      const personaInput: HeartbeatPersonaInput = {
        model,
        systemPrompt,
        buildUserInput,
        intervalMs: parsed.intervalMs ?? defaultIntervalMs,
        ...(onLog !== undefined ? { onLog } : {}),
        ...(runAgentLoopImpl !== undefined ? { runAgentLoopImpl } : {}),
      };
      const ctx: PersonaRunContext = { client, registry };
      return persona.run(personaInput, ctx);
    },
  };
}
