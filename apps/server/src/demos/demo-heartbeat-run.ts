/**
 * Phase 3 Core Task 1 — end-to-end HeartbeatAgent demo run. Drives the agent
 * through N accelerated ticks against a pre-deployed BSC mainnet token. Each
 * tick the agent inspects on-chain status and picks exactly one action:
 * `post_to_x` or `extend_lore`. `--dry-run` (or any missing X credential)
 * swaps `post_to_x` for a local stub so the flow runs without X credit.
 *
 * Usage:
 *   pnpm --filter @hack-fourmeme/server demo:heartbeat
 *   pnpm --filter @hack-fourmeme/server demo:heartbeat -- --token 0xYourToken --ticks 3
 *   HEARTBEAT_INTERVAL_MS=15000 pnpm --filter @hack-fourmeme/server demo:heartbeat
 *   pnpm --filter @hack-fourmeme/server demo:heartbeat -- --dry-run
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import type { AgentTool, LogEvent } from '@hack-fourmeme/shared';

import { loadConfig } from '../config.js';
import { ToolRegistry } from '../tools/registry.js';
import { createCheckTokenStatusTool } from '../tools/token-status.js';
import { createLoreExtendTool } from '../tools/lore-extend.js';
import {
  createPostToXTool,
  xPostInputSchema,
  xPostOutputSchema,
  type XPostInput,
  type XPostOutput,
} from '../tools/x-post.js';
import { BASE_RULES_NO_URL } from '../tools/tweet-guard.js';
import { HeartbeatAgent } from '../agents/heartbeat.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
loadDotenv({ path: resolve(repoRoot, '.env.local') });

// OpenRouter Anthropic-compatible gateway — mirrors the other demos.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
const MODEL = 'anthropic/claude-sonnet-4-5';
// Phase 2 validated BSC mainnet token — default when no --token/env provided.
const DEFAULT_DEMO_TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEFAULT_DEMO_TOKEN_NAME = 'HBNB2026-DemoToken';
const DEFAULT_DEMO_TOKEN_SYMBOL = 'HBNB2026';
const DEFAULT_TICK_COUNT = 3;
const POLL_INTERVAL_MS = 500;
const HARD_TIMEOUT_MS = 3 * 60 * 1000;

interface DemoArgs {
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  tickCount: number;
  dryRun: boolean;
}

function parseArgs(): DemoArgs {
  const argv = process.argv.slice(2);
  let tokenAddr: string | undefined;
  let tickCount: number | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--token' && i + 1 < argv.length) {
      tokenAddr = argv[i + 1];
      i += 1;
    } else if (flag === '--ticks' && i + 1 < argv.length) {
      const parsed = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) tickCount = parsed;
      i += 1;
    } else if (flag === '--dry-run') {
      dryRun = true;
    }
  }
  const envTicks = Number.parseInt(process.env.DEMO_TICK_COUNT ?? '', 10);
  return {
    tokenAddr: tokenAddr ?? process.env.DEMO_TOKEN_ADDR ?? DEFAULT_DEMO_TOKEN_ADDR,
    tokenName: process.env.DEMO_TOKEN_NAME ?? DEFAULT_DEMO_TOKEN_NAME,
    tokenSymbol: process.env.DEMO_TOKEN_SYMBOL ?? DEFAULT_DEMO_TOKEN_SYMBOL,
    tickCount:
      tickCount ?? (Number.isFinite(envTicks) && envTicks > 0 ? envTicks : DEFAULT_TICK_COUNT),
    dryRun,
  };
}

function orchestratorLog(message: string): void {
  console.info(`[${new Date().toISOString().slice(11, 19)}] demo-heartbeat ${message}`);
}

/**
 * Build a local stand-in for `post_to_x` that logs the intended tweet and
 * returns a schema-valid stub. Used when `--dry-run` is set or when any of
 * the four X credentials is missing, so typecheck + lint stay green on
 * machines without filled X creds.
 */
