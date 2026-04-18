/**
 * runShillMarketDemo — Phase 4.6 orchestrator for the creator-paid shilling
 * market. Mirrors the `runA2ADemo` shape (phase-callback dependency injection,
 * RunStore-driven artifacts + logs) so the HTTP route layer and the CLI demo
 * can drive the same code path.
 *
 * Flow:
 *   1. Creator payment phase — by default stubs an x402 settlement so demo
 *      harnesses and tests don't need real Base Sepolia USDC. Enqueues a
 *      `ShillOrderStore` entry with a sentinel tx hash + emits matching
 *      `x402-tx` and `shill-order (queued)` artifacts.
 *   2. Lore pull — read the latest `LoreStore` chapter for the target token.
 *      When none exists we synthesise a short fallback snippet (non-empty,
 *      URL-free) so the Shiller agent still has something to ground its
 *      tweet in. Demo robustness > strict correctness here: the user story
 *      "creator pays → shiller posts" must not fall over just because the
 *      Narrator phase has not run yet.
 *   3. Shiller phase — runs `runShillerAgent` (or a test fake) with the
 *      pulled order + lore snippet. Translates the agent decision back into
 *      `ShillOrderStore.markDone` / `.markFailed` + emits a terminal
 *      `shill-order` artifact + an optional `shill-tweet` artifact.
 *
 * Why default to a stub payment: the x402-gated `/shill/:tokenAddr` route
 * is a separate flow a real creator drives from the dashboard; the
 * orchestrator is a demo convenience that proves the queue → agent →
 * artifact chain works end-to-end without USDC. A `SHILL_REAL_PAY=true`
 * opt-in can replace this stub with a `payingFetch` call in a follow-up.
 */
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { runShillerAgent, type ShillerAgentOutput } from '../agents/market-maker.js';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { ShillOrderStore } from '../state/shill-order-store.js';
import { createPostShillForTool } from '../tools/post-shill-for.js';
import { createPostToXTool } from '../tools/x-post.js';
import type { RunStore } from './store.js';

export interface RunShillMarketDemoArgs {
  tokenAddr: string;
  tokenSymbol?: string;
  creatorBrief?: string;
}

/**
 * Shiller phase callback. Tests inject a fake that returns a synthetic
 * `ShillerAgentOutput`; production wires up the real `runShillerAgent` via
 * `defaultRunShillerImpl` below.
 */
export type RunShillerPhaseFn = (deps: {
  anthropic: Anthropic;
  config: AppConfig;
  store: RunStore;
  runId: string;
  orderId: string;
  tokenAddr: string;
  tokenSymbol?: string;
  loreSnippet: string;
  creatorBrief?: string;
}) => Promise<ShillerAgentOutput>;

/**
 * Creator-payment phase callback. Default implementation enqueues a stubbed
 * order with a zero-sentinel tx hash; an opt-in real-pay variant can call
 * `payingFetch` against the server's own `/shill/:tokenAddr` route.
 */
export type CreatorPaymentPhaseFn = (deps: {
  config: AppConfig;
  store: RunStore;
  runId: string;
  shillOrderStore: ShillOrderStore;
  tokenAddr: string;
  creatorBrief?: string;
}) => Promise<{ orderId: string; paidTxHash: string; paidAmountUsdc: string }>;

export interface RunShillMarketDemoDeps {
  config: AppConfig;
  anthropic: Anthropic;
  store: RunStore;
  runId: string;
  args: RunShillMarketDemoArgs;
  shillOrderStore: ShillOrderStore;
  loreStore: LoreStore;
  runShillerImpl?: RunShillerPhaseFn;
  creatorPaymentImpl?: CreatorPaymentPhaseFn;
}

// OpenRouter Anthropic-compatible gateway — mirrors a2a.ts so the Shiller
// persona talks to the same model the rest of the swarm uses.
const MODEL = 'anthropic/claude-sonnet-4-5';

/**
 * Default stub creator-payment phase. Emits a synthetic x402 settlement so
 * demo / test harnesses can drive the orchestrator without spending real
 * USDC. The sentinel tx hash (`0x00…00`) is intentionally obvious so anyone
 * inspecting the artifact knows it was not a real on-chain settlement.
 */
