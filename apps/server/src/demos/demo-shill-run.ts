/**
 * Phase 4.6 Task 3 — end-to-end Shilling Market demo run.
 *
 * Proves AC-P4.6 live: creator pays 0.01 USDC via x402 (stubbed in the default
 * orchestrator path so demos don't burn real Base Sepolia USDC) and the
 * Shiller persona of the Market-maker agent posts a promotional tweet
 * grounded in the target token's lore. Targets an ALREADY-DEPLOYED four.meme
 * BSC mainnet token — no redeploy. Token address comes from `--token <addr>`
 * / env `DEMO_TOKEN_ADDR` with the Phase 2 validated fallback.
 *
 * This CLI mirrors `demo-a2a-run.ts` shell structure:
 *   1. Loads .env.local + CLI args.
 *   2. Starts its own Express server so /shill/:addr is paywalled when a
 *      future dashboard client wants to drive the flow over HTTP — the
 *      orchestrator uses a stub payment phase so the demo itself does NOT
 *      round-trip through the HTTP route.
 *   3. Creates a RunStore + subscribes a stdout logger to the run.
 *   4. Awaits `runShillMarketDemo`, prints the final summary on success.
 *   5. Preserves SIGINT / SIGTERM / timeout behaviour unchanged.
 *
 * Usage (from repo root):
 *   pnpm --filter @hack-fourmeme/server demo:shill
 *   pnpm --filter @hack-fourmeme/server demo:shill -- --token 0xYourToken
 *   pnpm --filter @hack-fourmeme/server demo:shill -- --token 0x... --symbol HBNB2026-BAT --brief "launch day hype"
 *   pnpm --filter @hack-fourmeme/server demo:shill -- --dry-run
 *
 * Env vars (optional):
 *   DEMO_TOKEN_ADDR       default token
 *   DEMO_TOKEN_SYMBOL     default symbol to pass to the Shiller prompt
 *   DEMO_CREATOR_BRIEF    default creator free-text brief
 *   SHILL_DRY_RUN=true    equivalent to --dry-run
 *
 * Cost per run (approx):
 *   - live mode: OpenRouter Claude ~$0.02 + X API post $0.01; x402 is stubbed
 *     so no Base Sepolia USDC is spent.
 *   - dry-run: free — OpenRouter + X API calls are fully bypassed.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { config as loadDotenv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';

import { loadConfig, type AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { registerX402Routes } from '../x402/index.js';
import { RunStore } from '../runs/store.js';
import {
  runShillMarketDemo,
  type RunShillMarketDemoArgs,
  type RunShillerPhaseFn,
} from '../runs/shill-market.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

// OpenRouter Anthropic-compatible gateway — mirrors the other demos.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// Phase 2 validated BSC mainnet token — default when no --token/env provided.
const DEFAULT_DEMO_TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEMO_TIMEOUT_MS = 3 * 60 * 1000;

interface ParsedArgs {
  args: RunShillMarketDemoArgs;
  dryRun: boolean;
}

/**
 * Parse CLI flags with env-var fallbacks. The three business inputs
 * (`token`, `symbol`, `brief`) and the `--dry-run` switch each have a matching
 * `DEMO_*` env variable so recordings can preset them without juggling
 * shell args.
 */
function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  let tokenAddr: string | undefined;
  let tokenSymbol: string | undefined;
  let creatorBrief: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--token' && i + 1 < argv.length) {
      tokenAddr = argv[i + 1];
      i += 1;
    } else if (flag === '--symbol' && i + 1 < argv.length) {
      tokenSymbol = argv[i + 1];
      i += 1;
    } else if (flag === '--brief' && i + 1 < argv.length) {
      creatorBrief = argv[i + 1];
      i += 1;
    } else if (flag === '--dry-run') {
      dryRun = true;
    }
  }
  const resolvedTokenAddr = tokenAddr ?? process.env.DEMO_TOKEN_ADDR ?? DEFAULT_DEMO_TOKEN_ADDR;
  const resolvedSymbol = tokenSymbol ?? process.env.DEMO_TOKEN_SYMBOL;
  const resolvedBrief = creatorBrief ?? process.env.DEMO_CREATOR_BRIEF;
  const envDryRun = (process.env.SHILL_DRY_RUN ?? '').toLowerCase() === 'true';

  const args: RunShillMarketDemoArgs = {
    tokenAddr: resolvedTokenAddr,
    ...(resolvedSymbol !== undefined && resolvedSymbol !== ''
      ? { tokenSymbol: resolvedSymbol }
      : {}),
    ...(resolvedBrief !== undefined && resolvedBrief !== '' ? { creatorBrief: resolvedBrief } : {}),
  };
  return { args, dryRun: dryRun || envDryRun };
}

