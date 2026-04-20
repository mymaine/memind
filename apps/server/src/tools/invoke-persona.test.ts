import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  AgentTool,
  Artifact,
  CreatorResult,
  LogEvent,
  Persona,
  PersonaRunContext,
} from '@hack-fourmeme/shared';
import { ToolRegistry } from './registry.js';
import {
  createInvokeCreatorTool,
  createInvokeNarratorTool,
  createInvokeShillerTool,
  createInvokeHeartbeatTickTool,
  createListHeartbeatsTool,
  createStopHeartbeatTool,
  INVOKE_CREATOR_TOOL_NAME,
  INVOKE_NARRATOR_TOOL_NAME,
  INVOKE_SHILLER_TOOL_NAME,
  INVOKE_HEARTBEAT_TICK_TOOL_NAME,
  LIST_HEARTBEATS_TOOL_NAME,
  STOP_HEARTBEAT_TOOL_NAME,
} from './invoke-persona.js';
import {
  HeartbeatSessionStore,
  type HeartbeatTickDelta,
} from '../state/heartbeat-session-store.js';
import type { CreatorPersonaInput } from '../agents/creator.js';
import type { NarratorPersonaInput, NarratorPersonaOutput } from '../agents/narrator.js';
import type { ShillerPersonaInput, ShillerPersonaOutput } from '../agents/market-maker.js';
import type { HeartbeatPersonaInput, HeartbeatPersonaOutput } from '../agents/heartbeat.js';
import {
  postShillForInputSchema,
  postShillForOutputSchema,
  type PostShillForInput,
  type PostShillForOutput,
} from './post-shill-for.js';

/**
 * Brain meta-agent persona-invoke tools (BRAIN-P2). Four thin factory helpers
 * expose each persona adapter as an `AgentTool<TInput, TOutput>` so the Brain
 * agent loop can dispatch them like any other registered tool. The factories
 * take explicit dependencies (persona adapter + runtime context + per-persona
 * enrichers) and return a ready-to-register tool — the orchestrator supplies
 * the enrichers from run-level state. Tests stub the enrichers so persona
 * internals never run.
 */

// ─── Shared fixtures ────────────────────────────────────────────────────────

const FAKE_TOKEN_ADDR = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
const FAKE_TX = '0x' + 'cd'.repeat(32);

function fakeClient(): Anthropic {
  return {} as unknown as Anthropic;
}

function fakeRegistry(): ToolRegistry {
  return new ToolRegistry();
}

function fakePostShillForTool(
  overrides: Partial<PostShillForOutput> = {},
): AgentTool<PostShillForInput, PostShillForOutput> {
  return {
    name: 'post_shill_for',
    description: 'stub post_shill_for',
    inputSchema: postShillForInputSchema,
    outputSchema: postShillForOutputSchema,
    execute: vi.fn(
      async (input): Promise<PostShillForOutput> => ({
        orderId: input.orderId,
        tokenAddr: input.tokenAddr,
        tweetId: 'tid-stub',
        tweetUrl: 'https://x.com/stub/status/tid-stub',
        tweetText: 'stub tweet',
        postedAt: '2026-04-19T00:00:00.000Z',
        ...overrides,
      }),
    ),
  };
}

// ─── invoke_creator ─────────────────────────────────────────────────────────

