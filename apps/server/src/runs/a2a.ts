/**
 * runA2ADemo — pure-function orchestration of the Narrator → Market-maker
 * A2A commerce demo.
 *
 * Lifted verbatim (semantics-preserving) from the original
 * `demos/demo-a2a-run.ts` `main()` so two entry points can drive the same
 * code path:
 *   - The CLI (`pnpm --filter @hack-fourmeme/server demo:a2a`) keeps its
 *     SIGINT/timeout shell and subscribes a stdout logger to the RunStore.
 *   - The HTTP handler (`POST /api/runs` → SSE) fires this function in the
 *     background and streams RunStore events out over SSE.
 *
 * What moved out (compared to the CLI):
 *   - `process.exit`, `setTimeout` timeout, `SIGINT`/`SIGTERM` handlers.
 *   - Starting / stopping the Express server: the caller owns that.
 *   - `loadDotenv`: the caller (CLI or HTTP server bootstrap) is responsible
 *     for env loading before invoking this function.
 *
 * What stayed put:
 *   - Secret validation (OpenRouter / agent wallet / Pinata). We still fail
 *     fast — but by `throw new Error(...)` so the caller can translate it
 *     into a RunStatus transition.
 *   - Narrator-first, Market-maker-second ordering.
 *   - Orchestrator-level progress messages (previously `console.info`) now
 *     flow through the RunStore as LogEvents instead of stdout.
 *   - Artifact emission: one `lore-cid` when Narrator succeeds, one
 *     `x402-tx` when Market-maker actually settles a payment.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentId, Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { AnchorLedger } from '../state/anchor-ledger.js';
import { ToolRegistry } from '../tools/registry.js';
import { createLoreExtendTool } from '../tools/lore-extend.js';
import { createCheckTokenStatusTool } from '../tools/token-status.js';
import { createXFetchLoreTool } from '../tools/x-fetch-lore.js';
import { runNarratorAgent } from '../agents/narrator.js';
import { runMarketMakerAgent } from '../agents/market-maker.js';
import { runCreatorPhase as defaultRunCreatorPhase } from './creator-phase.js';
import type { RunStore } from './store.js';

// OpenRouter Anthropic-compatible gateway — mirrors demos/demo-a2a-run.ts.
const MODEL = 'anthropic/claude-sonnet-4-5';

export interface RunA2ADemoArgs {
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  /**
   * Optional user-supplied theme (e.g. from the dashboard ThemeInput). When
   * provided and non-blank, the orchestrator forwards it verbatim to the
   * Creator phase so the LLM pivots narrative / image / lore around this
   * string. When absent, a sensible default fires so the Creator prompt is
   * never empty. V2-P5 Task 1 — AC-V2-7.
   */
  theme?: string;
}

/** Default theme used when the caller does not provide one. */
export const DEFAULT_THEME = 'a meme celebrating BNB Chain 2026 agentic commerce';

export interface RunA2ADemoDeps {
  config: AppConfig;
  anthropic: Anthropic;
  /** Run event sink. The caller creates the record and passes the id here. */
  store: RunStore;
  runId: string;
  args: RunA2ADemoArgs;
  /**
   * Shared LoreStore: Narrator upserts chapters here and the x402
   * `/lore/:tokenAddr` handler reads them. MUST be the same instance both
   * sides see.
   */
  loreStore: LoreStore;
  /**
   * Shared AnchorLedger (AC3 layer 1). When provided, the Narrator phase
   * appends a keccak256 anchor record after every chapter upsert and emits a
   * `lore-anchor` artifact through the RunStore. Omitted for the existing a2a
   * test fixtures, which don't care about anchor evidence.
   */
  anchorLedger?: AnchorLedger;
  /**
   * Override the base URL used to build the lore endpoint the Market-maker
   * fetches from. Defaults to `http://localhost:${config.port}`. The CLI
   * leaves this default (starts its own server on that port); the HTTP entry
   * point can do the same since it reuses the main server.
   */
  loreEndpointBaseUrl?: string;