export const stubCreatorPaymentPhase: CreatorPaymentPhaseFn = async (deps) => {
  const { shillOrderStore, tokenAddr, creatorBrief } = deps;
  const orderId = randomUUID();
  const paidTxHash = `0x${'0'.repeat(64)}`;
  const paidAmountUsdc = '0.01';
  shillOrderStore.enqueue({
    orderId,
    targetTokenAddr: tokenAddr,
    ...(creatorBrief !== undefined ? { creatorBrief } : {}),
    paidTxHash,
    paidAmountUsdc,
    ts: new Date().toISOString(),
  });
  return { orderId, paidTxHash, paidAmountUsdc };
};

/**
 * Default Shiller phase implementation — wires the existing
 * `runShillerAgent` into the phase callback shape. Kept top-level so the
 * test suite can swap it for a fake while production defaults to it.
 */
const defaultRunShillerImpl: RunShillerPhaseFn = async (deps) => {
  const postToXTool = createPostToXTool({
    apiKey: deps.config.x.apiKey ?? '',
    apiKeySecret: deps.config.x.apiKeySecret ?? '',
    accessToken: deps.config.x.accessToken ?? '',
    accessTokenSecret: deps.config.x.accessTokenSecret ?? '',
    ...(deps.config.x.handle !== undefined ? { handle: deps.config.x.handle } : {}),
  });
  const postShillForTool = createPostShillForTool({
    anthropicClient: deps.anthropic,
    postToXTool,
    model: MODEL,
  });
  return runShillerAgent({
    postShillForTool,
    orderId: deps.orderId,
    tokenAddr: deps.tokenAddr,
    ...(deps.tokenSymbol !== undefined ? { tokenSymbol: deps.tokenSymbol } : {}),
    loreSnippet: deps.loreSnippet,
    ...(deps.creatorBrief !== undefined ? { creatorBrief: deps.creatorBrief } : {}),
    onLog: (event) => deps.store.addLog(deps.runId, event),
  });
};

function orchestratorLog(
  store: RunStore,
  runId: string,
  message: string,
  level: LogEvent['level'] = 'info',
): void {
  store.addLog(runId, {
    ts: new Date().toISOString(),
    // Shill persona shares the market-maker agent id per spec (AC-P4.6-3).
    agent: 'market-maker',
    tool: 'orchestrator',
    level,
    message,
  });
}

/**
 * Build a lore snippet for the Shiller prompt. Prefer the Narrator's latest
 * chapter; fall back to a short stub when the LoreStore has nothing for the
 * given token yet (the demo must still flow end-to-end, and a URL-free stub
 * will not trip the `post_shill_for` content guard).
 */
function resolveLoreSnippet(
  loreStore: LoreStore,
  tokenAddr: string,
  store: RunStore,
  runId: string,
): string {
  const latest = loreStore.getLatest(tokenAddr);
  if (latest !== undefined) {
    return latest.chapterText;
  }
  orchestratorLog(
    store,
    runId,
    `no lore chapter found for ${tokenAddr} — using fallback snippet`,
    'warn',
  );
  // Intentionally short, non-empty, and free of any token-substring that the
  // Shiller's post-generation guard (see post-shill-for.ts GUARD_PATTERNS)
  // would reject: no URLs, no block-explorer names, no platform domain.
  return `A mysterious token appears at address ${tokenAddr}. No one has written its lore yet, but whispers hint at something curious worth watching.`;
}

