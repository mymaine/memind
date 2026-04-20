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
import { runShillerAgent, type ShillerPersonaOutput } from '../agents/market-maker.js';
import type { HeartbeatPersonaInput, HeartbeatPersonaOutput } from '../agents/heartbeat.js';
import type { PostShillForInput, PostShillForOutput } from './post-shill-for.js';
import type { LoreStore } from '../state/lore-store.js';
import type { AnchorLedger } from '../state/anchor-ledger.js';
import { maybeAnchorContent, type sendAnchorMemoTx } from '../chain/anchor-tx.js';
import type { ShillOrderStore } from '../state/shill-order-store.js';
import type {
  HeartbeatSessionAction,
  HeartbeatSessionState,
  HeartbeatSessionStore,
  HeartbeatTickDelta,
} from '../state/heartbeat-session-store.js';
import { DEFAULT_HEARTBEAT_MAX_TICKS } from '../state/heartbeat-session-store.js';
import type { runAgentLoop } from '../agents/runtime.js';
import type { AppConfig } from '../config.js';
import type { RunStore } from '../runs/store.js';
import {
  runShillMarketDemo,
  type CreatorPaymentPhaseFn,
  type RunShillerPhaseFn,
} from '../runs/shill-market.js';

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
 *  - Orchestrator-side enrichers (`resolveTokenMeta`) are pure lookups
 *    against run-local state. The factory accepts them as callbacks so the
 *    Brain tool layer stays free of LoreStore imports.
 *
 * Most tools end with a single `persona.run(input, ctx)` call. The exception
 * is `invoke_shiller`, which delegates to the full `runShillMarketDemo`
 * orchestrator (creator x402 payment → shill-order enqueue → shiller
 * persona) so `/order` produces the same artifact set as a direct
 * `POST /api/runs {kind:'shill-market'}` dispatch.
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
  /**
   * Optional cap on scheduled tick attempts for this session. Defaults to
   * `DEFAULT_HEARTBEAT_MAX_TICKS` (5) when omitted — a safety rail against
   * runaway demos / resource abuse. The LLM should parse natural-language
   * asks like "run 20 heartbeats" and pass the value through here.
   */
  maxTicks: z.number().int().positive().optional(),
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
  /** Hard cap on tick attempts; the loop auto-stops when tickCount reaches this. */
  maxTicks: number;
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
  maxTicks: number;
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
  maxTicks: number;
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
   * metadata needed by the narrator persona. The Brain LLM only supplies
   * the address; everything else (name, symbol, previous chapters, target
   * chapter number) comes from run-local state. Async so the resolver can
   * `await loreStore.getAllChapters(...)` on the pg backend.
   */
  resolveTokenMeta: (tokenAddr: string) => Promise<NarratorTokenMeta> | NarratorTokenMeta;
  /**
   * Optional AC3 anchor ledger. When wired, every `/lore` slash that lands
   * here appends a keccak256 commitment row (layer 1) and — if
   * `ANCHOR_ON_CHAIN=true` + `bscDeployerPrivateKey` is available — fires
   * the zero-value memo tx on BSC mainnet (layer 2). Left undefined by
   * legacy unit tests + any callers that do not want anchor evidence.
   */
  anchorLedger?: AnchorLedger;
  /**
   * BSC deployer private key for the layer-2 memo tx. Resolved from
   * `config.wallets.bscDeployer.privateKey` in production; left undefined
   * for tests that disable layer 2. `maybeAnchorContent` downgrades to a
   * warn log when this is missing while `ANCHOR_ON_CHAIN=true`.
   */
  bscDeployerPrivateKey?: `0x${string}`;
  /**
   * Optional env bag for the `ANCHOR_ON_CHAIN` gate. Defaults to
   * `process.env` inside `maybeAnchorContent`; hermetic tests pass an
   * explicit bag to exercise both branches deterministically.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Test seam — override the real `sendAnchorMemoTx` so unit tests can spy
   * on the settlement without touching bsc-dataseed. Production omits it.
   */
  sendAnchorMemoTxImpl?: typeof sendAnchorMemoTx;
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
    anchorLedger,
    bscDeployerPrivateKey,
    env,
    sendAnchorMemoTxImpl,
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
      const meta = await resolveTokenMeta(parsed.tokenAddr);
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
      // Thread the anchor ledger onto ctx so the narrator adapter records
      // the layer-1 commitment + emits the initial lore-anchor artifact.
      // `PersonaRunContext` uses `[extra: string]: unknown`; narratorPersona
      // narrows `ctx.anchorLedger` at the call site.
      const ctx: PersonaRunContext = {
        client,
        registry,
        store,
        ...(anchorLedger !== undefined ? { anchorLedger } : {}),
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
        // AC3 layer 2 — optional. The narrator adapter already appended the
        // layer-1 commitment inside `runNarratorAgent` (fed by ctx.anchorLedger
        // above). Here we upgrade to the on-chain memo when the env flag is
        // set and a deployer key is present. `maybeAnchorContent` is
        // non-fatal on every failure branch so the narrator happy path and
        // the lore-cid artifact both stay intact regardless of RPC health.
        if (anchorLedger !== undefined) {
          await maybeAnchorContent({
            anchorLedger,
            tokenAddr: result.tokenAddr as `0x${string}`,
            chapterNumber: result.chapterNumber,
            loreCid: result.ipfsHash,
            ...(bscDeployerPrivateKey !== undefined ? { bscDeployerPrivateKey } : {}),
            ...(env !== undefined ? { env } : {}),
            ...(sendAnchorMemoTxImpl !== undefined ? { sendAnchorMemoTxImpl } : {}),
            ...(onArtifact !== undefined ? { onArtifact } : {}),
            ...(onLog !== undefined ? { onLog } : {}),
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
//
// Brain-chat's `/order <addr>` slash command routes here. Unlike the other
// invoke_* factories, this one does NOT call `shillerPersona.run` directly —
// it runs the full `runShillMarketDemo` orchestrator so the creator payment
// (x402 on Base Sepolia) + shill-order queue transition + shiller persona
// fire in a single execution. That is the only way the `x402-tx`,
// `shill-order` (queued→done), and `shill-tweet` artifacts land on the
// RunStore and surface in the Ch12 evidence tab.
//
// The factory builds a custom `runShillerImpl` so it can reuse the Brain
// orchestrator's `postShillForTool` (which has the X-creds stub guard). We
// capture the Shiller persona output via closure so the tool's return value
// still matches `ShillerPersonaOutput` — the orchestrator itself resolves
// void.
// ----------------------------------------------------------------------------

/**
 * Narrow subset of `PersonaInvokeEventCallbacks` — unlike the other invoke_*
 * tools, this factory never drives a `persona.run(input, ctx)` call, so
 * `onArtifact` / `onToolUseStart` / `onToolUseEnd` / `onAssistantDelta` have
 * nowhere to be forwarded. Artifacts and tool_use events for the
 * shill-market orchestrator flow through `store` directly. Only `onLog` is
 * consumed — it wraps every shiller-phase log so the brain-chat forwarder
 * sees the same stream it does for creator / narrator / heartbeat.
 */
export interface CreateInvokeShillerToolDeps {
  onLog?: (event: LogEvent) => void;
  /** App config — forwarded to `runShillMarketDemo` for downstream wiring. */
  config: AppConfig;
  /** Anthropic client — forwarded to `runShillMarketDemo`. */
  anthropic: Anthropic;
  /** Shared RunStore — `runShillMarketDemo` emits every artifact here. */
  store: RunStore;
  /** Run id the orchestrator tags every artifact / log with. */
  runId: string;
  /** Shared ShillOrderStore — producer (payment) + consumer (shiller) hit this. */
  shillOrderStore: ShillOrderStore;
  /** Shared LoreStore — orchestrator pulls the latest chapter for shill grounding. */
  loreStore: LoreStore;
  /**
   * Pre-built `post_shill_for` tool. Brain-chat gates the real tool on X
   * credentials; we reuse its stub when creds are missing so the shill flow
   * fails with a clear error instead of a raw HTTP 4xx.
   */
  postShillForTool: AgentTool<PostShillForInput, PostShillForOutput>;
  /**
   * Test seam — defaults to the real `runShillMarketDemo` import. Unit tests
   * pass a spy so they can assert the orchestrator was driven with the
   * correct args without touching Anthropic / Base Sepolia.
   */
  runShillMarketDemoImpl?: typeof runShillMarketDemo;
  /**
   * Creator-payment phase. Production wires
   * `createRealCreatorPaymentPhase(...)` here so the tx is a genuine Base
   * Sepolia USDC settlement; tests leave this undefined to fall back to
   * `stubCreatorPaymentPhase` (zero-sentinel hash, no USDC spend).
   */
  creatorPaymentImpl?: CreatorPaymentPhaseFn;
}

export function createInvokeShillerTool(
  deps: CreateInvokeShillerToolDeps,
): AgentTool<InvokeShillerInput, ShillerPersonaOutput> {
  const {
    config,
    anthropic,
    store,
    runId,
    shillOrderStore,
    loreStore,
    postShillForTool,
    runShillMarketDemoImpl,
    creatorPaymentImpl,
    onLog,
  } = deps;
  return {
    name: INVOKE_SHILLER_TOOL_NAME,
    description:
      'Run the full shill-market orchestrator: creator pays 0.01 USDC via x402 on Base Sepolia, then the Shiller persona posts a promotional tweet. Input: { tokenAddr, brief? }. Returns { orderId, tokenAddr, decision, tweetId?, tweetUrl?, tweetText?, postedAt?, toolCalls, errorMessage? }.',
    inputSchema: invokeShillerInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<ShillerPersonaOutput>,
    async execute(input): Promise<ShillerPersonaOutput> {
      const parsed = invokeShillerInputSchema.parse(input);
      const startedAt = Date.now();
      onLog?.({
        ts: new Date(startedAt).toISOString(),
        agent: 'shiller',
        tool: 'invoke_shiller',
        level: 'info',
        message: `shill-market orchestrator starting for ${parsed.tokenAddr}`,
      });

      // Capture the Shiller phase's output through closure so the tool can
      // return a `ShillerPersonaOutput` shaped value. `runShillMarketDemo`
      // itself resolves void — the richer value lives inside the phase.
      let capturedShillerOutput: ShillerPersonaOutput | undefined;

      const runShillerImpl: RunShillerPhaseFn = async (phaseDeps) => {
        const result = await runShillerAgent({
          postShillForTool,
          orderId: phaseDeps.orderId,
          tokenAddr: phaseDeps.tokenAddr,
          ...(phaseDeps.tokenSymbol !== undefined ? { tokenSymbol: phaseDeps.tokenSymbol } : {}),
          loreSnippet: phaseDeps.loreSnippet,
          ...(phaseDeps.creatorBrief !== undefined ? { creatorBrief: phaseDeps.creatorBrief } : {}),
          ...(phaseDeps.includeFourMemeUrl !== undefined
            ? { includeFourMemeUrl: phaseDeps.includeFourMemeUrl }
            : {}),
          // Prefer the outer `onLog` forwarder when wired so middleware
          // wrapped around it (rate-limits, redaction, SSE bridging) also
          // covers the shiller phase. Fall back to a direct store write so
          // the CLI / unit-test path (no forwarder) still captures events.
          onLog: onLog ?? ((event) => phaseDeps.store.addLog(phaseDeps.runId, event)),
        });
        // Translate the agent output to the persona-shaped record so the
        // surrounding orchestrator sees the identical shape it would from
        // `defaultRunShillerImpl`. `ShillerAgentOutput` and
        // `ShillerPersonaOutput` are structurally equivalent today; the
        // explicit projection guards against future drift.
        capturedShillerOutput = {
          orderId: result.orderId,
          tokenAddr: result.tokenAddr,
          decision: result.decision,
          ...(result.tweetId !== undefined ? { tweetId: result.tweetId } : {}),
          ...(result.tweetUrl !== undefined ? { tweetUrl: result.tweetUrl } : {}),
          ...(result.tweetText !== undefined ? { tweetText: result.tweetText } : {}),
          ...(result.postedAt !== undefined ? { postedAt: result.postedAt } : {}),
          toolCalls: result.toolCalls,
          ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
        };
        return result;
      };

      const orchestrator = runShillMarketDemoImpl ?? runShillMarketDemo;
      try {
        await orchestrator({
          config,
          anthropic,
          store,
          runId,
          args: {
            tokenAddr: parsed.tokenAddr,
            ...(parsed.brief !== undefined ? { creatorBrief: parsed.brief } : {}),
          },
          shillOrderStore,
          loreStore,
          runShillerImpl,
          ...(creatorPaymentImpl !== undefined ? { creatorPaymentImpl } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'shiller',
          tool: 'invoke_shiller',
          level: 'error',
          message: `shill-market orchestrator failed: ${message}`,
        });
        throw err;
      }

      if (capturedShillerOutput === undefined) {
        // Unreachable under the default orchestrator flow (runShiller always
        // runs after payment). Emit a clear error so any future refactor
        // that skips the shiller phase surfaces here instead of silently
        // returning a malformed output.
        const msg =
          'invoke_shiller: runShillMarketDemo completed without invoking the shiller phase';
        onLog?.({
          ts: new Date().toISOString(),
          agent: 'shiller',
          tool: 'invoke_shiller',
          level: 'error',
          message: msg,
        });
        throw new Error(msg);
      }

      const durationMs = Date.now() - startedAt;
      onLog?.({
        ts: new Date().toISOString(),
        agent: 'shiller',
        tool: 'invoke_shiller',
        level: 'info',
        message: `shill-market orchestrator finished (${durationMs.toString()}ms, decision=${capturedShillerOutput.decision})`,
        meta: { durationMs, decision: capturedShillerOutput.decision },
      });
      return capturedShillerOutput;
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
 * Kinds of artifacts that belong on a heartbeat tick event. We deliberately
 * keep the list narrow — the UI's BrainChat tick cards only surface tweet
 * links and lore CIDs. Broadening the filter later is a pure addition; the
 * bus wire shape stays stable.
 */
const HEARTBEAT_TICK_ARTIFACT_KINDS: ReadonlySet<Artifact['kind']> = new Set([
  'tweet-url',
  'lore-cid',
]);

/**
 * Execute one heartbeat persona tick and return the parsed snapshot plus
 * any tick-scoped artifacts captured during the run. Exported-shape so the
 * background scheduler can call the same code path as the foreground
 * invocation — keeps the behaviour identical regardless of who triggered the
 * tick. `capture` wraps the outer `deps.onArtifact` so the orchestrator (if
 * any) still sees every artifact while the local collector only retains the
 * ones BrainChat cares about.
 */
async function executeHeartbeatPersonaRun(
  deps: CreateInvokeHeartbeatTickToolDeps,
  intervalMs: number,
  tokenAddr: string,
): Promise<{ result: HeartbeatPersonaOutput; capturedArtifacts: Artifact[] }> {
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
  const capturedArtifacts: Artifact[] = [];
  const wrappedOnArtifact = (artifact: Artifact): void => {
    // Always forward to the outer listener first so Brain SSE still gets
    // every artifact exactly once. Local capture is for the heartbeat bus
    // event and is filtered to the BrainChat-relevant kinds.
    if (onArtifact !== undefined) onArtifact(artifact);
    if (HEARTBEAT_TICK_ARTIFACT_KINDS.has(artifact.kind)) {
      capturedArtifacts.push(artifact);
    }
  };
  // Wrap the caller-supplied buildUserInput so every tick prompt carries the
  // target tokenAddr verbatim. Without this, the Brain-supplied buildUserInput
  // only mentions tickId + tickAt, and the heartbeat LLM hallucinates a
  // random address to feed `check_token_status` each fire — users saw
  // "Token contract not deployed" on a clearly-deployed token because the
  // chain read was against a bogus address (different on each tick).
  const buildUserInputWithToken = (ctx: { tickId: string; tickAt: string }): string => {
    const base = buildUserInput(ctx);
    return `${base}\nCurrent token under observation: ${tokenAddr}. Use this exact address for check_token_status, post_to_x, and extend_lore — do NOT substitute any other address.`;
  };
  const personaInput: HeartbeatPersonaInput = {
    model,
    systemPrompt,
    buildUserInput: buildUserInputWithToken,
    intervalMs,
    ...(onLog !== undefined ? { onLog } : {}),
    ...(runAgentLoopImpl !== undefined ? { runAgentLoopImpl } : {}),
  };
  const ctx: PersonaRunContext = {
    client,
    registry,
    ...(onLog !== undefined ? { onLog } : {}),
    onArtifact: wrappedOnArtifact,
    ...(onToolUseStart !== undefined ? { onToolUseStart } : {}),
    ...(onToolUseEnd !== undefined ? { onToolUseEnd } : {}),
    ...(onAssistantDelta !== undefined ? { onAssistantDelta } : {}),
  };
  const result = await persona.run(personaInput, ctx);
  return { result, capturedArtifacts };
}

/**
 * Read the parsed `{action, reason}` decision off a heartbeat persona
 * result. Null when the tick errored OR the LLM's final text was
 * unparseable — downstream consumers (chat bubble) should render a neutral
 * status in that case rather than a fabricated action.
 */
function decisionFromPersonaResult(
  result: HeartbeatPersonaOutput,
): { action: HeartbeatSessionAction; reason: string } | null {
  return result.lastDecision ?? null;
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
    maxTicks: snap.maxTicks,
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
    // One-shot ticks never register with the session store, so there is no
    // per-session maxTicks to report. Surface the process-wide default as a
    // hint to the LLM for phrasing ("each /heartbeat without an interval
    // runs 1 tick; loops default to N") without pretending a cap is live.
    maxTicks: DEFAULT_HEARTBEAT_MAX_TICKS,
    tickCount: result.successCount + result.errorCount + result.skippedCount,
    successCount: result.successCount,
    errorCount: result.errorCount,
    skippedCount: result.skippedCount,
    lastTickAt: result.lastTickAt,
    lastTickId: result.lastTickId,
    // Surface the parsed LLM decision (may be null when the tick errored
    // or the final text was unparseable). The chat bubble reads this to
    // label the one-shot tick's action.
    lastAction: result.lastDecision?.action ?? null,
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
      'With intervalMs: a real setInterval runs ticks until stop_heartbeat is called OR the tick cap is hit (one immediate tick also runs so the user sees a result instantly). ' +
      'Without intervalMs: if a session already exists, return its current snapshot without running an extra tick; otherwise run exactly ONE manual tick. ' +
      `Background loops auto-stop at \`maxTicks\` (default ${DEFAULT_HEARTBEAT_MAX_TICKS.toString()}) — pass a higher maxTicks to extend; restarting a session with a new maxTicks lets a user resume after hitting the cap. \`maxTicks\` counts ONLY real executions (success + error); overlap-skipped fires accumulate on \`skippedCount\` and do not consume the cap, so N=3 means 3 real ticks regardless of persona latency. ` +
      'Input: { tokenAddr, intervalMs?, maxTicks? }. Returns a snapshot object with `mode` ∈ { one-shot | background-started | background-restarted | background-already-running } plus running/intervalMs/startedAt/maxTicks/tickCount/successCount/errorCount/skippedCount/lastTickAt/lastTickId/lastAction/lastError. When `running === false` AND `tickCount >= maxTicks`, the loop auto-stopped at the cap.',
    inputSchema: invokeHeartbeatTickInputSchema,
    outputSchema: z.any() as unknown as z.ZodType<InvokeHeartbeatTickOutput>,
    async execute(input): Promise<InvokeHeartbeatTickOutput> {
      const parsed = invokeHeartbeatTickInputSchema.parse(input);
      const tokenAddr = parsed.tokenAddr;
      const existing = await sessionStore.get(tokenAddr);

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
          const { result } = await executeHeartbeatPersonaRun(deps, defaultIntervalMs, tokenAddr);
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
          const { result, capturedArtifacts } = await executeHeartbeatPersonaRun(
            deps,
            intervalMs,
            tokenAddr,
          );
          const tickId = result.lastTickId ?? `tick_${Date.now().toString(36)}`;
          const decision = decisionFromPersonaResult(result);
          return {
            tickId,
            tickAt: result.lastTickAt ?? tickAt,
            success: result.lastError === null,
            ...(result.lastError !== null ? { error: result.lastError } : {}),
            ...(decision !== null ? { action: decision.action, reason: decision.reason } : {}),
            ...(capturedArtifacts.length > 0 ? { artifacts: capturedArtifacts } : {}),
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
      const { restarted } = await sessionStore.start({
        tokenAddr,
        intervalMs,
        runTick,
        ...(parsed.maxTicks !== undefined ? { maxTicks: parsed.maxTicks } : {}),
      });

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
      // Drive the immediate tick through `runExclusiveTick` so it shares the
      // same overlap guard as the scheduler's setInterval fires. Without
      // this, the immediate tick's ~20-30s LLM loop runs with
      // tickInFlight=false and any setInterval fire that lands during that
      // window would spin up a PARALLEL LLM call, producing the "no 10s
      // gap, continuous tool calls" behaviour users reported. With the
      // exclusive lock the scheduled fires see the in-flight marker and
      // record themselves as overlap-skips, which is the intended
      // resource-guard behaviour.
      await sessionStore.runExclusiveTick(tokenAddr, async () => {
        try {
          const { result, capturedArtifacts } = await executeHeartbeatPersonaRun(
            deps,
            intervalMs,
            tokenAddr,
          );
          const tickId = result.lastTickId ?? `tick_${Date.now().toString(36)}`;
          const tickAt = result.lastTickAt ?? new Date().toISOString();
          const decision = decisionFromPersonaResult(result);
          const durationMs = Date.now() - startedAt;
          onLog?.({
            ts: new Date().toISOString(),
            agent: 'heartbeat',
            tool: 'invoke_heartbeat_tick',
            level: 'info',
            message: `heartbeat immediate tick finished (${durationMs.toString()}ms)`,
            meta: { durationMs },
          });
          return {
            tickId,
            tickAt,
            success: result.lastError === null,
            ...(result.lastError !== null ? { error: result.lastError } : {}),
            ...(decision !== null ? { action: decision.action, reason: decision.reason } : {}),
            ...(capturedArtifacts.length > 0 ? { artifacts: capturedArtifacts } : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onLog?.({
            ts: new Date().toISOString(),
            agent: 'heartbeat',
            tool: 'invoke_heartbeat_tick',
            level: 'error',
            message: `heartbeat immediate tick failed: ${message}`,
          });
          return {
            tickId: `tick_err_${Date.now().toString(36)}`,
            tickAt: new Date().toISOString(),
            success: false,
            error: message,
          };
        }
      });

      const snap = await sessionStore.get(tokenAddr);
      if (snap === undefined) {
        // Unreachable: start(...) always creates the session. Fall back to
        // a synthetic output so the tool always returns something well-typed.
        return {
          tokenAddr,
          mode: wasExisting && restarted ? 'background-restarted' : 'background-started',
          running: true,
          intervalMs,
          startedAt: new Date().toISOString(),
          maxTicks: parsed.maxTicks ?? DEFAULT_HEARTBEAT_MAX_TICKS,
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
      const final = await sessionStore.stop(tokenAddr);
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
          maxTicks: final.maxTicks,
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
      const sessions = (await sessionStore.list())
        .filter((s) => s.running)
        .map(
          (s): ListHeartbeatsSessionSnapshot => ({
            tokenAddr: s.tokenAddr,
            intervalMs: s.intervalMs,
            startedAt: s.startedAt,
            running: s.running,
            maxTicks: s.maxTicks,
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
