/**
 * runHeartbeatDemo — dashboard-driven Heartbeat orchestrator (V2-P3).
 *
 * Sits alongside `runA2ADemo`: the HTTP POST /api/runs handler fires this
 * function in the background for `{ mode: 'heartbeat', tokenAddress }` payloads
 * and streams the RunStore events out over SSE. The CLI `demo-heartbeat-run`
 * still uses the `HeartbeatAgent` class directly (setInterval-driven, N ticks
 * decided at runtime); this runner is a finite, dashboard-tuned variant:
 *
 *   - exactly `tickCount` ticks (default 3) then stop
 *   - `intervalMs` sleep BETWEEN ticks (default from env HEARTBEAT_INTERVAL_MS,
 *     10_000ms for production, can be overriden to 10ms for tests)
 *   - each tick emits `heartbeat-tick` artifact (1-indexed, carries totalTicks
 *     so the UI renders `01 / 03 ticks` without knowing the schedule)
 *   - each tick is a single `runAgentLoop` invocation with the same system
 *     prompt as the CLI, so the Anthropic-side tool_use stream still drives
 *     V2-P2 tool_use:start / tool_use:end / assistant:delta events through
 *     the RunStore for the dashboard to render
 *   - when the agent's final JSON picks `action: 'post'` and a matching
 *     `post_to_x` tool-call output is present, we emit a `tweet-url` artifact
 *     so the TweetFeed updates
 *   - per-tick throws are isolated: the runner logs them + continues; matches
 *     the error-isolation contract the HeartbeatAgent class already honours.
 *
 * Why a separate function (not reuse `HeartbeatAgent`): the class is tuned
 * for long-running setInterval loops with overlap detection. The dashboard
 * flow wants a bounded N-tick run with explicit between-tick sleeps so the
 * SSE stream closes deterministically when the last tick completes.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { runAgentLoop, type AgentLoopResult } from '../agents/runtime.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  createCheckTokenStatusTool,
  tokenStatusInputSchema,
  tokenStatusOutputSchema,
  type TokenStatusInput,
  type TokenStatusOutput,
} from '../tools/token-status.js';
import { createLoreExtendTool } from '../tools/lore-extend.js';
import {
  createPostToXTool,
  xPostInputSchema,
  xPostOutputSchema,
  type XPostInput,
  type XPostOutput,
} from '../tools/x-post.js';
import { BASE_RULES_NO_URL } from '../tools/tweet-guard.js';
import type { AgentTool } from '@hack-fourmeme/shared';
import type { RunStore } from './store.js';
import type { AppConfig } from '../config.js';

// OpenRouter Anthropic-compatible gateway model used by every agent in this
// project. Duplicated here rather than imported from a2a.ts to keep the two
// run orchestrators decoupled.
const MODEL = 'anthropic/claude-sonnet-4-5';
const DEFAULT_TICK_COUNT = 3;
const DEFAULT_INTERVAL_MS = 10_000;
const MAX_TURNS_PER_TICK = 4;

/**
 * Per-tick system prompt. Cross-references the shared `BASE_RULES_NO_URL`
 * fragment from `tweet-guard.ts` so the LLM draft this agent ships to
 * `post_to_x` lines up with the guard the tool enforces. Before this
 * share the prompt told the model to embed the full tokenAddr + bscscan
 * URL — X's 2026 post-OAuth cooldown rejected every such post with a
 * 403. Safe mode: no URL, no raw address, lore chapter reference only.
 *
 * Exported so every heartbeat entry point (CLI runner, Brain
 * `invoke_heartbeat_tick`) shares one source of truth — prior drift
 * between this prompt and brain-chat.ts's private copy caused the
 * Brain-driven tick path to silently generate guard-rejected tweets.
 */