function createDryRunPostTool(): AgentTool<XPostInput, XPostOutput> {
  return {
    name: 'post_to_x',
    description:
      '[dry-run] Stub replacement for post_to_x. Logs the intended tweet text and returns a ' +
      'schema-valid placeholder so the agent loop can proceed without calling the real X API.',
    inputSchema: xPostInputSchema,
    outputSchema: xPostOutputSchema,
    async execute(input) {
      const parsed = xPostInputSchema.parse(input);
      orchestratorLog(`[dry-run] would have posted: ${parsed.text}`);
      return xPostOutputSchema.parse({
        tweetId: 'dry-run',
        text: parsed.text,
        postedAt: new Date().toISOString(),
        url: 'about:blank',
      });
    },
  };
}

const SYSTEM_PROMPT = [
  'You are an autonomous agent operating a meme token on BSC mainnet.',
  'Each tick, call check_token_status on the configured token. Based on the status,',
  'EITHER call post_to_x with a short tweet drafted per the tweet rules below,',
  'OR call extend_lore to add a new chapter to the on-chain story.',
  'When drafting the tweet body, refer to the latest lore chapter for flavour;',
  'the token is denoted by its $SYMBOL only — never the raw 0x address.',
  '',
  BASE_RULES_NO_URL,
  '',
  'Pick exactly ONE action per tick. Your final response is a single JSON object:',
  '{"action": "post_to_x" | "extend_lore" | "idle", "reason": "..."}.',
  'Do NOT invent addresses — only use the tokenAddr provided by check_token_status.',
].join('\n');