describe('createInvokeCreatorTool', () => {
  function makeCreatorPersona(
    run: (input: CreatorPersonaInput, ctx: PersonaRunContext) => Promise<CreatorResult>,
  ): Persona<CreatorPersonaInput, CreatorResult> {
    return {
      id: 'creator',
      description: 'stub creator',
      inputSchema: z.object({
        theme: z.string().min(1),
        model: z.string().optional(),
        maxTurns: z.number().int().positive().optional(),
      }) as unknown as z.ZodType<CreatorPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<CreatorResult>,
      run,
    };
  }

  it('accepts a valid {theme} input and rejects malformed inputs', () => {
    const persona = makeCreatorPersona(async () => ({
      tokenAddr: FAKE_TOKEN_ADDR,
      tokenDeployTx: FAKE_TX,
      loreIpfsCid: 'bafkrei-stub',
      metadata: {
        name: 'HBNB2026-X',
        symbol: 'HBNB2026-X',
        description: 'stub',
        imageLocalPath: '/tmp/x.png',
      },
    }));
    const tool = createInvokeCreatorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
    });

    expect(tool.name).toBe(INVOKE_CREATOR_TOOL_NAME);
    expect(tool.name).toBe('invoke_creator');
    expect(() => tool.inputSchema.parse({ theme: 'BNB Chain 2026 growth' })).not.toThrow();
    // theme too short (<3 chars) — Brain systemPrompt advertises min length 3.
    expect(() => tool.inputSchema.parse({ theme: 'a' })).toThrow();
    // missing theme entirely
    expect(() => tool.inputSchema.parse({})).toThrow();
  });

  it('forwards {theme} to creatorPersona.run and returns its output verbatim', async () => {
    const run = vi.fn(
      async (_input: CreatorPersonaInput, _ctx: PersonaRunContext): Promise<CreatorResult> => ({
        tokenAddr: FAKE_TOKEN_ADDR,
        tokenDeployTx: FAKE_TX,
        loreIpfsCid: 'bafkrei-out',
        metadata: {
          name: 'HBNB2026-Alpha',
          symbol: 'HBNB2026-ALP',
          description: 'test',
          imageLocalPath: '/tmp/alpha.png',
        },
      }),
    );
    const persona = makeCreatorPersona(run);
    const client = fakeClient();
    const registry = fakeRegistry();
    const tool = createInvokeCreatorTool({ persona, client, registry });

    const output = await tool.execute({ theme: 'BNB Chain 2026 growth' });

    expect(run).toHaveBeenCalledTimes(1);
    const [input, ctx] = run.mock.calls[0]!;
    expect(input).toEqual({ theme: 'BNB Chain 2026 growth' });
    expect(ctx.client).toBe(client);
    expect(ctx.registry).toBe(registry);
    expect(output.tokenAddr).toBe(FAKE_TOKEN_ADDR);
    expect(output.loreIpfsCid).toBe('bafkrei-out');
  });

  it('emits entry + exit logs and threads event callbacks through ctx', async () => {
    const run = vi.fn(
      async (_input: CreatorPersonaInput, _ctx: PersonaRunContext): Promise<CreatorResult> => ({
        tokenAddr: FAKE_TOKEN_ADDR,
        tokenDeployTx: FAKE_TX,
        loreIpfsCid: 'bafkrei-xyz',
        metadata: {
          name: 'HBNB2026-B',
          symbol: 'HBNB2026-B',
          description: 'b',
          imageLocalPath: '/tmp/b.png',
        },
      }),
    );
    const persona = makeCreatorPersona(run);
    const onLog = vi.fn<(event: LogEvent) => void>();
    const onArtifact = vi.fn<(artifact: Artifact) => void>();
    const onToolUseStart = vi.fn();
    const onToolUseEnd = vi.fn();
    const onAssistantDelta = vi.fn();

    const tool = createInvokeCreatorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      onLog,
      onArtifact,
      onToolUseStart,
      onToolUseEnd,
      onAssistantDelta,
    });

    await tool.execute({ theme: 'BNB Chain 2026 growth' });

    // Entry + exit logs both emitted under agent='creator'.
    expect(onLog).toHaveBeenCalled();
    const logMessages = onLog.mock.calls.map((c) => c[0].message);
    expect(logMessages.some((m) => m.includes('starting'))).toBe(true);
    expect(logMessages.some((m) => m.includes('finished'))).toBe(true);
    onLog.mock.calls.forEach((call) => expect(call[0].agent).toBe('creator'));

    // ctx must carry the event callbacks so persona.run → runAgentLoop can
    // read them off PersonaRunContext.
    const [, ctx] = run.mock.calls[0]!;
    expect(ctx.onLog).toBe(onLog);
    expect(ctx.onArtifact).toBe(onArtifact);
    expect(ctx.onToolUseStart).toBe(onToolUseStart);
    expect(ctx.onToolUseEnd).toBe(onToolUseEnd);
    expect(ctx.onAssistantDelta).toBe(onAssistantDelta);
  });

  it('emits bsc-token + token-deploy-tx + lore-cid artifacts from the persona result', async () => {
    const run = async (): Promise<CreatorResult> => ({
      tokenAddr: FAKE_TOKEN_ADDR,
      tokenDeployTx: FAKE_TX,
      loreIpfsCid: 'bafkrei-result',
      metadata: {
        name: 'HBNB2026-R',
        symbol: 'HBNB2026-R',
        description: 'r',
        imageLocalPath: '/tmp/r.png',
      },
    });
    const persona = makeCreatorPersona(run);
    const onArtifact = vi.fn<(artifact: Artifact) => void>();
    const tool = createInvokeCreatorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      onArtifact,
    });

    await tool.execute({ theme: 'theme' });

    const kinds = onArtifact.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('bsc-token');
    expect(kinds).toContain('token-deploy-tx');
    expect(kinds).toContain('lore-cid');

    const bscToken = onArtifact.mock.calls.find((c) => c[0].kind === 'bsc-token')?.[0];
    expect(bscToken).toMatchObject({
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: FAKE_TOKEN_ADDR,
    });
    const deployTx = onArtifact.mock.calls.find((c) => c[0].kind === 'token-deploy-tx')?.[0];
    expect(deployTx).toMatchObject({
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash: FAKE_TX,
    });
    const loreCid = onArtifact.mock.calls.find((c) => c[0].kind === 'lore-cid')?.[0];
    expect(loreCid).toMatchObject({
      kind: 'lore-cid',
      cid: 'bafkrei-result',
      author: 'creator',
    });
  });

  it('forwards meme-image artifacts the persona emits through ctx.onArtifact (UAT 2026-04-20)', async () => {
    // UAT fix: the meme-image artifact is emitted from inside
    // creatorPersona.run (which has access to `loop.toolCalls`), not from
    // the invoke_creator wrapper. This test locks in that ctx.onArtifact is
    // threaded through so persona-side emissions land on the Brain run's
    // artifact stream alongside the three result-derived pills. Combined
    // with the existing bsc-token + token-deploy-tx + lore-cid assertions,
    // this proves the 4-artifact contract end to end.
    const run = async (
      _input: CreatorPersonaInput,
      ctx: PersonaRunContext,
    ): Promise<CreatorResult> => {
      const onArtifact = ctx.onArtifact as ((a: Artifact) => void) | undefined;
      onArtifact?.({
        kind: 'meme-image',
        status: 'ok',
        cid: 'bafkreimemeimagecid999',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreimemeimagecid999',
        prompt: 'stub meme prompt',
      });
      return {
        tokenAddr: FAKE_TOKEN_ADDR,
        tokenDeployTx: FAKE_TX,
        loreIpfsCid: 'bafkrei-mem',
        metadata: {
          name: 'HBNB2026-M',
          symbol: 'HBNB2026-M',
          description: 'mem',
          imageLocalPath: '/tmp/m.png',
        },
      };
    };
    const persona = makeCreatorPersona(run);
    const onArtifact = vi.fn<(artifact: Artifact) => void>();
    const tool = createInvokeCreatorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      onArtifact,
    });

    await tool.execute({ theme: 'any theme' });

    const kinds = onArtifact.mock.calls.map((c) => c[0].kind);
    // 4 artifacts total: the three invoke_creator derives from the result +
    // the one creatorPersona emits from the meme_image_creator tool trace.
    expect(onArtifact).toHaveBeenCalledTimes(4);
    expect(kinds).toContain('bsc-token');
    expect(kinds).toContain('token-deploy-tx');
    expect(kinds).toContain('lore-cid');
    expect(kinds).toContain('meme-image');
    const memeImage = onArtifact.mock.calls.find((c) => c[0].kind === 'meme-image')?.[0];
    expect(memeImage).toMatchObject({
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafkreimemeimagecid999',
      prompt: 'stub meme prompt',
    });
  });

  it('emits an error log and rethrows when the persona run fails', async () => {
    const persona = makeCreatorPersona(async () => {
      throw new Error('boom');
    });
    const onLog = vi.fn<(event: LogEvent) => void>();
    const tool = createInvokeCreatorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      onLog,
    });

    await expect(tool.execute({ theme: 'will fail' })).rejects.toThrow('boom');
    const errorLogs = onLog.mock.calls.filter((c) => c[0].level === 'error');
    expect(errorLogs.length).toBeGreaterThanOrEqual(1);
    expect(errorLogs[0]![0].message).toContain('boom');
  });
});

