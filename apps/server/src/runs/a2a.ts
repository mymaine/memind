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
import { ToolRegistry } from '../tools/registry.js';
import { createLoreExtendTool } from '../tools/lore-extend.js';
import { createCheckTokenStatusTool } from '../tools/token-status.js';
import { createXFetchLoreTool } from '../tools/x-fetch-lore.js';
import { runNarratorAgent } from '../agents/narrator.js';
import { runMarketMakerAgent } from '../agents/market-maker.js';
import type { RunStore } from './store.js';

// OpenRouter Anthropic-compatible gateway — mirrors demos/demo-a2a-run.ts.
const MODEL = 'anthropic/claude-sonnet-4-5';

export interface RunA2ADemoArgs {
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
}

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
   * Override the base URL used to build the lore endpoint the Market-maker
   * fetches from. Defaults to `http://localhost:${config.port}`. The CLI
   * leaves this default (starts its own server on that port); the HTTP entry
   * point can do the same since it reuses the main server.
   */
  loreEndpointBaseUrl?: string;
}

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

const EVM_TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

/**
 * Emit the Phase 2 "already exists" artifacts so all 5 AC4 pills can light up
 * in a single a2a run. Only the bsc-token (derived from args.tokenAddr) is
 * unconditional; the other two depend on env vars since their full hashes can
 * only come from a prior real run and must stay private per .env.local.
 */
function emitPreSeedArtifacts(store: RunStore, runId: string, tokenAddr: string): void {
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
      label: 'Creator deploy tx (Phase 2)',
    });
  }

  const creatorLoreCid = process.env.DEMO_CREATOR_LORE_CID?.trim();
  if (creatorLoreCid) {
    store.addArtifact(runId, {
      kind: 'lore-cid',
      cid: creatorLoreCid,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${creatorLoreCid}`,
      author: 'creator',
      label: 'Creator lore chapter (Phase 2)',
    });
  }
}

export async function runA2ADemo(deps: RunA2ADemoDeps): Promise<void> {
  const { config, anthropic, store, runId, args, loreStore } = deps;
  const loreEndpointBaseUrl =
    deps.loreEndpointBaseUrl ?? `http://localhost:${config.port.toString()}`;

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

  // ─── Pre-seed artifacts (Phase 2 validated) ──────────────────────────────
  // Emit artifacts that exist before this run started so the AC4 dashboard
  // lights all 5 pills. bsc-token is always known (args.tokenAddr). Phase 2's
  // deploy tx and creator lore CID are full-hash values from a prior run —
  // callers pass them via env so defaults stay in the operator's .env.local.
  // Missing env → that pill is simply not emitted.
  emitPreSeedArtifacts(store, runId, args.tokenAddr);

  // ─── Narrator phase ──────────────────────────────────────────────────────
  orchestratorLog(
    store,
    runId,
    'narrator',
    `token: ${args.tokenAddr} (${args.tokenName} / ${args.tokenSymbol})`,
  );
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
    tokenAddr: args.tokenAddr,
    tokenName: args.tokenName,
    tokenSymbol: args.tokenSymbol,
    previousChapters: [],
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
  });

  orchestratorLog(
    store,
    runId,
    'narrator',
    `narrator published chapter ${narrator.chapterNumber.toString()} (CID ${narrator.ipfsHash})`,
  );

  const loreCidArtifact: Artifact = {
    kind: 'lore-cid',
    cid: narrator.ipfsHash,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${narrator.ipfsHash}`,
    author: 'narrator',
    chapterNumber: narrator.chapterNumber,
  };
  store.addArtifact(runId, loreCidArtifact);

  // ─── Market-maker phase ──────────────────────────────────────────────────
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
  const loreEndpointUrl = `${loreEndpointBaseUrl}/lore/${args.tokenAddr}`;
  orchestratorLog(
    store,
    runId,
    'market-maker',
    `running Market-maker agent against ${loreEndpointUrl} ...`,
  );

  const marketMaker = await runMarketMakerAgent({
    client: anthropic,
    registry: mmRegistry,
    tokenAddr: args.tokenAddr,
    loreEndpointUrl,
    model: MODEL,
    onLog: (event) => store.addLog(runId, event),
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
  } else {
    orchestratorLog(
      store,
      runId,
      'market-maker',
      'x402 settlement SKIPPED (market-maker declined purchase)',
      'warn',
    );
  }
}