export async function runShillMarketDemo(deps: RunShillMarketDemoDeps): Promise<void> {
  const {
    config,
    anthropic,
    store,
    runId,
    args,
    shillOrderStore,
    loreStore,
    runShillerImpl,
    creatorPaymentImpl,
  } = deps;

  const runShiller = runShillerImpl ?? defaultRunShillerImpl;
  const runPayment = creatorPaymentImpl ?? stubCreatorPaymentPhase;

  store.setStatus(runId, 'running');
  orchestratorLog(store, runId, `shill-market orchestrator starting for ${args.tokenAddr}`);

  // ─── Phase 1: Creator payment ──────────────────────────────────────────
  const payment = await runPayment({
    config,
    store,
    runId,
    shillOrderStore,
    tokenAddr: args.tokenAddr,
    ...(args.creatorBrief !== undefined ? { creatorBrief: args.creatorBrief } : {}),
  });

  const targetTokenAddrLower = args.tokenAddr.toLowerCase();

  // Emit the x402 settlement artifact + the initial queued shill-order
  // artifact so the dashboard lights up before the Shiller agent runs.
  const x402Artifact: Artifact = {
    kind: 'x402-tx',
    chain: 'base-sepolia',
    txHash: payment.paidTxHash,
    amountUsdc: payment.paidAmountUsdc,
    label: 'creator shill payment',
  };
  store.addArtifact(runId, x402Artifact);

  const shillOrderTs = new Date().toISOString();
  const queuedArtifact: Artifact = {
    kind: 'shill-order',
    orderId: payment.orderId,
    targetTokenAddr: targetTokenAddrLower,
    ...(args.creatorBrief !== undefined ? { creatorBrief: args.creatorBrief } : {}),
    paidTxHash: payment.paidTxHash,
    paidAmountUsdc: payment.paidAmountUsdc,
    status: 'queued',
    ts: shillOrderTs,
  };
  store.addArtifact(runId, queuedArtifact);

  // ─── Phase 2: Lore pull ────────────────────────────────────────────────
  const loreSnippet = resolveLoreSnippet(loreStore, args.tokenAddr, store, runId);

  // ─── Phase 3: Pull the order off the queue ─────────────────────────────
  // `pullPending` flips state queued → processing atomically, so this also
  // guarantees we never double-dispatch an order.
  const pending = shillOrderStore.pullPending();
  const order = pending.find((o) => o.orderId === payment.orderId);
  if (order === undefined) {
    throw new Error(
      `runShillMarketDemo: payment enqueued order ${payment.orderId} but pullPending did not return it`,
    );
  }

  orchestratorLog(store, runId, `Shiller agent picks up order ${order.orderId}`);

  // ─── Phase 4: Shiller agent ────────────────────────────────────────────
  const shillerResult = await runShiller({
    anthropic,
    config,
    store,
    runId,
    orderId: order.orderId,
    tokenAddr: order.targetTokenAddr,
    ...(args.tokenSymbol !== undefined ? { tokenSymbol: args.tokenSymbol } : {}),
    loreSnippet,
    ...(args.creatorBrief !== undefined ? { creatorBrief: args.creatorBrief } : {}),
  });

  // ─── Phase 5: Translate agent decision → store state + artifacts ───────
  if (
    shillerResult.decision === 'shill' &&
    shillerResult.tweetId !== undefined &&
    shillerResult.tweetUrl !== undefined &&
    shillerResult.tweetText !== undefined
  ) {
    shillOrderStore.markDone(order.orderId, {
      tweetId: shillerResult.tweetId,
      tweetUrl: shillerResult.tweetUrl,
    });
    const shillTweetArtifact: Artifact = {
      kind: 'shill-tweet',
      orderId: order.orderId,
      targetTokenAddr: targetTokenAddrLower,
      tweetId: shillerResult.tweetId,
      tweetUrl: shillerResult.tweetUrl,
      tweetText: shillerResult.tweetText,
      ts: new Date().toISOString(),
    };
    store.addArtifact(runId, shillTweetArtifact);

    const doneArtifact: Artifact = {
      kind: 'shill-order',
      orderId: order.orderId,
      targetTokenAddr: targetTokenAddrLower,
      ...(args.creatorBrief !== undefined ? { creatorBrief: args.creatorBrief } : {}),
      paidTxHash: payment.paidTxHash,
      paidAmountUsdc: payment.paidAmountUsdc,
      status: 'done',
      ts: new Date().toISOString(),
    };
    store.addArtifact(runId, doneArtifact);
  } else {
    // skip path — the shiller tool failed its guard / OAuth / etc. The
    // orchestrator must mark the order failed and keep flowing (skip is a
    // business path, not an exception — see ShillerAgentOutput docs).
    const errorMessage = shillerResult.errorMessage ?? 'shiller skipped without error detail';
    shillOrderStore.markFailed(order.orderId, errorMessage);
    const failedArtifact: Artifact = {
      kind: 'shill-order',
      orderId: order.orderId,
      targetTokenAddr: targetTokenAddrLower,
      ...(args.creatorBrief !== undefined ? { creatorBrief: args.creatorBrief } : {}),
      paidTxHash: payment.paidTxHash,
      paidAmountUsdc: payment.paidAmountUsdc,
      status: 'failed',
      ts: new Date().toISOString(),
    };
    store.addArtifact(runId, failedArtifact);
    orchestratorLog(
      store,
      runId,
      `shill-market order ${order.orderId} failed: ${errorMessage}`,
      'error',
    );
  }

  orchestratorLog(store, runId, 'shill-market orchestrator complete');
}
