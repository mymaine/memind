/**
 * Phase 3 Wave 2 Task C — end-to-end Agent-to-Agent demo run.
 *
 * Proves AC2 + AC5 live: Market-maker agent pays real USDC on Base Sepolia
 * through x402 to the Narrator's `/lore/:tokenAddr` endpoint (hosted by this
 * very process) and retrieves a Pinata-pinned chapter the Narrator just
 * produced. Targets an ALREADY-DEPLOYED four.meme BSC mainnet token — no
 * redeploy. Token address is taken from `--token <addr>` / env `DEMO_TOKEN_ADDR`
 * with a Phase 2 validated fallback.
 *
 * Usage (from repo root):
 *   pnpm --filter @hack-fourmeme/server demo:a2a
 *   pnpm --filter @hack-fourmeme/server demo:a2a -- --token 0xYourToken
 *   DEMO_TOKEN_ADDR=0xYourToken pnpm --filter @hack-fourmeme/server demo:a2a
 *
 * Cost per run (approx): Claude via OpenRouter ~$0.02 + Base Sepolia USDC
 * 0.01 (settled on-chain, permanent) + Base Sepolia gas ~free.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { config as loadDotenv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';

import { loadConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { registerX402Routes } from '../x402/index.js';
import { ToolRegistry } from '../tools/registry.js';
import { createLoreExtendTool } from '../tools/lore-extend.js';
import { createCheckTokenStatusTool } from '../tools/token-status.js';
import { createXFetchLoreTool } from '../tools/x-fetch-lore.js';
import { runNarratorAgent, type NarratorAgentOutput } from '../agents/narrator.js';
import { runMarketMakerAgent, type MarketMakerAgentOutput } from '../agents/market-maker.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

// OpenRouter Anthropic-compatible gateway — mirrors demo-creator-run.ts.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
const MODEL = 'anthropic/claude-sonnet-4-5';

// Phase 2 validated BSC mainnet token — default when no --token/env provided.
const DEFAULT_DEMO_TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEFAULT_DEMO_TOKEN_NAME = 'HBNB2026-DemoToken';
const DEFAULT_DEMO_TOKEN_SYMBOL = 'HBNB2026';
const DEMO_TIMEOUT_MS = 3 * 60 * 1000;

interface DemoArgs {
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
}

function parseArgs(): DemoArgs {
  const argv = process.argv.slice(2);
  let tokenAddr: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--token' && i + 1 < argv.length) {
      tokenAddr = argv[i + 1];
      i += 1;
    }
  }
  return {
    tokenAddr: tokenAddr ?? process.env.DEMO_TOKEN_ADDR ?? DEFAULT_DEMO_TOKEN_ADDR,
    tokenName: process.env.DEMO_TOKEN_NAME ?? DEFAULT_DEMO_TOKEN_NAME,
    tokenSymbol: process.env.DEMO_TOKEN_SYMBOL ?? DEFAULT_DEMO_TOKEN_SYMBOL,
  };
}

function orchestratorLog(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.info(`[${ts}] demo-orchestrator ${message}`);
}

function agentLogSink(e: {
  ts: string;
  agent: string;
  tool: string;
  level: string;
  message: string;
}): void {
  console.info(`[${e.ts.slice(11, 19)}] ${e.agent}.${e.tool} [${e.level}] ${e.message}`);
}

async function startServer(
  port: number,
  store: LoreStore,
  config: ReturnType<typeof loadConfig>,
): Promise<Server> {
  const app = express();
  registerX402Routes(app, config, { loreStore: store });
  return await new Promise<Server>((resolveFn, rejectFn) => {
    const server = app.listen(port);
    server.once('listening', () => resolveFn(server));
    server.once('error', rejectFn);
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolveFn) => server.close(() => resolveFn()));
}

function printSummary(
  args: DemoArgs,
  narrator: NarratorAgentOutput,
  mm: MarketMakerAgentOutput,
): void {
  const bcp =
    mm.tokenStatus.bondingCurveProgress === null
      ? 'n/a'
      : mm.tokenStatus.bondingCurveProgress.toFixed(2);
  const settlement = mm.loreFetch
    ? [
        '  x402 settlement (Base Sepolia USDC):',
        `    tx:          ${mm.loreFetch.settlementTxHash}`,
        `    basescan:    ${mm.loreFetch.baseSepoliaExplorerUrl}`,
      ].join('\n')
    : '  x402 settlement: SKIPPED (market-maker declined purchase)';
  console.info(
    [
      '',
      '════════════════════════════════════════════════',
      ' Agent-to-Agent demo complete',
      '════════════════════════════════════════════════',
      '  Token (BSC mainnet, pre-deployed):',
      `    address:     ${args.tokenAddr}`,
      `    bscscan:     https://bscscan.com/token/${args.tokenAddr}`,
      '',
      '  Narrator chapter (Pinata IPFS):',
      `    CID:         ${narrator.ipfsHash}`,
      `    gateway:     https://gateway.pinata.cloud/ipfs/${narrator.ipfsHash}`,
      `    chapter #:   ${narrator.chapterNumber.toString()}`,
      '',
      '  Market-maker decision:',
      `    decision:    ${mm.decision}`,
      `    holders:     ${mm.tokenStatus.holderCount.toString()}`,
      `    bondingCurveProgress: ${bcp}`,
      '',
      settlement,
      '',
    ].join('\n'),
  );
}

/**
 * Module-level handle to the running Express server so the signal handlers
 * installed below can close the listening port before the process exits.
 * `null` until startServer returns; set back to `null` in the `finally` block
 * once closeServer succeeds so a double signal cannot double-close.
 */