export const HEARTBEAT_SYSTEM_PROMPT = [
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

export interface RunHeartbeatDemoDeps {
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  tokenAddress: string;
  /** Dashboard contract: 3 ticks. Override only from tests. */
  tickCount?: number;
  /** Milliseconds to sleep between ticks. 0 disables sleep (tests). */
  intervalMs?: number;

  // ─── dependency injection for tests ──────────────────────────────────────
  /** Real runtime by default; tests pass a fake loop returning canned results. */
  runAgentLoopImpl?: typeof runAgentLoop;
  /** Override the sleep so tests don't wait. */
  sleepImpl?: (ms: number) => Promise<void>;
  /**
   * Optional check_token_status stub. Production leaves this undefined and
   * the runner builds the real viem-backed tool. Tests pass a pure async fn
   * returning canned TokenStatusOutput.
   */
  tokenStatusImpl?: (input: TokenStatusInput) => Promise<TokenStatusOutput>;
  /** Optional post_to_x stub — tests supply an inline output. */
  postToXImpl?: (input: XPostInput) => Promise<XPostOutput>;
  /** Optional extend_lore stub — tests supply an inline output. */
  extendLoreImpl?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

  // ─── production wiring ───────────────────────────────────────────────────
  /** Only required when tokenStatusImpl is absent — viem needs an RPC. */
  config?: AppConfig;
}

/**
 * Extract the first `{...}` JSON blob from the model's final text and attempt
 * to parse it into a heartbeat-decision action + reason. Matches the
 * contract stamped into HEARTBEAT_SYSTEM_PROMPT. Defensively tolerates surrounding
 * whitespace, markdown fences, or extra prose — if no valid JSON is found we
 * fall back to 'skip' with a generic reason so the UI still shows a decision.
 */
export function parseTickDecision(finalText: string): {
  action: 'post' | 'extend_lore' | 'skip';
  reason: string;
} {
  const firstBrace = finalText.indexOf('{');
  const lastBrace = finalText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = finalText.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate) as { action?: string; reason?: string };
      const rawAction = typeof parsed.action === 'string' ? parsed.action : '';
      const reason =
        typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
          ? parsed.reason.trim()
          : 'no reason provided';
      // Normalise the two spellings the prompt accepts — 'post_to_x' is the
      // tool name the CLI prompt uses; the artifact schema enum uses 'post'.
      if (rawAction === 'post' || rawAction === 'post_to_x') return { action: 'post', reason };
      if (rawAction === 'extend_lore') return { action: 'extend_lore', reason };
      // 'idle' is how the prompt tells the agent to do nothing.
      if (rawAction === 'skip' || rawAction === 'idle' || rawAction === '')
        return { action: 'skip', reason };
      return { action: 'skip', reason: `unrecognised action: ${rawAction}` };
    } catch {
      // Fall through to the default skip.
    }
  }
  return { action: 'skip', reason: 'final message did not carry a decision JSON' };
}

/**
 * Pull the most recent successful tool call matching `name` out of a loop
 * trace. Mirrors the helper in creator-phase.ts but kept private here to
 * avoid coupling the two run orchestrators.
 */
function findToolOutput(
  toolCalls: AgentLoopResult['toolCalls'],
  name: string,
): unknown | undefined {
  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const call = toolCalls[i];
    if (call && call.name === name && !call.isError) return call.output;
  }
  return undefined;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a test-only `AgentTool` from a plain async impl fn. Keeps the
 * production factory signatures untouched while letting unit tests pass raw
 * async functions in place of the real viem / X API-backed tools.
 */
function wrapTokenStatusStub(
  impl: (input: TokenStatusInput) => Promise<TokenStatusOutput>,
): AgentTool<TokenStatusInput, TokenStatusOutput> {
  return {
    name: 'check_token_status',
    description: 'check_token_status test stub',
    inputSchema: tokenStatusInputSchema,
    outputSchema: tokenStatusOutputSchema,
    execute: impl,
  };
}

function wrapPostToXStub(
  impl: (input: XPostInput) => Promise<XPostOutput>,
): AgentTool<XPostInput, XPostOutput> {
  return {
    name: 'post_to_x',
    description: 'post_to_x test stub',
    inputSchema: xPostInputSchema,
    outputSchema: xPostOutputSchema,
    execute: impl,
  };
}

/**
 * Entry point. Returns when all `tickCount` ticks have either completed or
 * thrown; never throws itself (per-tick errors are logged and swallowed so
 * the dashboard sees the full N-tick lifecycle even on partial failures).
 *
 * The orchestrator transitions the run to `running` on entry and leaves the
 * terminal status transition to the HTTP handler (mirrors runA2ADemo).
 */
