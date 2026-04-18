import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { AgentTool, AnyAgentTool, LogEvent } from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { runMarketMakerAgent } from './market-maker.js';
import {
  makeStreamingClient,
  textStream,
  toolUseStream,
  type ScriptedStream,
} from './_test-client.js';

/**
 * Fake Anthropic client factory — V2-P2: delegates to the shared streaming
 * helper. Helper name kept for parity with earlier tests.
 */
function fakeClient(scripts: ScriptedStream[]): {
  client: ReturnType<typeof makeStreamingClient>['client'];
  create: ReturnType<typeof vi.fn>;
} {
  const { client, stream } = makeStreamingClient(scripts);
  return { client, create: stream };
}

function textResponse(text: string): ScriptedStream {
  return textStream(text);
}

function toolUseResponse(
  _id: string,
  uses: { id: string; name: string; input: unknown }[],
): ScriptedStream {
  return toolUseStream(
    uses.map((u) => ({
      id: u.id,
      name: u.name,
      input: (u.input as Record<string, unknown>) ?? {},
    })),
  );
}

const TOKEN_ADDR = '0x1111111111111111111111111111111111111111';
const LORE_URL = `http://localhost:4000/lore/${TOKEN_ADDR}`;
const FAKE_TX = '0x' + 'ab'.repeat(32);

interface FakeStatus {
  tokenAddr: string;
  deployedOnChain: boolean;
  holderCount: number;
  bondingCurveProgress: number | null;
  volume24hBnb: number | null;
  marketCapBnb: number | null;
  inspectedAtBlock: string;
  warnings: string[];
}

function makeCheckTokenStatusTool(
  output: FakeStatus,
): AgentTool<{ tokenAddr: string }, FakeStatus> {
  return {
    name: 'check_token_status',
    description: 'fake token status for tests',
    inputSchema: z.object({
      tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    }),
    outputSchema: z.object({
      tokenAddr: z.string(),
      deployedOnChain: z.boolean(),
      holderCount: z.number(),
      bondingCurveProgress: z.number().nullable(),
      volume24hBnb: z.number().nullable(),
      marketCapBnb: z.number().nullable(),
      inspectedAtBlock: z.string(),
      warnings: z.array(z.string()),
    }),
    execute: vi.fn(async () => output),
  };
}

interface FakeLoreFetch {
  body: Record<string, unknown>;
  settlementTxHash: string;
  network: string;
  baseSepoliaExplorerUrl: string;
}

function makeXFetchLoreTool(output: FakeLoreFetch): AgentTool<{ url: string }, FakeLoreFetch> {
  return {
    name: 'x402_fetch_lore',
    description: 'fake x402 fetch lore tool',
    inputSchema: z.object({ url: z.string().url() }),
    outputSchema: z.object({
      body: z.record(z.unknown()),
      settlementTxHash: z.string(),
      network: z.string(),
      baseSepoliaExplorerUrl: z.string().url(),
    }),
    execute: vi.fn(async () => output),
  };
}

const HIGH_STATUS: FakeStatus = {
  tokenAddr: TOKEN_ADDR,
  deployedOnChain: true,
  holderCount: 412,
  bondingCurveProgress: 67.5,
  volume24hBnb: null,
  marketCapBnb: 12.3,
  inspectedAtBlock: '100000',
  warnings: [],
};

// Contract NOT on chain — falls below the demo-tuned soft policy threshold
// (deployedOnChain === true). Used to exercise the skip branch and the
// policy-violation warn branch when the model rationalises a buy on a
// non-existent contract.
const LOW_STATUS: FakeStatus = {
  tokenAddr: TOKEN_ADDR,
  deployedOnChain: false,
  holderCount: 0,
  bondingCurveProgress: 0,
  volume24hBnb: null,
  marketCapBnb: 0,
  inspectedAtBlock: '100000',
  warnings: [],
};

const LORE_FETCH_OUT: FakeLoreFetch = {
  body: { chapter: 1, text: 'a forgotten chapter', ipfsCid: 'bafyFAKE' },
  settlementTxHash: FAKE_TX,
  network: 'eip155:84532',
  baseSepoliaExplorerUrl: `https://sepolia.basescan.org/tx/${FAKE_TX}`,
};

function buildRegistry(status: FakeStatus, lore: FakeLoreFetch): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(makeCheckTokenStatusTool(status) as unknown as AnyAgentTool);
  registry.register(makeXFetchLoreTool(lore) as unknown as AnyAgentTool);
  return registry;
}