// ─── invoke_narrator ────────────────────────────────────────────────────────

describe('createInvokeNarratorTool', () => {
  function makeNarratorPersona(
    run: (input: NarratorPersonaInput, ctx: PersonaRunContext) => Promise<NarratorPersonaOutput>,
  ): Persona<NarratorPersonaInput, NarratorPersonaOutput> {
    return {
      id: 'narrator',
      description: 'stub narrator',
      inputSchema: z.any() as unknown as z.ZodType<NarratorPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<NarratorPersonaOutput>,
      run,
    };
  }

  it('accepts a valid 0x-prefixed tokenAddr and rejects invalid shapes', () => {
    const persona = makeNarratorPersona(async () => ({
      tokenAddr: FAKE_TOKEN_ADDR,
      chapterNumber: 2,
      ipfsHash: 'bafkrei-ch2',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch2',
      chapterText: 'ch2 body',
    }));
    const tool = createInvokeNarratorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      store: undefined as unknown as never,
      resolveTokenMeta: () => ({ tokenName: 'HBNB2026-X', tokenSymbol: 'HBNB2026-X' }),
    });

    expect(tool.name).toBe(INVOKE_NARRATOR_TOOL_NAME);
    expect(tool.name).toBe('invoke_narrator');
    expect(() => tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR })).not.toThrow();
    expect(() => tool.inputSchema.parse({ tokenAddr: '0xNOTAHEXADDR' })).toThrow();
    expect(() => tool.inputSchema.parse({})).toThrow();
  });

  it('enriches input from resolveTokenMeta and delegates to narratorPersona.run', async () => {
    const run = vi.fn(
      async (
        _input: NarratorPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<NarratorPersonaOutput> => ({
        tokenAddr: FAKE_TOKEN_ADDR,
        chapterNumber: 3,
        ipfsHash: 'bafkrei-ch3',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch3',
        chapterText: 'ch3 body',
      }),
    );
    const persona = makeNarratorPersona(run);
    const client = fakeClient();
    const registry = fakeRegistry();
    const fakeStore = { __brand: 'LoreStore' } as unknown as never;
    const resolveTokenMeta = vi.fn(() => ({
      tokenName: 'HBNB2026-Alpha',
      tokenSymbol: 'HBNB2026-ALP',
      previousChapters: ['ch1', 'ch2'],
    }));

    const tool = createInvokeNarratorTool({
      persona,
      client,
      registry,
      store: fakeStore,
      resolveTokenMeta,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    expect(resolveTokenMeta).toHaveBeenCalledWith(FAKE_TOKEN_ADDR);
    expect(run).toHaveBeenCalledTimes(1);
    const [input, ctx] = run.mock.calls[0]!;
    expect(input.tokenAddr).toBe(FAKE_TOKEN_ADDR);
    expect(input.tokenName).toBe('HBNB2026-Alpha');
    expect(input.tokenSymbol).toBe('HBNB2026-ALP');
    expect(input.previousChapters).toEqual(['ch1', 'ch2']);
    expect(ctx.client).toBe(client);
    expect(ctx.registry).toBe(registry);
    expect(ctx.store).toBe(fakeStore);
    expect(output.chapterNumber).toBe(3);
  });

  it('emits entry/exit logs, a lore-cid artifact, and threads ctx callbacks', async () => {
    const run = vi.fn(
      async (
        _input: NarratorPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<NarratorPersonaOutput> => ({
        tokenAddr: FAKE_TOKEN_ADDR,
        chapterNumber: 2,
        ipfsHash: 'bafkrei-narrator',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-narrator',
        chapterText: 'ch2',
      }),
    );
    const persona = makeNarratorPersona(run);
    const onLog = vi.fn<(event: LogEvent) => void>();
    const onArtifact = vi.fn<(artifact: Artifact) => void>();
    const onToolUseStart = vi.fn();
    const onToolUseEnd = vi.fn();
    const onAssistantDelta = vi.fn();

    const tool = createInvokeNarratorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      store: { __brand: 'LoreStore' } as unknown as never,
      resolveTokenMeta: () => ({ tokenName: 'N', tokenSymbol: 'N' }),
      onLog,
      onArtifact,
      onToolUseStart,
      onToolUseEnd,
      onAssistantDelta,
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    // Entry + exit logs.
    const logMessages = onLog.mock.calls.map((c) => c[0].message);
    expect(logMessages.some((m) => m.includes('starting'))).toBe(true);
    expect(logMessages.some((m) => m.includes('finished'))).toBe(true);
    onLog.mock.calls.forEach((call) => expect(call[0].agent).toBe('narrator'));

    // lore-cid artifact with author='narrator' + chapterNumber.
    const loreCid = onArtifact.mock.calls.find((c) => c[0].kind === 'lore-cid')?.[0];
    expect(loreCid).toMatchObject({
      kind: 'lore-cid',
      cid: 'bafkrei-narrator',
      author: 'narrator',
      chapterNumber: 2,
    });

    // ctx carries all callbacks.
    const [, ctx] = run.mock.calls[0]!;
    expect(ctx.onLog).toBe(onLog);
    expect(ctx.onArtifact).toBe(onArtifact);
    expect(ctx.onToolUseStart).toBe(onToolUseStart);
    expect(ctx.onToolUseEnd).toBe(onToolUseEnd);
    expect(ctx.onAssistantDelta).toBe(onAssistantDelta);
  });
});

// ─── invoke_shiller ─────────────────────────────────────────────────────────

describe('createInvokeShillerTool', () => {
  function makeShillerPersona(
    run: (input: ShillerPersonaInput, ctx: PersonaRunContext) => Promise<ShillerPersonaOutput>,
  ): Persona<ShillerPersonaInput, ShillerPersonaOutput> {
    return {
      id: 'shiller',
      description: 'stub shiller',
      inputSchema: z.any() as unknown as z.ZodType<ShillerPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<ShillerPersonaOutput>,
      run,
    };
  }

  it('accepts {tokenAddr} (brief optional) and rejects malformed addresses', () => {
    const persona = makeShillerPersona(async () => ({
      orderId: 'order-x',
      tokenAddr: FAKE_TOKEN_ADDR,
      decision: 'shill',
      tweetId: 'tid-x',
      tweetUrl: 'https://x.com/stub/status/tid-x',
      tweetText: 'stub',
      postedAt: '2026-04-19T00:00:00.000Z',
      toolCalls: [],
    }));
    const tool = createInvokeShillerTool({
      persona,
      postShillForTool: fakePostShillForTool(),
      resolveOrder: () => ({ orderId: 'order-x', loreSnippet: 'snippet' }),
    });

    expect(tool.name).toBe(INVOKE_SHILLER_TOOL_NAME);
    expect(tool.name).toBe('invoke_shiller');
    expect(() => tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR })).not.toThrow();
    expect(() =>
      tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR, brief: 'pls shill' }),
    ).not.toThrow();
    expect(() => tool.inputSchema.parse({ tokenAddr: 'not-an-addr' })).toThrow();
  });

  it('enriches with resolveOrder + threads postShillForTool to shillerPersona.run', async () => {
    const run = vi.fn(
      async (
        _input: ShillerPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<ShillerPersonaOutput> => ({
        orderId: 'order-42',
        tokenAddr: FAKE_TOKEN_ADDR,
        decision: 'shill',
        tweetId: 'tid-42',
        tweetUrl: 'https://x.com/stub/status/tid-42',
        tweetText: 'curious tale of HBNB',
        postedAt: '2026-04-19T01:00:00.000Z',
        toolCalls: [],
      }),
    );
    const persona = makeShillerPersona(run);
    const postShillForTool = fakePostShillForTool();
    const resolveOrder = vi.fn(() => ({
      orderId: 'order-42',
      loreSnippet: 'a whispered lore chapter',
      tokenSymbol: 'HBNB2026-ALP',
    }));

    const tool = createInvokeShillerTool({
      persona,
      postShillForTool,
      resolveOrder,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR, brief: 'please hype' });

    expect(resolveOrder).toHaveBeenCalledWith(FAKE_TOKEN_ADDR, 'please hype');
    expect(run).toHaveBeenCalledTimes(1);
    const [input] = run.mock.calls[0]!;
    expect(input.orderId).toBe('order-42');
    expect(input.tokenAddr).toBe(FAKE_TOKEN_ADDR);
    expect(input.loreSnippet).toBe('a whispered lore chapter');
    expect(input.tokenSymbol).toBe('HBNB2026-ALP');
    expect(input.creatorBrief).toBe('please hype');
    expect(input.postShillForTool).toBe(postShillForTool);
    expect(output.decision).toBe('shill');
    expect(output.tweetId).toBe('tid-42');
  });

  it('emits entry/exit logs, a tweet-url artifact on shill, and threads ctx callbacks', async () => {
    const run = vi.fn(
      async (
        _input: ShillerPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<ShillerPersonaOutput> => ({
        orderId: 'order-z',
        tokenAddr: FAKE_TOKEN_ADDR,
        decision: 'shill',
        tweetId: 'tid-z',
        tweetUrl: 'https://x.com/stub/status/tid-z',
        tweetText: 'z',
        postedAt: '2026-04-19T00:00:00.000Z',
        toolCalls: [],
      }),
    );
    const persona = makeShillerPersona(run);
    const onLog = vi.fn<(event: LogEvent) => void>();
    const onArtifact = vi.fn<(artifact: Artifact) => void>();

    const tool = createInvokeShillerTool({
      persona,
      postShillForTool: fakePostShillForTool(),
      resolveOrder: () => ({ orderId: 'order-z', loreSnippet: 'snip' }),
      onLog,
      onArtifact,
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    const logMessages = onLog.mock.calls.map((c) => c[0].message);
    expect(logMessages.some((m) => m.includes('starting'))).toBe(true);
    expect(logMessages.some((m) => m.includes('finished'))).toBe(true);
    onLog.mock.calls.forEach((call) => expect(call[0].agent).toBe('shiller'));

    const tweetUrl = onArtifact.mock.calls.find((c) => c[0].kind === 'tweet-url')?.[0];
    expect(tweetUrl).toMatchObject({
      kind: 'tweet-url',
      url: 'https://x.com/stub/status/tid-z',
      tweetId: 'tid-z',
    });

    // ctx carries onLog so runShillerAgent's [shill mode] logs flow through.
    const [, ctx] = run.mock.calls[0]!;
    expect(ctx.onLog).toBe(onLog);
  });

  it('does NOT emit a tweet-url artifact when the persona decides to skip', async () => {
    const persona = makeShillerPersona(async () => ({
      orderId: 'order-q',
      tokenAddr: FAKE_TOKEN_ADDR,
      decision: 'skip',
      toolCalls: [],
      errorMessage: 'guard-exhausted',
    }));
    const onArtifact = vi.fn<(artifact: Artifact) => void>();

    const tool = createInvokeShillerTool({
      persona,
      postShillForTool: fakePostShillForTool(),
      resolveOrder: () => ({ orderId: 'order-q', loreSnippet: 's' }),
      onArtifact,
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    const kinds = onArtifact.mock.calls.map((c) => c[0].kind);
    expect(kinds).not.toContain('tweet-url');
  });
});

// ─── invoke_heartbeat_tick ──────────────────────────────────────────────────

describe('createInvokeHeartbeatTickTool', () => {
  function makeHeartbeatPersona(
    run: (input: HeartbeatPersonaInput, ctx: PersonaRunContext) => Promise<HeartbeatPersonaOutput>,
  ): Persona<HeartbeatPersonaInput, HeartbeatPersonaOutput> {
    return {
      id: 'heartbeat',
      description: 'stub heartbeat',
      inputSchema: z.any() as unknown as z.ZodType<HeartbeatPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<HeartbeatPersonaOutput>,
      run,
    };
  }

  it('accepts {tokenAddr, intervalMs?} and rejects invalid addresses / intervals', () => {
    const persona = makeHeartbeatPersona(async () => ({
      lastTickAt: null,
      lastTickId: null,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      lastError: null,
      lastDecision: null,
    }));
    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'test-model',
      systemPrompt: 'heartbeat system prompt',
      buildUserInput: ({ tickId }) => `tick ${tickId}`,
      sessionStore: new HeartbeatSessionStore(),
    });

    expect(tool.name).toBe(INVOKE_HEARTBEAT_TICK_TOOL_NAME);
    expect(tool.name).toBe('invoke_heartbeat_tick');
    expect(() => tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR })).not.toThrow();
    expect(() =>
      tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR, intervalMs: 5000 }),
    ).not.toThrow();
    expect(() => tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR, intervalMs: -5 })).toThrow();
    expect(() => tool.inputSchema.parse({ tokenAddr: 'nope' })).toThrow();
  });

  it('one-shot mode: no session + no intervalMs → runs exactly one tick and returns mode=one-shot', async () => {
    const run = vi.fn(
      async (
        _input: HeartbeatPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => ({
        lastTickAt: '2026-04-19T00:00:00.000Z',
        lastTickId: 'tick_abc',
        successCount: 1,
        errorCount: 0,
        skippedCount: 0,
        lastError: null,
        lastDecision: null,
      }),
    );
    const persona = makeHeartbeatPersona(run);
    const client = fakeClient();
    const registry = fakeRegistry();
    const buildUserInput = vi.fn(({ tickId }: { tickId: string }) => `tick ${tickId}`);
    const sessionStore = new HeartbeatSessionStore();

    const tool = createInvokeHeartbeatTickTool({
      persona,
      client,
      registry,
      model: 'test-model',
      systemPrompt: 'HB system prompt',
      buildUserInput,
      sessionStore,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    expect(run).toHaveBeenCalledTimes(1);
    expect(output.mode).toBe('one-shot');
    expect(output.running).toBe(false);
    expect(output.successCount).toBe(1);
    expect(output.lastTickId).toBe('tick_abc');
    // No session created.
    expect(await sessionStore.get(FAKE_TOKEN_ADDR)).toBeUndefined();
  });

  // Regression — without this, the heartbeat LLM never sees which token it is
  // supposed to operate on and hallucinates a random address to feed
  // check_token_status, producing bogus "Token contract not deployed" reports
  // on clearly-deployed tokens.
  it('threads tokenAddr into the persona buildUserInput so the LLM never has to guess it', async () => {
    let capturedBuildUserInput: ((ctx: { tickId: string; tickAt: string }) => string) | undefined;
    const run = vi.fn(
      async (
        input: HeartbeatPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => {
        capturedBuildUserInput = input.buildUserInput as (ctx: {
          tickId: string;
          tickAt: string;
        }) => string;
        return {
          lastTickAt: '2026-04-19T00:00:00.000Z',
          lastTickId: 'tick_ok',
          successCount: 1,
          errorCount: 0,
          skippedCount: 0,
          lastError: null,
          lastDecision: null,
        };
      },
    );
    const persona = makeHeartbeatPersona(run);
    const buildUserInput = ({ tickId }: { tickId: string }): string => `tick ${tickId}`;
    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'test-model',
      systemPrompt: 'HB system prompt',
      buildUserInput,
      sessionStore: new HeartbeatSessionStore(),
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    expect(capturedBuildUserInput).toBeDefined();
    const built = capturedBuildUserInput!({
      tickId: 'tick_1',
      tickAt: '2026-04-20T00:00:00.000Z',
    });
    // Address must appear verbatim so the LLM pipes it into
    // check_token_status / post_to_x / extend_lore instead of guessing.
    expect(built).toContain(FAKE_TOKEN_ADDR);
    // The original caller-supplied line is still present so existing
    // prompt content (tickId anchoring etc.) is not lost.
    expect(built).toContain('tick tick_1');
  });

  it('background-started mode: no session + intervalMs → start session and run one immediate tick', async () => {
    const run = vi.fn(
      async (
        _input: HeartbeatPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => ({
        lastTickAt: '2026-04-19T00:00:00.000Z',
        lastTickId: 'tick_started',
        successCount: 1,
        errorCount: 0,
        skippedCount: 0,
        lastError: null,
        lastDecision: null,
      }),
    );
    const persona = makeHeartbeatPersona(run);
    const sessionStore = new HeartbeatSessionStore();
    const startSpy = vi.spyOn(sessionStore, 'start');

    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'test-model',
      systemPrompt: 'HB system prompt',
      buildUserInput: ({ tickId }) => `tick ${tickId}`,
      sessionStore,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR, intervalMs: 10_000 });

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(output.mode).toBe('background-started');
    expect(output.running).toBe(true);
    expect(output.intervalMs).toBe(10_000);
    // The immediate synchronous tick landed through recordTick.
    expect(output.tickCount).toBeGreaterThanOrEqual(1);
    expect(output.successCount).toBeGreaterThanOrEqual(1);
    // Session exists in the store after execute.
    const snap = await sessionStore.get(FAKE_TOKEN_ADDR);
    expect(snap).toBeDefined();
    expect(snap!.running).toBe(true);

    // Cleanup to avoid timer leaks across tests.
    await sessionStore.clear();
  });

  it('background-already-running mode: session exists + no intervalMs → return snapshot, no extra tick', async () => {
    const run = vi.fn(
      async (
        _input: HeartbeatPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => ({
        lastTickAt: '2026-04-19T00:00:00.000Z',
        lastTickId: 'tick_preexisting',
        successCount: 3,
        errorCount: 0,
        skippedCount: 0,
        lastError: null,
        lastDecision: null,
      }),
    );
    const persona = makeHeartbeatPersona(run);
    const sessionStore = new HeartbeatSessionStore();
    // Pre-seed a running session.
    sessionStore.start({
      tokenAddr: FAKE_TOKEN_ADDR,
      intervalMs: 30_000,
      runTick: async () => ({
        tickId: 'preseed',
        tickAt: '2026-04-19T00:00:00.000Z',
        success: true,
      }),
    });
    sessionStore.recordTick(FAKE_TOKEN_ADDR, {
      tickId: 'seed_tick',
      tickAt: '2026-04-19T00:00:05.000Z',
      success: true,
      action: 'post',
    });

    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'm',
      systemPrompt: 'p',
      buildUserInput: () => 'tick',
      sessionStore,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    // Persona was NOT run — snapshot-only branch.
    expect(run).not.toHaveBeenCalled();
    expect(output.mode).toBe('background-already-running');
    expect(output.running).toBe(true);
    expect(output.intervalMs).toBe(30_000);
    expect(output.tickCount).toBe(1);
    expect(output.lastTickId).toBe('seed_tick');

    sessionStore.clear();
  });

  it('background-restarted mode: session exists + new intervalMs → restart and run an immediate tick', async () => {
    const run = vi.fn(
      async (
        _input: HeartbeatPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => ({
        lastTickAt: '2026-04-19T01:00:00.000Z',
        lastTickId: 'tick_after_restart',
        successCount: 1,
        errorCount: 0,
        skippedCount: 0,
        lastError: null,
        lastDecision: null,
      }),
    );
    const persona = makeHeartbeatPersona(run);
    const sessionStore = new HeartbeatSessionStore();
    sessionStore.start({
      tokenAddr: FAKE_TOKEN_ADDR,
      intervalMs: 5_000,
      runTick: async () => ({
        tickId: 'preseed',
        tickAt: '2026-04-19T00:00:00.000Z',
        success: true,
      }),
    });
    sessionStore.recordTick(FAKE_TOKEN_ADDR, {
      tickId: 'seed_tick',
      tickAt: '2026-04-19T00:00:05.000Z',
      success: true,
    });

    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'm',
      systemPrompt: 'p',
      buildUserInput: () => 'tick',
      sessionStore,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR, intervalMs: 20_000 });

    expect(output.mode).toBe('background-restarted');
    expect(output.intervalMs).toBe(20_000);
    expect(output.running).toBe(true);
    // Counters preserved + immediate tick added one more.
    expect(output.tickCount).toBeGreaterThanOrEqual(2);
    expect(run).toHaveBeenCalledTimes(1);

    sessionStore.clear();
  });

  it('emits entry/exit logs in one-shot mode and threads all event callbacks through ctx', async () => {
    const run = vi.fn(
      async (
        _input: HeartbeatPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => ({
        lastTickAt: '2026-04-19T00:00:00.000Z',
        lastTickId: 'tick_1',
        successCount: 1,
        errorCount: 0,
        skippedCount: 0,
        lastError: null,
        lastDecision: null,
      }),
    );
    const persona = makeHeartbeatPersona(run);
    const onLog = vi.fn<(event: LogEvent) => void>();
    const onArtifact = vi.fn<(artifact: Artifact) => void>();
    const onToolUseStart = vi.fn();
    const onToolUseEnd = vi.fn();
    const onAssistantDelta = vi.fn();

    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'm',
      systemPrompt: 'p',
      buildUserInput: () => 'tick',
      sessionStore: new HeartbeatSessionStore(),
      onLog,
      onArtifact,
      onToolUseStart,
      onToolUseEnd,
      onAssistantDelta,
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    const logMessages = onLog.mock.calls.map((c) => c[0].message);
    expect(logMessages.some((m) => m.includes('starting'))).toBe(true);
    expect(logMessages.some((m) => m.includes('finished'))).toBe(true);
    onLog.mock.calls.forEach((call) => expect(call[0].agent).toBe('heartbeat'));

    const [, ctx] = run.mock.calls[0]!;
    expect(ctx.onLog).toBe(onLog);
    // `ctx.onArtifact` is a wrapper installed by the heartbeat invoke
    // layer so it can capture tweet-url / lore-cid artifacts for the
    // session store delta. Verify the wrapper still forwards to the
    // outer listener rather than pointer-equality on the callback.
    expect(typeof ctx.onArtifact).toBe('function');
    const wrapper = ctx.onArtifact as (a: Artifact) => void;
    wrapper({
      kind: 'tweet-url',
      url: 'https://x.com/stub/status/forwarded',
      tweetId: 'forwarded',
    });
    expect(onArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tweet-url', tweetId: 'forwarded' }),
    );
    expect(ctx.onToolUseStart).toBe(onToolUseStart);
    expect(ctx.onToolUseEnd).toBe(onToolUseEnd);
    expect(ctx.onAssistantDelta).toBe(onAssistantDelta);
  });

  it('captures tweet-url + lore-cid artifacts emitted during a background tick and threads them onto the recorded delta', async () => {
    // When the heartbeat persona emits a tweet-url or lore-cid artifact
    // during a tick, the invoke layer must (a) forward the artifact to the
    // outer `onArtifact` so the Brain run SSE still sees it, and (b) fold
    // it into `recordTick`'s delta so the session store's `onAfterTick`
    // hook (and thus the heartbeat SSE bus) can surface it. Artifact kinds
    // outside the tick filter set must NOT contribute to the delta.
    const capturedDeltas: HeartbeatTickDelta[] = [];
    const sessionStore = new HeartbeatSessionStore({
      onAfterTick: (_snap, delta) => {
        capturedDeltas.push(delta);
      },
    });

    const run = vi.fn(
      async (
        _input: HeartbeatPersonaInput,
        ctx: PersonaRunContext,
      ): Promise<HeartbeatPersonaOutput> => {
        const onArtifact = ctx.onArtifact as ((a: Artifact) => void) | undefined;
        // Persona emits one tweet-url + one lore-cid + one bsc-token (the
        // last kind is NOT a heartbeat tick artifact and must be filtered
        // out of the delta even though the outer forwarder still sees it).
        onArtifact?.({
          kind: 'tweet-url',
          url: 'https://x.com/agent/status/tid-hb',
          tweetId: 'tid-hb',
          label: 'Heartbeat tweet',
        });
        onArtifact?.({
          kind: 'lore-cid',
          cid: 'bafkrei-hb',
          gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkrei-hb',
          author: 'narrator',
          chapterNumber: 4,
        });
        onArtifact?.({
          kind: 'bsc-token',
          chain: 'bsc-mainnet',
          address: FAKE_TOKEN_ADDR,
          explorerUrl: `https://bscscan.com/token/${FAKE_TOKEN_ADDR}`,
        });
        return {
          lastTickAt: '2026-04-19T00:00:00.000Z',
          lastTickId: 'tick_hb',
          successCount: 1,
          errorCount: 0,
          skippedCount: 0,
          lastError: null,
          lastDecision: null,
        };
      },
    );
    const persona = makeHeartbeatPersona(run);

    const outerOnArtifact = vi.fn<(artifact: Artifact) => void>();
    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'm',
      systemPrompt: 'p',
      buildUserInput: () => 'tick',
      sessionStore,
      onArtifact: outerOnArtifact,
    });

    // Drive the background-started branch so we exercise the recordTick
    // path (one-shot would bypass the session store entirely).
    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR, intervalMs: 30_000 });
    expect(output.mode).toBe('background-started');

    // Outer listener still sees every artifact exactly once.
    expect(outerOnArtifact).toHaveBeenCalledTimes(3);
    const outerKinds = outerOnArtifact.mock.calls.map((c) => c[0].kind);
    expect(outerKinds).toEqual(expect.arrayContaining(['tweet-url', 'lore-cid', 'bsc-token']));

    // The immediate recordTick delta must carry only the tick-relevant
    // artifacts (tweet-url + lore-cid); bsc-token must be filtered out.
    expect(capturedDeltas.length).toBeGreaterThanOrEqual(1);
    const recordedDelta = capturedDeltas[capturedDeltas.length - 1]!;
    expect(recordedDelta.artifacts).toBeDefined();
    expect(recordedDelta.artifacts).toHaveLength(2);
    const deltaKinds = (recordedDelta.artifacts ?? []).map((a) => a.kind);
    expect(deltaKinds.sort()).toEqual(['lore-cid', 'tweet-url']);

    await sessionStore.clear();
  });
});

