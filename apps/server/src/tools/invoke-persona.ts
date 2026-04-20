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
import type {
  HeartbeatSessionAction,
  HeartbeatSessionState,
  HeartbeatSessionStore,
  HeartbeatTickDelta,
} from '../state/heartbeat-session-store.js';
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
export const STOP_HEARTBEAT_TOOL_NAME = 'stop_heartbeat';
export const LIST_HEARTBEATS_TOOL_NAME = 'list_heartbeats';

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

export const stopHeartbeatInputSchema = z.object({
  tokenAddr: z.string().regex(evmAddressRegex),
});
export type StopHeartbeatInput = z.infer<typeof stopHeartbeatInputSchema>;

// list_heartbeats takes no input; the empty object keeps the tool schema
// shape uniform with the others and preserves the option to add filters later
// (e.g. `runningOnly: boolean`) without a breaking change.
export const listHeartbeatsInputSchema = z.object({});
export type ListHeartbeatsInput = z.infer<typeof listHeartbeatsInputSchema>;

/**
 * Discriminator the Brain LLM reads back to phrase its reply after an
 * `invoke_heartbeat_tick` call:
 *   - `one-shot`                 — no intervalMs provided, no existing session, a single tick ran.
 *   - `background-started`       — intervalMs provided, a fresh session started.
 *   - `background-restarted`     — intervalMs provided, an existing session was rescheduled at a new interval.
 *   - `background-already-running` — no intervalMs provided but a session already existed; nothing changed.
 */
export type InvokeHeartbeatTickMode =
  | 'one-shot'
  | 'background-started'
  | 'background-restarted'
  | 'background-already-running';

export interface InvokeHeartbeatTickOutput {
  tokenAddr: string;
  mode: InvokeHeartbeatTickMode;
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  tickCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  lastTickAt: string | null;
  lastTickId: string | null;
  lastAction: HeartbeatSessionAction | null;
  lastError: string | null;
}

export interface StopHeartbeatFinalSnapshot {
  tokenAddr: string;
  intervalMs: number;
  startedAt: string;
  running: boolean;
  tickCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  lastTickAt: string | null;
  lastTickId: string | null;
  lastAction: HeartbeatSessionAction | null;
  lastError: string | null;
}

export interface StopHeartbeatOutput {
  tokenAddr: string;
  wasRunning: boolean;
  finalSnapshot: StopHeartbeatFinalSnapshot | null;
}

export interface ListHeartbeatsSessionSnapshot {
  tokenAddr: string;
  intervalMs: number;
  startedAt: string;
  running: boolean;
  tickCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  lastTickAt: string | null;
  lastTickId: string | null;
  lastAction: HeartbeatSessionAction | null;
  lastError: string | null;
}

export interface ListHeartbeatsOutput {
  /** Running sessions only — stopped ones are filtered out because the user
   * asked "what's alive right now?" not "what ever existed?". */
  sessions: ListHeartbeatsSessionSnapshot[];
  totalRunning: number;
}

// ─── invoke_creator ─────────────────────────────────────────────────────────

export interface CreateInvokeCreatorToolDeps extends PersonaInvokeEventCallbacks {
  persona: Persona<CreatorPersonaInput, CreatorResult>;
  client: Anthropic;
  registry: ToolRegistry;
  /**
   * Optional LoreStore the creator persona upserts Chapter 1 into after the
   * `lore_writer` tool returns. Threaded through `PersonaRunContext.store` —
   * the creator adapter reads it off the ctx escape-hatch. When omitted
   * (non-Brain callers like standalone CLI demos or unit tests) the persona
   * still returns its CreatorResult but the LoreStore hand-off is skipped.
   */
  store?: LoreStore;
}

