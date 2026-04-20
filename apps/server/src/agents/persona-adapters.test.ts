import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type {
  AgentTool,
  AnyAgentTool,
  AnyPersona,
  Artifact,
  LogEvent,
} from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { LoreStore } from '../state/lore-store.js';
import { creatorPersona } from './creator.js';
import { narratorPersona } from './narrator.js';
import { marketMakerPersona, shillerPersona } from './market-maker.js';
import { heartbeatPersona } from './heartbeat.js';
import {
  postShillForInputSchema,
  postShillForOutputSchema,
  type PostShillForInput,
  type PostShillForOutput,
} from '../tools/post-shill-for.js';
import {
  makeStreamingClient,
  msg,
  textStream,
  toolUseStream,
  type ScriptedStream,
} from './_test-client.js';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Persona adapter suite (Brain positioning, 2026-04-19). Each of the four
 * agents in `apps/server/src/agents/` now exports a `*Persona` constant that
 * satisfies `Persona<TInput, TOutput>` from
 * `packages/shared/src/persona.ts`. These tests lock in:
 *
 *   1. The shape of every exported persona (id / description / schemas /
 *      async run method) so a typo does not silently drift the pluggable
 *      contract.
 *   2. That `persona.run(input, ctx)` truly delegates to the existing
 *      `runXxxAgent(...)` entry point — we detect delegation by asserting
 *      the output payload matches what the runner produces for the same
 *      stubbed tool registry + Anthropic client.
 */

function fakeClient(scripts: ScriptedStream[]): {
  client: Anthropic;
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

// ─── Shape contract ─────────────────────────────────────────────────────────

function assertPersonaShape(p: AnyPersona, id: string): void {
  expect(p.id).toBe(id);
  expect(typeof p.description).toBe('string');
  expect(p.description.length).toBeGreaterThan(0);
  expect(p.inputSchema).toBeDefined();
  expect(typeof p.inputSchema.parse).toBe('function');
  expect(p.outputSchema).toBeDefined();
  expect(typeof p.outputSchema.parse).toBe('function');
  expect(typeof p.run).toBe('function');
}

describe('persona adapters — shape contract', () => {
  it('creatorPersona exposes the persona contract with id="creator"', () => {
    assertPersonaShape(creatorPersona as unknown as AnyPersona, 'creator');
  });

  it('narratorPersona exposes the persona contract with id="narrator"', () => {
    assertPersonaShape(narratorPersona as unknown as AnyPersona, 'narrator');
  });

  it('marketMakerPersona exposes the persona contract with id="market-maker"', () => {
    assertPersonaShape(marketMakerPersona as unknown as AnyPersona, 'market-maker');
  });

  it('shillerPersona exposes the persona contract with id="shiller"', () => {
    assertPersonaShape(shillerPersona as unknown as AnyPersona, 'shiller');
  });

  it('heartbeatPersona exposes the persona contract with id="heartbeat"', () => {
    assertPersonaShape(heartbeatPersona as unknown as AnyPersona, 'heartbeat');
  });
});

// ─── Delegation integration-lite ───────────────────────────────────────────

const CREATOR_TOKEN_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

function makeCreatorRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // Four tools the Creator prompt calls in order. Every one a stub.
  const narrativeTool: AgentTool<
    { theme: string },
    { name: string; symbol: string; description: string }
  > = {
    name: 'narrative_generator',
    description: 'stub narrative_generator',
    inputSchema: z.object({ theme: z.string() }),
    outputSchema: z.object({ name: z.string(), symbol: z.string(), description: z.string() }),
    execute: async () => ({ name: 'HBNB2026-Alpha', symbol: 'HBNB2026-ALP', description: 'test' }),
  };
  // Return the real ImageOutput shape (status + cid + gatewayUrl + prompt)
  // so creatorPersona.run can derive a `meme-image` artifact from the tool
  // trace. The agent loop still reads `imageLocalPath` for the downstream
  // onchain_deployer step; the extra fields are inert for the runner.
  const imageTool: AgentTool<
    { prompt: string },
    {
      imageLocalPath: string;
      status: 'ok';
      cid: string;
      gatewayUrl: string;
      prompt: string;
    }
  > = {
    name: 'meme_image_creator',
    description: 'stub meme_image_creator',
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({
      imageLocalPath: z.string(),
      status: z.literal('ok'),
      cid: z.string(),
      gatewayUrl: z.string().url(),
      prompt: z.string(),
    }),
    execute: async (input) => ({
      imageLocalPath: '/tmp/meme.png',
      status: 'ok' as const,
      cid: 'bafkreimemeimagecid123',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreimemeimagecid123',
      prompt: input.prompt,
    }),
  };
  const deployerTool: AgentTool<
    { name: string; symbol: string; description: string; imageLocalPath: string },
    { tokenAddr: string; txHash: string }
  > = {
    name: 'onchain_deployer',
    description: 'stub onchain_deployer',
    inputSchema: z.object({
      name: z.string(),
      symbol: z.string(),
      description: z.string(),
      imageLocalPath: z.string(),
    }),
    outputSchema: z.object({ tokenAddr: z.string(), txHash: z.string() }),
    execute: async () => ({
      tokenAddr: CREATOR_TOKEN_ADDR,
      txHash: '0x' + 'de'.repeat(32),
    }),
  };
  const loreTool: AgentTool<
    { tokenAddr: string; chapterText?: string },
    { ipfsHash: string; ipfsUri: string }
  > = {
    name: 'lore_writer',
    description: 'stub lore_writer',
    inputSchema: z.object({
      tokenAddr: z.string(),
      chapterText: z.string().optional(),
    }),
    outputSchema: z.object({ ipfsHash: z.string(), ipfsUri: z.string() }),
    execute: async () => ({
      ipfsHash: 'bafkrei-lore',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-lore',
    }),
  };
  registry.register(narrativeTool as unknown as AnyAgentTool);
  registry.register(imageTool as unknown as AnyAgentTool);
  registry.register(deployerTool as unknown as AnyAgentTool);
  registry.register(loreTool as unknown as AnyAgentTool);
  return registry;
}

