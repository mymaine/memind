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

  // ─── Wrapper injection (2026-04-20) ───────────────────────────────────────
  // The narrator wraps the registry's `extend_lore` tool so the authoritative
  // `previousChapters` / `targetChapterNumber` / tokenAddr / tokenName /
  // tokenSymbol always reach the real execute path regardless of what the LLM
  // placed in its tool_use input. Prior behaviour trusted the LLM to forward
  // these values, which broke chapter continuation because the LLM never saw
  // the chapter bodies and silently sent `[]`.
  //
  // These tests pin the contract by inspecting the arguments the UNDERLYING
  // extend_lore spy received — i.e. post-wrapper, pre-downstream.

  it('injects previousChapters from runtime state even when the LLM supplies an empty array', async () => {
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

    // LLM fabricates an empty `previousChapters` — the exact failure mode
    // that caused Chapter 2 to regress to a fresh Chapter 1. The wrapper
    // must overwrite this with the runtime-supplied chapter text.
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
            targetChapterNumber: 99,
          },
        },
      ]),
      textOnlyResponse('ok'),
    ]);

    const RUNTIME_CH1 = 'ch1 full text here — runtime-supplied';
    await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'HBNB2026-Alpha',
      tokenSymbol: 'HBNB2026-ALP',
      previousChapters: [RUNTIME_CH1],
    });

    // Critical assertion: the UNDERLYING extend_lore spy must have received
    // the runtime's previousChapters, not the LLM's empty array.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const passedInput = executeSpy.mock.calls[0]?.[0] as ExtendLoreInput | undefined;
    expect(passedInput).toBeDefined();
    expect(passedInput?.previousChapters).toEqual([RUNTIME_CH1]);
    // Target chapter number must also be injected (2 = previousChapters.length + 1).
    expect(passedInput?.targetChapterNumber).toBe(2);
    // Name / symbol / addr are also forcibly overwritten.
    expect(passedInput?.tokenAddr).toBe(TOKEN_ADDR);
    expect(passedInput?.tokenName).toBe('HBNB2026-Alpha');
    expect(passedInput?.tokenSymbol).toBe('HBNB2026-ALP');
  });

  it('injects the explicit targetChapterNumber over any value the LLM passes', async () => {
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

    // LLM hallucinates a wildly wrong targetChapterNumber; the wrapper
    // must overwrite it with the caller's explicit value (5).
    const { client } = fakeClient([
      toolUseResponse('msg_1', [
        {
          id: 'tu_1',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: ['a', 'b', 'c'],
            targetChapterNumber: 999,
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
      previousChapters: ['runtime-ch1', 'runtime-ch2', 'runtime-ch3', 'runtime-ch4'],
      targetChapterNumber: 5,
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const passedInput = executeSpy.mock.calls[0]?.[0] as ExtendLoreInput | undefined;
    expect(passedInput?.targetChapterNumber).toBe(5);
    expect(passedInput?.previousChapters).toEqual([
      'runtime-ch1',
      'runtime-ch2',
      'runtime-ch3',
      'runtime-ch4',
    ]);
  });

  it('injects runtime metadata on every LLM call when the model fires extend_lore twice', async () => {
    // Some LLMs call the tool multiple times against spec. Regardless of how
    // many times it fires or what the input looked like, each invocation
    // must receive the authoritative runtime values. pickExtendLoreCall then
    // picks the final (successful) call as the canonical result.
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

    const RUNTIME_CH1 = 'prior-chapter-runtime';
    const { client } = fakeClient([
      // Turn 1: first tool_use with an empty array
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
      // Turn 2: model retries with a FAKE previousChapters + wrong number
      toolUseResponse('msg_2', [
        {
          id: 'tu_2',
          name: 'extend_lore',
          input: {
            tokenAddr: TOKEN_ADDR,
            tokenName: 'T',
            tokenSymbol: 'T',
            previousChapters: ['fabricated chapter text'],
            targetChapterNumber: 42,
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
      tokenName: 'T',
      tokenSymbol: 'T',
      previousChapters: [RUNTIME_CH1],
    });

    // Both calls landed on the underlying spy…
    expect(executeSpy).toHaveBeenCalledTimes(2);
    // …both carry the injected runtime values, NOT the fabricated ones.
    for (const call of executeSpy.mock.calls) {
      const passed = call[0] as ExtendLoreInput;
      expect(passed.previousChapters).toEqual([RUNTIME_CH1]);
      expect(passed.targetChapterNumber).toBe(2);
    }
    // pickExtendLoreCall picks the LAST call — so Chapter 2's stored CID is
    // the second attempt's output, proving the trace is stable.
    expect(result.ipfsHash).toBe('bafkrei-ch2b');
  });

  it('still injects runtime values when the LLM supplies a non-object input (null)', async () => {
    // Defensive path: `z.preprocess` must recognise non-object input and
    // substitute a fresh object assembled from the injection, instead of
    // letting the original ZodObject parse reject a null. If this test ever
    // fails it signals that the preprocess fallback branch was dropped.
    const { tool, executeSpy } = makeFakeExtendLoreTool([
      {
        chapterNumber: 2,
        chapterText: 'ch2 from null input',
        ipfsHash: 'bafkrei-null',
        ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-null',
      },
    ]);
    const registry = makeRegistry(tool as unknown as AnyAgentTool);
    const store = new LoreStore();

    // Craft a tool_use whose `input` is a non-object — Anthropic's JSON
    // serialisation normally enforces object, but a malformed model response
    // (or a fake stream for a defensive test) can still land here.
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

    await runNarratorAgent({
      client,
      registry,
      store,
      tokenAddr: TOKEN_ADDR,
      tokenName: 'T',
      tokenSymbol: 'T',
      previousChapters: ['runtime-ch1'],
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const passed = executeSpy.mock.calls[0]?.[0] as ExtendLoreInput | undefined;
    expect(passed?.tokenAddr).toBe(TOKEN_ADDR);
    expect(passed?.previousChapters).toEqual(['runtime-ch1']);
    expect(passed?.targetChapterNumber).toBe(2);
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