export function createInvokeCreatorTool(
  deps: CreateInvokeCreatorToolDeps,
): AgentTool<InvokeCreatorInput, CreatorResult> {
  const {
    persona,
    client,
    registry,
    store,
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
      // the adapter narrows via `ctx.onLog` / `ctx.onArtifact` etc. `store`
      // is forwarded so the creator adapter can upsert Chapter 1 into the
      // Brain orchestrator's shared LoreStore.
      const ctx: PersonaRunContext = {
        client,
        registry,
        ...(store !== undefined ? { store } : {}),
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
//
// Dual-mode:
//   1. `{ tokenAddr }`               — one-shot tick if no session exists,
//                                     otherwise return the current snapshot
//                                     without running an extra tick.
//   2. `{ tokenAddr, intervalMs }`   — start or restart a real background
//                                     loop in `HeartbeatSessionStore`, then
//                                     synchronously run ONE immediate tick so
//                                     the user gets feedback without waiting
//                                     for the first interval.
// ----------------------------------------------------------------------------

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
  /** Default intervalMs used when the Brain does not override per-call. */
  defaultIntervalMs?: number;
  /**
   * Session store the tool consults / mutates. Always required now: the dual
   * mode depends on the store as the single source of truth for running
   * loops.
   */
  sessionStore: HeartbeatSessionStore;
  /** Optional test seam — pass through to the persona adapter. */
  runAgentLoopImpl?: typeof runAgentLoop;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Execute one heartbeat persona tick and return the parsed snapshot. Exported
 * so the background scheduler can call the same code path as the foreground
 * invocation — keeps the behaviour identical regardless of who triggered the
 * tick.
 */
async function executeHeartbeatPersonaRun(
  deps: CreateInvokeHeartbeatTickToolDeps,
  intervalMs: number,
): Promise<HeartbeatPersonaOutput> {
  const {
    persona,
    client,
    registry,
    model,
    systemPrompt,
    buildUserInput,
    onLog,
    onArtifact,
    onToolUseStart,
    onToolUseEnd,
    onAssistantDelta,
    runAgentLoopImpl,
  } = deps;
  const personaInput: HeartbeatPersonaInput = {
    model,
    systemPrompt,
    buildUserInput,
    intervalMs,
    ...(onLog !== undefined ? { onLog } : {}),
    ...(runAgentLoopImpl !== undefined ? { runAgentLoopImpl } : {}),
  };
  const ctx: PersonaRunContext = {
    client,
    registry,
    ...(onLog !== undefined ? { onLog } : {}),
    ...(onArtifact !== undefined ? { onArtifact } : {}),
    ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
    ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
    ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
  };
  return persona.run(personaInput, ctx);
}

/**
 * Infer a coarse-grained action label from the parsed persona output. The
 * heartbeat persona's final JSON is not captured structurally by the adapter
 * (it returns the scheduler snapshot instead), so we approximate by looking
 * at what changed relative to the prior snapshot. Best-effort — callers
 * treat `null` as "unknown".
 */
function inferActionFromSnapshotDelta(
  _prior: HeartbeatPersonaOutput | null,
  _next: HeartbeatPersonaOutput,
): HeartbeatSessionAction | null {
  // The persona adapter does not currently surface the LLM's `action` field
  // to the invoke layer; artifact emissions carry that info at a different
  // layer. Returning null keeps the contract honest — callers render "idle"
  // or "n/a" in the UI instead of guessing. A future change can swap this
  // for a real mapping if the adapter starts returning the decision.
  return null;
}

function snapshotToOutput(
  tokenAddr: string,
  mode: InvokeHeartbeatTickMode,
  snap: HeartbeatSessionState,
): InvokeHeartbeatTickOutput {
  return {
    tokenAddr,
    mode,
    running: snap.running,
    intervalMs: snap.intervalMs,
    startedAt: snap.startedAt,
    tickCount: snap.tickCount,
    successCount: snap.successCount,
    errorCount: snap.errorCount,
    skippedCount: snap.skippedCount,
    lastTickAt: snap.lastTickAt,
    lastTickId: snap.lastTickId,
    lastAction: snap.lastAction,
    lastError: snap.lastError,
  };
}

function personaOutputToOneShotOutput(
  tokenAddr: string,
  intervalMs: number,
  result: HeartbeatPersonaOutput,
): InvokeHeartbeatTickOutput {
  return {
    tokenAddr,
    mode: 'one-shot',
    running: false,
    intervalMs,
    startedAt: null,
    tickCount: result.successCount + result.errorCount + result.skippedCount,
    successCount: result.successCount,
    errorCount: result.errorCount,
    skippedCount: result.skippedCount,
    lastTickAt: result.lastTickAt,
    lastTickId: result.lastTickId,
    lastAction: null,
    lastError: result.lastError,
  };
}

export function createInvokeHeartbeatTickTool(
  deps: CreateInvokeHeartbeatTickToolDeps,
): AgentTool<InvokeHeartbeatTickInput, InvokeHeartbeatTickOutput> {
  const { defaultIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, sessionStore, onLog } = deps;
  return {
    name: INVOKE_HEARTBEAT_TICK_TOOL_NAME,
    description:
      'Run ONE Heartbeat tick, OR start/restart a background loop when intervalMs is provided. ' +
      'With intervalMs: a real setInterval runs ticks until stop_heartbeat is called (one immediate tick also runs so the user sees a result instantly). ' +
      'Without intervalMs: if a session already exists, return its current snapshot without running an extra tick; otherwise run exactly ONE manual tick. ' +
      'Input: { tokenAddr, intervalMs? }. Returns a snapshot object with `mode` ∈ { one-shot | background-started | background-restarted | background-already-running } plus running/intervalMs/startedAt/tickCount/successCount/errorCount/skippedCount/lastTickAt/lastTickId/lastAction/lastError.',
    inputSchema: invokeHeartbeatTickInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<InvokeHeartbeatTickOutput>,
    async execute(input): Promise<InvokeHeartbeatTickOutput> {
      const parsed = invokeHeartbeatTickInputSchema.parse(input);
      const tokenAddr = parsed.tokenAddr;
      const existing = sessionStore.get(tokenAddr);

      // ─── Branch 1: no intervalMs, session exists → snapshot-only ────────
      if (parsed.intervalMs === undefined && existing !== undefined) {
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'heartbeat',
          tool: 'invoke_heartbeat_tick',
          level: 'info',
          message: `heartbeat snapshot requested for ${tokenAddr} (background loop already running)`,
        });
        return snapshotToOutput(tokenAddr, 'background-already-running', existing);
      }

      // ─── Branch 2: no intervalMs, no session → one-shot tick ────────────
      if (parsed.intervalMs === undefined) {
        const startedAt = Date.now();
        onLog?.({
          ts: new Date(startedAt).toISOString(),
          agent: 'heartbeat',
          tool: 'invoke_heartbeat_tick',
          level: 'info',
          message: `heartbeat tick starting (token: ${tokenAddr}, one-shot)`,
        });
        try {
          const result = await executeHeartbeatPersonaRun(deps, defaultIntervalMs);
          const durationMs = Date.now() - startedAt;
          onLog?.({
            ts: new Date().toISOString(),
            agent: 'heartbeat',
            tool: 'invoke_heartbeat_tick',
            level: 'info',
            message: `heartbeat tick finished (${durationMs.toString()}ms, success=${result.successCount.toString()}, error=${result.errorCount.toString()})`,
            meta: { durationMs, mode: 'one-shot' },
          });
          return personaOutputToOneShotOutput(tokenAddr, defaultIntervalMs, result);
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
      }

      // ─── Branch 3: intervalMs provided → start / restart background loop ─
      const intervalMs = parsed.intervalMs;
      // The background runTick re-invokes the same persona adapter every
      // fire. It parses the persona's output and returns a tick delta for
      // the session store. Any error rethrows up to the store's fire()
      // which converts it into an error delta.
      const runTick = async (prior: HeartbeatSessionState): Promise<HeartbeatTickDelta> => {
        void prior;
        const tickAt = new Date().toISOString();
        try {
          const result = await executeHeartbeatPersonaRun(deps, intervalMs);
          const tickId = result.lastTickId ?? `tick_${Date.now().toString(36)}`;
          return {
            tickId,
            tickAt: result.lastTickAt ?? tickAt,
            success: result.lastError === null,
            ...(result.lastError !== null ? { error: result.lastError } : {}),
            ...(inferActionFromSnapshotDelta(null, result) !== null
              ? { action: inferActionFromSnapshotDelta(null, result) as HeartbeatSessionAction }
              : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            tickId: `tick_err_${Date.now().toString(36)}`,
            tickAt,
            success: false,
            error: message,
          };
        }
      };

      const wasExisting = existing !== undefined;
      const { restarted } = sessionStore.start({ tokenAddr, intervalMs, runTick });

      // Run one immediate tick synchronously so the user does not wait a
      // full interval for the first result. We do it here (not via the
      // scheduler) so counters update before we hand back the snapshot.
      const startedAt = Date.now();
      onLog?.({
        ts: new Date(startedAt).toISOString(),
        agent: 'heartbeat',
        tool: 'invoke_heartbeat_tick',
        level: 'info',
        message:
          wasExisting && restarted
            ? `heartbeat background loop restarted (token: ${tokenAddr}, intervalMs=${intervalMs.toString()})`
            : `heartbeat background loop started (token: ${tokenAddr}, intervalMs=${intervalMs.toString()})`,
      });
      try {
        const result = await executeHeartbeatPersonaRun(deps, intervalMs);
        const tickId = result.lastTickId ?? `tick_${Date.now().toString(36)}`;
        const tickAt = result.lastTickAt ?? new Date().toISOString();
        const action = inferActionFromSnapshotDelta(null, result);
        sessionStore.recordTick(tokenAddr, {
          tickId,
          tickAt,
          success: result.lastError === null,
          ...(result.lastError !== null ? { error: result.lastError } : {}),
          ...(action !== null ? { action } : {}),
        });
        const durationMs = Date.now() - startedAt;
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'heartbeat',
          tool: 'invoke_heartbeat_tick',
          level: 'info',
          message: `heartbeat immediate tick finished (${durationMs.toString()}ms)`,
          meta: { durationMs },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'heartbeat',
          tool: 'invoke_heartbeat_tick',
          level: 'error',
          message: `heartbeat immediate tick failed: ${message}`,
        });
        sessionStore.recordTick(tokenAddr, {
          tickId: `tick_err_${Date.now().toString(36)}`,
          tickAt: new Date().toISOString(),
          success: false,
          error: message,
        });
      }

      const snap = sessionStore.get(tokenAddr);
      if (snap === undefined) {
        // Unreachable: start(...) always creates the session. Fall back to
        // a synthetic output so the tool always returns something well-typed.
        return {
          tokenAddr,
          mode: wasExisting && restarted ? 'background-restarted' : 'background-started',
          running: true,
          intervalMs,
          startedAt: new Date().toISOString(),
          tickCount: 0,
          successCount: 0,
          errorCount: 0,
          skippedCount: 0,
          lastTickAt: null,
          lastTickId: null,
          lastAction: null,
          lastError: null,
        };
      }
      return snapshotToOutput(
        tokenAddr,
        wasExisting && restarted ? 'background-restarted' : 'background-started',
        snap,
      );
    },
  };
}

// ─── stop_heartbeat ─────────────────────────────────────────────────────────

export interface CreateStopHeartbeatToolDeps extends PersonaInvokeEventCallbacks {
  sessionStore: HeartbeatSessionStore;
}

export function createStopHeartbeatTool(
  deps: CreateStopHeartbeatToolDeps,
): AgentTool<StopHeartbeatInput, StopHeartbeatOutput> {
  const { sessionStore, onLog } = deps;
  return {
    name: STOP_HEARTBEAT_TOOL_NAME,
    description:
      'Stop the background Heartbeat loop for a token. Call this when the user asks to stop the heartbeat, kill the loop, or sends `/heartbeat-stop`. ' +
      'Input: { tokenAddr }. Returns { tokenAddr, wasRunning, finalSnapshot }. If no session exists, returns wasRunning=false and finalSnapshot=null.',
    inputSchema: stopHeartbeatInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<StopHeartbeatOutput>,
    async execute(input): Promise<StopHeartbeatOutput> {
      const parsed = stopHeartbeatInputSchema.parse(input);
      const tokenAddr = parsed.tokenAddr;
      onLog?.({
        ts: new Date().toISOString(),
        agent: 'heartbeat',
        tool: 'stop_heartbeat',
        level: 'info',
        message: `stop_heartbeat requested (token: ${tokenAddr})`,
      });
      const final = sessionStore.stop(tokenAddr);
      if (final === undefined) {
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'heartbeat',
          tool: 'stop_heartbeat',
          level: 'warn',
          message: `stop_heartbeat: no session for ${tokenAddr}`,
        });
        return {
          tokenAddr,
          wasRunning: false,
          finalSnapshot: null,
        };
      }
      onLog?.({
        ts: new Date().toISOString(),
        agent: 'heartbeat',
        tool: 'stop_heartbeat',
        level: 'info',
        message: `stop_heartbeat: session stopped (ticks=${final.tickCount.toString()})`,
      });
      return {
        tokenAddr,
        wasRunning: true,
        finalSnapshot: {
          tokenAddr: final.tokenAddr,
          intervalMs: final.intervalMs,
          startedAt: final.startedAt,
          running: final.running,
          tickCount: final.tickCount,
          successCount: final.successCount,
          errorCount: final.errorCount,
          skippedCount: final.skippedCount,
          lastTickAt: final.lastTickAt,
          lastTickId: final.lastTickId,
          lastAction: final.lastAction,
          lastError: final.lastError,
        },
      };
    },
  };
}

