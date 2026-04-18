import { describe, it, expect, vi } from 'vitest';
import {
  buildAnchorTxRequest,
  isAnchorOnChainEnabled,
  sendAnchorMemoTx,
  type AnchorTxDeps,
} from './anchor-tx.js';

/**
 * anchor-tx is the optional layer-2 hook for AC3: when
 * `ANCHOR_ON_CHAIN=true` and a BSC deployer wallet is configured, we fire a
 * zero-value self-tx on BSC mainnet whose `data` field carries the 32-byte
 * keccak256 contentHash. The tx acts as an on-chain memo — no smart contract
 * to deploy; ~$0.01 of BNB gas per chapter.
 *
 * Tests keep the RPC + signer hermetic by DI: a fake walletClient stands in
 * for viem's real createWalletClient so assertions can inspect the outgoing
 * tx request (to = from, value = 0n, data = contentHash) without touching
 * bsc-dataseed.binance.org.
 */

const CONTENT_HASH = `0x${'a'.repeat(64)}` as const;
const PRIVATE_KEY = `0x${'b'.repeat(64)}` as const;
const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

function makeDeps(overrides?: Partial<AnchorTxDeps>): AnchorTxDeps {
  const sendTransaction = vi.fn().mockResolvedValue(`0x${'c'.repeat(64)}`);
  return {
    privateKey: PRIVATE_KEY,
    walletClientFactory: () => ({
      account: { address: ADDRESS },
      sendTransaction,
    }),
    explorerUrlBuilder: (txHash) => `https://bscscan.com/tx/${txHash}`,
    ...overrides,
  };
}

describe('isAnchorOnChainEnabled', () => {
  it('returns true only when env flag is exactly "true"', () => {
    expect(isAnchorOnChainEnabled({ ANCHOR_ON_CHAIN: 'true' })).toBe(true);
    expect(isAnchorOnChainEnabled({ ANCHOR_ON_CHAIN: 'false' })).toBe(false);
    expect(isAnchorOnChainEnabled({ ANCHOR_ON_CHAIN: '1' })).toBe(false);
    expect(isAnchorOnChainEnabled({ ANCHOR_ON_CHAIN: '' })).toBe(false);
    expect(isAnchorOnChainEnabled({})).toBe(false);
  });
});

describe('buildAnchorTxRequest', () => {
  it('constructs a self-tx with value=0 and data=contentHash', () => {
    const req = buildAnchorTxRequest({ from: ADDRESS, contentHash: CONTENT_HASH });
    expect(req.to).toBe(ADDRESS);
    expect(req.value).toBe(0n);
    expect(req.data).toBe(CONTENT_HASH);
  });
});

describe('sendAnchorMemoTx', () => {
  it('signs + sends a zero-value self-tx and returns the settlement fields', async () => {
    const sendTransaction = vi.fn().mockResolvedValue(`0x${'c'.repeat(64)}`);
    const deps = makeDeps({
      walletClientFactory: () => ({
        account: { address: ADDRESS },
        sendTransaction,
      }),
    });

    const result = await sendAnchorMemoTx({
      contentHash: CONTENT_HASH,
      deps,
    });

    expect(result.onChainTxHash).toBe(`0x${'c'.repeat(64)}`);
    expect(result.chain).toBe('bsc-mainnet');
    expect(result.explorerUrl).toBe(`https://bscscan.com/tx/0x${'c'.repeat(64)}`);

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    const txArgs = sendTransaction.mock.calls[0]?.[0] as {
      to: string;
      value: bigint;
      data: string;
    };
    expect(txArgs.to).toBe(ADDRESS);
    expect(txArgs.value).toBe(0n);
    expect(txArgs.data).toBe(CONTENT_HASH);
  });

  it('rejects malformed contentHash before touching the wallet', async () => {
    const sendTransaction = vi.fn();
    const deps = makeDeps({
      walletClientFactory: () => ({
        account: { address: ADDRESS },
        sendTransaction,
      }),
    });

    await expect(
      sendAnchorMemoTx({
        contentHash: '0xabc' as `0x${string}`,
        deps,
      }),
    ).rejects.toThrow(/contentHash/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('surfaces wallet send errors unchanged', async () => {
    const sendTransaction = vi.fn().mockRejectedValue(new Error('insufficient funds'));
    const deps = makeDeps({
      walletClientFactory: () => ({
        account: { address: ADDRESS },
        sendTransaction,
      }),
    });

    await expect(sendAnchorMemoTx({ contentHash: CONTENT_HASH, deps })).rejects.toThrow(
      /insufficient funds/,
    );
  });
});
