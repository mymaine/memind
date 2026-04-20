import { createWalletClient, http, publicActions } from 'viem';
import type { WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { x402Facilitator } from '@x402/core/facilitator';
import type { FacilitatorClient } from '@x402/core/server';
import type { Network, SupportedResponse } from '@x402/core/types';
import { registerExactEvmScheme } from '@x402/evm/exact/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';

/**
 * Default RPC endpoint for Base Sepolia. Mirrors the fallback used in
 * `apps/server/src/tools/x-fetch-lore.ts` so the whole server stays on one
 * shared public endpoint when no RPC override is provided.
 */
const DEFAULT_BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';

/**
 * Options accepted by {@link createLocalFacilitator}.
 */
export interface CreateLocalFacilitatorOpts {
  /**
   * Agent EOA private key. Also doubles as the facilitator fee-payer — the
   * derived address must hold Base Sepolia ETH to cover `transferWithAuthorization`
   * gas at settle time. `createLocalFacilitator` does NOT check the balance;
   * if the wallet is empty the first `settle()` call will fail naturally and
   * surface the error to the x402 client instead of blocking server startup.
   */
  readonly agentPrivateKey: `0x${string}`;
  /**
   * x402 network identifier (CAIP-2). Today we only ship Base Sepolia
   * (`eip155:84532`) but the parameter stays so callers can migrate without
   * touching this factory when additional networks are introduced.
   */
  readonly network: Network;
  /**
   * Optional JSON-RPC override. Defaults to the public Base Sepolia endpoint.
   */
  readonly rpcUrl?: string;
  /**
   * Optional viem WalletClient factory. Tests use this to swap in a stub
   * client so we can verify the factory's wiring without hitting the real
   * chain. Production callers should omit it.
   */
  readonly walletClientFactory?: (args: {
    privateKey: `0x${string}`;
    rpcUrl: string;
  }) => WalletClient;
  /**
   * Optional hook for `registerExactEvmScheme`. Tests inject a spy so they
   * can assert the factory passed the correct signer + networks through.
   * Production callers should omit it.
   */
  readonly registerScheme?: typeof registerExactEvmScheme;
}

/**
 * Build an in-process x402 facilitator wired to the agent wallet.
 *
 * Why in-process (2026-04-21): the public `x402.org` facilitator's `/settle`
 * endpoint is currently broken — it returns `invalid_exact_evm_transaction_failed`
 * with an empty `transaction` field even though `/verify` succeeds and the
 * signed EIP-3009 authorization is valid on-chain. Running the facilitator
 * inside this process keeps the paid routes working while the upstream is
 * down, and removes one external dependency from the demo path.
 *
 * Wiring:
 *   1. Derive an EOA from `agentPrivateKey` (viem local account).
 *   2. Build a viem WalletClient on Base Sepolia extended with `publicActions`
 *      so a single client exposes both read (readContract, getCode, …) and
 *      write (writeContract, sendTransaction, …) capabilities required by
 *      {@link FacilitatorEvmSigner}.
 *   3. Surface the account address on the top-level `address` property —
 *      `toFacilitatorEvmSigner` reads `client.address` and does not look
 *      inside `client.account`.
 *   4. Register the EVM exact scheme against the resulting facilitator for
 *      the caller-supplied network list.
 */
export function createLocalFacilitator(opts: CreateLocalFacilitatorOpts): x402Facilitator {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_BASE_SEPOLIA_RPC_URL;
  const register = opts.registerScheme ?? registerExactEvmScheme;

  const walletClient =
    opts.walletClientFactory !== undefined
      ? opts.walletClientFactory({ privateKey: opts.agentPrivateKey, rpcUrl })
      : buildBaseSepoliaWalletClient({ privateKey: opts.agentPrivateKey, rpcUrl });

  // `toFacilitatorEvmSigner` reads `client.address` at the top level (see
  // signer-D912R4mq.d.mts — it is typed as `Omit<FacilitatorEvmSigner,
  // 'getAddresses'> & { address: \`0x\${string}\` }`). viem WalletClients only
  // expose the EOA via `client.account.address`, so we pull it up here.
  const accountAddress = (walletClient.account?.address ??
    // Fallback for custom factories that do not bundle an account but still
    // expose `address` at the top level. We never exercise this in the
    // production path but tests can use it to avoid constructing a full
    // viem account.
    (walletClient as unknown as { address?: `0x${string}` }).address) as `0x${string}` | undefined;

  if (accountAddress === undefined) {
    throw new Error(
      '[x402 local-facilitator] wallet client has no account; cannot derive facilitator address',
    );
  }

  // Wrap writeContract + waitForTransactionReceipt so we can see what the
  // @x402/evm `catch {}` in settleEIP3009 would otherwise swallow. Only
  // touches the error path — successful settlements are untouched.
  const instrumented = instrumentForDiagnostics(walletClient as unknown as Record<string, unknown>);
  const signer = toFacilitatorEvmSigner({
    ...instrumented,
    address: accountAddress,
  } as Parameters<typeof toFacilitatorEvmSigner>[0]);

  const facilitator = new x402Facilitator();
  register(facilitator, {
    networks: opts.network,
    signer,
  });
  return facilitator;
}

/**
 * Wrap an {@link x402Facilitator} in the {@link FacilitatorClient} interface
 * expected by {@link x402ResourceServer}.
 *
 * Why this adapter exists (2026-04-21, @x402/core@2.10.0): `FacilitatorClient`
 * requires `getSupported(): Promise<SupportedResponse>`, but
 * `x402Facilitator.getSupported()` is synchronous and returns the same shape
 * without a Promise wrapper. Runtime the resource server just does
 * `await facilitatorClient.getSupported()` — which works on sync values —
 * but TypeScript refuses to unify the two types. A one-line Promise.resolve
 * wrapper makes the contract explicit instead of forcing an `as unknown as`
 * cast at the call site.
 *
 * `verify()` and `settle()` already return Promises on both sides, so we can
 * forward them verbatim.
 */
export function toFacilitatorClient(facilitator: x402Facilitator): FacilitatorClient {
  return {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    // The runtime shape matches `SupportedResponse` exactly. The cast only
    // narrows `kinds[i].network` from `string` (what `x402Facilitator` declares
    // in @x402/core@2.10.0) back to `Network` (`${string}:${string}`, what
    // `FacilitatorClient` requires). Every value we register with
    // `registerExactEvmScheme` comes in as a `Network` already, so this is a
    // safe re-narrowing — not a runtime coercion.
    getSupported: () => Promise.resolve(facilitator.getSupported() as unknown as SupportedResponse),
  };
}

/**
 * Gas limit injected into every `writeContract` call the facilitator makes.
 *
 * Why force a gas cap: Base Sepolia's public RPC nodes (sepolia.base.org,
 * tenderly, drpc, thirdweb — verified 2026-04-21) reject every
 * `eth_estimateGas` without an explicit `gas` field with
 * `intrinsic gas too high`. The node uses the block gas limit (400M) as the
 * default upper bound and the new op-geth policy caps tx gas at ~30M, so the
 * "no-cap" estimate is pre-rejected. Viem's `writeContract` internally calls
 * estimateGas when `gas` is omitted, which is exactly what @x402/evm's
 * `executeTransferWithAuthorization` does. Supplying `gas` skips estimation
 * entirely and the tx goes through.
 *
 * 200_000 is ~2.5× measured cost for `transferWithAuthorization` on Base
 * Sepolia USDC (~80k gas). Plenty of headroom for future bytecode tweaks.
 */
const SETTLE_GAS_LIMIT = 200_000n;

/**
 * Wrap the signer methods that the @x402/evm settle path calls so that:
 *   1. viem errors surface in logs instead of being swallowed by `settleEIP3009`'s
 *      bare `catch {}`.
 *   2. `writeContract` always includes an explicit `gas` field — see
 *      {@link SETTLE_GAS_LIMIT}.
 */
function instrumentForDiagnostics(client: Record<string, unknown>): Record<string, unknown> {
  const wrap =
    <A extends unknown[], R>(name: string, fn: ((...a: A) => Promise<R>) | undefined) =>
    async (...args: A): Promise<R> => {
      if (fn === undefined) {
        throw new Error(`[x402 local-facilitator] signer.${name} is missing`);
      }
      try {
        return await fn(...args);
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.warn(`[x402 local-facilitator] ${name} threw: ${msg}`);
        throw err;
      }
    };
  const originalWriteContract = client['writeContract'] as
    | ((args: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  const writeContractWithGas = originalWriteContract
    ? (args: Record<string, unknown>) =>
        originalWriteContract({
          ...args,
          gas: (args['gas'] as bigint | undefined) ?? SETTLE_GAS_LIMIT,
        })
    : undefined;
  return {
    ...client,
    writeContract: wrap('writeContract', writeContractWithGas),
    waitForTransactionReceipt: wrap(
      'waitForTransactionReceipt',
      client['waitForTransactionReceipt'] as ((...a: unknown[]) => Promise<unknown>) | undefined,
    ),
    sendTransaction: wrap(
      'sendTransaction',
      client['sendTransaction'] as ((...a: unknown[]) => Promise<unknown>) | undefined,
    ),
  };
}

/**
 * Build the default viem WalletClient used in production. Extracted so tests
 * can swap it via `walletClientFactory` without mocking the viem module.
 */
function buildBaseSepoliaWalletClient(args: {
  privateKey: `0x${string}`;
  rpcUrl: string;
}): WalletClient {
  const account = privateKeyToAccount(args.privateKey);
  // `.extend(publicActions)` widens the client so `readContract`, `getCode`,
  // `waitForTransactionReceipt`, etc. are available alongside the wallet
  // actions — exactly the surface `FacilitatorEvmSigner` requires.
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(args.rpcUrl),
  }).extend(publicActions) as unknown as WalletClient;
}