// ─── stop_heartbeat ─────────────────────────────────────────────────────────

describe('createStopHeartbeatTool', () => {
  it('stops a running session and returns the final snapshot', async () => {
    const sessionStore = new HeartbeatSessionStore();
    sessionStore.start({
      tokenAddr: FAKE_TOKEN_ADDR,
      intervalMs: 60_000,
      runTick: async () => ({
        tickId: 't',
        tickAt: '2026-04-19T00:00:00.000Z',
        success: true,
      }),
    });
    sessionStore.recordTick(FAKE_TOKEN_ADDR, {
      tickId: 't1',
      tickAt: '2026-04-19T00:00:05.000Z',
      success: true,
      action: 'post',
    });

    const tool = createStopHeartbeatTool({ sessionStore });
    expect(tool.name).toBe(STOP_HEARTBEAT_TOOL_NAME);

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });
    expect(output.tokenAddr).toBe(FAKE_TOKEN_ADDR);
    expect(output.wasRunning).toBe(true);
    expect(output.finalSnapshot).not.toBeNull();
    expect(output.finalSnapshot!.running).toBe(false);
    expect(output.finalSnapshot!.tickCount).toBe(1);
    expect(output.finalSnapshot!.lastAction).toBe('post');

    // Session really stopped.
    expect((await sessionStore.get(FAKE_TOKEN_ADDR))?.running).toBe(false);

    await sessionStore.clear();
  });

  it('returns wasRunning=false + finalSnapshot=null when no session exists', async () => {
    const sessionStore = new HeartbeatSessionStore();
    const tool = createStopHeartbeatTool({ sessionStore });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });
    expect(output.wasRunning).toBe(false);
    expect(output.finalSnapshot).toBeNull();
  });

  it('validates tokenAddr shape', () => {
    const tool = createStopHeartbeatTool({ sessionStore: new HeartbeatSessionStore() });
    expect(() => tool.inputSchema.parse({ tokenAddr: FAKE_TOKEN_ADDR })).not.toThrow();
    expect(() => tool.inputSchema.parse({ tokenAddr: 'bad' })).toThrow();
    expect(() => tool.inputSchema.parse({})).toThrow();
  });
});

