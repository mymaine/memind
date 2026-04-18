import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ShillerAgentOutput } from '../agents/market-maker.js';
import type { AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { RunStore } from './store.js';
import {
  runShillMarketDemo,
  stubCreatorPaymentPhase,
  type CreatorPaymentPhaseFn,
  type RunShillerPhaseFn,
} from './shill-market.js';

/**
 * runShillMarketDemo orchestrator unit tests — exercise the Creator-payment →
 * LoreStore → Shiller agent path without touching Anthropic / X / x402 live
 * infra.
 *
 * Every phase is dependency-injected (`runShillerImpl`, `creatorPaymentImpl`)
 * so the suite stays in-memory. We assert the artifact sequence + the
 * ShillOrderStore state machine transitions, which is the whole point of the
 * orchestrator: glue together the queue + store + agent with correct ordering
 * and correct fallback when inputs are missing.
 */

function makeConfigStub(): AppConfig {
  return {
    port: 0,
    anthropic: { apiKey: undefined },
    openrouter: { apiKey: 'dummy' },
    pinata: { jwt: 'dummy' },
    wallets: {
      agent: { privateKey: undefined, address: undefined },
      bscDeployer: { privateKey: undefined, address: undefined },
    },
    x402: { facilitatorUrl: 'https://x402.org/facilitator', network: 'eip155:84532' },
    bsc: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    heartbeat: { intervalMs: 60_000 },
    x: {
      apiKey: undefined,
      apiKeySecret: undefined,
      accessToken: undefined,
      accessTokenSecret: undefined,
      bearerToken: undefined,
      handle: undefined,
    },
  };
}

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const TOKEN_ADDR_LOWER = TOKEN_ADDR.toLowerCase();

describe('runShillMarketDemo', () => {
  let runStore: RunStore;
  let loreStore: LoreStore;
  let shillOrderStore: ShillOrderStore;
  const anthropic = {} as Anthropic; // never invoked — phases are stubbed.

  beforeEach(() => {
    runStore = new RunStore();
    loreStore = new LoreStore();
    shillOrderStore = new ShillOrderStore();
  });

  afterEach(() => {
    runStore.clear();
    loreStore.clear();
    shillOrderStore.clear();
  });

  /**
   * Default creator-payment phase: uses the exported stub so tests align with
   * the real default path. Returns the orderId so the test body can chase the
   * order through markDone / markFailed.
   */
  function defaultPayment(orderId: string): CreatorPaymentPhaseFn {
    return async (deps) => {
      const paidTxHash = `0x${'0'.repeat(64)}`;
      const paidAmountUsdc = '0.01';
      deps.shillOrderStore.enqueue({
        orderId,
        targetTokenAddr: deps.tokenAddr,
        ...(deps.creatorBrief !== undefined ? { creatorBrief: deps.creatorBrief } : {}),
        paidTxHash,
        paidAmountUsdc,
        ts: new Date().toISOString(),
      });
      return { orderId, paidTxHash, paidAmountUsdc };
    };
  }

  it('happy path: lore present, shiller posts, artifact sequence matches', async () => {
    // Seed lore so the orchestrator has a real snippet to forward.
    const LORE_TEXT = 'The bats rose from the cavern at dusk, hunger sharp as moonlight.';
    loreStore.upsert({
      tokenAddr: TOKEN_ADDR_LOWER,
      chapterNumber: 1,
      chapterText: LORE_TEXT,
      ipfsHash: 'bafkreiLOREHAPPY',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreiLOREHAPPY',
      publishedAt: '2026-04-18T10:00:00.000Z',
    });

    const ORDER_ID = 'order_happy';
    const creatorPaymentImpl = vi
      .fn<CreatorPaymentPhaseFn>()
      .mockImplementation(defaultPayment(ORDER_ID));

    const shillerOutput: ShillerAgentOutput = {
      orderId: ORDER_ID,
      tokenAddr: TOKEN_ADDR_LOWER,
      decision: 'shill',
      tweetId: 't1',
      tweetUrl: 'https://x.com/shiller/status/t1',
      tweetText: '$HBNB2026-BAT a fever dream rose from the cavern at dusk 👁',
      postedAt: '2026-04-18T10:05:00.000Z',
      toolCalls: [],
    };
    const runShillerImpl = vi.fn<RunShillerPhaseFn>().mockResolvedValue(shillerOutput);

    const record = runStore.create('shill-market');

    await runShillMarketDemo({
      config: makeConfigStub(),
      anthropic,
      store: runStore,
      runId: record.runId,
      args: { tokenAddr: TOKEN_ADDR, tokenSymbol: 'HBNB2026-BAT', creatorBrief: 'make it weird' },
      shillOrderStore,
      loreStore,
      creatorPaymentImpl,
      runShillerImpl,
    });

    // Lore snippet was forwarded verbatim from LoreStore.
    expect(runShillerImpl).toHaveBeenCalledTimes(1);
    const call = runShillerImpl.mock.calls[0]?.[0];
    expect(call?.loreSnippet).toBe(LORE_TEXT);

    // Order state: processing → done with tweet metadata.
    const orderAfter = shillOrderStore.getById(ORDER_ID);
    expect(orderAfter?.status).toBe('done');
    expect(orderAfter?.tweetId).toBe('t1');
    expect(orderAfter?.tweetUrl).toBe('https://x.com/shiller/status/t1');

    // Artifact sequence: x402-tx, shill-order(queued), shill-tweet, shill-order(done).
    const updated = runStore.get(record.runId);
    const kinds = updated?.artifacts.map((a) => a.kind) ?? [];
    expect(kinds[0]).toBe('x402-tx');
    expect(kinds[1]).toBe('shill-order');
    expect(kinds[2]).toBe('shill-tweet');
    expect(kinds[3]).toBe('shill-order');

    const shillOrderArtifacts = updated?.artifacts.filter((a) => a.kind === 'shill-order') ?? [];
    expect(shillOrderArtifacts).toHaveLength(2);
    const first = shillOrderArtifacts[0];
    const second = shillOrderArtifacts[1];
    if (first?.kind !== 'shill-order' || second?.kind !== 'shill-order') {
      throw new Error('unexpected artifact kind');
    }
    expect(first.status).toBe('queued');
    expect(first.targetTokenAddr).toBe(TOKEN_ADDR_LOWER);
    expect(second.status).toBe('done');

    const shillTweet = updated?.artifacts.find((a) => a.kind === 'shill-tweet');
    if (shillTweet?.kind !== 'shill-tweet') throw new Error('missing shill-tweet artifact');
    expect(shillTweet.tweetId).toBe('t1');
    expect(shillTweet.orderId).toBe(ORDER_ID);
  });

  it('shiller skip path: order moves to failed, no shill-tweet artifact', async () => {
    loreStore.upsert({
      tokenAddr: TOKEN_ADDR_LOWER,
      chapterNumber: 1,
      chapterText: 'The cavern stayed silent.',
      ipfsHash: 'bafkreiLORESKIP',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkreiLORESKIP',
      publishedAt: '2026-04-18T10:00:00.000Z',
    });

    const ORDER_ID = 'order_skip';
    const creatorPaymentImpl = vi
      .fn<CreatorPaymentPhaseFn>()
      .mockImplementation(defaultPayment(ORDER_ID));
    const shillerOutput: ShillerAgentOutput = {
      orderId: ORDER_ID,
      tokenAddr: TOKEN_ADDR_LOWER,
      decision: 'skip',
      toolCalls: [],
      errorMessage: 'guard exhausted after 2 attempts',
    };
    const runShillerImpl = vi.fn<RunShillerPhaseFn>().mockResolvedValue(shillerOutput);

    const record = runStore.create('shill-market');

    // Orchestrator must NOT throw on a shiller skip — skip is a business path.
    await expect(
      runShillMarketDemo({
        config: makeConfigStub(),
        anthropic,
        store: runStore,
        runId: record.runId,
        args: { tokenAddr: TOKEN_ADDR },
        shillOrderStore,
        loreStore,
        creatorPaymentImpl,
        runShillerImpl,
      }),
    ).resolves.toBeUndefined();

    const orderAfter = shillOrderStore.getById(ORDER_ID);
    expect(orderAfter?.status).toBe('failed');
    expect(orderAfter?.errorMessage).toBe('guard exhausted after 2 attempts');

    const updated = runStore.get(record.runId);
    const kinds = updated?.artifacts.map((a) => a.kind) ?? [];
    expect(kinds).not.toContain('shill-tweet');
    const shillOrderArtifacts = updated?.artifacts.filter((a) => a.kind === 'shill-order') ?? [];
    const last = shillOrderArtifacts[shillOrderArtifacts.length - 1];
    if (last?.kind !== 'shill-order') throw new Error('missing shill-order artifact');
    expect(last.status).toBe('failed');
  });

  it('lore-missing fallback: stub snippet is non-empty and URL-free', async () => {
    // LoreStore is empty — orchestrator must synthesise a fallback snippet so
    // the Shiller phase still runs. Fallback content matters: it cannot leak
    // URLs (would trigger the post_shill_for URL guard) and must not be empty
    // (would fail the post_shill_for zod min(1) validation).
    const ORDER_ID = 'order_lore_missing';
    const creatorPaymentImpl = vi
      .fn<CreatorPaymentPhaseFn>()
      .mockImplementation(defaultPayment(ORDER_ID));

    let observedLore: string | undefined;
    const runShillerImpl = vi
      .fn<RunShillerPhaseFn>()
      .mockImplementation(async (deps): Promise<ShillerAgentOutput> => {
        observedLore = deps.loreSnippet;
        return {
          orderId: deps.orderId,
          tokenAddr: deps.tokenAddr,
          decision: 'shill',
          tweetId: 't2',
          tweetUrl: 'https://x.com/shiller/status/t2',
          tweetText: '$HBNB2026 a curious find 👁',
          postedAt: '2026-04-18T10:05:00.000Z',
          toolCalls: [],
        };
      });

    const record = runStore.create('shill-market');

    await runShillMarketDemo({
      config: makeConfigStub(),
      anthropic,
      store: runStore,
      runId: record.runId,
      args: { tokenAddr: TOKEN_ADDR },
      shillOrderStore,
      loreStore,
      creatorPaymentImpl,
      runShillerImpl,
    });

    expect(typeof observedLore).toBe('string');
    expect((observedLore ?? '').length).toBeGreaterThan(0);
    expect(observedLore ?? '').not.toMatch(/https?:\/\//i);
    expect(observedLore ?? '').not.toMatch(/www\./i);

    // Happy flow still completes end-to-end.
    const orderAfter = shillOrderStore.getById(ORDER_ID);
    expect(orderAfter?.status).toBe('done');
  });
});

// The exported stub is a real CreatorPaymentPhaseFn that other code paths
// (CLI demo, integration harness) rely on — guard against accidental removal.
describe('stubCreatorPaymentPhase', () => {
  it('is exported as a function', () => {
    expect(typeof stubCreatorPaymentPhase).toBe('function');
  });
});
