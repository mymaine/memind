import { describe, it, expect, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Log, type PublicClient } from 'viem';
import {
  countUniqueRecipients,
  createCheckTokenStatusTool,
  tokenStatusInputSchema,
  tokenStatusOutputSchema,
} from './token-status.js';
import { ERC20_TRANSFER_EVENT } from '../chain/token-manager-abi.js';

/**
 * Unit tests for check_token_status. The real flow hits a BSC JSON-RPC; we
 * inject a minimal PublicClient fake exposing only the methods the tool
 * actually calls. No network.
 */

const TOKEN_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const ZERO = '0x0000000000000000000000000000000000000000';
const HOLDER_A = '0x00000000000000000000000000000000000000aa';
const HOLDER_B = '0x00000000000000000000000000000000000000bb';

/**
 * Build an ERC-20-compliant Transfer log the tool can decode via viem's
 * `decodeEventLog`. The `to` indexed topic is what we care about for the
 * holder count; `from` and `value` are set to stable filler.
 */
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

/**
 * Shape of the `_tokenInfos` tuple return. Viem decodes array-of-positional
 * outputs into a tuple we can mirror with a plain array. Order follows
 * chain/token-manager-abi.ts.
 */
function tokenInfosTuple(overrides: {
  totalSupply?: bigint;
  maxRaising?: bigint;
  funds?: bigint;
  lastPrice?: bigint;
  status?: bigint;
}): unknown[] {
  return [
    ('0x' + '0'.repeat(40)) as `0x${string}`, // base
    ('0x' + '0'.repeat(40)) as `0x${string}`, // quote
    ('0x' + '0'.repeat(40)) as `0x${string}`, // template
    overrides.totalSupply ?? 0n,
    0n, // maxOffers
    overrides.maxRaising ?? 0n,
    0n, // launchTime
    0n, // offers
    overrides.funds ?? 0n,
    overrides.lastPrice ?? 0n,
    0n, // K
    0n, // T
    overrides.status ?? 0n,
  ];
}

interface FakeClientOptions {
  bytecode?: string;
  blockNumber?: bigint;
  transferLogs?: Log[];
  tokenInfos?: unknown[];
  tokenInfosShouldRevert?: boolean;
  getLogsShouldReject?: boolean;
}

/**
 * Minimal PublicClient fake. Returns canned responses and records calls so
 * individual tests can assert on filter ranges.
 */
function fakeClient(opts: FakeClientOptions = {}): PublicClient {
  const bytecode = opts.bytecode ?? '0x6080604052'; // non-empty default
  const getLogs = vi.fn(async () => {
    if (opts.getLogsShouldReject) throw new Error('rpc getLogs boom');
    return opts.transferLogs ?? [];
  });
  const readContract = vi.fn(async () => {
    if (opts.tokenInfosShouldRevert) throw new Error('execution reverted: token not registered');
    return opts.tokenInfos ?? tokenInfosTuple({});
  });
  const getCode = vi.fn(async () => bytecode);
  const getBlockNumber = vi.fn(async () => opts.blockNumber ?? 50_000n);

  // We intentionally expose a superset of the viem PublicClient type through
  // a cast: the tool only calls these four methods, and keeping the fake
  // small is the whole point of the DI seam.
  return {
    getCode,
    getBlockNumber,
    getLogs,
    readContract,
  } as unknown as PublicClient;
}

describe('tokenStatusInputSchema', () => {
  it('accepts a valid 0x-prefixed 40-hex address', () => {
    expect(tokenStatusInputSchema.safeParse({ tokenAddr: TOKEN_ADDR }).success).toBe(true);
  });

  it('rejects an invalid address format', () => {
    expect(tokenStatusInputSchema.safeParse({ tokenAddr: 'not-hex' }).success).toBe(false);
    // Also rejects short hex strings.
    expect(tokenStatusInputSchema.safeParse({ tokenAddr: '0xabc' }).success).toBe(false);
  });
});

