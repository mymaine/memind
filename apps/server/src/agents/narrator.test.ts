import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { AgentTool, AnyAgentTool, Artifact, LogEvent } from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { LoreStore } from '../state/lore-store.js';
import { AnchorLedger, computeAnchorId, computeContentHash } from '../state/anchor-ledger.js';
import { runNarratorAgent } from './narrator.js';
import {
  makeStreamingClient,
  msg,
  textStream,
  toolUseStream,
  type ScriptedStream,
} from './_test-client.js';

/**
 * The Narrator agent is a thin wrapper around runAgentLoop that:
 *   1. Forces the model to call the `extend_lore` tool once.
 *   2. Upserts the tool's result into a LoreStore so the x402 handler can
 *      serve it to paying callers.
 *
 * These tests drive a fake Anthropic client whose `messages.create` returns a
 * scripted queue, plus an in-process fake `extend_lore` tool so we never hit
 * the real LLM / Pinata. This keeps the Narrator suite unit-level and fast.
 */

interface ExtendLoreInput {
  tokenAddr: string;
  tokenName: string;
  tokenSymbol: string;
  previousChapters?: string[];
  targetChapterNumber?: number;
}

interface ExtendLoreOutput {
  chapterNumber: number;
  chapterText: string;
  ipfsHash: string;
  ipfsUri: string;
}

// V2-P2: runtime now drives `messages.stream`; fakeClient delegates to the
// shared streaming helper. We preserve the original helper names
// (fakeClient/textOnlyResponse/toolUseResponse) to minimise churn across the
// existing test assertions.
function fakeClient(scripts: ScriptedStream[]): {
  client: ReturnType<typeof makeStreamingClient>['client'];
  create: ReturnType<typeof vi.fn>;
} {
  const { client, stream } = makeStreamingClient(scripts);
  return { client, create: stream };
}

function textOnlyResponse(text: string): ScriptedStream {
  return textStream(text);
}

function toolUseResponse(
  _id: string,
  toolUses: { id: string; name: string; input: unknown }[],
): ScriptedStream {
  void msg;
  return toolUseStream(
    toolUses.map((t) => ({
      id: t.id,
      name: t.name,
      input: (t.input as Record<string, unknown>) ?? {},
    })),
  );
}

/**
 * Build a fake `extend_lore` tool whose execute() returns the next scripted
 * output (or throws if the script is exhausted). The behaviour-under-test is
 * the Narrator wrapper, so we don't care about LLM or Pinata here.
 */
function makeFakeExtendLoreTool(outputs: ExtendLoreOutput[]): {
  tool: AgentTool<ExtendLoreInput, ExtendLoreOutput>;
  executeSpy: ReturnType<typeof vi.fn>;
} {
  const queue = [...outputs];
  const executeSpy = vi.fn(async (_input: ExtendLoreInput): Promise<ExtendLoreOutput> => {
    const next = queue.shift();
    if (!next) throw new Error('fake extend_lore: queue exhausted');
    return next;
  });
  const tool: AgentTool<ExtendLoreInput, ExtendLoreOutput> = {
    name: 'extend_lore',
    description: 'fake extend_lore tool used by the Narrator test suite',
    inputSchema: z.object({
      tokenAddr: z.string(),
      tokenName: z.string(),
      tokenSymbol: z.string(),
      previousChapters: z.array(z.string()).optional(),
      targetChapterNumber: z.number().optional(),
    }),
    outputSchema: z.object({
      chapterNumber: z.number(),
      chapterText: z.string(),
      ipfsHash: z.string(),
      ipfsUri: z.string(),
    }),
    execute: executeSpy as unknown as (input: ExtendLoreInput) => Promise<ExtendLoreOutput>,
  };
  return { tool, executeSpy };
}

function makeRegistry(tool: AnyAgentTool): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry;
}

const TOKEN_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