let activeServer: Server | null = null;

async function main(): Promise<void> {
  const args = parseArgs();
  const config = loadConfig();

  // Fail fast on missing secrets so the root cause surfaces immediately.
  // Accept either OPENROUTER_API_KEY (preferred, Phase 3) or ANTHROPIC_API_KEY
  // (Phase 2 legacy name) — both point at the same OpenRouter secret.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  if (openrouterKey.trim() === '')
    throw new Error(
      'demo-a2a: OPENROUTER_API_KEY (preferred) or ANTHROPIC_API_KEY missing from .env.local',
    );
  if (config.wallets.agent.privateKey === undefined)
    throw new Error('demo-a2a: AGENT_WALLET_PRIVATE_KEY missing from .env.local');
  if (config.pinata.jwt === undefined)
    throw new Error('demo-a2a: PINATA_JWT missing from .env.local');

  orchestratorLog(`token: ${args.tokenAddr} (${args.tokenName} / ${args.tokenSymbol})`);
  orchestratorLog(`model: ${MODEL} port: ${config.port.toString()}`);
  orchestratorLog(`x402: ${config.x402.network} via ${config.x402.facilitatorUrl}`);

  const anthropic = new Anthropic({ apiKey: openrouterKey, baseURL: OPENROUTER_BASE_URL });
  const store = new LoreStore();

  let server: Server | null = null;
  try {
    server = await startServer(config.port, store, config);
    activeServer = server;
    orchestratorLog(`x402 server listening on http://localhost:${config.port.toString()}`);

    // --- Narrator: produce + pin chapter 1, upsert into LoreStore. ---
    const narratorRegistry = new ToolRegistry();
    narratorRegistry.register(
      createLoreExtendTool({ anthropic, pinataJwt: config.pinata.jwt, model: MODEL }),
    );
    orchestratorLog(
      `narrator tools: ${narratorRegistry
        .list()
        .map((t) => t.name)
        .join(', ')}`,
    );
    orchestratorLog('running Narrator agent ...');
    const narrator = await runNarratorAgent({
      client: anthropic,
      registry: narratorRegistry,
      store,
      tokenAddr: args.tokenAddr,
      tokenName: args.tokenName,
      tokenSymbol: args.tokenSymbol,
      previousChapters: [],
      model: MODEL,
      onLog: agentLogSink,
    });
    orchestratorLog(
      `narrator published chapter ${narrator.chapterNumber.toString()} (CID ${narrator.ipfsHash})`,
    );

    // --- Market-maker: read on-chain state, auto-pay x402, fetch lore. ---
    const mmRegistry = new ToolRegistry();
    mmRegistry.register(createCheckTokenStatusTool({ rpcUrl: config.bsc.rpcUrl }));
    mmRegistry.register(
      createXFetchLoreTool({
        agentPrivateKey: config.wallets.agent.privateKey as `0x${string}`,
        network: config.x402.network,
      }),
    );
    orchestratorLog(
      `market-maker tools: ${mmRegistry
        .list()
        .map((t) => t.name)
        .join(', ')}`,
    );
    const loreEndpointUrl = `http://localhost:${config.port.toString()}/lore/${args.tokenAddr}`;
    orchestratorLog(`running Market-maker agent against ${loreEndpointUrl} ...`);
    const marketMaker = await runMarketMakerAgent({
      client: anthropic,
      registry: mmRegistry,
      tokenAddr: args.tokenAddr,
      loreEndpointUrl,
      model: MODEL,
      onLog: agentLogSink,
    });

    printSummary(args, narrator, marketMaker);
  } finally {
    await closeServer(server);
    activeServer = null;
    orchestratorLog('x402 server closed');
  }
}

const timeoutHandle = setTimeout(() => {
  console.error('[demo-a2a] demo timeout exceeded');
  process.exit(1);
}, DEMO_TIMEOUT_MS);
// Unref so a clean exit before the timer fires does not keep the event loop alive.
timeoutHandle.unref();

/**
 * Register SIGINT / SIGTERM handlers BEFORE main() so that a Ctrl-C mid-run
 * closes the Express listener and releases the port instead of orphaning it.
 *
 * Lifecycle:
 *   - SIGINT  → close server, clear timeout, exit 130 (128 + SIGINT).
 *   - SIGTERM → close server, clear timeout, exit 143 (128 + SIGTERM).
 *   - Idempotent: the `handled` flag short-circuits a double-signal so we
 *     don't race `closeServer` or emit duplicate exit calls.
 */
let handled = false;
function installShutdownHandler(signal: 'SIGINT' | 'SIGTERM', exitCode: number): void {
  process.on(signal, () => {
    if (handled) return;
    handled = true;
    clearTimeout(timeoutHandle);
    orchestratorLog(`received ${signal}, shutting down ...`);
    void (async () => {
      try {
        await closeServer(activeServer);
      } catch (err) {
        console.error(`[demo-a2a] error while closing server on ${signal}:`, err);
      } finally {
        activeServer = null;
        process.exit(exitCode);
      }
    })();
  });
}
installShutdownHandler('SIGINT', 130);
installShutdownHandler('SIGTERM', 143);

main()
  .then(() => {
    clearTimeout(timeoutHandle);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('[demo-a2a] FAIL', err);
    clearTimeout(timeoutHandle);
    process.exit(1);
  });
