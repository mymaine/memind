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
 *   - Run-scoped state (pending orders, latest lore, chat history) lives in
 *     the shared PG-backed stores (LoreStore / ShillOrderStore / RunStore)
 *     the orchestrator receives via DI, not in per-run in-memory maps.
 *
 * Registry isolation — why each persona gets its OWN sub-registry:
 *   - The Brain meta-agent (`runBrainAgent`) registers its four `invoke_*`
 *     tools into the registry we pass it, then runs its LLM loop against
 *     that registry. That is the *brain* registry.
 *   - Each of invoke_creator / invoke_narrator / invoke_heartbeat_tick's
 *     execute path calls `persona.run(input, ctx)` where `ctx.registry`
 *     MUST be the persona's own internal sub-tool registry (e.g. creator
 *     needs narrative_generator / meme_image_creator / onchain_deployer /
 *     lore_writer). If we reused the brain's registry here, the creator
 *     persona's inner `runAgentLoop` would see the four `invoke_*` tools,
 *     call `invoke_creator` on itself, and spin an infinite recursion that
 *     wall-clocks the entire `/launch` demo path.
 *   - Therefore the orchestrator builds one fresh registry per sub-agent
 *     (creator / narrator / heartbeat) populated with only that persona's
 *     real sub-tools, plus a separate brain registry that only ever holds
 *     the four invoke_* tools.
 *   - `invoke_shiller` is the exception: it drives `runShillMarketDemo`
 *     end-to-end (x402 payment → shill-order enqueue → shiller persona),
 *     bypassing the persona.run / ctx.registry pathway entirely — so no
 *     shiller sub-registry exists.
 *
 * Not handled here (intentionally):
 *   - Per-run persistence of chat history — the HTTP caller ships the full
 *     messages array with every POST (stateless server).
 *   - Slash-command semantics — the Brain systemPrompt already routes
 *     `/launch`, `/order`, `/lore`, `/heartbeat` into tool calls; the
 *     orchestrator is transport-agnostic.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { PinataSDK } from 'pinata';
import type { AgentTool, ChatMessage } from '@hack-fourmeme/shared';
import { chatMessageSchema } from '@hack-fourmeme/shared';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { AnchorLedger } from '../state/anchor-ledger.js';
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
  INVOKE_CREATOR_TOOL_NAME,
  INVOKE_HEARTBEAT_TICK_TOOL_NAME,
  INVOKE_NARRATOR_TOOL_NAME,
  INVOKE_SHILLER_TOOL_NAME,
  LIST_HEARTBEATS_TOOL_NAME,
  STOP_HEARTBEAT_TOOL_NAME,
  type NarratorTokenMeta,
} from '../tools/invoke-persona.js';
import type { CreatorPaymentPhaseFn, runShillMarketDemo } from './shill-market.js';
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
   * Optional shared AnchorLedger (AC3). When wired, `/launch` fires
   * chapter 1 anchors through `invoke_creator` and `/lore` fires chapter N
   * anchors through `invoke_narrator`. Layer 2 (BSC mainnet memo) is
   * gated inside the factories by `ANCHOR_ON_CHAIN` and by the presence of
   * `config.wallets.bscDeployer.privateKey`. Omitted in unit tests and
   * legacy CLI boot paths — the invoke_* tools silently skip anchor work
   * when the ledger is absent.
   */
  anchorLedger?: AnchorLedger;
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
  /**
   * Optional real creator-payment phase — threaded straight into the
   * shill-market orchestrator when `/order` fires via `invoke_shiller`.
   * Production wires `createRealCreatorPaymentPhase(...)` here so the
   * settlement artifact carries a genuine Base Sepolia USDC tx hash. Left
   * undefined by tests and CLI demos → `stubCreatorPaymentPhase` runs
   * instead, emitting the zero-sentinel hash and never spending USDC.
   */
  creatorPaymentImpl?: CreatorPaymentPhaseFn;
  /**
   * Test seam for the `invoke_shiller` tool's internal `runShillMarketDemo`
   * call. Integration tests override this so driving `/order` through the
   * Brain agent doesn't touch Anthropic / X API / pg. Production leaves it
   * undefined and the factory falls back to the real `runShillMarketDemo`.
   */
  invokeShillerRunShillMarketDemoImpl?: typeof runShillMarketDemo;
}