describe('creatorPersona.run delegation', () => {
  it('delegates to runCreatorAgent and returns a creatorResultSchema-shaped payload', async () => {
    const registry = makeCreatorRegistry();
    const finalJson = JSON.stringify({
      tokenAddr: CREATOR_TOKEN_ADDR,
      tokenDeployTx: '0x' + 'de'.repeat(32),
      loreIpfsCid: 'bafkrei-lore',
      metadata: {
        name: 'HBNB2026-Alpha',
        symbol: 'HBNB2026-ALP',
        description: 'test',
        imageLocalPath: '/tmp/meme.png',
      },
    });
    const { client } = fakeClient([
      toolUseResponse('c1', [
        { id: 'tu_narr', name: 'narrative_generator', input: { theme: 'alpha' } },
      ]),
      toolUseResponse('c2', [
        { id: 'tu_img', name: 'meme_image_creator', input: { prompt: 'alpha meme' } },
      ]),
      toolUseResponse('c3', [
        {
          id: 'tu_dep',
          name: 'onchain_deployer',
          input: {
            name: 'HBNB2026-Alpha',
            symbol: 'HBNB2026-ALP',
            description: 'test',
            imageLocalPath: '/tmp/meme.png',
          },
        },
      ]),
      toolUseResponse('c4', [
        {
          id: 'tu_lore',
          name: 'lore_writer',
          input: { tokenAddr: CREATOR_TOKEN_ADDR, chapterText: 'ch1' },
        },
      ]),
      textResponse(finalJson),
    ]);

    const output = await creatorPersona.run({ theme: 'alpha' }, { client, registry });

    expect(output.tokenAddr).toBe(CREATOR_TOKEN_ADDR);
    expect(output.loreIpfsCid).toBe('bafkrei-lore');
    expect(output.metadata.symbol).toBe('HBNB2026-ALP');
  });

  it('emits a meme-image artifact via ctx.onArtifact from the meme_image_creator tool trace', async () => {
    // UAT fix (2026-04-20): the Brain-driven invoke_creator path was only
    // emitting 3 of the 4 expected artifacts (bsc-token + token-deploy-tx +
    // lore-cid) because the meme_image_creator tool output never reached the
    // artifact stream. `creatorPersona.run` is the correct seam — it has
    // access to `loop.toolCalls` from runCreatorAgent. This lock-in test
    // asserts that when the persona receives `onArtifact` on its context, a
    // `meme-image` artifact is emitted carrying the CID / gatewayUrl / prompt
    // from the most recent successful meme_image_creator call.
    const registry = makeCreatorRegistry();
    const finalJson = JSON.stringify({
      tokenAddr: CREATOR_TOKEN_ADDR,
      tokenDeployTx: '0x' + 'de'.repeat(32),
      loreIpfsCid: 'bafkrei-lore',
      metadata: {
        name: 'HBNB2026-Alpha',
        symbol: 'HBNB2026-ALP',
        description: 'test',
        imageLocalPath: '/tmp/meme.png',
      },
    });
    const { client } = fakeClient([
      toolUseResponse('c1', [
        { id: 'tu_narr', name: 'narrative_generator', input: { theme: 'alpha' } },
      ]),
      toolUseResponse('c2', [
        { id: 'tu_img', name: 'meme_image_creator', input: { prompt: 'alpha meme' } },
      ]),
      toolUseResponse('c3', [
        {
          id: 'tu_dep',
          name: 'onchain_deployer',
          input: {
            name: 'HBNB2026-Alpha',
            symbol: 'HBNB2026-ALP',
            description: 'test',
            imageLocalPath: '/tmp/meme.png',
          },
        },
      ]),
      toolUseResponse('c4', [
        {
          id: 'tu_lore',
          name: 'lore_writer',
          input: { tokenAddr: CREATOR_TOKEN_ADDR, chapterText: 'ch1' },
        },
      ]),
      textResponse(finalJson),
    ]);

    const onArtifact = vi.fn<(a: Artifact) => void>();
    await creatorPersona.run({ theme: 'alpha' }, { client, registry, onArtifact });

    const memeImageCalls = onArtifact.mock.calls.filter((c) => c[0].kind === 'meme-image');
    expect(memeImageCalls).toHaveLength(1);
    const artifact = memeImageCalls[0]![0];
    expect(artifact).toMatchObject({
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafkreimemeimagecid123',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreimemeimagecid123',
      prompt: 'alpha meme',
    });
  });
});