/**
 * Format a LogEvent for stdout in the existing `[HH:MM:SS] agent.tool [level] message`
 * shape so the CLI transcript matches the other demo scripts.
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

/**
 * Fake shiller phase for --dry-run — returns a synthetic tweet without
 * touching OpenRouter or the X API. Lets recording walk through the full
 * orchestrator artifact flow (x402-tx → shill-order queued → shill-tweet →
 * shill-order done) even when Claude/X credentials are missing.
 */
const dryRunShillerImpl: RunShillerPhaseFn = async (deps) => {
  const symbol = deps.tokenSymbol ?? 'TOKEN';
  const shortOrder = deps.orderId.slice(0, 8);
  // Emit a single synthetic log line so the dashboard / stdout transcript
  // still shows one `post_shill_for` entry under the market-maker agent —
  // matches the live-mode onLog pattern without wiring a real tool.
  deps.store.addLog(deps.runId, {
    ts: new Date().toISOString(),
    agent: 'market-maker',
    tool: 'post_shill_for',
    level: 'info',
    message: `[dry-run] generated stub tweet for order ${shortOrder}`,
  });
  return {
    orderId: deps.orderId,
    tokenAddr: deps.tokenAddr,
    decision: 'shill',
    tweetId: `dry-run-${shortOrder}`,
    tweetUrl: 'https://x.com/i/web/status/dry-run',
    tweetText: `$${symbol} — lore hints at something curious worth watching. (dry-run)`,
    postedAt: new Date().toISOString(),
    toolCalls: [
      {
        name: 'post_shill_for',
        input: { orderId: deps.orderId, tokenAddr: deps.tokenAddr },
        output: { dryRun: true },
        isError: false,
      },
    ],
  };
};

/**
 * Start the local Express server that hosts the x402-gated routes. We mount
 * `express.json()` before `registerX402Routes` so that POST /shill/:addr can
 * parse the optional creatorBrief body payload.
 */
async function startServer(
  port: number,
  loreStore: LoreStore,
  shillOrderStore: ShillOrderStore,
  config: AppConfig,
): Promise<Server> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerX402Routes(app, config, { loreStore, shillOrderStore });
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
 * Pull the final shill-order, shill-tweet and x402-tx artifacts out of the
 * completed run to reconstruct a single summary block. Graceful fallbacks
 * when the Shiller skipped (no shill-tweet) or when the orchestrator failed
 * mid-flight (no terminal shill-order) — we print `<missing>` instead of
 * throwing so the operator still sees whatever partial artifacts landed.
 */
