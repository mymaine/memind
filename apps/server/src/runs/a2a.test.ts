import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { AnchorLedger } from '../state/anchor-ledger.js';
import { RunStore } from './store.js';
import {
  buildMarketMakerRegistry,
  buildNarratorRegistry,
  runA2ADemo,
  type RunCreatorPhaseFn,
  type RunNarratorPhaseFn,
  type RunMarketMakerPhaseFn,
} from './a2a.js';

/**
 * a2a orchestrator unit tests — exercise the env-gated mode dispatch and the
 * Creator pre-seed → real-run handoff without touching the LLM, USDC or
 * Pinata stacks.
 *
 * runA2ADemo's three "phase" callbacks (Creator / Narrator / Market-maker)
 * are now dependency-injectable so we can substitute fakes that just push
 * synthetic logs/artifacts into the RunStore. The tests assert the env-gated
 * branching: `CREATOR_DRY_RUN=true` short-circuits to the env-fed pre-seed
 * path; everything else (default + 'false') runs the Creator phase.
 */

function makeConfigStub(): AppConfig {
  return {
    port: 0,
    anthropic: { apiKey: undefined },
    openrouter: { apiKey: 'dummy' },
    pinata: { jwt: 'dummy' },
    wallets: {
      agent: { privateKey: '0xa'.padEnd(66, 'a') as `0x${string}`, address: undefined },
      bscDeployer: {
        privateKey: '0xb'.padEnd(66, 'b') as `0x${string}`,
        address: undefined,
      },
    },
    x402: {
      facilitatorUrl: 'https://x402.org/facilitator',
      network: 'eip155:84532',
      mode: 'local' as const,
    },
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

const SAMPLE_TOKEN = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const SAMPLE_DEPLOY_TX = `0x${'a'.repeat(64)}`;

describe('runA2ADemo (V2-P1)', () => {
  let store: RunStore;
  let loreStore: LoreStore;
  const anthropic = {} as Anthropic; // never invoked — phases are mocked.

  beforeEach(() => {
    store = new RunStore();
    loreStore = new LoreStore();
  });

  afterEach(() => {
    delete process.env.CREATOR_DRY_RUN;
    delete process.env.DEMO_TOKEN_DEPLOY_TX;
    delete process.env.DEMO_CREATOR_LORE_CID;
  });

  // Default fakes for narrator + market-maker — produce minimal valid output
  // so the orchestrator can move to the next phase without throwing.
  const fakeNarrator: RunNarratorPhaseFn = async (deps) => {
    deps.store.addLog(deps.runId, {
      ts: new Date().toISOString(),
      agent: 'narrator',
      tool: 'orchestrator',
      level: 'info',
      message: 'fake narrator',
    });
    deps.store.addArtifact(deps.runId, {
      kind: 'lore-cid',
      cid: 'bafyNARRATOR',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafyNARRATOR',
      author: 'narrator',
      chapterNumber: 1,
    });
    return { tokenAddr: deps.tokenAddr, ipfsHash: 'bafyNARRATOR', chapterNumber: 1 };
  };
  const fakeMarketMaker: RunMarketMakerPhaseFn = async () => undefined;

  it('runs the Creator phase by default (CREATOR_DRY_RUN unset)', async () => {
    const record = store.create('a2a');
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockImplementation(async (deps) => {
      deps.store.addLog(deps.runId, {
        ts: new Date().toISOString(),
        agent: 'creator',
        tool: 'orchestrator',
        level: 'info',
        message: 'creator real-run',
      });
      return {
        tokenAddr: SAMPLE_TOKEN,
        tokenName: 'HBNB2026-DemoToken',
        tokenSymbol: 'HBNB2026',
        tokenDeployTx: SAMPLE_DEPLOY_TX,
      };
    });

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(runCreator).toHaveBeenCalledTimes(1);
    const updated = store.get(record.runId);
    const creatorLog = updated?.logs.find((l) => l.message === 'creator real-run');
    expect(creatorLog).toBeDefined();
  });

  it('skips the Creator phase when CREATOR_DRY_RUN=true and emits dry-run fallback artifacts from env', async () => {
    process.env.CREATOR_DRY_RUN = 'true';
    process.env.DEMO_TOKEN_DEPLOY_TX = SAMPLE_DEPLOY_TX;
    process.env.DEMO_CREATOR_LORE_CID = 'bafyDRYRUNCREATORLORE';
    const record = store.create('a2a');
    const runCreator = vi.fn<RunCreatorPhaseFn>();

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(runCreator).not.toHaveBeenCalled();
    const updated = store.get(record.runId);
    const kinds = updated?.artifacts.map((a) => a.kind) ?? [];
    expect(kinds).toContain('bsc-token');
    expect(kinds).toContain('token-deploy-tx');
    // The narrator pushes its own lore-cid; the dry-run fallback also seeds
    // the creator's lore-cid → expect at least one author='creator' lore-cid.
    const creatorLore = updated?.artifacts.find(
      (a) => a.kind === 'lore-cid' && a.author === 'creator',
    );
    expect(creatorLore).toBeDefined();
  });

  it('runs the Creator phase when CREATOR_DRY_RUN is the empty string or "false"', async () => {
    process.env.CREATOR_DRY_RUN = 'false';
    const record = store.create('a2a');
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(runCreator).toHaveBeenCalledTimes(1);
  });

  it('passes the Creator-produced tokenAddr through to the Narrator phase', async () => {
    const record = store.create('a2a');
    const creatorTokenAddr = '0x' + 'c'.repeat(40);
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: creatorTokenAddr,
      tokenName: 'CreatorToken',
      tokenSymbol: 'HBNB2026-NEW',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });
    const narratorSpy = vi.fn<RunNarratorPhaseFn>().mockImplementation(fakeNarrator);

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'orig', tokenSymbol: 'orig' },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: narratorSpy,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(narratorSpy).toHaveBeenCalled();
    const narratorArgs = narratorSpy.mock.calls[0]?.[0];
    expect(narratorArgs?.tokenAddr).toBe(creatorTokenAddr);
    expect(narratorArgs?.tokenName).toBe('CreatorToken');
  });

  // ─── V2-P5 Task 1: theme plumbing ──────────────────────────────────────
  // ThemeInput → POST /api/runs → runA2ADemo → Creator phase. When the caller
  // provides `theme`, the orchestrator must forward it verbatim to the Creator
  // phase callback. When `theme` is absent / blank, a sensible default is
  // passed so the Creator prompt is never empty.
  it('forwards the caller-supplied theme to the Creator phase', async () => {
    const record = store.create('a2a');
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: {
        tokenAddr: SAMPLE_TOKEN,
        tokenName: 'x',
        tokenSymbol: 'y',
        theme: 'Shiba Astronaut on Mars building a moon colony',
      },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(runCreator).toHaveBeenCalledTimes(1);
    const call = runCreator.mock.calls[0]?.[0];
    expect(call?.theme).toBe('Shiba Astronaut on Mars building a moon colony');
  });

  it('falls back to a default theme when args.theme is absent or blank', async () => {
    const record = store.create('a2a');
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      // theme omitted entirely
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    const call = runCreator.mock.calls[0]?.[0];
    expect(typeof call?.theme).toBe('string');
    expect((call?.theme ?? '').length).toBeGreaterThan(0);
  });

  // ─── AC3 anchor ledger plumbing ────────────────────────────────────────────
  // The Narrator phase callback must receive the AnchorLedger the orchestrator
  // was configured with, so the default narrator implementation can register
  // an anchor after the chapter upsert and emit the lore-anchor artifact
  // through the RunStore.
  it('forwards the anchorLedger dependency to the Narrator phase', async () => {
    const record = store.create('a2a');
    const anchorLedger = new AnchorLedger();
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });
    const narratorSpy = vi.fn<RunNarratorPhaseFn>().mockImplementation(fakeNarrator);

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      anchorLedger,
      runCreatorImpl: runCreator,
      runNarratorImpl: narratorSpy,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(narratorSpy).toHaveBeenCalledTimes(1);
    const deps = narratorSpy.mock.calls[0]?.[0];
    expect(deps?.anchorLedger).toBe(anchorLedger);
  });

  it('omitting anchorLedger keeps the Narrator phase deps.anchorLedger undefined', async () => {
    const record = store.create('a2a');
    const runCreator = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });
    const narratorSpy = vi.fn<RunNarratorPhaseFn>().mockImplementation(fakeNarrator);

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      runCreatorImpl: runCreator,
      runNarratorImpl: narratorSpy,
      runMarketMakerImpl: fakeMarketMaker,
    });

    const deps = narratorSpy.mock.calls[0]?.[0];
    expect(deps?.anchorLedger).toBeUndefined();
  });

  // Symmetric plumbing for the Creator phase — `anchorChapterOne` inside
  // `runCreatorPhase` can only fire when the orchestrator hands the ledger
  // through. Both branches (present / absent) are asserted so any future
  // refactor that drops the forward would be caught here.
  it('forwards the anchorLedger dependency to the Creator phase', async () => {
    const record = store.create('a2a');
    const anchorLedger = new AnchorLedger();
    const creatorSpy = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      anchorLedger,
      runCreatorImpl: creatorSpy,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    expect(creatorSpy).toHaveBeenCalledTimes(1);
    const deps = creatorSpy.mock.calls[0]?.[0];
    expect(deps?.anchorLedger).toBe(anchorLedger);
  });

  it('omitting anchorLedger keeps the Creator phase deps.anchorLedger undefined', async () => {
    const record = store.create('a2a');
    const creatorSpy = vi.fn<RunCreatorPhaseFn>().mockResolvedValue({
      tokenAddr: SAMPLE_TOKEN,
      tokenName: 'x',
      tokenSymbol: 'y',
      tokenDeployTx: SAMPLE_DEPLOY_TX,
    });

    await runA2ADemo({
      config: makeConfigStub(),
      anthropic,
      store,
      runId: record.runId,
      args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
      loreStore,
      runCreatorImpl: creatorSpy,
      runNarratorImpl: fakeNarrator,
      runMarketMakerImpl: fakeMarketMaker,
    });

    const deps = creatorSpy.mock.calls[0]?.[0];
    expect(deps?.anchorLedger).toBeUndefined();
  });

  // ─── Registry-contract tests ─────────────────────────────────────────────
  // The narrator + market-maker system prompts force `get_token_info` as the
  // first tool call via `toolChoice: { type: 'tool', name: 'get_token_info' }`.
  // Anthropic's API rejects with 400 when a forced tool name is absent from
  // the registry. pnpm test mocks the narrator / market-maker phases directly,
  // so a missing tool never surfaces there — a registry-mismatch would only
  // blow up in prod. These tests lock the forced-tool ↔ registry invariant
  // without touching Anthropic: they drive only the pure registry builder.
  it('buildNarratorRegistry exposes get_token_info and extend_lore', () => {
    const reg = buildNarratorRegistry({
      config: makeConfigStub(),
      anthropic,
      loreStore,
    });
    const names = reg.list().map((t) => t.name);
    expect(names).toContain('get_token_info');
    expect(names).toContain('extend_lore');
  });

  it('buildMarketMakerRegistry exposes get_token_info, check_token_status, x402_fetch_lore', () => {
    const reg = buildMarketMakerRegistry({
      config: makeConfigStub(),
      loreStore,
    });
    const names = reg.list().map((t) => t.name);
    expect(names).toContain('get_token_info');
    expect(names).toContain('check_token_status');
    expect(names).toContain('x402_fetch_lore');
  });

  it('throws when secrets are missing (preserves Phase 4 fail-fast behaviour)', async () => {
    const record = store.create('a2a');
    const config = makeConfigStub();
    config.openrouter = { apiKey: undefined };
    config.anthropic = { apiKey: undefined };

    await expect(
      runA2ADemo({
        config,
        anthropic,
        store,
        runId: record.runId,
        args: { tokenAddr: SAMPLE_TOKEN, tokenName: 'x', tokenSymbol: 'y' },
        loreStore,
        runCreatorImpl: vi.fn(),
        runNarratorImpl: fakeNarrator,
        runMarketMakerImpl: fakeMarketMaker,
      }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
