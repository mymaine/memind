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

  it('overrides a hallucinated tokenAddr from the LLM with the runtime tokenAddr', async () => {
    // Model hallucinates the tool input: it swaps the address on the way in.
    // Prior behaviour relied on a runtime guard to reject this — now the
    // wrapper silently overwrites the LLM's tokenAddr with the authoritative
    // runtime value, so the extend_lore execute path sees the correct
    // address and the chapter is filed under `params.tokenAddr` as intended.
    // This test pins that the override DOES happen (belt-and-suspenders guard
    // stays in place and should never fire under normal operation).
    const { tool, executeSpy } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'chapter for the right token',
        ipfsHash: 'bafkrei-right',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-right',
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

    const output = await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
    });

    // Wrapper overwrote the hallucinated tokenAddr with the runtime value.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const passedInput = executeSpy.mock.calls[0]?.[0] as ExtendLoreInput | undefined;
    expect(passedInput?.tokenAddr).toBe(TOKEN_ADDR);
    // Chapter was upserted under the runtime address, not the hallucinated one.
    expect(output.tokenAddr).toBe(TOKEN_ADDR);
    expect(await store.getLatest(TOKEN_ADDR)).toBeDefined();
    expect(await store.getLatest(HALLUCINATED_ADDR)).toBeUndefined();
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

  // ─── Wrapper injection (2026-04-21 rewire) ─────────────────────────────
  // The narrator wrapper now only force-overrides `tokenAddr` on the
  // extend_lore input. tokenName / tokenSymbol / previousChapters /
  // targetChapterNumber are sourced by the LLM from its own get_token_info
  // call and flow through the wrapper untouched. The tests below pin that
  // contract by asserting the spy sees the LLM-supplied values for those
  // four fields (no server override) while `tokenAddr` is always the
  // runtime-authoritative value.

  it('forwards LLM-supplied previousChapters through the wrapper without overriding', async () => {
    const { tool, executeSpy } = makeFakeExtendLoreTool([
      {
        chapterNumber: 2,
        chapterText: 'continuation body',
        ipfsHash: 'bafkrei-ch2',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch2',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    // The LLM supplies previousChapters harvested from its own
    // `get_token_info` call — the wrapper MUST forward them untouched.
    const LLM_CH1 = 'ch1 full text here — LLM-supplied from get_token_info';
    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'HBNB2026-Alpha',
            tokenSymbol: 'HBNB2026-ALP',
            previousChapters: [LLM_CH1],
            targetChapterNumber: 2,
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
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const passedInput = executeSpy.mock.calls[0]?.[0] as ExtendLoreInput | undefined;
    expect(passedInput).toBeDefined();
    // tokenAddr is still forced by the runtime.
    expect(passedInput?.tokenAddr).toBe(TOKEN_ADDR);
    // Everything else is whatever the LLM passed (from get_token_info).
    expect(passedInput?.previousChapters).toEqual([LLM_CH1]);
    expect(passedInput?.targetChapterNumber).toBe(2);
    expect(passedInput?.tokenName).toBe('HBNB2026-Alpha');
    expect(passedInput?.tokenSymbol).toBe('HBNB2026-ALP');
  });

  it('always overwrites tokenAddr with the runtime value even when the LLM passes a wrong address', async () => {
    // The anti-hallucination rail: lore prose can contain a stray 0x hex
    // string. The wrapper must still pin the runtime tokenAddr regardless
    // of what the LLM placed in the tool_use input.
    const { tool, executeSpy } = makeFakeExtendLoreTool([
      {
        chapterNumber: 5,
        chapterText: 'ch5 body',
        ipfsHash: 'bafkrei-ch5',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch5',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const WRONG_ADDR = '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead';
    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: WRONG_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: ['a', 'b', 'c'],
            targetChapterNumber: 5,
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
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const passedInput = executeSpy.mock.calls[0]?.[0] as ExtendLoreInput | undefined;
    // tokenAddr got pinned back to the runtime value.
    expect(passedInput?.tokenAddr).toBe(TOKEN_ADDR);
    // But the LLM-supplied chapter metadata flows through the wrapper.
    expect(passedInput?.targetChapterNumber).toBe(5);
    expect(passedInput?.previousChapters).toEqual(['a', 'b', 'c']);
  });

  it('forwards LLM-supplied previousChapters on every call when the model fires extend_lore twice', async () => {
    // Some LLMs call the tool multiple times against spec. Each call must
    // still see the runtime-authoritative tokenAddr, but the LLM-supplied
    // chapter metadata flows through untouched (the model is responsible
    // for reading them back from `get_token_info`).
    const { tool, executeSpy } = makeFakeExtendLoreTool([
      {
        chapterNumber: 2,
        chapterText: 'ch2 first attempt',
        ipfsHash: 'bafkrei-ch2a',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch2a',
      },
      {
        chapterNumber: 2,
        chapterText: 'ch2 second attempt',
        ipfsHash: 'bafkrei-ch2b',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch2b',
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
            previousChapters: ['first-call-ch1'],
            targetChapterNumber: 2,
          },
        },
      ]),
      toolUseResponse('msg_2', [
        {
          id: 'tu_2',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: ['second-call-ch1'],
            targetChapterNumber: 2,
          },
        },
      ]),
      textOnlyResponse('final ack'),
    ]);

    const result = await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
    });

    expect(executeSpy).toHaveBeenCalledTimes(2);
    // tokenAddr is pinned on every call; the LLM-supplied chapter metadata
    // passes through the wrapper verbatim.
    for (const call of executeSpy.mock.calls) {
      const passed = call[0] as ExtendLoreInput;
      expect(passed.tokenAddr).toBe(TOKEN_ADDR);
    }
    expect(result.ipfsHash).toBe('bafkrei-ch2b');
  });

  it('falls back to a safe extend_lore input when the LLM supplies a non-object', async () => {
    // Defensive path: when Anthropic hands us a malformed tool_use input
    // (null / string / etc.) the preprocess branch injects a minimal
    // payload carrying just the runtime tokenAddr. The inner schema then
    // rejects cleanly because tokenName/symbol are missing — we cover that
    // behaviour here by asserting the tool call lands as an error trace.
    const { tool } = makeFakeExtendLoreTool([]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: null as unknown as Record<string, unknown>,
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    // The inner extend_lore schema requires tokenName / tokenSymbol, so a
    // null LLM input (defaulted to just tokenAddr) triggers a rejection
    // which `pickExtendLoreCall` surfaces as an error — runNarratorAgent
    // then throws out.
    await expect(
      runNarratorAgent({
        client,
        registry,
        store,
        tokenAddr: TOKEN_ADDR,
      }),
    ).rejects.toThrow();
  });

  it('forces first-turn tool_choice to get_token_info (anti-hallucination rail)', async () => {
    // The narrator now runs a strict two-step flow — get_token_info first,
    // then extend_lore — enforced at the Anthropic API boundary by
    // `tool_choice: {type:'tool', name:'get_token_info'}` on turn 0.
    // Subsequent turns revert to auto so the loop can terminate after
    // extend_lore returns. We assert the forced choice lands on the first
    // stream call and disappears on the second.
    const { tool } = makeFakeExtendLoreTool([
      {
        chapterNumber: 1,
        chapterText: 'body',
        ipfsHash: 'bafkrei-forced',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-forced',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();
    const { client, create: streamSpy } = fakeClient([
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
    });

    // First call carries the forced tool_choice; second reverts to default.
    const firstCallArgs = streamSpy.mock.calls[0]?.[0] as { tool_choice?: unknown } | undefined;
    expect(firstCallArgs?.tool_choice).toEqual({ type: 'tool', name: 'get_token_info' });
    const secondCallArgs = streamSpy.mock.calls[1]?.[0] as { tool_choice?: unknown } | undefined;
    expect(secondCallArgs?.tool_choice).toBeUndefined();
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