// ─── list_heartbeats ────────────────────────────────────────────────────────

describe('createListHeartbeatsTool', () => {
  it('returns every running session and excludes stopped ones', async () => {
    const sessionStore = new HeartbeatSessionStore();
    const otherAddr = '0x1111111111111111111111111111111111111111';
    const stoppedAddr = '0x2222222222222222222222222222222222222222';

    sessionStore.start({
      tokenAddr: FAKE_TOKEN_ADDR,
      intervalMs: 60_000,
      runTick: async () => ({ tickId: 't', tickAt: '2026-04-19T00:00:00.000Z', success: true }),
    });
    sessionStore.start({
      tokenAddr: otherAddr,
      intervalMs: 30_000,
      runTick: async () => ({ tickId: 't', tickAt: '2026-04-19T00:00:00.000Z', success: true }),
    });
    sessionStore.start({
      tokenAddr: stoppedAddr,
      intervalMs: 10_000,
      runTick: async () => ({ tickId: 't', tickAt: '2026-04-19T00:00:00.000Z', success: true }),
    });
    sessionStore.stop(stoppedAddr);

    const tool = createListHeartbeatsTool({ sessionStore });
    expect(tool.name).toBe(LIST_HEARTBEATS_TOOL_NAME);

    const output = await tool.execute({});
    expect(output.totalRunning).toBe(2);
    const addrs = output.sessions.map((s) => s.tokenAddr).sort();
    expect(addrs).toEqual([FAKE_TOKEN_ADDR.toLowerCase(), otherAddr.toLowerCase()].sort());
    for (const s of output.sessions) {
      expect(s.running).toBe(true);
    }

    sessionStore.clear();
  });

  it('returns an empty list when nothing is running', async () => {
    const sessionStore = new HeartbeatSessionStore();
    const tool = createListHeartbeatsTool({ sessionStore });

    const output = await tool.execute({});
    expect(output.totalRunning).toBe(0);
    expect(output.sessions).toEqual([]);
  });
});

