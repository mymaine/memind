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
 * Registry isolation — why each persona gets its OWN sub-registry:
 *   - The Brain meta-agent (`runBrainAgent`) registers its four `invoke_*`
 *     tools into the registry we pass it, then runs its LLM loop against
 *     that registry. That is the *brain* registry.
 *   - Each `invoke_*` tool's execute path calls `persona.run(input, ctx)`
 *     where `ctx.registry` MUST be the persona's own internal sub-tool
 *     registry (e.g. creator needs narrative_generator / meme_image_creator
 *     / onchain_deployer / lore_writer). If we reused the brain's registry
 *     here, the creator persona's inner `runAgentLoop` would see the four
 *     `invoke_*` tools, call `invoke_creator` on itself, and spin an
 *     infinite recursion that wall-clocks the entire `/launch` demo path.
 *   - Therefore the orchestrator builds one fresh registry per sub-agent
 *     (creator / narrator / heartbeat) populated with only that persona's
 *     real sub-tools, plus a separate brain registry that only ever holds
 *     the four invoke_* tools. The shiller persona intentionally gets an
 *     empty fresh registry because its `run(...)` ignores `ctx.registry`
 *     (the post_shill_for tool is passed on TInput).
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
import { GoogleGenAI } from '@google/genai';
import { PinataSDK } from 'pinata';
import type { AgentTool, ChatMessage } from '@hack-fourmeme/shared';
import { chatMessageSchema } from '@hack-fourmeme/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { ShillOrderStore } from '../state/shill-order-store.js';
import type { HeartbeatSessionStore } from '../state/heartbeat-session-store.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  createInvokeCreatorTool,
  createInvokeHeartbeatTickTool,
  createInvokeNarratorTool,
  createInvokeShillerTool,
  createListHeartbeatsTool,
  createStopHeartbeatTool,
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
import { createPostToXTool, xPostInputSchema, xPostOutputSchema } from '../tools/x-post.js';
import { createNarrativeTool } from '../tools/narrative.js';
import { createImageTool } from '../tools/image.js';
import { createLoreTool } from '../tools/lore.js';
import { createOnchainDeployerTool } from '../tools/deployer.js';
import { createLoreExtendTool } from '../tools/lore-extend.js';
import { createCheckTokenStatusTool } from '../tools/token-status.js';
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
  'The user message names the exact tokenAddr under observation — use THAT address verbatim.',
  'Each tick, call check_token_status(tokenAddr) with the address from the user message.',
  'Based on the status, EITHER call post_to_x with a short tweet (<=240 chars, include the',
  'tokenAddr and a bscscan link) OR call extend_lore to add a new chapter to the on-chain',
  'story, OR respond idle when nothing is worth doing this tick.',
  'Pick exactly ONE action per tick. Your final response is a single JSON object:',
  '{"action": "post_to_x" | "extend_lore" | "idle", "reason": "..."}.',
  'Do NOT invent addresses. If check_token_status returns zero holders or zero activity,',
  'that alone does NOT mean the token is undeployed — the contract can exist on-chain with',
  'fresh data; treat it as "newly launched" and still operate on the given tokenAddr.',
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

// ─── Sub-registry builders ─────────────────────────────────────────────────
//
// Each persona that runs its own `runAgentLoop` needs a dedicated sub-tool
// registry containing ONLY its real tools (never any `invoke_*` wrapper) so
// the inner LLM loop cannot see its own invocation tool and recurse.
// ----------------------------------------------------------------------------

/**
 * Build the creator persona's sub-tool registry: narrative_generator,
 * meme_image_creator, onchain_deployer, lore_writer. Mirrors the wiring in
 * `runs/creator-phase.ts` so both entry points produce the same creator
 * tool surface.
 *
 * Throws early when a required secret is missing so the failure surfaces as
 * the Brain's `invoke_creator` call rather than a downstream mid-loop crash.
 */