// ─── list_heartbeats ────────────────────────────────────────────────────────

export interface CreateListHeartbeatsToolDeps extends PersonaInvokeEventCallbacks {
  sessionStore: HeartbeatSessionStore;
}

export function createListHeartbeatsTool(
  deps: CreateListHeartbeatsToolDeps,
): AgentTool<ListHeartbeatsInput, ListHeartbeatsOutput> {
  const { sessionStore, onLog } = deps;
  return {
    name: LIST_HEARTBEATS_TOOL_NAME,
    description:
      'List every currently running background Heartbeat loop (one per token). Call this when the user asks which heartbeats are active, sends `/heartbeat-list`, or wonders which tokens are consuming resources. ' +
      'Input: {}. Returns { sessions: [...], totalRunning }. Stopped sessions are filtered out.',
    inputSchema: listHeartbeatsInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<ListHeartbeatsOutput>,
    async execute(): Promise<ListHeartbeatsOutput> {
      onLog?.({
        ts: new Date().toISOString(),
        agent: 'heartbeat',
        tool: 'list_heartbeats',
        level: 'info',
        message: 'list_heartbeats requested',
      });
      const sessions = sessionStore
        .list()
        .filter((s) => s.running)
        .map(
          (s): ListHeartbeatsSessionSnapshot => ({
            tokenAddr: s.tokenAddr,
            intervalMs: s.intervalMs,
            startedAt: s.startedAt,
            running: s.running,
            tickCount: s.tickCount,
            successCount: s.successCount,
            errorCount: s.errorCount,
            skippedCount: s.skippedCount,
            lastTickAt: s.lastTickAt,
            lastTickId: s.lastTickId,
            lastAction: s.lastAction,
            lastError: s.lastError,
          }),
        );
      onLog?.({
        ts: new Date().toISOString(),
        agent: 'heartbeat',
        tool: 'list_heartbeats',
        level: 'info',
        message: `list_heartbeats: ${sessions.length.toString()} running`,
      });
      return {
        sessions,
        totalRunning: sessions.length,
      };
    },
  };
}