describe('runNarratorAgent', () => {
  it('invokes extend_lore once, upserts the result into the store, and returns it', async () => {
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'the first vignette',
        ipfsHash: 'bafkrei-ch1',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'HBNB2026-Alpha',
            tokenSymbol: 'HBNB2026-ALP',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('chapter published'),
    ]);

    const output = await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'HBNB2026-Alpha',
      tokenSymbol: 'HBNB2026-ALP',
    });

    expect(output.chapterNumber).toBe(1);
    expect(output.ipfsHash).toBe('bafkrei-ch1');
    expect(output.chapterText).toBe('the first vignette');
    // Address is stored in normalised lowercase form.
    expect(output.tokenAddr).toBe(TOKEN_ADDR);

    const stored = await store.getLatest(TOKEN_ADDR);
    expect(stored).toBeDefined();
    expect(stored?.chapterNumber).toBe(1);
    expect(stored?.ipfsHash).toBe('bafkrei-ch1');
    expect(stored?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(output.toolCalls).toHaveLength(1);
    expect(output.toolCalls[0]?.name).toBe('extend_lore');
  });

  it('respects an explicit targetChapterNumber from the caller', async () => {
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 7,
        chapterText: 'chapter seven body',
        ipfsHash: 'bafkrei-ch7',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch7',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 7,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    const output = await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      targetChapterNumber: 7,
    });

    expect(output.chapterNumber).toBe(7);
    expect((await store.getLatest(TOKEN_ADDR))?.chapterNumber).toBe(7);
  });

  it('continues a multi-chapter timeline by defaulting target to previousChapters.length + 1', async () => {
    const { tool, executeSpy } = makeFakeExtendLoreTool([
      {
        chapterNumber: 4,
        chapterText: 'fourth chapter body',
        ipfsHash: 'bafkrei-ch4',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch4',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: ['ch1', 'ch2', 'ch3'],
            targetChapterNumber: 4,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      previousChapters: ['ch1', 'ch2', 'ch3'],
    });

    // The Narrator doesn't validate the tool's reported chapterNumber against
    // the requested target — but it DOES surface the "3 prior chapters"
    // context in the user prompt so the model has the continuation hint.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect((await store.getLatest(TOKEN_ADDR))?.chapterNumber).toBe(4);
  });

  it('throws when the agent loop ends without invoking extend_lore', async () => {
    const { tool, executeSpy } = makeFakeExtendLoreTool([]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([textOnlyResponse('I refuse to publish')]);

    await expect(
      runNarratorAgent({
        client,
        registry,
        store,
        tokenAddr: TOKEN_ADDR,
        tokenName: 'T',
        tokenSymbol: 'T',
      }),
    ).rejects.toThrow(/extend_lore/);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(await store.size()).toBe(0);
  });

  it('throws when the extend_lore call reports an error via is_error', async () => {
    // Register a tool whose execute() throws — runAgentLoop will feed the
    // error back as is_error; the loop then ends with no successful call.
    const failingTool: AgentTool<ExtendLoreInput, ExtendLoreOutput> = {
      name: 'extend_lore',
      description: 'always-fails extend_lore stub',
      inputSchema: z.object({
        tokenAddr: z.string(),
        tokenName: z.string(),
        tokenSymbol: z.string(),
        previousChapters: z.array(z.string()).optional(),
        targetChapterNumber: z.number().optional(),
      }),
      outputSchema: z.object({
        chapterNumber: z.number(),
        chapterText: z.string(),
        ipfsHash: z.string(),
        ipfsUri: z.string(),
      }),
      execute: async () => {
        throw new Error('pinata is down');
      },
    };
    const registry = makeRegistry(failingTool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('could not publish'),
    ]);

    await expect(
      runNarratorAgent({
        client,
        registry,
        store,
        tokenAddr: TOKEN_ADDR,
        tokenName: 'T',
        tokenSymbol: 'T',
      }),
    ).rejects.toThrow(/pinata is down|extend_lore.*error/i);

    expect(await store.size()).toBe(0);
  });

  it('throws when extend_lore was invoked with a tokenAddr different from the requested one', async () => {
    // Model hallucinates the tool input: it swaps the address on the way in.
    // The Narrator stores the chapter under `params.tokenAddr`, so if we let
    // this through the chapter of the hallucinated token would be filed under
    // the caller's key — a data-binding bug. Guard must fail loud.
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'chapter for the wrong token',
        ipfsHash: 'bafkrei-wrong',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-wrong',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const HALLUCINATED_ADDR = '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead';
    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: HALLUCINATED_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    await expect(
      runNarratorAgent({
        client,
        registry,
        store,
        tokenAddr: TOKEN_ADDR,
        tokenName: 'T',
        tokenSymbol: 'T',
      }),
    ).rejects.toThrow(/unexpected tokenAddr/i);
  });

  // ─── AC3 anchor hook ───────────────────────────────────────────────────────
  // After the Narrator upserts the chapter into the LoreStore, it must also
  // append a ledger entry and emit a `lore-anchor` artifact — provided the
  // caller wired the optional `anchorLedger` + `onArtifact` dependencies.
  // Wiring is opt-in so existing callers that don't need the anchor evidence
  // (test fixtures, Phase 2 demos) aren't forced to add state.

  it('appends an AnchorLedger entry and emits a lore-anchor artifact after upsert', async () => {
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 3,
        chapterText: 'third chapter body',
        ipfsHash: 'bafkrei-ch3',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch3',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();
    const ledger = new AnchorLedger();
    const artifacts: Artifact[] = [];

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 3,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    await runNarratorAgent({
      client,
      registry,
      store,
      anchorLedger: ledger,
      onArtifact: (a) => artifacts.push(a),
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      targetChapterNumber: 3,
    });

    // Ledger row exists with the expected contentHash + anchorId shape.
    const expectedAnchorId = computeAnchorId(TOKEN_ADDR, 3);
    const expectedHash = computeContentHash(TOKEN_ADDR, 3, 'bafkrei-ch3');
    expect(await ledger.size()).toBe(1);
    const row = await ledger.get(expectedAnchorId);
    expect(row).toBeDefined();
    expect(row?.contentHash).toBe(expectedHash);
    expect(row?.chapterNumber).toBe(3);
    expect(row?.loreCid).toBe('bafkrei-ch3');
    expect(row?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Exactly one lore-anchor artifact emitted with the same commitment.
    const anchors = artifacts.filter((a) => a.kind === 'lore-anchor');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    if (!anchor || anchor.kind !== 'lore-anchor') {
      throw new Error('unreachable: filter guaranteed a lore-anchor element');
    }
    expect(anchor.anchorId).toBe(expectedAnchorId);
    expect(anchor.contentHash).toBe(expectedHash);
    expect(anchor.chapterNumber).toBe(3);
    expect(anchor.loreCid).toBe('bafkrei-ch3');
    // Layer-1 only: no on-chain fields yet.
    expect(anchor.onChainTxHash).toBeUndefined();
    expect(anchor.chain).toBeUndefined();
    expect(anchor.explorerUrl).toBeUndefined();
  });

  it('skips anchor emission when anchorLedger + onArtifact are not supplied (back-compat)', async () => {
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'body',
        ipfsHash: 'bafkrei-ch1',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    // No anchorLedger, no onArtifact — must still run the happy path cleanly.
    const out = await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
    });

    expect(out.ipfsHash).toBe('bafkrei-ch1');
  });

  it('overwrites the same anchor row on chapter rewrite', async () => {
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'first try',
        ipfsHash: 'first-cid',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/first-cid',
      },
      {
        chapterNumber: 1,
        chapterText: 'second try',
        ipfsHash: 'second-cid',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/second-cid',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();
    const ledger = new AnchorLedger();
    const artifacts: Artifact[] = [];

    const scripts = [
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('first ack'),
      toolUseResponse('msg_2', [
        {
          id: 'tu_2',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('second ack'),
    ];
    const { client } = fakeClient(scripts);

    await runNarratorAgent({
      client,
      registry,
      store,
      anchorLedger: ledger,
      onArtifact: (a) => artifacts.push(a),
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      targetChapterNumber: 1,
    });
    await runNarratorAgent({
      client,
      registry,
      store,
      anchorLedger: ledger,
      onArtifact: (a) => artifacts.push(a),
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      targetChapterNumber: 1,
    });

    // One ledger slot (same anchorId), but two artifact emissions — the event
    // stream is append-only; the UI layer does its own dedup by anchorId.
    expect(await ledger.size()).toBe(1);
    expect((await ledger.get(computeAnchorId(TOKEN_ADDR, 1)))?.loreCid).toBe('second-cid');

    const anchors = artifacts.filter((a) => a.kind === 'lore-anchor');
    expect(anchors).toHaveLength(2);
  });

  it('emits LogEvents tagged with agent="narrator"', async () => {
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'body',
        ipfsHash: 'bafkrei-ch1',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const logs: LogEvent[] = [];
    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: [],
            targetChapterNumber: 1,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      onLog: (event) => logs.push(event),
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((e) => e.agent === 'narrator')).toBe(true);
    expect(logs.some((e) => e.tool === 'extend_lore')).toBe(true);
  });
});
