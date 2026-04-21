import { describe, it, expect, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { TokenIdentityReader } from './token-identity-reader.js';

/**
 * TokenIdentityReader unit tests.
 *
 * Strategy mirrors token-status.test.ts: inject a minimal PublicClient fake
 * that answers only the two methods the reader calls (`getCode`,
 * `readContract`). Covers the happy path, LRU hit/evict, TTL expiry, bytecode
 * short-circuit, and the read-failure throw contract.
 */

const TOKEN_ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const TOKEN_ADDR_CHECKSUM = '0x1234567890AbcdEF1234567890aBcdef12345678'; // viem checksums the mixed-case variant

interface FakeIdentityOpts {
  bytecode?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: bigint;
  /** When true, every readContract call rejects with the supplied error. */
  readContractShouldReject?: boolean | Error;
  getCodeShouldReject?: boolean | Error;
}

/**
 * Build a fake PublicClient with `vi.fn` hooks so tests can assert call
 * counts (used for LRU / TTL assertions) without reaching for a real RPC.
 */
function fakeClient(opts: FakeIdentityOpts = {}): PublicClient {
  const bytecode = opts.bytecode ?? '0x6080604052';
  const getCode = vi.fn(async () => {
    if (opts.getCodeShouldReject) {
      throw opts.getCodeShouldReject instanceof Error
        ? opts.getCodeShouldReject
        : new Error('getCode boom');
    }
    return bytecode;
  });
  const readContract = vi.fn(async (params: { functionName: string }) => {
    if (opts.readContractShouldReject) {
      throw opts.readContractShouldReject instanceof Error
        ? opts.readContractShouldReject
        : new Error('readContract reverted');
    }
    switch (params.functionName) {
      case 'name':
        return opts.name ?? 'HBNB2026-Hackathon Kat';
      case 'symbol':
        return opts.symbol ?? 'HBNB2026-HKAT';
      case 'decimals':
        return opts.decimals ?? 18;
      case 'totalSupply':
        return opts.totalSupply ?? 1_000_000_000_000_000_000_000_000n;
      default:
        throw new Error(`unexpected functionName=${params.functionName}`);
    }
  });
  return { getCode, readContract } as unknown as PublicClient;
}

describe('TokenIdentityReader', () => {
  it('returns the ERC-20 quartet and normalises the returned address to checksum form', async () => {
    const client = fakeClient();
    const reader = new TokenIdentityReader({ publicClient: client });

    const out = await reader.readIdentity(TOKEN_ADDR);

    expect(out.tokenAddr).toBe(TOKEN_ADDR_CHECKSUM);
    expect(out.symbol).toBe('HBNB2026-HKAT');
    expect(out.name).toBe('HBNB2026-Hackathon Kat');
    expect(out.decimals).toBe(18);
    // totalSupply surfaces as a decimal string so the value stays JSON-safe.
    expect(out.totalSupply).toBe('1000000000000000000000000');
    expect(out.deployedOnChain).toBe(true);
  });

  it('short-circuits when getCode returns 0x with deployedOnChain=false and no readContract', async () => {
    const client = fakeClient({ bytecode: '0x' });
    const reader = new TokenIdentityReader({ publicClient: client });

    const out = await reader.readIdentity(TOKEN_ADDR);

    expect(out.deployedOnChain).toBe(false);
    expect(out.symbol).toBe('');
    expect(out.name).toBe('');
    expect(out.decimals).toBe(0);
    expect(out.totalSupply).toBe('0');
    // readContract must not be touched when there is nothing to call.
    expect(client.readContract as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('throws when any of the four reads reverts so the caller can decide to degrade', async () => {
    const client = fakeClient({ readContractShouldReject: true });
    const reader = new TokenIdentityReader({ publicClient: client });
    await expect(reader.readIdentity(TOKEN_ADDR)).rejects.toThrow(/readContract reverted/);
  });

  it('caches a successful read and does not re-hit the RPC on the next call', async () => {
    const client = fakeClient();
    const reader = new TokenIdentityReader({ publicClient: client });

    await reader.readIdentity(TOKEN_ADDR);
    await reader.readIdentity(TOKEN_ADDR);

    // One bytecode check + one parallel readContract fan-out on the first call
    // only — the LRU hit on the second call bypasses both.
    expect(client.getCode as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(client.readContract as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(4);
  });

  it('expires cache entries after the TTL and falls through to a fresh read', async () => {
    const client = fakeClient();
    let now = 1_000_000;
    const reader = new TokenIdentityReader({
      publicClient: client,
      cacheTtlMs: 500,
      now: () => now,
    });

    await reader.readIdentity(TOKEN_ADDR);
    // Advance the fake clock past the TTL — the entry should be invalidated.
    now += 1_000;
    await reader.readIdentity(TOKEN_ADDR);

    expect(client.getCode as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when the cache exceeds cacheMaxEntries', async () => {
    const client = fakeClient();
    const reader = new TokenIdentityReader({
      publicClient: client,
      cacheMaxEntries: 2,
    });

    const A = '0x' + 'a'.repeat(40);
    const B = '0x' + 'b'.repeat(40);
    const C = '0x' + 'c'.repeat(40);
    await reader.readIdentity(A);
    await reader.readIdentity(B);
    await reader.readIdentity(C); // should evict A
    expect(reader.cacheSize()).toBe(2);

    // A re-read of A must miss the cache (fresh RPC call) while a re-read of
    // C stays hot. Track getCode call count before/after to verify.
    const beforeA = (client.getCode as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await reader.readIdentity(A);
    const afterA = (client.getCode as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterA).toBe(beforeA + 1);

    const beforeC = (client.getCode as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await reader.readIdentity(C);
    const afterC = (client.getCode as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterC).toBe(beforeC);
  });

  it('refreshes LRU recency on read so a hot key does not get evicted by newer inserts', async () => {
    const client = fakeClient();
    const reader = new TokenIdentityReader({
      publicClient: client,
      cacheMaxEntries: 2,
    });

    const A = '0x' + 'a'.repeat(40);
    const B = '0x' + 'b'.repeat(40);
    const C = '0x' + 'c'.repeat(40);
    await reader.readIdentity(A);
    await reader.readIdentity(B);
    // Re-read A → touches recency, should not evict. Next insert (C) evicts B.
    await reader.readIdentity(A);
    await reader.readIdentity(C);

    // A still hot: re-read must not increment getCode.
    const beforeA = (client.getCode as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await reader.readIdentity(A);
    expect((client.getCode as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(beforeA);
  });

  it('requires either publicClient or rpcUrl at construction', () => {
    expect(() => new TokenIdentityReader()).toThrow(/publicClient.*rpcUrl/);
  });
});
