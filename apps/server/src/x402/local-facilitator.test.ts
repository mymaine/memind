import { describe, expect, it, vi } from 'vitest';
import type { WalletClient } from 'viem';
import type { Network } from '@x402/core/types';
import { x402Facilitator } from '@x402/core/facilitator';

import { createLocalFacilitator } from './local-facilitator.js';

// A shared fixture private key (well-known Hardhat test account #0). We never
// hit the chain in these tests, so using a recognisable zeroed-nonce key is
// safer than inlining the real agent key.
const FIXTURE_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

/**
 * Build a minimal stub matching the subset of `WalletClient` that
 * `toFacilitatorEvmSigner` touches (top-level `address` via our factory's
 * spread plus `account.address` so the factory can lift the EOA up).
 *
 * We return an identity-like object — the factory never invokes its methods
 * (that only happens inside `x402Facilitator.settle()` which we do not call
 * in these tests), so empty fn stubs are enough to satisfy the type.
 */
function buildStubWalletClient(address: `0x${string}`): WalletClient {
  return {
    account: { address },
    readContract: vi.fn(),
    writeContract: vi.fn(),
    sendTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    verifyTypedData: vi.fn(),
    getCode: vi.fn(),
  } as unknown as WalletClient;
}

describe('createLocalFacilitator', () => {
  const NETWORK: Network = 'eip155:84532' as Network;

  it('returns an x402Facilitator instance', () => {
    const facilitator = createLocalFacilitator({
      agentPrivateKey: FIXTURE_PRIVATE_KEY,
      network: NETWORK,
      walletClientFactory: () =>
        buildStubWalletClient('0x000000000000000000000000000000000000dEaD'),
    });
    expect(facilitator).toBeInstanceOf(x402Facilitator);
  });

  it('registers the exact EVM scheme against the configured network', () => {
    const registerSpy = vi.fn((fac, _cfg) => fac);
    createLocalFacilitator({
      agentPrivateKey: FIXTURE_PRIVATE_KEY,
      network: NETWORK,
      walletClientFactory: () =>
        buildStubWalletClient('0x000000000000000000000000000000000000dEaD'),
      registerScheme: registerSpy as unknown as Parameters<
        typeof createLocalFacilitator
      >[0]['registerScheme'],
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);
    const call = registerSpy.mock.calls[0];
    expect(call).toBeDefined();
    // call[0] is the facilitator instance, call[1] is the config we handed over.
    const passedCfg = call?.[1] as { networks: unknown; signer: unknown } | undefined;
    expect(passedCfg?.networks).toBe(NETWORK);
    expect(passedCfg?.signer).toBeDefined();
  });

  it('lifts the viem account address onto the signer via getAddresses()', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678' as const;
    let capturedSigner: unknown;
    const registerSpy = vi.fn((fac, cfg: { signer: unknown }) => {
      capturedSigner = cfg.signer;
      return fac;
    });

    createLocalFacilitator({
      agentPrivateKey: FIXTURE_PRIVATE_KEY,
      network: NETWORK,
      walletClientFactory: () => buildStubWalletClient(address),
      registerScheme: registerSpy as unknown as Parameters<
        typeof createLocalFacilitator
      >[0]['registerScheme'],
    });

    const signer = capturedSigner as { getAddresses: () => readonly `0x${string}`[] };
    expect(signer.getAddresses()).toEqual([address]);
  });

  it('passes the provided rpcUrl through to the wallet client factory', () => {
    const factory = vi.fn(() =>
      buildStubWalletClient('0x000000000000000000000000000000000000dEaD'),
    );
    createLocalFacilitator({
      agentPrivateKey: FIXTURE_PRIVATE_KEY,
      network: NETWORK,
      rpcUrl: 'https://custom.rpc.example/v1',
      walletClientFactory: factory,
      registerScheme: vi.fn((fac) => fac) as unknown as Parameters<
        typeof createLocalFacilitator
      >[0]['registerScheme'],
    });
    expect(factory).toHaveBeenCalledWith({
      privateKey: FIXTURE_PRIVATE_KEY,
      rpcUrl: 'https://custom.rpc.example/v1',
    });
  });

  it('defaults rpcUrl to the public Base Sepolia endpoint when omitted', () => {
    const factory = vi.fn(() =>
      buildStubWalletClient('0x000000000000000000000000000000000000dEaD'),
    );
    createLocalFacilitator({
      agentPrivateKey: FIXTURE_PRIVATE_KEY,
      network: NETWORK,
      walletClientFactory: factory,
      registerScheme: vi.fn((fac) => fac) as unknown as Parameters<
        typeof createLocalFacilitator
      >[0]['registerScheme'],
    });
    const firstCall = factory.mock.calls[0];
    expect(firstCall).toBeDefined();
    const arg = (firstCall as unknown as [{ rpcUrl: string }])[0];
    expect(arg.rpcUrl).toBe('https://sepolia.base.org');
  });

  it('throws when the wallet client exposes neither account.address nor top-level address', () => {
    const brokenClient = { account: undefined } as unknown as WalletClient;
    expect(() =>
      createLocalFacilitator({
        agentPrivateKey: FIXTURE_PRIVATE_KEY,
        network: NETWORK,
        walletClientFactory: () => brokenClient,
        registerScheme: vi.fn((fac) => fac) as unknown as Parameters<
          typeof createLocalFacilitator
        >[0]['registerScheme'],
      }),
    ).toThrow(/cannot derive facilitator address/);
  });
});