describe('countUniqueRecipients', () => {
  it('counts unique non-zero recipients', () => {
    const logs = [transferLog(HOLDER_A), transferLog(HOLDER_B), transferLog(HOLDER_A)];
    expect(countUniqueRecipients(logs)).toBe(2);
  });

  it('excludes the zero address from the count', () => {
    const logs = [transferLog(ZERO), transferLog(HOLDER_A)];
    expect(countUniqueRecipients(logs)).toBe(1);
  });

  it('returns 0 on an empty set', () => {
    expect(countUniqueRecipients([])).toBe(0);
  });
});

describe('createCheckTokenStatusTool.execute', () => {
  it('returns deployedOnChain=true with computed metrics when bytecode is present', async () => {
    const client = fakeClient({
      bytecode: '0x6080604052',
      blockNumber: 100_000n,
      transferLogs: [transferLog(HOLDER_A), transferLog(HOLDER_B), transferLog(HOLDER_A)],
      tokenInfos: tokenInfosTuple({
        totalSupply: 1_000_000_000_000_000_000_000_000n, // 1e24 base units
        maxRaising: 24_000_000_000_000_000_000n, // 24 BNB target
        funds: 12_000_000_000_000_000_000n, // 12 BNB raised -> 50%
        lastPrice: 1_000_000_000_000_000n, // 1e15 wei/token
      }),
    });

    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });

    expect(out.deployedOnChain).toBe(true);
    expect(out.holderCount).toBe(2);
    expect(out.bondingCurveProgress).toBeCloseTo(50, 4);
    expect(out.marketCapBnb).not.toBeNull();
    // volume24hBnb is documented as null (Trade ABI out of scope).
    expect(out.volume24hBnb).toBeNull();
    expect(out.inspectedAtBlock).toBe('100000');
    expect(out.warnings.some((w) => w.startsWith('volume24hBnb unavailable'))).toBe(true);
  });

  it('short-circuits when bytecode is 0x and returns null metrics + warning', async () => {
    const client = fakeClient({ bytecode: '0x', blockNumber: 42n });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });

    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.deployedOnChain).toBe(false);
    expect(out.holderCount).toBe(0);
    expect(out.bondingCurveProgress).toBeNull();
    expect(out.volume24hBnb).toBeNull();
    expect(out.marketCapBnb).toBeNull();
    expect(out.inspectedAtBlock).toBe('42');
    expect(out.warnings[0]).toMatch(/not deployed/);
    // getLogs / readContract must NOT be called when there is no contract.
    expect(client.getLogs as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(client.readContract as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('throws when input address format is invalid', async () => {
    const client = fakeClient();
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    await expect(tool.execute({ tokenAddr: 'not-an-address' })).rejects.toThrow();
  });

  it('returns bondingCurveProgress=null + warning when _tokenInfos reverts', async () => {
    const client = fakeClient({
      bytecode: '0x6080',
      tokenInfosShouldRevert: true,
      transferLogs: [transferLog(HOLDER_A)],
    });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.bondingCurveProgress).toBeNull();
    expect(out.marketCapBnb).toBeNull();
    expect(out.warnings.some((w) => w.startsWith('bondingCurveProgress unavailable'))).toBe(true);
    // holderCount still computed — unrelated failure mode.
    expect(out.holderCount).toBe(1);
  });

  it('excludes zero-address recipients from holderCount via end-to-end path', async () => {
    const client = fakeClient({
      transferLogs: [
        transferLog(ZERO),
        transferLog(HOLDER_A),
        transferLog(HOLDER_B),
        transferLog(HOLDER_A),
        transferLog(ZERO),
      ],
    });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.holderCount).toBe(2);
  });

  it('output always passes tokenStatusOutputSchema.parse', async () => {
    const client = fakeClient({ tokenInfosShouldRevert: true, getLogsShouldReject: true });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    // Re-parse to assert the tool never leaks a shape the schema would reject.
    expect(() => tokenStatusOutputSchema.parse(out)).not.toThrow();
    // Double-fault: both getLogs and readContract failed, so warnings
    // should include the holder-scan failure alongside the curve failure.
    expect(out.warnings.some((w) => w.startsWith('holderCount scan failed'))).toBe(true);
  });

  it('honours a custom holderScanBlockRange when capping the fromBlock', async () => {
    const client = fakeClient({ blockNumber: 1_000_000n });
    const tool = createCheckTokenStatusTool({
      rpcUrl: 'http://ignored',
      publicClient: client,
      holderScanBlockRange: 500n,
    });
    await tool.execute({ tokenAddr: TOKEN_ADDR });
    const getLogs = client.getLogs as unknown as ReturnType<typeof vi.fn>;
    expect(getLogs).toHaveBeenCalledTimes(1);
    const args = getLogs.mock.calls[0]![0] as { fromBlock: bigint; toBlock: bigint };
    expect(args.fromBlock).toBe(999_500n);
    expect(args.toBlock).toBe(1_000_000n);
  });

  // --- Fix 1: marketCapBnb sub-1-BNB precision + overflow guard ------------
  it('preserves precision for sub-1-BNB market caps (no BigInt truncation to 0)', async () => {
    // lastPrice = 1e12 wei-per-token (1e-6 BNB/token),
    // totalSupply = 1e24 atomic (1e6 tokens) => market cap = 1 BNB.
    // Pre-fix formula: (1e12 * 1e24) / 1e36 = 10^0 = 1 (integer), still 1 here.
    // A smaller-price case exposes the bug: price = 1e9, supply = 1e24
    // => market cap = 1e-3 BNB but BigInt division yields 0.
    const client = fakeClient({
      bytecode: '0x6080',
      blockNumber: 100n,
      transferLogs: [],
      tokenInfos: tokenInfosTuple({
        totalSupply: 1_000_000_000_000_000_000_000_000n, // 1e24
        maxRaising: 24_000_000_000_000_000_000n,
        funds: 0n,
        lastPrice: 1_000_000_000n, // 1e9 wei/token => 1e-9 BNB/token => 1e-3 BNB cap
      }),
    });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.marketCapBnb).not.toBeNull();
    expect(out.marketCapBnb!).toBeGreaterThan(0);
    expect(out.marketCapBnb!).toBeLessThan(0.01);
    expect(out.marketCapBnb!).toBeCloseTo(0.001, 6);
  });

  it('returns marketCapBnb=null + warning when computed value overflows Number', async () => {
    // price * supply / 1e36 easily overflows when both operands are 1e60-ish.
    // Choose values that produce a safe-precision bigint quotient far beyond
    // Number.MAX_VALUE (~1.8e308) when we go through the expanded formula.
    const huge = 10n ** 200n;
    const client = fakeClient({
      bytecode: '0x6080',
      blockNumber: 100n,
      transferLogs: [],
      tokenInfos: tokenInfosTuple({
        totalSupply: huge,
        maxRaising: 24_000_000_000_000_000_000n,
        funds: 0n,
        lastPrice: huge,
      }),
    });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.marketCapBnb).toBeNull();
    expect(out.warnings.some((w) => /marketCapBnb out of safe numeric range/.test(w))).toBe(true);
  });

  // --- Fix 2: getLogs chunked pagination -----------------------------------
  it('chunks a 10_000 block holder scan into two 5_000-block getLogs calls', async () => {
    const client = fakeClient({
      bytecode: '0x6080',
      blockNumber: 1_000_000n,
      transferLogs: [],
    });
    const tool = createCheckTokenStatusTool({
      rpcUrl: 'http://ignored',
      publicClient: client,
      holderScanBlockRange: 10_000n,
    });
    await tool.execute({ tokenAddr: TOKEN_ADDR });
    const getLogs = client.getLogs as unknown as ReturnType<typeof vi.fn>;
    expect(getLogs).toHaveBeenCalledTimes(2);
    const first = getLogs.mock.calls[0]![0] as { fromBlock: bigint; toBlock: bigint };
    const second = getLogs.mock.calls[1]![0] as { fromBlock: bigint; toBlock: bigint };
    // Chunks must cover [from..toBlock] inclusive without gap or overlap.
    expect(first.fromBlock).toBe(990_000n);
    expect(first.toBlock).toBe(995_000n);
    expect(second.fromBlock).toBe(995_001n);
    expect(second.toBlock).toBe(1_000_000n);
  });

  it('uses a single getLogs call when span <= 5_000 blocks', async () => {
    const client = fakeClient({
      bytecode: '0x6080',
      blockNumber: 1_000_000n,
      transferLogs: [],
    });
    const tool = createCheckTokenStatusTool({
      rpcUrl: 'http://ignored',
      publicClient: client,
      holderScanBlockRange: 3_000n,
    });
    await tool.execute({ tokenAddr: TOKEN_ADDR });
    const getLogs = client.getLogs as unknown as ReturnType<typeof vi.fn>;
    expect(getLogs).toHaveBeenCalledTimes(1);
    const args = getLogs.mock.calls[0]![0] as { fromBlock: bigint; toBlock: bigint };
    expect(args.fromBlock).toBe(997_000n);
    expect(args.toBlock).toBe(1_000_000n);
  });

  it('partial chunk failure reports N/M warning and still counts successful chunk holders', async () => {
    // First chunk rejects, second returns a HOLDER_A transfer; final count = 1.
    const getLogs = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk boom'))
      .mockResolvedValueOnce([transferLog(HOLDER_A)]);
    const readContract = vi.fn(async () => tokenInfosTuple({}));
    const client = {
      getCode: vi.fn(async () => '0x6080'),
      getBlockNumber: vi.fn(async () => 1_000_000n),
      getLogs,
      readContract,
    } as unknown as PublicClient;
    const tool = createCheckTokenStatusTool({
      rpcUrl: 'http://ignored',
      publicClient: client,
      holderScanBlockRange: 10_000n,
    });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(getLogs).toHaveBeenCalledTimes(2);
    expect(out.holderCount).toBe(1);
    expect(
      out.warnings.some((w) => /holderCount scan failed — partial — 1\/2 chunks failed/.test(w)),
    ).toBe(true);
  });

  // --- Fix 3: _tokenInfos tuple length pin ---------------------------------
  it('rejects _tokenInfos tuple of wrong length with explicit warning', async () => {
    // Tuple truncated to 12 fields: decode must return null + warning.
    const shortTuple = tokenInfosTuple({
      totalSupply: 1n,
      maxRaising: 1n,
      funds: 0n,
      lastPrice: 1n,
    }).slice(0, 12);
    const client = fakeClient({
      bytecode: '0x6080',
      tokenInfos: shortTuple,
    });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.bondingCurveProgress).toBeNull();
    expect(out.marketCapBnb).toBeNull();
    expect(
      out.warnings.some((w) => /_tokenInfos tuple length mismatch \(expected 13, got 12\)/.test(w)),
    ).toBe(true);
  });

  it('rejects _tokenInfos tuple of length 14 with explicit warning', async () => {
    const longTuple = [...tokenInfosTuple({}), 0n];
    const client = fakeClient({
      bytecode: '0x6080',
      tokenInfos: longTuple,
    });
    const tool = createCheckTokenStatusTool({ rpcUrl: 'http://ignored', publicClient: client });
    const out = await tool.execute({ tokenAddr: TOKEN_ADDR });
    expect(out.bondingCurveProgress).toBeNull();
    expect(out.marketCapBnb).toBeNull();
    expect(
      out.warnings.some((w) => /_tokenInfos tuple length mismatch \(expected 13, got 14\)/.test(w)),
    ).toBe(true);
  });
});