function printSummary(
  args: DemoArgs,
  agent: HeartbeatAgent,
  artifacts: { tool: string; meta: Record<string, unknown> }[],
): void {
  const s = agent.state;
  const artifactLines =
    artifacts.length === 0
      ? ['    (none)']
      : artifacts.map((a) => {
          const id = typeof a.meta.toolUseId === 'string' ? a.meta.toolUseId : 'unknown';
          return `    - ${a.tool}: toolUseId=${id}`;
        });
  console.info(
    [
      '',
      '════════════════════════════════════════════════',
      ' Heartbeat demo complete',
      '════════════════════════════════════════════════',
      `  mode:        ${args.dryRun ? 'dry-run (post_to_x stub)' : 'live (real X API)'}`,
      `  token:       ${args.tokenAddr}`,
      `  bscscan:     https://bscscan.com/token/${args.tokenAddr}`,
      '',
      '  Heartbeat counters:',
      `    success:   ${s.successCount.toString()}`,
      `    error:     ${s.errorCount.toString()}`,
      `    skipped:   ${s.skippedCount.toString()}`,
      `    lastError: ${s.lastError ?? 'none'}`,
      '',
      '  Per-tick artifacts (captured via onLog):',
      ...artifactLines,
      '',
      '  Run complete. Have a good demo.',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = loadConfig();

  // Shared LLM secret for extend_lore + the heartbeat reasoning turns.
  const openrouterKey = config.openrouter.apiKey ?? config.anthropic.apiKey ?? '';
  if (openrouterKey.trim() === '')
    throw new Error(
      'demo-heartbeat: OPENROUTER_API_KEY (preferred) or ANTHROPIC_API_KEY missing from .env.local',
    );
  if (config.pinata.jwt === undefined)
    throw new Error('demo-heartbeat: PINATA_JWT missing from .env.local');

  // In live mode all four X credentials must be present. In dry-run we
  // short-circuit this check so typecheck/lint/compile stays green on
  // machines where X creds have not been wired up yet.
  const xCreds = config.x;
  const haveLiveXCreds =
    xCreds.apiKey !== undefined &&
    xCreds.apiKeySecret !== undefined &&
    xCreds.accessToken !== undefined &&
    xCreds.accessTokenSecret !== undefined;
  const effectiveDryRun = args.dryRun || !haveLiveXCreds;
  if (!args.dryRun && !haveLiveXCreds)
    orchestratorLog('X credentials incomplete — falling back to dry-run safe path');

  orchestratorLog(`token:    ${args.tokenAddr} (${args.tokenName} / ${args.tokenSymbol})`);
  orchestratorLog(`ticks:    ${args.tickCount.toString()}`);
  orchestratorLog(`interval: ${config.heartbeat.intervalMs.toString()}ms`);
  orchestratorLog(`mode:     ${effectiveDryRun ? 'dry-run' : 'live'}`);
  orchestratorLog(`model:    ${MODEL}`);

  const anthropic = new Anthropic({ apiKey: openrouterKey, baseURL: OPENROUTER_BASE_URL });

  const registry = new ToolRegistry();
  registry.register(createCheckTokenStatusTool({ rpcUrl: config.bsc.rpcUrl }));
  registry.register(
    createLoreExtendTool({ anthropic, pinataJwt: config.pinata.jwt, model: MODEL }),
  );
  registry.register(
    effectiveDryRun
      ? createDryRunPostTool()
      : createPostToXTool({
          apiKey: xCreds.apiKey as string,
          apiKeySecret: xCreds.apiKeySecret as string,
          accessToken: xCreds.accessToken as string,
          accessTokenSecret: xCreds.accessTokenSecret as string,
          handle: xCreds.handle,
        }),
  );
  orchestratorLog(
    `tools:    ${registry
      .list()
      .map((t) => t.name)
      .join(', ')}`,
  );

  // Tool-call success events from runtime.ts carry `meta: { toolUseId }`.
  // We stash them here so the final summary can list one line per call.
  const artifacts: { tool: string; meta: Record<string, unknown> }[] = [];
  const onLog = (event: LogEvent): void => {
    console.info(
      `[${event.ts.slice(11, 19)}] ${event.agent}.${event.tool} [${event.level}] ${event.message}`,
    );
    if (event.level === 'info' && event.message.startsWith(`tool ${event.tool} ok`)) {
      artifacts.push({
        tool: event.tool,
        meta: (event.meta as Record<string, unknown>) ?? {},
      });
    }
  };

  const heartbeat = new HeartbeatAgent({
    client: anthropic,
    model: MODEL,
    registry,
    systemPrompt: SYSTEM_PROMPT,
    buildUserInput: ({ tickId, tickAt }) =>
      `Tick ${tickId} at ${tickAt}. Current token under observation: ${args.tokenName} ` +
      `(${args.tokenSymbol}) at ${args.tokenAddr}. Decide one action now.`,
    intervalMs: config.heartbeat.intervalMs,
    maxTurnsPerTick: 4,
    onLog,
  });

  // Register signal handlers BEFORE .start() so a Ctrl-C mid-tick drains the
  // scheduler instead of orphaning the setInterval handle.
  let handled = false;
  const installShutdown = (signal: 'SIGINT' | 'SIGTERM', exitCode: number): void => {
    process.on(signal, () => {
      if (handled) return;
      handled = true;
      orchestratorLog(`received ${signal}, shutting down ...`);
      void heartbeat.shutdown().finally(() => process.exit(exitCode));
    });
  };
  installShutdown('SIGINT', 130);
  installShutdown('SIGTERM', 143);

  // Hard wall-clock ceiling. `unref` so a clean exit before the timer fires
  // does not keep the event loop alive.
  const timeoutHandle = setTimeout(() => {
    console.error('[demo-heartbeat] hard timeout exceeded');
    void heartbeat.shutdown().finally(() => process.exit(1));
  }, HARD_TIMEOUT_MS);
  timeoutHandle.unref();

  heartbeat.start();

  // Poll the agent's state until the target tick count is reached. We count
  // success + error + skipped so a run that errors out still terminates
  // gracefully instead of hanging on a retry loop.
  await new Promise<void>((resolveWait) => {
    const iv = setInterval(() => {
      const s = heartbeat.state;
      if (s.successCount + s.errorCount + s.skippedCount >= args.tickCount) {
        clearInterval(iv);
        resolveWait();
      }
    }, POLL_INTERVAL_MS);
  });

  await heartbeat.shutdown();
  clearTimeout(timeoutHandle);
  printSummary(args, heartbeat, artifacts);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('[demo-heartbeat] FAIL', err);
    process.exit(1);
  });
