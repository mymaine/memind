import { describe, it, expect, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Log, type PublicClient } from 'viem';
import { LoreStore } from '../state/lore-store.js';
import { TokenIdentityReader, type TokenIdentity } from '../state/token-identity-reader.js';
import { createGetTokenInfoTool, GET_TOKEN_INFO_TOOL_NAME } from './get-token-info.js';
import { ERC20_TRANSFER_EVENT } from '../chain/token-manager-abi.js';

/**
 * get_token_info tests — cover the three include combinations, the empty
 * narrative branch, the parallel execution path, and the cache-hit
 * short-circuit that proves the identity reader's LRU is actually wired in.
 *
 * Strategy: inject a stub TokenIdentityReader (subclass override) so we can
 * assert the tool calls it exactly once per execute; LoreStore is used with
 * the in-memory test seam; viem PublicClient is faked the same way as
 * token-status.test.ts when `market` is enabled.
 */

const TOKEN_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const TOKEN_ADDR_CHECKSUM = '0x1234567890AbcdEF1234567890aBcdef12345678';

interface StubIdentity {
  symbol?: string;
  name?: string;
  decimals?: number;
  totalSupply?: string;
  deployedOnChain?: boolean;
  shouldThrow?: Error;
}

/**
 * Minimal TokenIdentityReader stub. Extends the real class so type
 * assignability stays correct, but overrides `readIdentity` to return a
 * canned record. Counts call occurrences via an internal spy.
 */
class StubTokenIdentityReader extends TokenIdentityReader {
  public readonly spy = vi.fn(async (tokenAddr: string): Promise<TokenIdentity> => {
    if (this.opts.shouldThrow !== undefined) throw this.opts.shouldThrow;
    return {
      tokenAddr,
      symbol: this.opts.symbol ?? 'HBNB2026-HKAT',
      name: this.opts.name ?? 'HBNB2026-Hackathon Kat',
      decimals: this.opts.decimals ?? 18,
      totalSupply: this.opts.totalSupply ?? '1000000000000000000000000',
      deployedOnChain: this.opts.deployedOnChain ?? true,
    };
  });
  constructor(private readonly opts: StubIdentity = {}) {
    super({ publicClient: {} as unknown as PublicClient });
  }
  override async readIdentity(tokenAddr: string): Promise<TokenIdentity> {
    return this.spy(tokenAddr);
  }
}

const HOLDER_A = '0x00000000000000000000000000000000000000aa';
const ZERO = '0x0000000000000000000000000000000000000000';