function printSummary(
  args: RunShillMarketDemoArgs,
  dryRun: boolean,
  runStore: RunStore,
  runId: string,
): void {
  const record = runStore.get(runId);
  if (!record) return;

  // `shill-order` is emitted twice (queued + terminal); the later one is the
  // one we want to surface. `findLast` keeps us tolerant of either count
  // without having to track insertion index.
  const shillOrder = [...record.artifacts]
    .reverse()
    .find(
      (a): a is Extract<(typeof record.artifacts)[number], { kind: 'shill-order' }> =>
        a.kind === 'shill-order',
    );
  const shillTweet = record.artifacts.find(
    (a): a is Extract<(typeof record.artifacts)[number], { kind: 'shill-tweet' }> =>
      a.kind === 'shill-tweet',
  );
  const x402 = record.artifacts.find(
    (a): a is Extract<(typeof record.artifacts)[number], { kind: 'x402-tx' }> =>
      a.kind === 'x402-tx',
  );

  const tweetBlock = shillTweet
    ? [
        '  Shill tweet:',
        `    tweetId:     ${shillTweet.tweetId}`,
        `    url:         ${shillTweet.tweetUrl}`,
        `    text:        ${shillTweet.tweetText}`,
      ].join('\n')
    : '  Shill tweet: SKIPPED (shiller declined or failed — see logs above)';

  const settlement = x402
    ? [
        '  x402 settlement (Base Sepolia USDC, stubbed in demo):',
        `    tx:          ${x402.txHash}`,
        `    amount:      ${x402.amountUsdc} USDC`,
      ].join('\n')
    : '  x402 settlement: MISSING (creator payment phase did not emit an artifact)';

  console.info(
    [
      '',
      '════════════════════════════════════════════════',
      ' Shilling-market demo complete',
      '════════════════════════════════════════════════',
      `  mode:        ${dryRun ? 'dry-run (fake shiller)' : 'live (real Claude + X API)'}`,
      '',
      '  Target token (BSC mainnet, pre-deployed):',
      `    address:     ${args.tokenAddr}`,
      `    bscscan:     https://bscscan.com/token/${args.tokenAddr}`,
      `    symbol:      ${args.tokenSymbol ?? '<unset — Shiller will infer from lore>'}`,
      `    brief:       ${args.creatorBrief ?? '<unset>'}`,
      '',
      '  Shill order (final state):',
      `    orderId:     ${shillOrder?.orderId ?? '<missing>'}`,
      `    status:      ${shillOrder?.status ?? '<missing>'}`,
      '',
      tweetBlock,
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
  const { args, dryRun } = parseArgs();
  const config = loadConfig();

  // Resolve the OpenRouter key up front. In dry-run the Anthropic client is
  // constructed but never called, so an empty key is fine; in live mode we
  // fail fast with a helpful error to mirror demo-a2a-run's style.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  if (!dryRun && openrouterKey.trim() === '') {
    throw new Error(
      'demo-shill: OPENROUTER_API_KEY (preferred) or ANTHROPIC_API_KEY missing from .env.local — ' +
        're-run with --dry-run to bypass the real Claude call.',
    );
  }

  // Live mode requires all four X OAuth-1.0a credentials for the Shiller's
  // `post_to_x` tool. Fail fast with the same shape as demo-a2a-run's
  // PINATA_JWT check so operators get a precise remediation hint.
  if (!dryRun) {
    const missing: string[] = [];
    if (config.x.apiKey === undefined) missing.push('X_API_KEY');
    if (config.x.apiKeySecret === undefined) missing.push('X_API_KEY_SECRET');
    if (config.x.accessToken === undefined) missing.push('X_ACCESS_TOKEN');
    if (config.x.accessTokenSecret === undefined) missing.push('X_ACCESS_TOKEN_SECRET');
    if (missing.length > 0) {
      throw new Error(
        `demo-shill: missing X API credentials in .env.local — ${missing.join(', ')}. ` +
          'Re-run with --dry-run to bypass the real X post.',
      );
    }
  }

  const anthropic = new Anthropic({ apiKey: openrouterKey, baseURL: OPENROUTER_BASE_URL });

  const loreStore = new LoreStore();
  const shillOrderStore = new ShillOrderStore();
  const runStore = new RunStore();
  const runRecord = runStore.create('shill-market');

  // Subscribe early so orchestrator-level log events emitted before the
  // Shiller phase also reach stdout. Replay-then-live is a no-op here (no
  // buffered events yet) but keeps the contract identical to the HTTP SSE
  // client.
  const unsubscribe = runStore.subscribe(runRecord.runId, (event) => {
    if (event.type === 'log') {
      printLogEvent(event.data);
    }
  });

  let server: Server | null = null;
  try {
    server = await startServer(config.port, loreStore, shillOrderStore, config);
    activeServer = server;
    // Log the server-listening line via the RunStore so it flows through the
    // same sink as every other orchestrator message. Tagged as market-maker
    // to align with the Shiller persona's agent id per AC-P4.6-3.
    runStore.addLog(runRecord.runId, {
      ts: new Date().toISOString(),
      agent: 'market-maker',
      tool: 'orchestrator',
      level: 'info',
      message: `x402 server listening on http://localhost:${config.port.toString()}`,
    });
    if (dryRun) {
      runStore.addLog(runRecord.runId, {
        ts: new Date().toISOString(),
        agent: 'market-maker',
        tool: 'orchestrator',
        level: 'info',
        message: 'dry-run mode: fake shiller phase — no Claude / X API calls',
      });
    }

    await runShillMarketDemo({
      config,
      anthropic,
      store: runStore,
      runId: runRecord.runId,
      args,
      shillOrderStore,
      loreStore,
      ...(dryRun ? { runShillerImpl: dryRunShillerImpl } : {}),
    });
    runStore.setStatus(runRecord.runId, 'done');
    printSummary(args, dryRun, runStore, runRecord.runId);
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
      agent: 'market-maker',
      tool: 'orchestrator',
      level: 'info',
      message: 'x402 server closed',
    });
  }
}

const timeoutHandle = setTimeout(() => {
  console.error('[demo-shill] demo timeout exceeded');
  process.exit(1);
}, DEMO_TIMEOUT_MS);
// Unref so a clean exit before the timer fires does not keep the event loop alive.
timeoutHandle.unref();

/**
 * Register SIGINT / SIGTERM handlers BEFORE main() so a Ctrl-C mid-run closes
 * the Express listener and releases the port instead of orphaning it.
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
    console.info(`[demo-shill] received ${signal}, shutting down ...`);
    void (async () => {
      try {
        await closeServer(activeServer);
      } catch (err) {
        console.error(`[demo-shill] error while closing server on ${signal}:`, err);
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
    console.error('[demo-shill] FAIL', err);
    clearTimeout(timeoutHandle);
    process.exit(1);
  });
