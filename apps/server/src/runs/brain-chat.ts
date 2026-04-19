/**
 * runBrainChat — BRAIN-P3 orchestrator for the `brain-chat` run kind.
 *
 * Drives the Brain meta-agent (`apps/server/src/agents/brain.ts`) against a
 * provided chat transcript, supplying the per-run dependencies the four
 * persona-invoke tools need (LoreStore, ShillOrderStore, Anthropic client,
 * heartbeat systemPrompt, post_shill_for tool). Every persona-side log /
 * tool_use / assistant:delta event is forwarded verbatim into the RunStore
 * so the SSE layer (`routes.ts`) can stream them out under the same runId —
 * AC-BRAIN-2 event bubbling is a pure pass-through here.
 *
 * Why a thin orchestrator:
 *   - The Brain agent itself already encapsulates the LLM loop (see brain.ts).
 *     The orchestrator's only job is DI: wire the persona-invoke tools with
 *     their run-level context + adapters, then hand them + the messages to
 *     runBrainAgent.
 *   - Keeping state (tokenMetaByAddr, orderByAddr) local to a single run
 *     satisfies the spec's "no persistence, single server instance demo" rail.
 *
 * Not handled here (intentionally):
 *   - Per-run persistence of chat history — the HTTP caller ships the full
 *     messages array with every POST (stateless server).
 *   - Slash-command semantics — the Brain systemPrompt already routes
 *     `/launch`, `/order`, `/lore`, `/heartbeat` into tool calls; the
 *     orchestrator is transport-agnostic.
 */
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool, ChatMessage } from '@hack-fourmeme/shared';
import { chatMessageSchema } from '@hack-fourmeme/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { ShillOrderStore } from '../state/shill-order-store.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  createInvokeCreatorTool,
  createInvokeHeartbeatTickTool,
  createInvokeNarratorTool,
  createInvokeShillerTool,
  type NarratorTokenMeta,
  type ShillerOrderContext,
} from '../tools/invoke-persona.js';
import {
  createPostShillForTool,
  postShillForInputSchema,
  postShillForOutputSchema,
  type PostShillForInput,
  type PostShillForOutput,
} from '../tools/post-shill-for.js';
import { createPostToXTool } from '../tools/x-post.js';
import { creatorPersona } from '../agents/creator.js';
import { narratorPersona } from '../agents/narrator.js';
import { shillerPersona } from '../agents/market-maker.js';
import { heartbeatPersona } from '../agents/heartbeat.js';
import { runBrainAgent, type RunBrainAgentParams } from '../agents/brain.js';
import type { AgentLoopResult } from '../agents/runtime.js';
import type { RunStore } from './store.js';

// OpenRouter Anthropic-compatible gateway — same model every other orchestrator
// in this project uses so the Brain loop runs on the same cost profile.
const MODEL = 'anthropic/claude-sonnet-4-5';

// Input-side schema for the orchestrator. Routes parse the same at HTTP
// boundary, but the orchestrator re-validates so CLI / test callers cannot
// bypass the check.
const brainChatMessagesSchema = z.array(chatMessageSchema).min(1);

/**
 * Same per-tick heartbeat system prompt used by the `heartbeat` run kind's
 * runner. Duplicated (not imported) because the heartbeat-runner keeps it
 * private; the Brain only needs a minimal prompt since it drives exactly one
 * tick per `invoke_heartbeat_tick` call per AC spec.
 */
const HEARTBEAT_SYSTEM_PROMPT = [
  'You are an autonomous agent operating a meme token on BSC mainnet.',
  'Each tick, call check_token_status on the configured token. Based on the status,',
  'EITHER call post_to_x with a short tweet (<=240 chars, include the tokenAddr and a',
  'bscscan link) OR call extend_lore to add a new chapter to the on-chain story.',
  'Pick exactly ONE action per tick. Your final response is a single JSON object:',
  '{"action": "post_to_x" | "extend_lore" | "idle", "reason": "..."}.',
  'Do NOT invent addresses — only use the tokenAddr provided by check_token_status.',
].join(' ');

/**
 * Stub fallback lore snippet: used when the Brain dispatches `invoke_shiller`
 * before the Narrator has deposited any chapter for the token into LoreStore.
 * Mirrors `shill-market.ts::resolveLoreSnippet` — short, URL-free, non-empty
 * so the downstream post_shill_for guard is satisfied.
 */
function fallbackLoreSnippet(tokenAddr: string): string {
  return `A mysterious token appears at address ${tokenAddr}. No one has written its lore yet, but whispers hint at something curious worth watching.`;
}