describe('runMarketMakerAgent', () => {
  it('buy-lore branch: invokes both tools when bonding curve progress is high', async () => {
    const registry = buildRegistry(HIGH_STATUS, LORE_FETCH_OUT);
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      toolUseResponse('m2', [
        { id: 'tu_fetch', name: 'x402_fetch_lore', input: { url: LORE_URL } },
      ]),
      textResponse(JSON.stringify({ decision: 'buy-lore', reason: 'progress 67.5% > 20%' })),
    ]);

    const out = await runMarketMakerAgent({
      client,
      registry,
      tokenAddr: TOKEN_ADDR,
      loreEndpointUrl: LORE_URL,
    });

    expect(out.decision).toBe('buy-lore');
    expect(out.tokenAddr).toBe(TOKEN_ADDR);
    expect(out.tokenStatus.bondingCurveProgress).toBe(67.5);
    expect(out.loreFetch?.settlementTxHash).toBe(FAKE_TX);
    expect(out.toolCalls.map((c) => c.name)).toEqual(['check_token_status', 'x402_fetch_lore']);
  });

  it('skip branch: only invokes check_token_status when the contract is not on chain', async () => {
    const registry = buildRegistry(LOW_STATUS, LORE_FETCH_OUT);
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      textResponse(JSON.stringify({ decision: 'skip', reason: 'contract not deployed on chain' })),
    ]);

    const out = await runMarketMakerAgent({
      client,
      registry,
      tokenAddr: TOKEN_ADDR,
      loreEndpointUrl: LORE_URL,
    });

    expect(out.decision).toBe('skip');
    expect(out.loreFetch).toBeUndefined();
    expect(out.toolCalls.map((c) => c.name)).toEqual(['check_token_status']);
  });

  it('throws when check_token_status is missing from the trace', async () => {
    const registry = buildRegistry(HIGH_STATUS, LORE_FETCH_OUT);
    // Model returns skip without ever calling check_token_status — the agent
    // must reject this because the decision isn't grounded in real state.
    const { client } = fakeClient([
      textResponse(JSON.stringify({ decision: 'skip', reason: 'no data, skipping' })),
    ]);

    await expect(
      runMarketMakerAgent({
        client,
        registry,
        tokenAddr: TOKEN_ADDR,
        loreEndpointUrl: LORE_URL,
      }),
    ).rejects.toThrow(/check_token_status/);
  });

  it('throws when decision is buy-lore but x402_fetch_lore was never invoked', async () => {
    const registry = buildRegistry(HIGH_STATUS, LORE_FETCH_OUT);
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      textResponse(JSON.stringify({ decision: 'buy-lore', reason: 'forgot to pay' })),
    ]);

    await expect(
      runMarketMakerAgent({
        client,
        registry,
        tokenAddr: TOKEN_ADDR,
        loreEndpointUrl: LORE_URL,
      }),
    ).rejects.toThrow(/x402_fetch_lore/);
  });

  it('emits LogEvents with agent="market-maker"', async () => {
    const registry = buildRegistry(LOW_STATUS, LORE_FETCH_OUT);
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      textResponse(JSON.stringify({ decision: 'skip', reason: 'low' })),
    ]);

    const logs: LogEvent[] = [];
    await runMarketMakerAgent({
      client,
      registry,
      tokenAddr: TOKEN_ADDR,
      loreEndpointUrl: LORE_URL,
      onLog: (e) => logs.push(e),
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((e) => e.agent === 'market-maker')).toBe(true);
  });

  it('tolerates JSON wrapped in a ```json fence with surrounding whitespace', async () => {
    const registry = buildRegistry(HIGH_STATUS, LORE_FETCH_OUT);
    const fenced =
      '\n\n```json\n' +
      JSON.stringify({ decision: 'buy-lore', reason: 'fenced block from model' }) +
      '\n```\n\n';
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      toolUseResponse('m2', [
        { id: 'tu_fetch', name: 'x402_fetch_lore', input: { url: LORE_URL } },
      ]),
      textResponse(fenced),
    ]);

    const out = await runMarketMakerAgent({
      client,
      registry,
      tokenAddr: TOKEN_ADDR,
      loreEndpointUrl: LORE_URL,
    });

    expect(out.decision).toBe('buy-lore');
    expect(out.loreFetch?.settlementTxHash).toBe(FAKE_TX);
  });

  it('emits a policy-violation warn LogEvent when buy-lore is chosen below threshold, but still returns successfully', async () => {
    // Policy threshold is soft: the system prompt hard-codes
    // `deployedOnChain === true` (demo-tuned), but the runtime does NOT
    // reject a non-conforming decision. That's by design — the demo must
    // still produce an observable settlement tx even when the model
    // rationalises a buy on a contract that is not actually on chain. This
    // test locks in the contract: warn gets logged, run succeeds.
    const registry = buildRegistry(LOW_STATUS, LORE_FETCH_OUT);
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      toolUseResponse('m2', [
        { id: 'tu_fetch', name: 'x402_fetch_lore', input: { url: LORE_URL } },
      ]),
      textResponse(
        JSON.stringify({
          decision: 'buy-lore',
          reason: 'rationalised override despite low signal',
        }),
      ),
    ]);

    const logs: LogEvent[] = [];
    const out = await runMarketMakerAgent({
      client,
      registry,
      tokenAddr: TOKEN_ADDR,
      loreEndpointUrl: LORE_URL,
      onLog: (e) => logs.push(e),
    });

    expect(out.decision).toBe('buy-lore');
    expect(out.loreFetch?.settlementTxHash).toBe(FAKE_TX);

    const policyWarn = logs.find(
      (e) => e.agent === 'market-maker' && e.tool === 'policy' && e.level === 'warn',
    );
    expect(policyWarn).toBeDefined();
    expect(policyWarn?.message).toMatch(/policy violation/i);
    expect(policyWarn?.meta).toMatchObject({
      decision: 'buy-lore',
      deployedOnChain: LOW_STATUS.deployedOnChain,
      bondingCurveProgress: LOW_STATUS.bondingCurveProgress,
      holderCount: LOW_STATUS.holderCount,
    });
    expect(typeof policyWarn?.meta?.reason).toBe('string');
  });

  it('rejects an invalid decision value in the final JSON', async () => {
    const registry = buildRegistry(HIGH_STATUS, LORE_FETCH_OUT);
    const { client } = fakeClient([
      toolUseResponse('m1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: TOKEN_ADDR } },
      ]),
      textResponse(JSON.stringify({ decision: 'yolo-pump', reason: 'invalid enum value' })),
    ]);

    await expect(
      runMarketMakerAgent({
        client,
        registry,
        tokenAddr: TOKEN_ADDR,
        loreEndpointUrl: LORE_URL,
      }),
    ).rejects.toThrow();
  });
});