/**
 * BRAIN-P3 orchestrator entry point. Mirrors the shape of `runShillMarketDemo`
 * (phase callbacks injected at construction) but with only one phase — the
 * Brain agent loop itself. Persona-invoke tools are built here because they
 * close over run-scoped deps (runId, RunStore, sub-registries, PG-backed
 * stores) that no other caller has reason to manage.
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
  //   - Shiller has NO sub-registry: `createInvokeShillerTool` now drives
  //     `runShillMarketDemo` end-to-end and the shiller phase inside that
  //     orchestrator calls `runShillerAgent` directly with the injected
  //     `postShillForTool` — no Anthropic client or tool registry involved.
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
  //
  // AC3 — thread the optional anchor ledger + deployer key so `/launch`
  // anchors chapter 1 symmetrically with `/lore`. `maybeAnchorContent`
  // inside the tool factory consults `ANCHOR_ON_CHAIN` at run time; we
  // forward the config's bscDeployer key so the gate can actually fire
  // when enabled. Layer 1 still runs without the key (just ledger + initial
  // artifact), and the factory silently skips everything when no ledger
  // is wired.
  const bscDeployerPk = config.wallets.bscDeployer.privateKey as `0x${string}` | undefined;
  const invokeCreatorTool = createInvokeCreatorTool({
    persona: creatorPersona,
    client: anthropic,
    registry: creatorSubRegistry,
    store: loreStore,
    ...(deps.anchorLedger !== undefined ? { anchorLedger: deps.anchorLedger } : {}),
    ...(bscDeployerPk !== undefined ? { bscDeployerPrivateKey: bscDeployerPk } : {}),
    // Route layer-2 anchor through the configured Binance BSC RPC so
    // Railway deployments stop hanging on viem's default community node.
    rpcUrl: config.bsc.rpcUrl,
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
    // AC3 — `/lore` joins `/launch` on the anchor surface. The factory
    // handles the ANCHOR_ON_CHAIN gate internally so we only need to
    // forward the ledger + deployer key.
    ...(deps.anchorLedger !== undefined ? { anchorLedger: deps.anchorLedger } : {}),
    ...(bscDeployerPk !== undefined ? { bscDeployerPrivateKey: bscDeployerPk } : {}),
    // Same Binance-node override the creator tool uses — keeps /lore
    // anchor tx out of viem's community default RPC.
    rpcUrl: config.bsc.rpcUrl,
    ...eventForwarders,
  });

  // Shiller tool now delegates to the full shill-market orchestrator
  // (runShillMarketDemo) so `/order <addr>` produces the same artifact set
  // — x402-tx, shill-order (queued→done), shill-tweet — as a direct
  // `POST /api/runs {kind:'shill-market'}` dispatch. This is the fix for
  // the Ch12 evidence BASE tab "always shows sample" bug: prior to this
  // change, Brain's `/order` short-circuited the orchestrator, never
  // emitted `x402-tx`, and thus never landed a row in the artifacts log.
  //
  // When the X API credentials are not configured (CLI demos, unit tests),
  // `buildPostShillForTool` falls back to a stub that rejects cleanly when
  // invoked — keeping the other three tools (creator / narrator /
  // heartbeat) usable.
  const postShillForTool = buildPostShillForTool(config, anthropic);

  const invokeShillerTool = createInvokeShillerTool({
    config,
    anthropic,
    store,
    runId,
    shillOrderStore,
    loreStore,
    postShillForTool,
    ...(deps.creatorPaymentImpl !== undefined
      ? { creatorPaymentImpl: deps.creatorPaymentImpl }
      : {}),
    ...(deps.invokeShillerRunShillMarketDemoImpl !== undefined
      ? { runShillMarketDemoImpl: deps.invokeShillerRunShillMarketDemoImpl }
      : {}),
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
  // Hallucination guard: count Brain-level tool calls that fired this turn
  // so we can detect the "LLM saw prior results in context and skipped the
  // tool call, fabricating plausible output instead" failure mode. If the
  // final user turn was a slash command that MUST go through a tool
  // (launch/order/lore/heartbeat/heartbeat-stop/heartbeat-list) but the
  // Brain emitted zero tool calls this turn, we log loudly so the operator
  // can see something is wrong — the UI will show the dodgy assistant text
  // either way, but at least a warn-level log lands in the run's event
  // stream. The Brain system prompt's HARD NO-FABRICATION RULES are the
  // primary defence; this guard is belt-and-suspenders.
  // Derive forced tool_choice from the final user turn's slash command, if
  // any. This bypasses the LLM's ability to "decide to skip the tool" on
  // tool-required slashes — the root structural defence against the
  // fabricated CID regression observed when prior tool_result text sat in
  // context. Emits an info log on force so demo operators can see the
  // decision in the SSE stream.
  const forcedToolName = deriveForcedToolName(validated);
  if (forcedToolName !== undefined) {
    store.addLog(runId, {
      ts: new Date().toISOString(),
      agent: 'brain',
      tool: 'runtime',
      level: 'info',
      message: `forcing tool_choice=${forcedToolName} for slash command`,
    });
  }

  let brainToolCallCount = 0;
  await runBrainAgentFn({
    client: anthropic,
    registry: brainRegistry,
    messages: validated,
    tools,
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
    onToolUseStart: (event) => {
      if (event.agent === 'brain') {
        brainToolCallCount += 1;
      }
      store.addToolUseStart(runId, event);
    },
    onToolUseEnd: (event) => store.addToolUseEnd(runId, event),
    onAssistantDelta: (event) => store.addAssistantDelta(runId, event),
    ...(forcedToolName !== undefined
      ? { toolChoice: { type: 'tool' as const, name: forcedToolName } }
      : {}),
  });

  const lastUserMessage = validated[validated.length - 1];
  if (lastUserMessage !== undefined && lastUserMessage.role === 'user') {
    const trimmed = lastUserMessage.content.trim();
    if (TOOL_REQUIRED_SLASH_REGEX.test(trimmed) && brainToolCallCount === 0) {
      const hint =
        `Brain emitted zero tool calls for a slash command that requires one (message=${JSON.stringify(trimmed.slice(0, 80))}). ` +
        'Any CIDs, tx hashes, or URLs in the assistant reply are likely fabricated. ' +
        'See BRAIN_SYSTEM_PROMPT HARD NO-FABRICATION RULES.';
      store.addLog(runId, {
        ts: new Date().toISOString(),
        agent: 'brain',
        tool: 'runtime',
        level: 'warn',
        message: hint,
      });
      console.warn(`[brain-chat] ${hint} (runId=${runId})`);
    }
  }

  store.setStatus(runId, 'done');
}

/**
 * Server-side slash commands that MUST be backed by a tool call. Client-only
 * commands (/status, /help, /reset, /clear) are handled in the web UI before
 * they ever reach the Brain, so we do NOT include them here.
 */