/**
 * Build a `post_shill_for` tool from the run config. When X OAuth credentials
 * are fully configured we return the real tool (that will actually tweet). If
 * any credential is missing we hand back a stub whose `execute` rejects with
 * a clear error message — this keeps `createInvokeShillerTool` construction
 * usable for runs that never call `/order`, while signalling loudly if a
 * Brain does try to shill without the wallet. Matches the CLI/demo posture
 * where test environments never ship the Twitter secrets.
 */
function buildPostShillForTool(
  config: AppConfig,
  anthropic: Anthropic,
): AgentTool<PostShillForInput, PostShillForOutput> {
  const creds = [
    config.x.apiKey,
    config.x.apiKeySecret,
    config.x.accessToken,
    config.x.accessTokenSecret,
  ];
  const allPresent = creds.every((v) => typeof v === 'string' && v.trim() !== '');
  if (!allPresent) {
    // Typed cast via the re-exported interface keeps the factory signature
    // strict without pulling the concrete `createPostShillForTool` shape.
    return {
      name: 'post_shill_for',
      description:
        'Stub post_shill_for tool — X API credentials are not configured for this run, so shilling is disabled.',
      inputSchema: postShillForInputSchema,
      outputSchema: postShillForOutputSchema,
      async execute(_input: PostShillForInput): Promise<PostShillForOutput> {
        throw new Error(
          'post_shill_for: X API credentials are not configured (apiKey / apiKeySecret / accessToken / accessTokenSecret missing)',
        );
      },
    };
  }
  const postToXTool = createPostToXTool({
    apiKey: config.x.apiKey ?? '',
    apiKeySecret: config.x.apiKeySecret ?? '',
    accessToken: config.x.accessToken ?? '',
    accessTokenSecret: config.x.accessTokenSecret ?? '',
    ...(config.x.handle !== undefined ? { handle: config.x.handle } : {}),
  });
  return createPostShillForTool({
    anthropicClient: anthropic,
    postToXTool,
    model: MODEL,
  });
}

export interface RunBrainChatDeps {
  config: AppConfig;
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  messages: ChatMessage[];
  loreStore: LoreStore;
  shillOrderStore: ShillOrderStore;
  /**
   * Test seam — defaults to the real `runBrainAgent`. Tests supply a stub
   * that short-circuits the LLM call and optionally invokes the forwarded
   * event callbacks so AC-BRAIN-2 bubbling is verifiable without Anthropic.
   */
  runBrainAgentImpl?: (params: RunBrainAgentParams) => Promise<AgentLoopResult>;
}

/**
 * BRAIN-P3 orchestrator entry point. Mirrors the shape of `runShillMarketDemo`
 * (phase callbacks injected at construction) but with only one phase — the
 * Brain agent loop itself. Persona-invoke tools are built here because they
 * need run-local state (Map-based `tokenMetaByAddr` / `orderByAddr`) that no
 * other caller has reason to manage.
 */
