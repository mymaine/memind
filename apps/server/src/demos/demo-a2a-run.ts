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
 * Post-refactor note: the Narrator → Market-maker orchestration itself lives
 * in `../runs/a2a.ts` as a pure function (`runA2ADemo`). This CLI is now a
 * thin shell that:
 *   1. Loads .env.local + CLI args.
 *   2. Starts its own Express server (so /lore/:addr is paywalled).
 *   3. Creates a RunStore + subscribes a stdout logger to the run.
 *   4. Awaits `runA2ADemo`, prints the same final summary on success.
 *   5. Preserves SIGINT / SIGTERM / timeout behaviour unchanged.
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
import { RunStore } from '../runs/store.js';
import { runA2ADemo, type RunA2ADemoArgs } from '../runs/a2a.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

// OpenRouter Anthropic-compatible gateway — mirrors demo-creator-run.ts.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// Phase 2 validated BSC mainnet token — default when no --token/env provided.
const DEFAULT_DEMO_TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEFAULT_DEMO_TOKEN_NAME = 'HBNB2026-DemoToken';
const DEFAULT_DEMO_TOKEN_SYMBOL = 'HBNB2026';
const DEMO_TIMEOUT_MS = 3 * 60 * 1000;

function parseArgs(): RunA2ADemoArgs {
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

/**
 * Format a LogEvent for stdout in the existing `[HH:MM:SS] agent.tool [level] message`
 * shape so the CLI transcript looks the same as before the refactor.
 */
function printLogEvent(e: {
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

/**
 * Pull the final lore-cid + x402-tx artifacts out of the completed run to
 * reconstruct the summary block that the pre-refactor CLI printed. Keeps the
 * user-visible success output byte-compatible with the Phase 3 recording.
 */
function printSummary(args: RunA2ADemoArgs, runStore: RunStore, runId: string): void {
  const record = runStore.get(runId);
  if (!record) return;

  const lore = record.artifacts.find(
    (a): a is Extract<(typeof record.artifacts)[number], { kind: 'lore-cid' }> =>
      a.kind === 'lore-cid',
  );
  const x402 = record.artifacts.find(
    (a): a is Extract<(typeof record.artifacts)[number], { kind: 'x402-tx' }> =>
      a.kind === 'x402-tx',
  );

  const settlement = x402
    ? [
        '  x402 settlement (Base Sepolia USDC):',
        `    tx:          ${x402.txHash}`,
        `    basescan:    ${x402.explorerUrl}`,
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
      `    CID:         ${lore?.cid ?? '<missing>'}`,
      `    gateway:     ${lore?.gatewayUrl ?? '<missing>'}`,
      `    chapter #:   ${lore?.chapterNumber?.toString() ?? '<missing>'}`,
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

  // Resolve the OpenRouter key once up front so the Anthropic client can be
  // constructed even though runA2ADemo also checks for its presence and will
  // throw with a precise error if it's missing.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  const anthropic = new Anthropic({ apiKey: openrouterKey, baseURL: OPENROUTER_BASE_URL });

  const loreStore = new LoreStore();
  const runStore = new RunStore();
  const runRecord = runStore.create('a2a');
  // Subscribe early so orchestrator-level log events emitted before the
  // Narrator phase also reach stdout. Replay-then-live is a no-op here (the
  // run has no buffered events yet) but keeps the contract identical to the
  // HTTP SSE client.
  const unsubscribe = runStore.subscribe(runRecord.runId, (event) => {
    if (event.type === 'log') {
      printLogEvent(event.data);
    }
  });

  let server: Server | null = null;
  try {
    server = await startServer(config.port, loreStore, config);
    activeServer = server;
    // Log the server-listening line via the RunStore so it flows through the
    // same sink as every other orchestrator-level message.
    runStore.addLog(runRecord.runId, {
      ts: new Date().toISOString(),
      agent: 'narrator',
      tool: 'orchestrator',
      level: 'info',
      message: `x402 server listening on http://localhost:${config.port.toString()}`,
    });

    await runA2ADemo({
      config,
      anthropic,
      store: runStore,
      runId: runRecord.runId,
      args,
      loreStore,
    });
    runStore.setStatus(runRecord.runId, 'done');
    printSummary(args, runStore, runRecord.runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runStore.setStatus(runRecord.runId, 'error', message);
    throw err;
  } finally {
    unsubscribe();
    await closeServer(server);
    activeServer = null;
    runStore.addLog(runRecord.runId, {
      ts: new Date().toISOString(),
      agent: 'narrator',
      tool: 'orchestrator',
      level: 'info',
      message: 'x402 server closed',
    });
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
    console.info(`[demo-a2a] received ${signal}, shutting down ...`);
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