export function buildCreatorSubRegistry(config: AppConfig, anthropic: Anthropic): ToolRegistry {
  const googleKey = process.env.GOOGLE_API_KEY?.trim();
  if (googleKey === undefined || googleKey === '') {
    throw new Error(
      'runBrainChat: GOOGLE_API_KEY missing (creator persona requires Gemini for meme image generation)',
    );
  }
  const bscKey = config.wallets.bscDeployer.privateKey;
  if (bscKey === undefined) {
    throw new Error(
      'runBrainChat: BSC_DEPLOYER_PRIVATE_KEY missing (creator persona requires BSC deployer)',
    );
  }
  if (config.pinata.jwt === undefined) {
    throw new Error(
      'runBrainChat: PINATA_JWT missing (creator persona requires Pinata to pin the meme image and lore)',
    );
  }

  const gemini = new GoogleGenAI({ apiKey: googleKey });
  const pinata = new PinataSDK({
    pinataJwt: config.pinata.jwt,
    pinataGateway: 'gateway.pinata.cloud',
  });

  const reg = new ToolRegistry();
  reg.register(createNarrativeTool({ client: anthropic, model: MODEL }));
  reg.register(createImageTool({ client: gemini, pinata }));
  reg.register(createLoreTool({ anthropic, pinata, model: MODEL }));
  reg.register(createOnchainDeployerTool({ privateKey: bscKey as `0x${string}` }));
  return reg;
}

/**
 * Build the narrator persona's sub-tool registry: extend_lore only. The
 * narrator's systemPrompt forces a single `extend_lore` call per invocation;
 * no other tool is needed. Mirrors the wiring in `a2a.ts#defaultRunNarratorPhase`.
 */
export function buildNarratorSubRegistry(config: AppConfig, anthropic: Anthropic): ToolRegistry {
  if (config.pinata.jwt === undefined) {
    throw new Error(
      'runBrainChat: PINATA_JWT missing (narrator persona requires Pinata to pin lore chapters)',
    );
  }
  const reg = new ToolRegistry();
  reg.register(createLoreExtendTool({ anthropic, pinataJwt: config.pinata.jwt, model: MODEL }));
  return reg;
}

/**
 * Build the heartbeat persona's sub-tool registry: check_token_status (viem),
 * post_to_x (X API or dry-run), and extend_lore. Mirrors the production wiring
 * in `heartbeat-runner.ts` minus the test seams — Brain-driven heartbeat ticks
 * never need stubs because they ride on the same Anthropic / viem / Pinata
 * stack the real heartbeat runner uses.
 */
export function buildHeartbeatSubRegistry(config: AppConfig, anthropic: Anthropic): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(createCheckTokenStatusTool({ rpcUrl: config.bsc.rpcUrl }));

  const x = config.x;
  const haveCreds =
    x.apiKey !== undefined &&
    x.apiKeySecret !== undefined &&
    x.accessToken !== undefined &&
    x.accessTokenSecret !== undefined;
  if (haveCreds) {
    reg.register(
      createPostToXTool({
        apiKey: x.apiKey as string,
        apiKeySecret: x.apiKeySecret as string,
        accessToken: x.accessToken as string,
        accessTokenSecret: x.accessTokenSecret as string,
        handle: x.handle,
      }),
    );
  } else {
    // Dry-run post_to_x — mirrors heartbeat-runner's dry-run branch so a
    // Brain-driven heartbeat tick can still pick the post action without live
    // X creds. Never real-posts; returns a fixed sentinel tweet id.
    reg.register({
      name: 'post_to_x',
      description:
        'Dry-run post_to_x stub — X API credentials are not configured, so the tweet is not actually posted.',
      inputSchema: xPostInputSchema,
      outputSchema: xPostOutputSchema,
      async execute(input: { text: string }) {
        return {
          tweetId: 'dry-run',
          text: input.text,
          postedAt: new Date().toISOString(),
          url: 'about:blank',
        };
      },
    } as unknown as AgentTool<unknown, unknown>);
  }

  if (config.pinata.jwt !== undefined) {
    reg.register(createLoreExtendTool({ anthropic, pinataJwt: config.pinata.jwt, model: MODEL }));
  }
  return reg;
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
   * Process-wide registry of live background heartbeat loops. Required so
   * `/heartbeat <addr> <intervalMs>` starts a real timer that survives the
   * brain-chat run's lifecycle (the run finishes after one LLM turn; the
   * background loop keeps ticking). Same instance must be passed to every
   * brain-chat run so `/heartbeat-stop` on a later run finds the session
   * started on an earlier run.
   */
  heartbeatSessionStore: HeartbeatSessionStore;
  /**
   * Test seam — defaults to the real `runBrainAgent`. Tests supply a stub
   * that short-circuits the LLM call and optionally invokes the forwarded
   * event callbacks so AC-BRAIN-2 bubbling is verifiable without Anthropic.
   */
  runBrainAgentImpl?: (params: RunBrainAgentParams) => Promise<AgentLoopResult>;
  /**
   * Test seam — override sub-registry construction so unit tests can avoid
   * the GOOGLE_API_KEY / BSC_DEPLOYER_PRIVATE_KEY / PINATA_JWT preconditions
   * the real builders enforce. Production callers leave these undefined and
   * the orchestrator falls back to the real `buildXxxSubRegistry` helpers.
   */
  buildCreatorSubRegistryImpl?: (config: AppConfig, anthropic: Anthropic) => ToolRegistry;
  buildNarratorSubRegistryImpl?: (config: AppConfig, anthropic: Anthropic) => ToolRegistry;
  buildHeartbeatSubRegistryImpl?: (config: AppConfig, anthropic: Anthropic) => ToolRegistry;
}