export async function runBrainChat(deps: RunBrainChatDeps): Promise<void> {
  const { config, anthropic, store, runId, messages, loreStore, shillOrderStore } = deps;

  // Validate the messages array up-front. An invalid shape is a caller bug
  // (HTTP layer already runs this same schema, but CLI / tests can reach the
  // orchestrator directly). Throwing here lets the HTTP route translate the
  // rejection into `setStatus(runId, 'error', ...)` — same pattern every other
  // orchestrator follows.
  const validated = brainChatMessagesSchema.parse(messages);

  const runBrainAgentFn = deps.runBrainAgentImpl ?? runBrainAgent;

  store.setStatus(runId, 'running');

  // ─── Run-local state caches ────────────────────────────────────────────────
  //
  // The Brain systemPrompt only passes `tokenAddr` to `invoke_narrator` and
  // `invoke_shiller`; the personas need richer inputs (tokenName / tokenSymbol
  // for the narrator, orderId / loreSnippet for the shiller). We cache those
  // here keyed by lower-cased tokenAddr. Ephemeral: cleared when this function
  // returns. Spec permits because "single server instance demo scope".
  //
  // Seed from whatever state the prior run kinds left in shared stores:
  //   - LoreStore already holds `{tokenName, tokenSymbol, chapters}` per token
  //     from the a2a / creator runs, so we can populate tokenMeta lookups.
  //   - ShillOrderStore surfaces already-enqueued orders so a Brain-driven
  //     `/order` call can pick up the pending queue entry.
  const tokenMetaByAddr = new Map<string, NarratorTokenMeta>();

  // Build the four persona-invoke tools with their run-level dependencies.
  // Registry is fresh per run so concurrent Brain runs don't clobber tool
  // registration state.
  const registry = new ToolRegistry();

  // Tools that depend only on client + registry (creator).
  const invokeCreatorTool = createInvokeCreatorTool({
    persona: creatorPersona,
    client: anthropic,
    registry,
  });

  // Narrator tool needs the LoreStore + a tokenMeta resolver. We read the
  // latest lore entry for the token if present; otherwise we return
  // placeholders so the persona can still run (the narrator will overwrite
  // them once the Creator deposits real metadata).
  const resolveTokenMeta = (tokenAddr: string): NarratorTokenMeta => {
    const key = tokenAddr.toLowerCase();
    const cached = tokenMetaByAddr.get(key);
    if (cached !== undefined) {
      return cached;
    }
    // Fallback: placeholder names. The narrator persona tolerates this — it
    // will use whatever we pass. A real Creator run would have prefilled
    // the cache via its CreatorResult.metadata before the narrator is invoked.
    const fallback: NarratorTokenMeta = {
      tokenName: 'HBNB2026-Unknown',
      tokenSymbol: 'HBNB2026-UNK',
    };
    return fallback;
  };

  const invokeNarratorTool = createInvokeNarratorTool({
    persona: narratorPersona,
    client: anthropic,
    registry,
    store: loreStore,
    resolveTokenMeta,
  });

  // Shiller tool needs post_shill_for + an order resolver. The order resolver
  // tries to pick up an enqueued ShillOrderStore order for the tokenAddr; if
  // none exists, we synthesise one with a stub orderId so the tool still runs.
  // TODO(BRAIN-P5): wire a real x402 creator-payment phase here if evaluators
  // click a Brain-driven "/order" flow — for the demo, synthetic orderIds are
  // acceptable because the Shiller persona itself still posts a real tweet.
  //
  // When the X API credentials are not configured (CLI demos, unit tests),
  // `createPostToXTool` throws at construction time. We gate the real tool on
  // presence of all four OAuth creds and fall back to a stub that rejects
  // cleanly when the Brain actually tries to invoke_shiller — keeping the
  // other three tools (creator / narrator / heartbeat) usable.
  const postShillForTool = buildPostShillForTool(config, anthropic);

  const resolveOrder = (tokenAddr: string, _brief: string | undefined): ShillerOrderContext => {
    const key = tokenAddr.toLowerCase();
    const lore = loreStore.getLatest(key);
    const loreSnippet = lore?.chapterText ?? fallbackLoreSnippet(key);
    const tokenSymbol = tokenMetaByAddr.get(key)?.tokenSymbol;
    // Prefer an existing queued ShillOrderStore entry (from a prior creator
    // payment) so Brain-driven shills correlate to a real paid order when
    // possible. Fallback to a synthetic UUID when no pending order exists —
    // demo path acceptance per brain-conversational-surface.md.
    const pending = shillOrderStore
      .findByTokenAddr(key)
      .filter((o) => o.status === 'queued' || o.status === 'processing');
    const orderId = pending[0]?.orderId ?? randomUUID();
    return {
      orderId,
      loreSnippet,
      ...(tokenSymbol !== undefined ? { tokenSymbol } : {}),
    };
  };

  const invokeShillerTool = createInvokeShillerTool({
    persona: shillerPersona,
    postShillForTool,
    resolveOrder,
  });

  // Heartbeat tool needs a systemPrompt + buildUserInput. Single tick per call.
  const invokeHeartbeatTickTool = createInvokeHeartbeatTickTool({
    persona: heartbeatPersona,
    client: anthropic,
    registry,
    model: MODEL,
    systemPrompt: HEARTBEAT_SYSTEM_PROMPT,
    buildUserInput: ({ tickId, tickAt }) =>
      `Tick ${tickId} at ${tickAt}. Pick exactly ONE action and respond with the required JSON object.`,
    onLog: (event) => store.addLog(runId, event),
  });

  const tools: ReadonlyArray<AgentTool<unknown, unknown>> = [
    invokeCreatorTool as unknown as AgentTool<unknown, unknown>,
    invokeNarratorTool as unknown as AgentTool<unknown, unknown>,
    invokeShillerTool as unknown as AgentTool<unknown, unknown>,
    invokeHeartbeatTickTool as unknown as AgentTool<unknown, unknown>,
  ];

  // Drive the Brain agent. Every persona-side event surfaces through the
  // RunStore callbacks so the SSE consumer (routes.ts) sees them end-to-end.
  await runBrainAgentFn({
    client: anthropic,
    registry,
    messages: validated,
    tools,
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
    onToolUseStart: (event) => store.addToolUseStart(runId, event),
    onToolUseEnd: (event) => store.addToolUseEnd(runId, event),
    onAssistantDelta: (event) => store.addAssistantDelta(runId, event),
  });

  store.setStatus(runId, 'done');
}