// ─── Narrator ──────────────────────────────────────────────────────────────

const NARRATOR_TOKEN_ADDR = '0x2222222222222222222222222222222222222222';

describe('narratorPersona.run delegation', () => {
  it('delegates to runNarratorAgent, upserts the chapter, and returns the canonical shape', async () => {
    const extendLoreTool: AgentTool<
      { tokenAddr: string; tokenName: string; tokenSymbol: string },
      { chapterNumber: number; chapterText: string; ipfsHash: string; ipfsUri: string }
    > = {
      name: 'extend_lore',
      description: 'stub extend_lore for persona delegation test',
      inputSchema: z.object({
        tokenAddr: z.string(),
        tokenName: z.string(),
        tokenSymbol: z.string(),
        previousChapters: z.array(z.string()).optional(),
        targetChapterNumber: z.number().optional(),
      }) as unknown as z.ZodType<{ tokenAddr: string; tokenName: string; tokenSymbol: string }>,
      outputSchema: z.object({
        chapterNumber: z.number(),
        chapterText: z.string(),
        ipfsHash: z.string(),
        ipfsUri: z.string(),
      }),
      execute: async () => ({
        chapterNumber: 1,
        chapterText: 'first chapter body',
        ipfsHash: 'bafkrei-ch1',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      }),
    };
    const registry = new ToolRegistry();
    registry.register(extendLoreTool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('n1', [
        {
          id: 'tu_ext',
          name: 'extend_lore',
          input: {
            tokenAddr: NARRATOR_TOKEN_ADDR,
            tokenName: 'Alpha',
            tokenSymbol: 'ALP',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textResponse('ok'),
    ]);

    const output = await narratorPersona.run(
      {
        tokenAddr: NARRATOR_TOKEN_ADDR,
        tokenName: 'Alpha',
        tokenSymbol: 'ALP',
      },
      { client, registry, store },
    );

    expect(output.chapterNumber).toBe(1);
    expect(output.ipfsHash).toBe('bafkrei-ch1');
    expect((await store.getLatest(NARRATOR_TOKEN_ADDR))?.chapterNumber).toBe(1);
  });
});

// ─── Market-maker (a2a persona) ────────────────────────────────────────────

const MM_TOKEN_ADDR = '0x3333333333333333333333333333333333333333';
const LORE_URL = `http://localhost:4000/lore/${MM_TOKEN_ADDR}`;
const FAKE_TX = '0x' + 'ab'.repeat(32);

describe('marketMakerPersona.run delegation', () => {
  it('delegates to runMarketMakerAgent and returns a skip decision grounded in on-chain state', async () => {
    const statusTool: AgentTool<
      { tokenAddr: string },
      {
        tokenAddr: string;
        deployedOnChain: boolean;
        holderCount: number;
        bondingCurveProgress: number | null;
        volume24hBnb: number | null;
        marketCapBnb: number | null;
        inspectedAtBlock: string;
        warnings: string[];
      }
    > = {
      name: 'check_token_status',
      description: 'stub check_token_status',
      inputSchema: z.object({ tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }),
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
      execute: async () => ({
        tokenAddr: MM_TOKEN_ADDR,
        deployedOnChain: false,
        holderCount: 0,
        bondingCurveProgress: 0,
        volume24hBnb: null,
        marketCapBnb: 0,
        inspectedAtBlock: '100000',
        warnings: [],
      }),
    };
    const fetchTool: AgentTool<
      { url: string },
      {
        body: Record<string, unknown>;
        settlementTxHash: string;
        network: string;
        baseSepoliaExplorerUrl: string;
      }
    > = {
      name: 'x402_fetch_lore',
      description: 'stub x402_fetch_lore',
      inputSchema: z.object({ url: z.string().url() }),
      outputSchema: z.object({
        body: z.record(z.unknown()),
        settlementTxHash: z.string(),
        network: z.string(),
        baseSepoliaExplorerUrl: z.string().url(),
      }),
      execute: async () => ({
        body: { chapter: 1 },
        settlementTxHash: FAKE_TX,
        network: 'eip155:84532',
        baseSepoliaExplorerUrl: `https://sepolia.basescan.org/tx/${FAKE_TX}`,
      }),
    };
    const registry = new ToolRegistry();
    registry.register(statusTool as unknown as AnyAgentTool);
    registry.register(fetchTool as unknown as AnyAgentTool);

    const { client } = fakeClient([
      toolUseResponse('mm1', [
        { id: 'tu_status', name: 'check_token_status', input: { tokenAddr: MM_TOKEN_ADDR } },
      ]),
      textResponse(JSON.stringify({ decision: 'skip', reason: 'not deployed' })),
    ]);

    const output = await marketMakerPersona.run(
      { tokenAddr: MM_TOKEN_ADDR, loreEndpointUrl: LORE_URL },
      { client, registry },
    );

    expect(output.decision).toBe('skip');
    expect(output.tokenStatus.deployedOnChain).toBe(false);
    expect(output.toolCalls.map((c) => c.name)).toEqual(['check_token_status']);
  });
});

// ─── Shiller ───────────────────────────────────────────────────────────────

describe('shillerPersona.run delegation', () => {
  it('delegates to runShillerAgent and returns a shill decision on tool success', async () => {
    const executeSpy = vi.fn(
      async (input: PostShillForInput): Promise<PostShillForOutput> => ({
        orderId: input.orderId,
        tokenAddr: input.tokenAddr,
        tweetId: 'tid-delegation',
        tweetUrl: 'https://x.com/shiller/status/tid-delegation',
        tweetText: `$ALP lore reads like a dream`,
        postedAt: '2026-04-19T00:00:00.000Z',
      }),
    );
    const postShillForTool: AgentTool<PostShillForInput, PostShillForOutput> = {
      name: 'post_shill_for',
      description: 'stub post_shill_for',
      inputSchema: postShillForInputSchema,
      outputSchema: postShillForOutputSchema,
      execute: executeSpy,
    };

    // Shiller persona does not need client/registry from the ctx — but the
    // Persona interface requires them for shape consistency. Supply empty
    // stubs; the run method routes to the DI-style `postShillForTool` on the
    // input instead.
    const output = await shillerPersona.run(
      {
        postShillForTool,
        orderId: 'order-delegation',
        tokenAddr: '0x4444444444444444444444444444444444444444',
        tokenSymbol: 'ALP',
        loreSnippet: 'a curious tale',
      },
      { client: {} as unknown as Anthropic, registry: new ToolRegistry() },
    );

    expect(output.decision).toBe('shill');
    expect(output.tweetId).toBe('tid-delegation');
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Heartbeat ─────────────────────────────────────────────────────────────

describe('heartbeatPersona.run delegation', () => {
  it('delegates to HeartbeatAgent, ticks once, and returns a state snapshot', async () => {
    // Stub the underlying runAgentLoop so the persona run does not hit any
    // real runtime. HeartbeatAgent already has a `runAgentLoopImpl` seam —
    // the adapter must thread it through.
    const runAgentLoopImpl = vi.fn(async () => ({
      finalText: 'ok',
      toolCalls: [],
      trace: [],
      stopReason: 'end_turn' as const,
    }));
    const logs: LogEvent[] = [];

    const output = await heartbeatPersona.run(
      {
        model: 'test-model',
        systemPrompt: 'heartbeat system prompt',
        buildUserInput: ({ tickId }) => `tick ${tickId}`,
        intervalMs: 1000,
        runAgentLoopImpl,
        onLog: (e) => logs.push(e),
      },
      { client: {} as unknown as Anthropic, registry: new ToolRegistry() },
    );

    expect(runAgentLoopImpl).toHaveBeenCalledTimes(1);
    expect(output.successCount).toBe(1);
    expect(output.errorCount).toBe(0);
    expect(output.lastTickId).toMatch(/^tick_/);
    // msg helper is imported to satisfy the test-client contract; keep the
    // reference alive so tree-shaking doesn't flag an unused import.
    void msg;
  });
});