  // ─── Phase dependency-injection (V2-P1) ───────────────────────────────────
  // Each phase runs through a callback so tests can swap in fakes that just
  // push synthetic logs/artifacts into the RunStore. Production callers omit
  // these fields and the orchestrator falls back to the real implementations.
  runCreatorImpl?: RunCreatorPhaseFn;
  runNarratorImpl?: RunNarratorPhaseFn;
  runMarketMakerImpl?: RunMarketMakerPhaseFn;
}

/**
 * Creator phase callback. Returns the deployed token's address + tx hash so
 * the orchestrator can hand them to the Narrator phase. Implementations must
 * also push their own logs/artifacts into the store.
 */
export type RunCreatorPhaseFn = (deps: {
  config: AppConfig;
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  theme: string;
}) => Promise<{
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDeployTx: string;
}>;

/**
 * Narrator phase callback. Receives the (possibly Creator-produced) token
 * triple and returns the published lore CID + chapter number. Mirrors the
 * shape of `runNarratorAgent`'s return without leaking the agent type.
 */
export type RunNarratorPhaseFn = (deps: {
  config: AppConfig;
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  loreStore: LoreStore;
  /**
   * Optional AnchorLedger. When the orchestrator supplies one, the default
   * narrator implementation wires it into runNarratorAgent so every chapter
   * upsert records an anchor and emits a lore-anchor artifact. Absence means
   * the callback runs without anchor capture (Phase 2 demo callers, tests).
   */
  anchorLedger?: AnchorLedger;
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
}) => Promise<{ tokenAddr: string; ipfsHash: string; chapterNumber: number }>;

/**
 * Market-maker phase callback. Returns the x402 settlement details when the
 * MM purchases lore, or undefined when it declines.
 */
export type RunMarketMakerPhaseFn = (deps: {
  config: AppConfig;
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  loreEndpointBaseUrl: string;
  tokenAddr: string;
}) => Promise<
  | undefined
  | {
      settlementTxHash: string;
      baseSepoliaExplorerUrl: string;
    }
>;

/**
 * LogLevel is an inline alias of `LogEvent['level']`: the shared schema keeps
 * the level enum internal to `logEventSchema`, so we re-surface only the
 * literal union here to keep `addLog` payloads type-safe without duplicating
 * the schema.
 */
type LogLevel = LogEvent['level'];

/**
 * Build a LogEvent attributed to the orchestrator phase. The shared
 * `agentIdSchema` only permits creator / narrator / market-maker / heartbeat,
 * so we cannot invent an `orchestrator` agent id — we instead bucket each
 * orchestrator-level line under the agent whose phase is about to run (or
 * just ran). `tool: 'orchestrator'` makes the attribution observable.
 */
function orchestratorLog(
  store: RunStore,
  runId: string,
  agent: AgentId,
  message: string,
  level: LogLevel = 'info',
): void {
  store.addLog(runId, {
    ts: new Date().toISOString(),
    agent,
    tool: 'orchestrator',
    level,
    message,
  });
}

/**
 * Demo-day fallback path that bypasses the live Creator agent and forges
 * the same artifact set from env-supplied values. Activated only when
 * `CREATOR_DRY_RUN=true` (see runA2ADemo). Kept as a private helper to keep
 * the env-parsing constants (regex, env var names) co-located with the only
 * code path that consumes them.
 *
 * History: this used to be `emitPreSeedArtifacts` and was called
 * unconditionally on every a2a run as a Phase 4 hard-gate workaround. V2-P1
 * makes the Creator agent the default path; this helper now only fires under
 * the explicit dry-run opt-in. The rename happens in a Contract commit so
 * `git log` shows the moment we stopped pre-seeding by default.
 */
