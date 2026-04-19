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
  INVOKE_CREATOR_TOOL_NAME,
  INVOKE_NARRATOR_TOOL_NAME,
  INVOKE_SHILLER_TOOL_NAME,
  INVOKE_HEARTBEAT_TICK_TOOL_NAME,
} from './invoke-persona.js';
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
    }));
    const tool = createInvokeHeartbeatTickTool({
      persona,
      client: fakeClient(),
      registry: fakeRegistry(),
      model: 'test-model',
      systemPrompt: 'heartbeat system prompt',
      buildUserInput: ({ tickId }) => `tick ${tickId}`,
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

  it('constructs persona input from tool config and returns the tick snapshot', async () => {
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
      }),
    );
    const persona = makeHeartbeatPersona(run);
    const client = fakeClient();
    const registry = fakeRegistry();
    const buildUserInput = vi.fn(({ tickId }: { tickId: string }) => `tick ${tickId}`);

    const tool = createInvokeHeartbeatTickTool({
      persona,
      client,
      registry,
      model: 'test-model',
      systemPrompt: 'HB system prompt',
      buildUserInput,
    });

    const output = await tool.execute({ tokenAddr: FAKE_TOKEN_ADDR, intervalMs: 10_000 });

    expect(run).toHaveBeenCalledTimes(1);
    const [input, ctx] = run.mock.calls[0]!;
    expect(input.model).toBe('test-model');
    expect(input.systemPrompt).toBe('HB system prompt');
    expect(input.buildUserInput).toBe(buildUserInput);
    expect(input.intervalMs).toBe(10_000);
    expect(ctx.client).toBe(client);
    expect(ctx.registry).toBe(registry);
    expect(output.successCount).toBe(1);
    expect(output.lastTickId).toBe('tick_abc');
  });

  it('emits entry/exit logs and threads all event callbacks through ctx', async () => {
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
    expect(ctx.onArtifact).toBe(onArtifact);
    expect(ctx.onToolUseStart).toBe(onToolUseStart);
    expect(ctx.onToolUseEnd).toBe(onToolUseEnd);
    expect(ctx.onAssistantDelta).toBe(onAssistantDelta);
  });
});