const TOOL_REQUIRED_SLASH_REGEX =
  /^\/(launch|order|lore|heartbeat|heartbeat-stop|heartbeat-list)(\s|$)/;

/**
 * Anti-fabrication fix (2026-04-20): maps a slash-command keyword to the
 * exact Brain-level tool name the Anthropic `tool_choice: {type:'tool'}`
 * must force. With this, the LLM cannot "decide to skip the tool" on a
 * repeated /lore — which was the root cause of the fabricated Chapter 3/4
 * CIDs observed when prior turns' tool_result text sat in context.
 *
 * Keep this map in lockstep with the BRAIN_SYSTEM_PROMPT's slash-handling
 * section; a drift means the prompt tells the LLM to route `/X` to tool Y
 * while the runtime forces a different tool, which either fails loudly
 * (unknown tool) or silently produces the wrong action.
 */
const SLASH_TO_TOOL_NAME = new Map<string, string>([
  ['launch', INVOKE_CREATOR_TOOL_NAME],
  ['order', INVOKE_SHILLER_TOOL_NAME],
  ['lore', INVOKE_NARRATOR_TOOL_NAME],
  ['heartbeat', INVOKE_HEARTBEAT_TICK_TOOL_NAME],
  ['heartbeat-stop', STOP_HEARTBEAT_TOOL_NAME],
  ['heartbeat-list', LIST_HEARTBEATS_TOOL_NAME],
]);

/**
 * Inspect the final user turn's content; if it opens with a recognised
 * tool-required slash command, return the forced tool name. Free-form user
 * turns (no leading slash) and unrecognised slashes both yield undefined —
 * the Brain's auto tool_choice branch handles them.
 *
 * Exported for unit tests so the slash → tool mapping is pinnable without
 * driving the full orchestrator. Keep in sync with SLASH_TO_TOOL_NAME.
 */
export function deriveForcedToolName(messages: ReadonlyArray<ChatMessage>): string | undefined {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'user') return undefined;
  const trimmed = last.content.trim();
  const match = /^\/([a-z][a-z-]*)/.exec(trimmed);
  if (match === null) return undefined;
  const slashKey = match[1];
  if (slashKey === undefined) return undefined;
  return SLASH_TO_TOOL_NAME.get(slashKey);
}