function emitDryRunFallbackArtifacts(store: RunStore, runId: string, tokenAddr: string): void {
  // Full 32-byte EVM tx hash regex — env-supplied DEMO_TOKEN_DEPLOY_TX must
  // match before we ship it as an artifact, otherwise downstream UI would
  // render a broken explorer link.
  const EVM_TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

  store.addArtifact(runId, {
    kind: 'bsc-token',
    chain: 'bsc-mainnet',
    address: tokenAddr as `0x${string}`,
    explorerUrl: `https://bscscan.com/token/${tokenAddr}`,
    label: 'four.meme token (BSC mainnet)',
  });

  const deployTx = process.env.DEMO_TOKEN_DEPLOY_TX?.trim();
  if (deployTx && EVM_TX_HASH_REGEX.test(deployTx)) {
    store.addArtifact(runId, {
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash: deployTx,
      explorerUrl: `https://bscscan.com/tx/${deployTx}`,
      label: 'Creator deploy tx (dry-run fallback)',
    });
  }

  const creatorLoreCid = process.env.DEMO_CREATOR_LORE_CID?.trim();
  if (creatorLoreCid) {
    store.addArtifact(runId, {
      kind: 'lore-cid',
      cid: creatorLoreCid,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${creatorLoreCid}`,
      author: 'creator',
      label: 'Creator lore chapter (dry-run fallback)',
    });
  }
}

/**
 * Default Narrator phase implementation — wires the existing
 * `runNarratorAgent` into the phase callback shape. Kept as a top-level
 * function so a2a.test can replace it with a fake while production code
 * defaults to it.
 */
const defaultRunNarratorPhase: RunNarratorPhaseFn = async (deps) => {
  const {
    config,
    anthropic,
    store,
    runId,
    loreStore,
    anchorLedger,
    tokenAddr,
    tokenName,
    tokenSymbol,
  } = deps;
  if (config.pinata.jwt === undefined) {
    throw new Error('narrator phase: PINATA_JWT missing');
  }
  orchestratorLog(store, runId, 'narrator', `token: ${tokenAddr} (${tokenName} / ${tokenSymbol})`);
  orchestratorLog(store, runId, 'narrator', `model: ${MODEL} port: ${config.port.toString()}`);
  orchestratorLog(
    store,
    runId,
    'narrator',
    `x402: ${config.x402.network} via ${config.x402.facilitatorUrl}`,
  );

  const narratorRegistry = new ToolRegistry();
  narratorRegistry.register(
    createLoreExtendTool({ anthropic, pinataJwt: config.pinata.jwt, model: MODEL }),
  );
  orchestratorLog(
    store,
    runId,
    'narrator',
    `narrator tools: ${narratorRegistry
      .list()
      .map((t) => t.name)
      .join(', ')}`,
  );
  orchestratorLog(store, runId, 'narrator', 'running Narrator agent ...');

  const narrator = await runNarratorAgent({
    client: anthropic,
    registry: narratorRegistry,
    store: loreStore,
    tokenAddr,
    tokenName,
    tokenSymbol,
    previousChapters: [],
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
    // V2-P2: forward fine-grained stream events into the RunStore so SSE
    // subscribers see spinner + result bubbles + token-by-token text.
    onToolUseStart: (event) => store.addToolUseStart(runId, event),
    onToolUseEnd: (event) => store.addToolUseEnd(runId, event),
    onAssistantDelta: (event) => store.addAssistantDelta(runId, event),
    // AC3 layer 1: when the orchestrator wired an AnchorLedger, capture the
    // commitment + emit a lore-anchor artifact through the same RunStore the
    // SSE stream is subscribed to.
    ...(anchorLedger
      ? {
          anchorLedger,
          onArtifact: (artifact) => store.addArtifact(runId, artifact),
        }
      : {}),
  });

  orchestratorLog(
    store,
    runId,
    'narrator',
    `narrator published chapter ${narrator.chapterNumber.toString()} (CID ${narrator.ipfsHash})`,
  );

  store.addArtifact(runId, {
    kind: 'lore-cid',
    cid: narrator.ipfsHash,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${narrator.ipfsHash}`,
    author: 'narrator',
    chapterNumber: narrator.chapterNumber,
  });

  return {
    tokenAddr,
    ipfsHash: narrator.ipfsHash,
    chapterNumber: narrator.chapterNumber,
  };
};

/**
 * Default Market-maker phase implementation. Mirrors the Phase 4 logic from
 * the original monolithic runA2ADemo.
 */
const defaultRunMarketMakerPhase: RunMarketMakerPhaseFn = async (deps) => {
  const { config, anthropic, store, runId, loreEndpointBaseUrl, tokenAddr } = deps;
  if (config.wallets.agent.privateKey === undefined) {
    throw new Error('market-maker phase: AGENT_WALLET_PRIVATE_KEY missing');
  }
  const mmRegistry = new ToolRegistry();
  mmRegistry.register(createCheckTokenStatusTool({ rpcUrl: config.bsc.rpcUrl }));
  mmRegistry.register(
    createXFetchLoreTool({
      agentPrivateKey: config.wallets.agent.privateKey as `0x${string}`,
      network: config.x402.network,
    }),
  );
  orchestratorLog(
    store,
    runId,
    'market-maker',
    `market-maker tools: ${mmRegistry
      .list()
      .map((t) => t.name)
      .join(', ')}`,
  );
  const loreEndpointUrl = `${loreEndpointBaseUrl}/lore/${tokenAddr}`;
  orchestratorLog(
    store,
    runId,
    'market-maker',
    `running Market-maker agent against ${loreEndpointUrl} ...`,
  );

  const marketMaker = await runMarketMakerAgent({
    client: anthropic,
    registry: mmRegistry,
    tokenAddr,
    loreEndpointUrl,
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
    onToolUseStart: (event) => store.addToolUseStart(runId, event),
    onToolUseEnd: (event) => store.addToolUseEnd(runId, event),
    onAssistantDelta: (event) => store.addAssistantDelta(runId, event),
  });

  if (marketMaker.loreFetch) {
    const x402Artifact: Artifact = {
      kind: 'x402-tx',
      chain: 'base-sepolia',
      txHash: marketMaker.loreFetch.settlementTxHash,
      explorerUrl: marketMaker.loreFetch.baseSepoliaExplorerUrl,
      amountUsdc: '0.01',
    };
    store.addArtifact(runId, x402Artifact);
    orchestratorLog(
      store,
      runId,
      'market-maker',
      `x402 settled on Base Sepolia: ${marketMaker.loreFetch.settlementTxHash}`,
    );
    return {
      settlementTxHash: marketMaker.loreFetch.settlementTxHash,
      baseSepoliaExplorerUrl: marketMaker.loreFetch.baseSepoliaExplorerUrl,
    };
  }
  orchestratorLog(
    store,
    runId,
    'market-maker',
    'x402 settlement SKIPPED (market-maker declined purchase)',
    'warn',
  );
  return undefined;
};

export async function runA2ADemo(deps: RunA2ADemoDeps): Promise<void> {
  const { config, anthropic, store, runId, args, loreStore } = deps;
  const loreEndpointBaseUrl =
    deps.loreEndpointBaseUrl ?? `http://localhost:${config.port.toString()}`;

  // Phase implementations: tests inject fakes; production gets the real
  // wiring. Resolved here so the rest of the function does not branch on
  // "is this a test?".
  const runCreator = deps.runCreatorImpl ?? defaultRunCreatorPhase;
  const runNarrator = deps.runNarratorImpl ?? defaultRunNarratorPhase;
  const runMarketMaker = deps.runMarketMakerImpl ?? defaultRunMarketMakerPhase;

  // Secret validation — fail fast by throwing so the caller can translate the
  // failure into `store.setStatus(runId, 'error', err.message)`.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  if (openrouterKey.trim() === '') {
    throw new Error(
      'runA2ADemo: OPENROUTER_API_KEY (preferred) or ANTHROPIC_API_KEY missing from .env.local',
    );
  }
  if (config.wallets.agent.privateKey === undefined) {
    throw new Error('runA2ADemo: AGENT_WALLET_PRIVATE_KEY missing from .env.local');
  }
  if (config.pinata.jwt === undefined) {
    throw new Error('runA2ADemo: PINATA_JWT missing from .env.local');
  }

  store.setStatus(runId, 'running');

  // ─── Step 0: Creator phase or dry-run fallback ──────────────────────────
  // Default path runs the Creator agent end-to-end so the dashboard's left
  // column shows real activity (V2-P1 AC-V2-1). The legacy pre-seed path
  // only fires when the operator explicitly opts in via CREATOR_DRY_RUN=true,
  // which is the demo-day fallback when the BSC mainnet RPC or Pinata is
  // flaky.
  const dryRun = process.env.CREATOR_DRY_RUN === 'true';
  let nextTokenAddr = args.tokenAddr;
  let nextTokenName = args.tokenName;
  let nextTokenSymbol = args.tokenSymbol;

  if (dryRun) {
    orchestratorLog(
      store,
      runId,
      'creator',
      'CREATOR_DRY_RUN=true — skipping Creator phase, emitting env-fed pre-seed artifacts',
      'warn',
    );
    emitDryRunFallbackArtifacts(store, runId, args.tokenAddr);
  } else {
    // V2-P5 Task 1: forward the caller's theme (from ThemeInput) to the
    // Creator phase. Blank / omitted values fall back to DEFAULT_THEME so the
    // Creator prompt is never empty.
    const rawTheme = args.theme?.trim() ?? '';
    const resolvedTheme = rawTheme.length > 0 ? rawTheme : DEFAULT_THEME;
    orchestratorLog(store, runId, 'creator', `running Creator agent (theme: ${resolvedTheme}) ...`);
    const creatorOut = await runCreator({
      config,
      anthropic,
      store,
      runId,
      theme: resolvedTheme,
    });
    nextTokenAddr = creatorOut.tokenAddr;
    nextTokenName = creatorOut.tokenName;
    nextTokenSymbol = creatorOut.tokenSymbol;
    orchestratorLog(
      store,
      runId,
      'creator',
      `creator deployed token ${creatorOut.tokenAddr} (tx ${creatorOut.tokenDeployTx})`,
    );
    // Emit the bsc-token + token-deploy-tx artifacts so the Pills row lights
    // the same way the dry-run path does — the Creator phase callback is
    // responsible for the meme-image + lore-cid artifacts itself.
    store.addArtifact(runId, {
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: creatorOut.tokenAddr as `0x${string}`,
      explorerUrl: `https://bscscan.com/token/${creatorOut.tokenAddr}`,
      label: 'four.meme token (BSC mainnet)',
    });
    store.addArtifact(runId, {
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash: creatorOut.tokenDeployTx,
      explorerUrl: `https://bscscan.com/tx/${creatorOut.tokenDeployTx}`,
      label: 'Creator deploy tx',
    });
  }

  // ─── Narrator phase ──────────────────────────────────────────────────────
  await runNarrator({
    config,
    anthropic,
    store,
    runId,
    loreStore,
    // Forward the AnchorLedger (or undefined) so the default narrator
    // implementation decides whether to capture commitments; fakes in tests
    // simply ignore the field.
    ...(deps.anchorLedger ? { anchorLedger: deps.anchorLedger } : {}),
    tokenAddr: nextTokenAddr,
    tokenName: nextTokenName,
    tokenSymbol: nextTokenSymbol,
  });

  // ─── Market-maker phase ──────────────────────────────────────────────────
  await runMarketMaker({
    config,
    anthropic,
    store,
    runId,
    loreEndpointBaseUrl,
    tokenAddr: nextTokenAddr,
  });
}