export async function runHeartbeatDemo(deps: RunHeartbeatDemoDeps): Promise<void> {
  const tickCount = deps.tickCount ?? DEFAULT_TICK_COUNT;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = deps.sleepImpl ?? defaultSleep;
  const runLoop = deps.runAgentLoopImpl ?? runAgentLoop;

  deps.store.setStatus(deps.runId, 'running');

  // Build the tool registry once per run. Tests inject stubs; production
  // builds the real viem + Anthropic + X API factories. We only support a
  // dry-run path for post_to_x when real X creds are absent because the
  // Creator phase (a2a flow) has no similar fallback: the HTTP handler
  // decides which path to take BEFORE invoking this function.
  // Production path needs `config` to build the viem + Anthropic tools.
  // Tests that pass a mocked `runAgentLoopImpl` never actually exercise the
  // registry — `runAgentLoop` is the one that invokes tools — so we allow
  // `config` to be undefined in that case and skip real tool registration.
  const registry = new ToolRegistry();
  if (deps.tokenStatusImpl !== undefined) {
    registry.register(wrapTokenStatusStub(deps.tokenStatusImpl));
  } else if (deps.config !== undefined) {
    registry.register(createCheckTokenStatusTool({ rpcUrl: deps.config.bsc.rpcUrl }));
  }

  if (deps.postToXImpl !== undefined) {
    registry.register(wrapPostToXStub(deps.postToXImpl));
  } else if (deps.config !== undefined) {
    const x = deps.config.x;
    const haveCreds =
      x.apiKey !== undefined &&
      x.apiKeySecret !== undefined &&
      x.accessToken !== undefined &&
      x.accessTokenSecret !== undefined;
    if (haveCreds) {
      registry.register(
        createPostToXTool({
          apiKey: x.apiKey as string,
          apiKeySecret: x.apiKeySecret as string,
          accessToken: x.accessToken as string,
          accessTokenSecret: x.accessTokenSecret as string,
          handle: x.handle,
        }),
      );
    } else {
      // Dry-run stub — mirrors demos/demo-heartbeat-run.ts createDryRunPostTool
      // so the agent can still take a post action without a real X credit.
      registry.register(
        wrapPostToXStub(async (input) => {
          return {
            tweetId: 'dry-run',
            text: input.text,
            postedAt: new Date().toISOString(),
            url: 'about:blank',
          };
        }),
      );
    }
  }

  if (deps.extendLoreImpl !== undefined) {
    // Tests may omit extend_lore entirely; only wrap when present.
    registry.register({
      name: 'extend_lore',
      description: 'extend_lore test stub',
      // Loose schemas for the stub since tests do not exercise the tool body.
      inputSchema: xPostInputSchema.passthrough(),
      outputSchema: xPostOutputSchema.passthrough(),
      execute: deps.extendLoreImpl,
    } as unknown as AgentTool<Record<string, unknown>, Record<string, unknown>>);
  } else if (deps.config?.pinata.jwt !== undefined) {
    registry.register(
      createLoreExtendTool({
        anthropic: deps.anthropic,
        pinataJwt: deps.config.pinata.jwt,
        model: MODEL,
      }),
    );
  }

  emitOrchestratorLog(
    deps.store,
    deps.runId,
    `heartbeat run start (ticks=${tickCount.toString()}, intervalMs=${intervalMs.toString()})`,
  );

  for (let i = 1; i <= tickCount; i += 1) {
    // Emit the tick counter artifact BEFORE the tool-use round so the UI
    // advances `01 / 03 ticks` while the LLM is still thinking. `decisions`
    // starts empty and is re-emitted per intra-tick choice via
    // `heartbeat-decision`.
    const tickArtifact: Artifact = {
      kind: 'heartbeat-tick',
      tickNumber: i,
      totalTicks: tickCount,
      decisions: [],
    };
    deps.store.addArtifact(deps.runId, tickArtifact);

    const userInput =
      `Tick ${i.toString()} of ${tickCount.toString()} at ${new Date().toISOString()}. ` +
      `Current token under observation: ${deps.tokenAddress}. ` +
      `Decide one action now and respond with the required JSON.`;

    let loopResult: AgentLoopResult | undefined;
    try {
      loopResult = await runLoop({
        client: deps.anthropic,
        model: MODEL,
        registry,
        systemPrompt: HEARTBEAT_SYSTEM_PROMPT,
        userInput,
        agentId: 'heartbeat',
        maxTurns: MAX_TURNS_PER_TICK,
        onLog: (event) => deps.store.addLog(deps.runId, event),
        onToolUseStart: (event) => deps.store.addToolUseStart(deps.runId, event),
        onToolUseEnd: (event) => deps.store.addToolUseEnd(deps.runId, event),
        onAssistantDelta: (event) => deps.store.addAssistantDelta(deps.runId, event),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitOrchestratorLog(
        deps.store,
        deps.runId,
        `tick ${i.toString()} failed: ${message}`,
        'error',
      );
    }

    if (loopResult !== undefined) {
      const decision = parseTickDecision(loopResult.finalText);
      deps.store.addArtifact(deps.runId, {
        kind: 'heartbeat-decision',
        tickNumber: i,
        action: decision.action,
        reason: decision.reason,
      });

      if (decision.action === 'post') {
        const postOutput = findToolOutput(loopResult.toolCalls, 'post_to_x') as
          | XPostOutput
          | undefined;
        if (postOutput !== undefined) {
          const isDryRun = postOutput.tweetId === 'dry-run' || postOutput.url === 'about:blank';
          deps.store.addArtifact(deps.runId, {
            kind: 'tweet-url',
            url: postOutput.url,
            tweetId: postOutput.tweetId,
            ...(isDryRun ? { label: 'tweet (dry-run)' } : {}),
          });
        }
      }
    }

    if (i < tickCount) {
      await sleep(intervalMs);
    }
  }

  emitOrchestratorLog(deps.store, deps.runId, 'heartbeat run complete');
}

function emitOrchestratorLog(
  store: RunStore,
  runId: string,
  message: string,
  level: LogEvent['level'] = 'info',
): void {
  store.addLog(runId, {
    ts: new Date().toISOString(),
    agent: 'heartbeat',
    tool: 'orchestrator',
    level,
    message,
  });
}