// ─── persona input contract ─────────────────────────────────────────────────
//
// Regression layer for the "brain layer silently drops / fabricates LLM-
// visible persona inputs" class of bug. Each test below captures the TInput
// the persona adapter receives via a spy on `persona.run` and asserts that
// every user-facing field the Brain LLM supplies (theme / tokenAddr / brief /
// intervalMs) or the orchestrator enricher derives (tokenName /
// previousChapters / loreSnippet / orderId) reaches the persona verbatim.
//
// The heartbeat case is NOT duplicated here — the canonical regression test
// is "threads tokenAddr into the persona buildUserInput so the LLM never has
// to guess it" (~line 733 of this file), which both captures the TInput and
// invokes `buildUserInput` to assert the tokenAddr lands in the final LLM
// prompt string. That one fix is what stopped the hallucinated-tokenAddr bug
// (commit 8cdd429). Do not add a parallel heartbeat test here; extend the
// canonical one if the contract grows.

describe('persona input contract', () => {
  it('invoke_creator: theme from Brain reaches creatorPersona.run verbatim', async () => {
    const run = vi.fn(
      async (_input: CreatorPersonaInput, _ctx: PersonaRunContext): Promise<CreatorResult> => ({
        tokenAddr: FAKE_TOKEN_ADDR,
        tokenDeployTx: FAKE_TX,
        loreIpfsCid: 'bafkrei-contract-creator',
        metadata: {
          name: 'HBNB2026-CONTRACT',
          symbol: 'HBNB2026-CONTRACT',
          description: 'contract-test',
          imageLocalPath: '/tmp/contract.png',
        },
      }),
    );
    const persona: Persona<CreatorPersonaInput, CreatorResult> = {
      id: 'creator',
      description: 'stub creator',
      inputSchema: z.object({
        theme: z.string().min(1),
        model: z.string().optional(),
        maxTurns: z.number().int().positive().optional(),
      }) as unknown as z.ZodType<CreatorPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<CreatorResult>,
      run,
    };
    const tool = createInvokeCreatorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
    });

    await tool.execute({ theme: 'BNB Chain 2026 growth' });

    expect(run).toHaveBeenCalledTimes(1);
    const [capturedInput] = run.mock.calls[0]!;
    // The only user-facing param. Must land on TInput verbatim so the
    // creator persona's LLM prompt sees exactly what the Brain received.
    expect(capturedInput).toEqual({ theme: 'BNB Chain 2026 growth' });
  });

  it('invoke_narrator: tokenAddr + resolveTokenMeta output reach narratorPersona.run verbatim', async () => {
    const run = vi.fn(
      async (
        _input: NarratorPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<NarratorPersonaOutput> => ({
        tokenAddr: FAKE_TOKEN_ADDR,
        chapterNumber: 5,
        ipfsHash: 'bafkrei-contract-narr',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-contract-narr',
        chapterText: 'ch5',
      }),
    );
    const persona: Persona<NarratorPersonaInput, NarratorPersonaOutput> = {
      id: 'narrator',
      description: 'stub narrator',
      inputSchema: z.any() as unknown as z.ZodType<NarratorPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<NarratorPersonaOutput>,
      run,
    };
    // Real-looking resolver output — exercises the LoreStore plumbing that,
    // if it regresses, gives us a "HBNB2026-Unknown" Narrator run.
    const resolveTokenMeta = vi.fn(async () => ({
      tokenName: 'HBNB2026-Alpha',
      tokenSymbol: 'HBNB2026-ALP',
      previousChapters: ['chapter one body', 'chapter two body'],
      targetChapterNumber: 5,
    }));
    const tool = createInvokeNarratorTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      store: { __brand: 'LoreStore' } as unknown as never,
      resolveTokenMeta,
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR });

    expect(resolveTokenMeta).toHaveBeenCalledWith(FAKE_TOKEN_ADDR);
    expect(run).toHaveBeenCalledTimes(1);
    const [capturedInput] = run.mock.calls[0]!;
    // tokenAddr comes straight from Brain; the rest comes from the
    // resolver. All four must land on TInput verbatim so the narrator
    // persona's LLM prompt sees real token metadata instead of
    // "HBNB2026-Unknown".
    expect(capturedInput.tokenAddr).toBe(FAKE_TOKEN_ADDR);
    expect(capturedInput.tokenName).toBe('HBNB2026-Alpha');
    expect(capturedInput.tokenSymbol).toBe('HBNB2026-ALP');
    expect(capturedInput.previousChapters).toEqual(['chapter one body', 'chapter two body']);
    expect(capturedInput.targetChapterNumber).toBe(5);
  });

  it('invoke_shiller: tokenAddr + brief + resolveOrder output reach shillerPersona.run verbatim', async () => {
    const run = vi.fn(
      async (
        _input: ShillerPersonaInput,
        _ctx: PersonaRunContext,
      ): Promise<ShillerPersonaOutput> => ({
        orderId: 'order-contract',
        tokenAddr: FAKE_TOKEN_ADDR,
        decision: 'shill',
        tweetId: 'tid-contract',
        tweetUrl: 'https://x.com/stub/status/tid-contract',
        tweetText: 'contract tweet',
        postedAt: '2026-04-20T00:00:00.000Z',
        toolCalls: [],
      }),
    );
    const persona: Persona<ShillerPersonaInput, ShillerPersonaOutput> = {
      id: 'shiller',
      description: 'stub shiller',
      inputSchema: z.any() as unknown as z.ZodType<ShillerPersonaInput>,
      outputSchema: z.any() as unknown as z.ZodType<ShillerPersonaOutput>,
      run,
    };
    const postShillForTool = fakePostShillForTool();
    const resolveOrder = vi.fn(async () => ({
      orderId: 'order-contract',
      loreSnippet: 'a whispered chapter about BNB',
      tokenSymbol: 'HBNB2026-ALP',
      includeFourMemeUrl: true,
    }));
    const tool = createInvokeShillerTool({
      persona,
      postShillForTool,
      resolveOrder,
    });

    await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR, brief: 'pump the hype' });

    expect(resolveOrder).toHaveBeenCalledWith(FAKE_TOKEN_ADDR, 'pump the hype');
    expect(run).toHaveBeenCalledTimes(1);
    const [capturedInput] = run.mock.calls[0]!;
    // All user- and resolver-derived fields must land on TInput verbatim.
    // The Brain LLM supplies tokenAddr + brief; everything else rides the
    // resolver. If the wrapper drops any of these, the shiller persona
    // posts a tweet with "HBNB2026" or no lore snippet at all.
    expect(capturedInput.tokenAddr).toBe(FAKE_TOKEN_ADDR);
    expect(capturedInput.creatorBrief).toBe('pump the hype');
    expect(capturedInput.orderId).toBe('order-contract');
    expect(capturedInput.loreSnippet).toBe('a whispered chapter about BNB');
    expect(capturedInput.tokenSymbol).toBe('HBNB2026-ALP');
    expect(capturedInput.includeFourMemeUrl).toBe(true);
    // post_shill_for tool is wired through TInput — this is the only
    // side-effect channel the shiller persona has.
    expect(capturedInput.postShillForTool).toBe(postShillForTool);
  });
});