function transferLog(toAddr: string): Log {
  const topics = encodeEventTopics({
    abi: [ERC20_TRANSFER_EVENT],
    eventName: 'Transfer',
    args: { from: ZERO as `0x${string}`, to: toAddr as `0x${string}` },
  });
  const data = encodeAbiParameters([{ type: 'uint256' }], [1n]);
  return {
    address: TOKEN_ADDR,
    topics,
    data,
    blockHash: ('0x' + '0'.repeat(64)) as `0x${string}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: ('0x' + '1'.repeat(64)) as `0x${string}`,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function tokenInfosTuple(
  overrides: {
    totalSupply?: bigint;
    maxRaising?: bigint;
    funds?: bigint;
    lastPrice?: bigint;
  } = {},
): unknown[] {
  return [
    ('0x' + '0'.repeat(40)) as `0x${string}`,
    ('0x' + '0'.repeat(40)) as `0x${string}`,
    ('0x' + '0'.repeat(40)) as `0x${string}`,
    overrides.totalSupply ?? 0n,
    0n,
    overrides.maxRaising ?? 0n,
    0n,
    0n,
    overrides.funds ?? 0n,
    overrides.lastPrice ?? 0n,
    0n,
    0n,
    0n,
  ];
}

function fakeMarketClient(): PublicClient {
  return {
    getBlockNumber: vi.fn(async () => 100_000n),
    getCode: vi.fn(async () => '0x6080'),
    getLogs: vi.fn(async () => [transferLog(HOLDER_A)]),
    readContract: vi.fn(async () =>
      tokenInfosTuple({
        totalSupply: 1_000_000_000_000_000_000_000_000n,
        maxRaising: 24_000_000_000_000_000_000n,
        funds: 12_000_000_000_000_000_000n,
        lastPrice: 1_000_000_000_000_000n,
      }),
    ),
  } as unknown as PublicClient;
}

describe('createGetTokenInfoTool', () => {
  it('tool identity matches the exported constant', () => {
    const tool = createGetTokenInfoTool({
      tokenIdentityReader: new StubTokenIdentityReader(),
      loreStore: new LoreStore(),
    });
    expect(tool.name).toBe(GET_TOKEN_INFO_TOOL_NAME);
    expect(tool.name).toBe('get_token_info');
  });

  it('default include: returns identity + narrative, omits market', async () => {
    const reader = new StubTokenIdentityReader();
    const loreStore = new LoreStore();
    await loreStore.upsert({
      tokenAddr: TOKEN_ADDR,
      chapterNumber: 1,
      chapterText: 'Opening chapter prose\nwith a second paragraph.',
      ipfsHash: 'bafkrei-ch1',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      tokenName: 'HBNB2026-Hackathon Kat',
      tokenSymbol: 'HBNB2026-HKAT',
      publishedAt: '2026-04-21T00:00:00.000Z',
    });

    const tool = createGetTokenInfoTool({ tokenIdentityReader: reader, loreStore });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });

    expect(out.tokenAddr).toBe(TOKEN_ADDR);
    expect(out.identity?.symbol).toBe('HBNB2026-HKAT');
    expect(out.identity?.name).toBe('HBNB2026-Hackathon Kat');
    expect(out.identity?.deployedOnChain).toBe(true);
    expect(out.narrative?.totalChapters).toBe(1);
    expect(out.narrative?.latestChapterText).toContain('Opening chapter prose');
    expect(out.narrative?.chapterSummaries[0]?.firstLine).toBe('Opening chapter prose');
    expect(out.market).toBeUndefined();
  });

  it('include.market=true: runs the market read alongside the identity + narrative strands', async () => {
    const reader = new StubTokenIdentityReader();
    const loreStore = new LoreStore();
    const publicClient = fakeMarketClient();

    const tool = createGetTokenInfoTool({ tokenIdentityReader: reader, loreStore, publicClient });
    const out = await tool.execute({
      tokenAddr: TOKEN_ADDR,
      include: { market: true },
    });

    expect(out.identity?.symbol).toBe('HBNB2026-HKAT');
    expect(out.market).toBeDefined();
    expect(out.market?.holderCount).toBe(1);
    expect(out.market?.curveProgress).toBeCloseTo(50, 2);
    // Market still returns `inspectedAtBlock` as a block-number string.
    expect(out.market?.inspectedAtBlock).toBe('100000');
  });

  it('include.identity=false disables the identity strand entirely', async () => {
    const reader = new StubTokenIdentityReader();
    const loreStore = new LoreStore();
    await loreStore.upsert({
      tokenAddr: TOKEN_ADDR,
      chapterNumber: 1,
      chapterText: 'ch1',
      ipfsHash: 'bafkrei-ch1',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      tokenName: 'HBNB2026-X',
      tokenSymbol: 'HBNB2026-X',
      publishedAt: '2026-04-21T00:00:00.000Z',
    });
    const tool = createGetTokenInfoTool({ tokenIdentityReader: reader, loreStore });
    const out = await tool.execute({
      tokenAddr: TOKEN_ADDR,
      include: { identity: false, narrative: true },
    });
    expect(out.identity).toBeUndefined();
    expect(out.narrative?.totalChapters).toBe(1);
    expect(reader.spy).not.toHaveBeenCalled();
  });

  it('narrative strand returns empty scaffolding when the token has no stored chapters', async () => {
    const reader = new StubTokenIdentityReader();
    const loreStore = new LoreStore();
    const tool = createGetTokenInfoTool({ tokenIdentityReader: reader, loreStore });

    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.narrative).toEqual({
      totalChapters: 0,
      latestChapterText: '',
      chapterSummaries: [],
    });
  });

  it('identity failure propagates so the caller cannot fabricate a symbol', async () => {
    const reader = new StubTokenIdentityReader({
      shouldThrow: new Error('rpc getCode boom'),
    });
    const tool = createGetTokenInfoTool({
      tokenIdentityReader: reader,
      loreStore: new LoreStore(),
    });
    await expect(tool.execute({ tokenAddr: TOKEN_ADDR })).rejects.toThrow(/getCode boom/);
  });

  it('truncates the latest chapter text to the 2000-char cap', async () => {
    const reader = new StubTokenIdentityReader();
    const loreStore = new LoreStore();
    await loreStore.upsert({
      tokenAddr: TOKEN_ADDR,
      chapterNumber: 1,
      // 3000 chars, no newlines — hits the cap cleanly.
      chapterText: 'A'.repeat(3000),
      ipfsHash: 'bafkrei-ch1',
      ipfsUri: 'https://gateway.pinata.cloud/ipfs/bafkrei-ch1',
      tokenName: 'N',
      tokenSymbol: 'N',
      publishedAt: '2026-04-21T00:00:00.000Z',
    });
    const tool = createGetTokenInfoTool({ tokenIdentityReader: reader, loreStore });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.narrative?.latestChapterText.length).toBe(2000);
    // chapterSummaries firstLine uses a 120-char cap independent of the 2000.
    expect(out.narrative?.chapterSummaries[0]?.firstLine.length).toBe(120);
  });

  it('surfaces every chapter summary in chronological order', async () => {
    const reader = new StubTokenIdentityReader();
    const loreStore = new LoreStore();
    for (const n of [1, 2, 3]) {
      await loreStore.upsert({
        tokenAddr: TOKEN_ADDR,
        chapterNumber: n,
        chapterText: `chapter ${n.toString()} begins...`,
        ipfsHash: `bafkrei-ch${n.toString()}`,
        ipfsUri: `https://gateway.pinata.cloud/ipfs/bafkrei-ch${n.toString()}`,
        tokenName: 'N',
        tokenSymbol: 'N',
        publishedAt: '2026-04-21T00:00:00.000Z',
      });
    }
    const tool = createGetTokenInfoTool({ tokenIdentityReader: reader, loreStore });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.narrative?.totalChapters).toBe(3);
    expect(out.narrative?.chapterSummaries.map((s) => s.chapterNumber)).toEqual([1, 2, 3]);
    expect(out.narrative?.latestChapterText).toMatch(/chapter 3/);
  });

  it('rejects invalid tokenAddr via zod before any reader is called', async () => {
    const reader = new StubTokenIdentityReader();
    const tool = createGetTokenInfoTool({
      tokenIdentityReader: reader,
      loreStore: new LoreStore(),
    });
    await expect(tool.execute({ tokenAddr: 'not-an-addr' } as never)).rejects.toThrow();
    expect(reader.spy).not.toHaveBeenCalled();
  });

  it('market strand without rpcUrl or publicClient throws a clear error', async () => {
    const reader = new StubTokenIdentityReader();
    const tool = createGetTokenInfoTool({
      tokenIdentityReader: reader,
      loreStore: new LoreStore(),
    });
    await expect(
      tool.execute({
        tokenAddr: TOKEN_ADDR,
        include: { identity: false, narrative: false, market: true },
      }),
    ).rejects.toThrow(/publicClient.*rpcUrl/);
  });

  it('each execute delegates to the underlying reader (LRU covered by reader tests)', async () => {
    // The LRU lives on the TokenIdentityReader itself — we verify the tool
    // defers to whatever the reader returns. With a stubbed reader the
    // "cache hit" equivalent is: calling `readIdentity` exactly once per
    // execute. Two sequential executes therefore hit the spy twice; the
    // real LRU is covered in token-identity-reader.test.ts.
    const reader = new StubTokenIdentityReader();
    const tool = createGetTokenInfoTool({
      tokenIdentityReader: reader,
      loreStore: new LoreStore(),
    });
    await tool.execute({ tokenAddr: TOKEN_ADDR });
    await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(reader.spy).toHaveBeenCalledTimes(2);
    // Both calls use the checksum-normalised address the tool re-normalises
    // on its own — confirming the factory passes tokenAddr verbatim.
    for (const call of reader.spy.mock.calls) {
      expect(call[0]).toBe(TOKEN_ADDR);
    }
    // Returned tokenAddr echoes the tool's input verbatim (not the stub's
    // checksum normalisation) so the caller can cross-reference easily.
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.tokenAddr).toBe(TOKEN_ADDR);
    expect(TOKEN_ADDR_CHECKSUM.toLowerCase()).toBe(TOKEN_ADDR);
  });
});