/**
 * BRAIN-P3 orchestrator entry point. Mirrors the shape of `runShillMarketDemo`
 * (phase callbacks injected at construction) but with only one phase — the
 * Brain agent loop itself. Persona-invoke tools are built here because they
 * need run-local state (Map-based `tokenMetaByAddr` / `orderByAddr`) that no
 * other caller has reason to manage.
 */
export async function runBrainChat(deps: RunBrainChatDeps): Promise<void> {
  const {
    config,
    anthropic,
    store,
    runId,
    messages,
    loreStore,
    shillOrderStore,
    heartbeatSessionStore,
  } = deps;

  // Validate the messages array up-front. An invalid shape is a caller bug
  // (HTTP layer already runs this same schema, but CLI / tests can reach the
  // orchestrator directly). Throwing here lets the HTTP route translate the
  // rejection into `setStatus(runId, 'error', ...)` — same pattern every other
  // orchestrator follows.
  const validated = brainChatMessagesSchema.parse(messages);

  const runBrainAgentFn = deps.runBrainAgentImpl ?? runBrainAgent;
  const buildCreatorReg = deps.buildCreatorSubRegistryImpl ?? buildCreatorSubRegistry;
  const buildNarratorReg = deps.buildNarratorSubRegistryImpl ?? buildNarratorSubRegistry;
  const buildHeartbeatReg = deps.buildHeartbeatSubRegistryImpl ?? buildHeartbeatSubRegistry;

  store.setStatus(runId, 'running');

  // ─── Registry isolation ──────────────────────────────────────────────────
  //
  // One registry per scope:
  //   - `brainRegistry` — the Brain meta-agent's registry. Only the four
  //     `invoke_*` tools end up here (brain.ts#runBrainAgent registers them).
  //     The Brain LLM loop runs against this registry.
  //   - `creatorSubRegistry` / `narratorSubRegistry` / `heartbeatSubRegistry`
  //     — each persona's internal tools. Passed to the matching
  //     `createInvoke*Tool({ registry })` so the persona's nested
  //     `runAgentLoop` (via `ctx.registry`) only sees its own sub-tools.
  //   - `shillerSubRegistry` — a fresh empty registry. The shiller persona's
  //     `run(...)` ignores `ctx.registry` (see market-maker.ts), but the
  //     factory still requires a registry reference to thread onto the ctx.
  //     An empty one avoids accidentally sharing state with any other scope.
  //
  // Historical bug: this orchestrator used to build a single registry and
  // feed it to BOTH `runBrainAgent` AND each `createInvoke*Tool`. After
  // `runBrainAgent` registered the four invoke_* tools, every persona's
  // `ctx.registry` contained them — so `creatorPersona.run(...)` would enter
  // `runAgentLoop` with `invoke_creator` in its toolset and immediately call
  // it on itself, causing infinite recursion that bricked `/launch`.
  const brainRegistry = new ToolRegistry();
  const creatorSubRegistry = buildCreatorReg(config, anthropic);
  const narratorSubRegistry = buildNarratorReg(config, anthropic);
  const heartbeatSubRegistry = buildHeartbeatReg(config, anthropic);
  const shillerSubRegistry = new ToolRegistry();

  // Shared event-forwarders — each tool factory takes this bundle so every
  // nested persona-side log / artifact / tool_use / assistant:delta event
  // surfaces on the Brain run's SSE stream under the same runId. Without
  // this, the FooterDrawer Logs / Artifacts / Brain Console tabs stay empty
  // for the full 60-90s persona execution window and the UI looks hung.
  const eventForwarders = {
    onLog: (event: Parameters<typeof store.addLog>[1]) => store.addLog(runId, event),
    onArtifact: (artifact: Parameters<typeof store.addArtifact>[1]) =>
      store.addArtifact(runId, artifact),
    onToolUseStart: (event: Parameters<typeof store.addToolUseStart>[1]) =>
      store.addToolUseStart(runId, event),
    onToolUseEnd: (event: Parameters<typeof store.addToolUseEnd>[1]) =>
      store.addToolUseEnd(runId, event),
    onAssistantDelta: (event: Parameters<typeof store.addAssistantDelta>[1]) =>
      store.addAssistantDelta(runId, event),
  };

  // Tools that depend only on client + registry (creator). The shared
  // LoreStore is threaded in so the creator persona can upsert Chapter 1
  // after `lore_writer` completes — that is what makes a later `/lore` call
  // produce a real Chapter 2 continuation instead of rewriting Chapter 1.
  const invokeCreatorTool = createInvokeCreatorTool({
    persona: creatorPersona,
    client: anthropic,
    registry: creatorSubRegistry,
    store: loreStore,
    ...eventForwarders,
  });

  // Narrator tool needs the LoreStore + a tokenMeta resolver. LoreStore is
  // the single source of truth for per-token metadata: the creator persona
  // deposits Chapter 1 with `{tokenName, tokenSymbol}` on `/launch`, and the
  // narrator persona overwrites/extends the chain on each subsequent call.
  // When no chapter has been deposited yet (e.g. user calls `/lore` before
  // `/launch`), fall back to placeholder names — the narrator persona
  // tolerates them and will produce Chapter 1.
  const resolveTokenMeta = async (tokenAddr: string): Promise<NarratorTokenMeta> => {
    const chapters = await loreStore.getAllChapters(tokenAddr);
    if (chapters.length === 0) {
      return {
        tokenName: 'HBNB2026-Unknown',
        tokenSymbol: 'HBNB2026-UNK',
      };
    }
    const latest = chapters[chapters.length - 1]!;
    return {
      tokenName: latest.tokenName,
      tokenSymbol: latest.tokenSymbol,
      previousChapters: chapters.map((c) => c.chapterText),
      targetChapterNumber: chapters.length + 1,
    };
  };

  const invokeNarratorTool = createInvokeNarratorTool({
    persona: narratorPersona,
    client: anthropic,
    registry: narratorSubRegistry,
    store: loreStore,
    resolveTokenMeta,
    ...eventForwarders,
  });

  // Shiller tool needs post_shill_for + an order resolver. The order resolver
  // tries to pick up an enqueued ShillOrderStore order for the tokenAddr; if
  // none exists, we synthesise one with a stub orderId so the tool still runs.
  // TODO(BRAIN-P5): wire a real x402 creator-payment phase here if a user
  // triggers a Brain-driven "/order" flow — for now, synthetic orderIds are
  // acceptable because the Shiller persona itself still posts a real tweet.
  //
  // When the X API credentials are not configured (CLI demos, unit tests),
  // `createPostToXTool` throws at construction time. We gate the real tool on
  // presence of all four OAuth creds and fall back to a stub that rejects
  // cleanly when the Brain actually tries to invoke_shiller — keeping the
  // other three tools (creator / narrator / heartbeat) usable.
  const postShillForTool = buildPostShillForTool(config, anthropic);

  const resolveOrder = async (
    tokenAddr: string,
    _brief: string | undefined,
  ): Promise<ShillerOrderContext> => {
    const key = tokenAddr.toLowerCase();
    const lore = await loreStore.getLatest(key);
    const loreSnippet = lore?.chapterText ?? fallbackLoreSnippet(key);
    // Token symbol travels on the lore entry itself (creator/narrator both
    // write it on upsert), so LoreStore is the single source of truth here
    // too — no parallel metadata cache needed.
    const tokenSymbol = lore?.tokenSymbol;
    // Prefer an existing queued ShillOrderStore entry (from a prior creator
    // payment) so Brain-driven shills correlate to a real paid order when
    // possible. Fallback to a synthetic UUID when no pending order exists —
    // demo path acceptance per brain-conversational-surface.md.
    const pending = (await shillOrderStore.findByTokenAddr(key)).filter(
      (o) => o.status === 'queued' || o.status === 'processing',
    );
    const orderId = pending[0]?.orderId ?? randomUUID();
    return {
      orderId,
      loreSnippet,
      ...(tokenSymbol !== undefined ? { tokenSymbol } : {}),
    };
  };

  // NB: the shiller persona's `run(...)` does not use `ctx.registry`. We
  // still create and thread a fresh empty registry (via the
  // createInvokeShillerTool factory's internal ctx construction) to keep
  // the surface uniform; the factory itself currently does not accept a
  // `registry` param, so we rely on its in-tool empty-stub (see
  // invoke-persona.ts#createInvokeShillerTool where `ctx.registry` is set
  // to `{}` before persona.run). The `shillerSubRegistry` variable below
  // exists only to make the isolation rule grep-able and is deliberately
  // unused by the factory today.
  void shillerSubRegistry;

  const invokeShillerTool = createInvokeShillerTool({
    persona: shillerPersona,
    postShillForTool,
    resolveOrder,
    ...eventForwarders,
  });

  // Heartbeat tool is dual-mode now: `{tokenAddr}` → one-shot tick OR
  // snapshot-read if a session exists; `{tokenAddr, intervalMs}` → start or
  // restart a real background loop in `heartbeatSessionStore`. The session
  // store comes from the server boot layer so /heartbeat-stop on a later
  // run finds the session started by an earlier run.
  const invokeHeartbeatTickTool = createInvokeHeartbeatTickTool({
    persona: heartbeatPersona,
    client: anthropic,
    registry: heartbeatSubRegistry,
    model: MODEL,
    systemPrompt: HEARTBEAT_SYSTEM_PROMPT,
    buildUserInput: ({ tickId, tickAt }) =>
      `Tick ${tickId} at ${tickAt}. Pick exactly ONE action and respond with the required JSON object.`,
    sessionStore: heartbeatSessionStore,
    ...eventForwarders,
  });

  const stopHeartbeatTool = createStopHeartbeatTool({
    sessionStore: heartbeatSessionStore,
    ...eventForwarders,
  });

  const listHeartbeatsTool = createListHeartbeatsTool({
    sessionStore: heartbeatSessionStore,
    ...eventForwarders,
  });

  const tools: ReadonlyArray<AgentTool<unknown, unknown>> = [
    invokeCreatorTool as unknown as AgentTool<unknown, unknown>,
    invokeNarratorTool as unknown as AgentTool<unknown, unknown>,
    invokeShillerTool as unknown as AgentTool<unknown, unknown>,
    invokeHeartbeatTickTool as unknown as AgentTool<unknown, unknown>,
    stopHeartbeatTool as unknown as AgentTool<unknown, unknown>,
    listHeartbeatsTool as unknown as AgentTool<unknown, unknown>,
  ];

  // Drive the Brain agent. Every persona-side event surfaces through the
  // RunStore callbacks so the SSE consumer (routes.ts) sees them end-to-end.
  await runBrainAgentFn({
    client: anthropic,
    registry: brainRegistry,
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
