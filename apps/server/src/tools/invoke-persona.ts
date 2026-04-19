import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AgentTool,
  Artifact,
  AssistantDeltaEventPayload,
  CreatorResult,
  LogEvent,
  Persona,
  PersonaRunContext,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import type { ToolRegistry } from './registry.js';
import type { CreatorPersonaInput } from '../agents/creator.js';
import type { NarratorPersonaInput, NarratorPersonaOutput } from '../agents/narrator.js';
import type { ShillerPersonaInput, ShillerPersonaOutput } from '../agents/market-maker.js';
import type { HeartbeatPersonaInput, HeartbeatPersonaOutput } from '../agents/heartbeat.js';
import type { PostShillForInput, PostShillForOutput } from './post-shill-for.js';
import type { LoreStore } from '../state/lore-store.js';
import type { runAgentLoop } from '../agents/runtime.js';

/**
 * Shared event-forwarding callback bundle. Each factory may accept these so the
 * orchestrator (typically `runs/brain-chat.ts`) can forward every persona-side
 * log / artifact / tool_use / assistant-delta event to its RunStore. Callbacks
 * land on `PersonaRunContext` via the `[extra: string]: unknown` escape hatch
 * and the individual persona adapters narrow the types at their call site.
 *
 * Why here (not on a shared type): the callbacks are intentionally tied to the
 * persona-invoke tool surface. Other callers of the persona adapters (e.g. the
 * a2a phase runners) already wire `onLog` etc. through their dedicated
 * `runXxxAgent` params and do not go through this factory layer, so a separate
 * cross-cutting type would only add indirection.
 */
export interface PersonaInvokeEventCallbacks {
  onLog?: (event: LogEvent) => void;
  onArtifact?: (artifact: Artifact) => void;
  onToolUseStart?: (event: ToolUseStartEventPayload) => void;
  onToolUseEnd?: (event: ToolUseEndEventPayload) => void;
  onAssistantDelta?: (event: AssistantDeltaEventPayload) => void;
}

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

export interface CreateInvokeCreatorToolDeps extends PersonaInvokeEventCallbacks {
  persona: Persona<CreatorPersonaInput, CreatorResult>;
  client: Anthropic;
  registry: ToolRegistry;
}

export function createInvokeCreatorTool(
  deps: CreateInvokeCreatorToolDeps,
): AgentTool<InvokeCreatorInput, CreatorResult> {
  const {
    persona,
    client,
    registry,
    onLog,
    onArtifact,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
  } = deps;
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
      const startedAt = Date.now();
      onLog?.({
        ts: new Date(startedAt).toISOString(),
        agent: 'creator',
        tool: 'invoke_creator',
        level: 'info',
        message: `creator persona starting (theme: ${parsed.theme})`,
      });
      // Thread every event callback onto the ctx so the persona adapter can
      // forward them into its runAgentLoop call. Keys are the same strings
      // the adapter narrows via `ctx.onLog` / `ctx.onArtifact` etc.
      const ctx: PersonaRunContext = {
        client,
        registry,
        ...(onLog !== undefined ? { onLog } : {}),
        ...(onArtifact !== undefined ? { onArtifact } : {}),
        ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
        ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
        ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
      };
      try {
        const result = await persona.run({ theme: parsed.theme }, ctx);
        // Emit result-derived artifacts so the FooterDrawer Artifacts tab
        // pills (bsc-token / token-deploy-tx / lore-cid) appear as soon as
        // the persona returns. `persona.run` itself does not emit these —
        // they are derived from the returned CreatorResult shape.
        if (onArtifact && typeof result.tokenAddr === 'string') {
          onArtifact({
            kind: 'bsc-token',
            chain: 'bsc-mainnet',
            address: result.tokenAddr as `0x${string}`,
            explorerUrl: `https://bscscan.com/token/${result.tokenAddr}`,
            label: 'four.meme token (BSC mainnet)',
          });
        }
        if (
          onArtifact &&
          typeof result.tokenDeployTx === 'string' &&
          /^0x[a-fA-F0-9]{64}$/.test(result.tokenDeployTx)
        ) {
          onArtifact({
            kind: 'token-deploy-tx',
            chain: 'bsc-mainnet',
            txHash: result.tokenDeployTx,
            explorerUrl: `https://bscscan.com/tx/${result.tokenDeployTx}`,
            label: 'Creator deploy tx',
          });
        }
        if (onArtifact && typeof result.loreIpfsCid === 'string' && result.loreIpfsCid !== '') {
          onArtifact({
            kind: 'lore-cid',
            cid: result.loreIpfsCid,
            gatewayUrl: `https://gateway.pinata.cloud/ipfs/${result.loreIpfsCid}`,
            author: 'creator',
            label: 'Creator lore chapter 1',
          });
        }
        const durationMs = Date.now() - startedAt;
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'creator',
          tool: 'invoke_creator',
          level: 'info',
          message: `creator persona finished (${durationMs.toString()}ms, token=${result.tokenAddr})`,
          meta: { durationMs },
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'creator',
          tool: 'invoke_creator',
          level: 'error',
          message: `creator persona failed: ${message}`,
        });
        throw err;
      }
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

