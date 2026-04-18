/**
 * anchor-tx — optional layer-2 BSC mainnet memo for AC3.
 *
 * When `ANCHOR_ON_CHAIN=true` the server fires a zero-value self-tx on BSC
 * mainnet whose `data` field carries the 32-byte keccak256 commitment the
 * Narrator just produced. The tx is an on-chain memo — no smart contract
 * deploy, ~$0.01 BNB gas per chapter. The tx hash + BscScan URL are stamped
 * back onto the AnchorLedger entry (and re-emitted as a second lore-anchor
 * artifact so the dashboard can surface the upgrade without refresh).
 *
 * Design notes:
 *   - Dependency-injectable wallet factory so tests can exercise the logic
 *     without reaching out to bsc-dataseed.
 *   - `isAnchorOnChainEnabled` lives here so callers only need to import
 *     anchor-tx to gate the feature; exact equality with "true" keeps the
 *     check noise-free (empty string / "1" / unset all mean off).
 *   - Errors bubble up unchanged: callers are expected to catch + log and
 *     leave the layer-1 anchor intact so the artifact stream stays useful.
 */
import {
  createWalletClient,
  http,
  type Hash,
  type PrivateKeyAccount,
  type WalletClient,
} from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CONTENT_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

export interface AnchorTxRequest {
  /** Self-address (from === to on a memo tx). */
  to: `0x${string}`;
  /** Always 0n — we're writing data, not moving value. */
  value: bigint;
  /** 32-byte keccak256 commitment the memo carries. */
  data: `0x${string}`;
}

export interface AnchorTxSettlement {
  onChainTxHash: `0x${string}`;
  chain: 'bsc-mainnet';
  explorerUrl: string;
}

/**
 * Minimal contract the deps factory must satisfy. We only need an `account`
 * (for the self-tx from/to) and a `sendTransaction` that returns a 32-byte
 * tx hash. Intentionally a subset of viem's WalletClient so tests can mock
 * without reconstructing the entire surface area.
 */
export interface AnchorWalletClient {
  account: { address: `0x${string}` };
  sendTransaction: (args: {
    to: `0x${string}`;
    value: bigint;
    data: `0x${string}`;
    account?: { address: `0x${string}` };
    chain?: unknown;
  }) => Promise<Hash>;
}

export interface AnchorTxDeps {
  /** Signer for the BSC mainnet self-tx (e.g. `BSC_DEPLOYER_PRIVATE_KEY`). */
  privateKey: `0x${string}`;
  /**
   * Walk-ins the wallet client. Production callers use the default factory
   * which wires viem against BSC mainnet; tests inject a fake.
   */
  walletClientFactory?: (pk: `0x${string}`) => AnchorWalletClient;
  /** Produce the explorer URL from the settled tx hash. */
  explorerUrlBuilder?: (txHash: `0x${string}`) => string;
}

function defaultExplorerUrl(txHash: `0x${string}`): string {
  return `https://bscscan.com/tx/${txHash}`;
}

function defaultWalletClientFactory(pk: `0x${string}`): AnchorWalletClient {
  // `privateKeyToAccount` yields a viem LocalAccount; createWalletClient with
  // a BSC mainnet transport gives us a concrete, production-shaped client.
  // Return the viem client directly — its shape is a superset of the minimal
  // AnchorWalletClient contract.
  const account: PrivateKeyAccount = privateKeyToAccount(pk);
  const client: WalletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(),
  });
  // viem's sendTransaction accepts a chain argument automatically via the
  // bound client. Narrow the callable surface to our interface.
  return client as unknown as AnchorWalletClient;
}

/**
 * Read the ANCHOR_ON_CHAIN env flag. Only the literal string "true" enables
 * layer-2 so accidental typos ("1", "yes", whitespace) default to off.
 */
export function isAnchorOnChainEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ANCHOR_ON_CHAIN === 'true';
}

/**
 * Build the zero-value memo tx request. Extracted as a pure helper so tests
 * can assert the shape without stubbing the wallet.
 */
export function buildAnchorTxRequest(args: {
  from: `0x${string}`;
  contentHash: `0x${string}`;
}): AnchorTxRequest {
  return {
    to: args.from,
    value: 0n,
    data: args.contentHash,
  };
}

export interface SendAnchorMemoTxArgs {
  contentHash: `0x${string}`;
  deps: AnchorTxDeps;
}

/**
 * Sign and broadcast the memo tx. Returns the settlement trio the caller
 * stamps onto the AnchorLedger entry + lore-anchor artifact.
 */
export async function sendAnchorMemoTx(args: SendAnchorMemoTxArgs): Promise<AnchorTxSettlement> {
  if (!CONTENT_HASH_REGEX.test(args.contentHash)) {
    throw new Error(
      `sendAnchorMemoTx: contentHash must be 32-byte 0x-prefixed hex, got ${args.contentHash}`,
    );
  }
  const factory = args.deps.walletClientFactory ?? defaultWalletClientFactory;
  const explorerUrl = args.deps.explorerUrlBuilder ?? defaultExplorerUrl;
  const wallet = factory(args.deps.privateKey);

  const tx = buildAnchorTxRequest({
    from: wallet.account.address,
    contentHash: args.contentHash,
  });

  const txHash = await wallet.sendTransaction({
    to: tx.to,
    value: tx.value,
    data: tx.data,
  });

  return {
    onChainTxHash: txHash as `0x${string}`,
    chain: 'bsc-mainnet',
    explorerUrl: explorerUrl(txHash as `0x${string}`),
  };
}