export interface CreateInvokeNarratorToolDeps extends PersonaInvokeEventCallbacks {
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
  const {
    persona,
    client,
    registry,
    store,
    resolveTokenMeta,
    onLog,
    onArtifact,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
  } = deps;
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
      const startedAt = Date.now();
      onLog?.({
        ts: new Date(startedAt).toISOString(),
        agent: 'narrator',
        tool: 'invoke_narrator',
        level: 'info',
        message: `narrator persona starting (token: ${parsed.tokenAddr})`,
      });
      const ctx: PersonaRunContext = {
        client,
        registry,
        store,
        ...(onLog !== undefined ? { onLog } : {}),
        ...(onArtifact !== undefined ? { onArtifact } : {}),
        ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
        ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
        ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
      };
      try {
        const result = await persona.run(personaInput, ctx);
        // Emit the new chapter's lore-cid artifact derived from the persona
        // result. The narrator adapter itself only emits the `lore-anchor`
        // artifact (when an anchorLedger is wired); the plain lore-cid pill
        // is this factory's responsibility because it is the dashboard's
        // primary chapter-progress indicator.
        if (onArtifact && typeof result.ipfsHash === 'string' && result.ipfsHash !== '') {
          onArtifact({
            kind: 'lore-cid',
            cid: result.ipfsHash,
            gatewayUrl: `https://gateway.pinata.cloud/ipfs/${result.ipfsHash}`,
            author: 'narrator',
            chapterNumber: result.chapterNumber,
          });
        }
        const durationMs = Date.now() - startedAt;
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'narrator',
          tool: 'invoke_narrator',
          level: 'info',
          message: `narrator persona finished (${durationMs.toString()}ms, chapter=${result.chapterNumber.toString()})`,
          meta: { durationMs },
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'narrator',
          tool: 'invoke_narrator',
          level: 'error',
          message: `narrator persona failed: ${message}`,
        });
        throw err;
      }
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

export interface CreateInvokeShillerToolDeps extends PersonaInvokeEventCallbacks {
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
  const {
    persona,
    postShillForTool,
    resolveOrder,
    onLog,
    onArtifact,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
  } = deps;
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
      const startedAt = Date.now();
      onLog?.({
        ts: new Date(startedAt).toISOString(),
        agent: 'shiller',
        tool: 'invoke_shiller',
        level: 'info',
        message: `shiller persona starting (order: ${order.orderId}, token: ${parsed.tokenAddr})`,
      });
      // Shiller persona's run method ignores ctx.client / ctx.registry — the
      // post_shill_for tool carries the only side-effect path. We still pass
      // empty stubs so the PersonaRunContext shape stays uniform. Event
      // callbacks are forwarded onto ctx so future instrumentation in the
      // shiller adapter (e.g. wrapping post_shill_for to emit per-guard
      // logs) can pick them up without another factory change.
      const ctx: PersonaRunContext = {
        client: {} as unknown,
        registry: {} as unknown,
        ...(onLog !== undefined ? { onLog } : {}),
        ...(onArtifact !== undefined ? { onArtifact } : {}),
        ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
        ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
        ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
      };
      try {
        const result = await persona.run(personaInput, ctx);
        // Emit a tweet-url artifact when the persona actually posted so the
        // dashboard Artifacts tab surfaces the live tweet link.
        if (
          onArtifact &&
          result.decision === 'shill' &&
          typeof result.tweetUrl === 'string' &&
          typeof result.tweetId === 'string'
        ) {
          onArtifact({
            kind: 'tweet-url',
            url: result.tweetUrl,
            tweetId: result.tweetId,
            label: 'Shiller tweet',
          });
        }
        const durationMs = Date.now() - startedAt;
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'shiller',
          tool: 'invoke_shiller',
          level: 'info',
          message: `shiller persona finished (${durationMs.toString()}ms, decision=${result.decision})`,
          meta: { durationMs, decision: result.decision },
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'shiller',
          tool: 'invoke_shiller',
          level: 'error',
          message: `shiller persona failed: ${message}`,
        });
        throw err;
      }
    },
  };
}

// ─── invoke_heartbeat_tick ──────────────────────────────────────────────────

export interface CreateInvokeHeartbeatTickToolDeps extends PersonaInvokeEventCallbacks {
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
    onArtifact,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
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
      const startedAt = Date.now();
      onLog?.({
        ts: new Date(startedAt).toISOString(),
        agent: 'heartbeat',
        tool: 'invoke_heartbeat_tick',
        level: 'info',
        message: `heartbeat tick starting (token: ${parsed.tokenAddr})`,
      });
      const ctx: PersonaRunContext = {
        client,
        registry,
        ...(onLog !== undefined ? { onLog } : {}),
        ...(onArtifact !== undefined ? { onArtifact } : {}),
        ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
        ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
        ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
      };
      try {
        const result = await persona.run(personaInput, ctx);
        const durationMs = Date.now() - startedAt;
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'heartbeat',
          tool: 'invoke_heartbeat_tick',
          level: 'info',
          message: `heartbeat tick finished (${durationMs.toString()}ms, success=${result.successCount.toString()}, error=${result.errorCount.toString()})`,
          meta: { durationMs },
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'heartbeat',
          tool: 'invoke_heartbeat_tick',
          level: 'error',
          message: `heartbeat tick failed: ${message}`,
        });
        throw err;
      }
    },
  };
}
