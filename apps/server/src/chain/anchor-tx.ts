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
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import {
  type AnchorLedger,
  type AnchorLedgerAppendInput,
  computeAnchorId,
  computeContentHash,
} from '../state/anchor-ledger.js';

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

/**
 * Factory signature for producing an `AnchorWalletClient` from a private key
 * and an optional RPC URL. The rpcUrl parameter carries `config.bsc.rpcUrl`
 * through to viem's `http(rpcUrl)` transport so production traffic hits the
 * same Binance-operated node `tools/deployer.ts` uses. When undefined (legacy
 * callers, tests) the transport falls back to viem's built-in BSC default,
 * preserving existing behaviour.
 *
 * Fake factories injected by tests can ignore the rpcUrl parameter entirely —
 * the optional trailing arg means `(pk) => ...` shaped fakes remain valid.
 */
export type AnchorWalletClientFactory = (pk: `0x${string}`, rpcUrl?: string) => AnchorWalletClient;

export interface AnchorTxDeps {
  /** Signer for the BSC mainnet self-tx (e.g. `BSC_DEPLOYER_PRIVATE_KEY`). */
  privateKey: `0x${string}`;
  /**
   * Walk-ins the wallet client. Production callers use the default factory
   * which wires viem against BSC mainnet; tests inject a fake.
   */
  walletClientFactory?: AnchorWalletClientFactory;
  /** Produce the explorer URL from the settled tx hash. */
  explorerUrlBuilder?: (txHash: `0x${string}`) => string;
  /**
   * Optional BSC mainnet RPC URL forwarded to the default wallet client
   * factory as `http(rpcUrl)`. Resolved from `config.bsc.rpcUrl` in
   * production (which defaults to Binance's `https://bsc-dataseed.binance.org`
   * — the same node `tools/deployer.ts` uses). Left undefined in tests and
   * legacy callers → viem's built-in default RPC is used.
   *
   * History: Railway egress IPs get silently stuck on the community nodes
   * viem's built-in default resolves to, so anchor tx calls would hang
   * indefinitely. Routing through `config.bsc.rpcUrl` matches the deployer
   * path's proven-stable Binance-operated node.
   */
  rpcUrl?: string;
  /**
   * Optional millisecond cap on the `wallet.sendTransaction` call. Defaults
   * to 30_000ms so a stuck RPC can never wedge the orchestrator
   * indefinitely. Tests inject a short value (e.g. 50ms) to exercise the
   * timeout path without real waits.
   */
  timeoutMs?: number;
}

function defaultExplorerUrl(txHash: `0x${string}`): string {
  return `https://bscscan.com/tx/${txHash}`;
}

function defaultWalletClientFactory(pk: `0x${string}`, rpcUrl?: string): AnchorWalletClient {
  // `privateKeyToAccount` yields a viem LocalAccount; createWalletClient with
  // a BSC mainnet transport gives us a concrete, production-shaped client.
  // Return the viem client directly — its shape is a superset of the minimal
  // AnchorWalletClient contract. When `rpcUrl` is undefined, `http(undefined)`
  // falls back to viem's built-in BSC default; when set, the configured
  // Binance-operated node is used.
  const account: PrivateKeyAccount = privateKeyToAccount(pk);
  const client: WalletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(rpcUrl),
  });
  // viem's sendTransaction accepts a chain argument automatically via the
  // bound client. Narrow the callable surface to our interface.
  return client as unknown as AnchorWalletClient;
}

/** Default cap on `wallet.sendTransaction` latency — see `AnchorTxDeps.timeoutMs`. */
const DEFAULT_SEND_TX_TIMEOUT_MS = 30_000;

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
  // Forward the RPC URL so the default factory produces a viem client that
  // hits `config.bsc.rpcUrl` (Binance's dataseed) instead of viem's built-in
  // community fallback. Fake factories in tests can ignore the trailing arg.
  const wallet = factory(args.deps.privateKey, args.deps.rpcUrl);

  const tx = buildAnchorTxRequest({
    from: wallet.account.address,
    contentHash: args.contentHash,
  });

  // Safety rail: a stuck RPC must never wedge the orchestrator. `Promise.race`
  // a timeout against the send so any node-side hang turns into a normal error
  // the caller (`maybeAnchorContent`) catches and downgrades to a warn log.
  const timeoutMs = args.deps.timeoutMs ?? DEFAULT_SEND_TX_TIMEOUT_MS;
  const txHash = await Promise.race<Hash>([
    wallet.sendTransaction({
      to: tx.to,
      value: tx.value,
      data: tx.data,
    }),
    new Promise<never>((_, reject) => {
      const handle = setTimeout(() => {
        reject(
          new Error(`sendAnchorMemoTx: BSC RPC call timed out after ${timeoutMs.toString()}ms`),
        );
      }, timeoutMs);
      // Do not keep the event loop alive solely because the timeout is
      // pending — if the wallet promise resolves first, the timer unref
      // avoids leaking an open handle into test runners.
      if (typeof handle.unref === 'function') handle.unref();
    }),
  ]);

  return {
    onChainTxHash: txHash as `0x${string}`,
    chain: 'bsc-mainnet',
    explorerUrl: explorerUrl(txHash as `0x${string}`),
  };
}

// ---------------------------------------------------------------------------
// maybeAnchorContent — cross-path layer-2 helper.
// ---------------------------------------------------------------------------
// The legacy a2a.ts inlined the ANCHOR_ON_CHAIN gate + send + markOnChain +
// artifact-emit block directly inside the narrator phase, which meant the
// other three code paths that produce lore chapters (brain-chat
// `/lore` → invoke_narrator, brain-chat `/launch` → invoke_creator, and the
// `demo:creator` CLI → runCreatorPhase) never got the on-chain upgrade. This
// helper lifts that block into a pure function so every path shares the
// same:
//
//   1. Env gate (`ANCHOR_ON_CHAIN === 'true'`)
//   2. BSC deployer key presence check (warn-log + no-op when missing)
//   3. `computeContentHash` → `sendAnchorMemoTx` → `markOnChain` pipeline
//   4. Upgraded `lore-anchor` artifact with the on-chain trio + BscScan url
//   5. Non-fatal error handling so layer-1 evidence is never blocked by a
//      flaky BSC mainnet RPC or an unfunded deployer wallet.
//
// Layer-1 append (the keccak256 commitment row) is deliberately NOT done
// here — callers own that step via `anchorLedger.append(...)` before calling
// this helper, so the ledger row exists even when layer-2 is disabled. Same
// ordering as the pre-refactor a2a.ts path.
// ---------------------------------------------------------------------------

/**
 * Arguments passed to `maybeAnchorContent`. All fields except `anchorLedger`,
 * `tokenAddr`, `chapterNumber`, and `loreCid` are optional so callers can
 * wire only what they have.
 */
export interface MaybeAnchorContentArgs {
  /** Ledger to stamp the on-chain trio onto once the memo tx settles. */
  anchorLedger: AnchorLedger;
  /** Lowercased/mixed-case EVM address — `computeAnchorId` normalises it. */
  tokenAddr: `0x${string}`;
  /** 1-based chapter index the anchor belongs to. */
  chapterNumber: number;
  /** Pinata CID of the chapter body. */
  loreCid: string;
  /**
   * Env bag consulted for `ANCHOR_ON_CHAIN`. Defaults to `process.env` so
   * production callers only need to opt into the layer-2 flag once, but
   * tests can pass a hermetic bag to exercise both branches deterministically.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * BSC deployer private key used to sign the zero-value self-tx memo.
   * Production callers resolve it off `config.wallets.bscDeployer.privateKey`;
   * when undefined we log a warn and return null so the layer-1 evidence
   * still ships.
   */
  bscDeployerPrivateKey?: `0x${string}` | undefined;
  /**
   * Optional BSC mainnet RPC URL threaded through to `sendAnchorMemoTx`.
   * Production callers resolve it off `config.bsc.rpcUrl` so the viem wallet
   * client talks to the Binance-operated node `tools/deployer.ts` already
   * uses (stable on Railway egress IPs). Left undefined → viem's built-in
   * BSC default kicks in (same as pre-fix behaviour).
   */
  rpcUrl?: string;
  /**
   * Optional per-call override for `sendAnchorMemoTx`'s send timeout. Tests
   * pass a short value (e.g. 50ms) to exercise the timeout branch without
   * real waits; production callers omit this and the 30s default wins.
   */
  timeoutMs?: number;
  /** Artifact sink — receives the upgraded `lore-anchor` once the tx settles. */
  onArtifact?: (artifact: Artifact) => void;
  /** Log sink — receives info/warn lines from this helper. */
  onLog?: (event: LogEvent) => void;
  /**
   * Test seam — override the real `sendAnchorMemoTx` so unit tests can spy
   * on the send call and control its resolution without touching
   * bsc-dataseed. Production callers omit this and the real implementation
   * runs.
   */
  sendAnchorMemoTxImpl?: typeof sendAnchorMemoTx;
  /**
   * `LogEvent.tool` attribution for anchor info/warn lines. Defaults to
   * `'anchor'` to match the modern tool-namespaced shape. The a2a narrator
   * phase opts into `'orchestrator'` to preserve the log tool attribution the
   * inline pre-refactor implementation used, keeping downstream log stream
   * filters stable for that specific path.
   */
  logTool?: string;
}

/**
 * Emit a `LogEvent` attributed to the narrator phase. We hard-code the
 * agent attribution to `narrator` because every path that anchors chapters
 * is ultimately a narrator-side action (creator chapter 1 is emitted under
 * the narrator-shaped `lore-anchor` artifact, so the log story stays
 * consistent). The `tool` field defaults to `'anchor'` but callers can
 * override — the a2a narrator path passes `'orchestrator'` to match the
 * pre-refactor inline block's log tool attribution.
 */
function narratorLog(
  onLog: ((event: LogEvent) => void) | undefined,
  level: LogEvent['level'],
  message: string,
  tool: string = 'anchor',
): void {
  if (onLog === undefined) return;
  onLog({
    ts: new Date().toISOString(),
    agent: 'narrator',
    tool,
    level,
    message,
  });
}

/**
 * Pure helper: if `ANCHOR_ON_CHAIN=true` in the supplied env and a BSC
 * deployer key is available, compute the keccak256 contentHash, fire the
 * zero-value memo tx via `sendAnchorMemoTx`, mark the existing ledger row as
 * on-chain, and emit an upgraded `lore-anchor` artifact carrying the
 * BscScan explorer link. Returns the settlement trio on success; returns
 * `null` whenever layer-2 is disabled, skipped, or the tx fails.
 *
 * The helper never throws. Any error (bad contentHash, RPC failure,
 * markOnChain storage fault) is downgraded to a warn log so the layer-1
 * anchor row + `lore-cid` artifact stay intact.
 */
export async function maybeAnchorContent(
  args: MaybeAnchorContentArgs,
): Promise<AnchorTxSettlement | null> {
  const {
    anchorLedger,
    tokenAddr,
    chapterNumber,
    loreCid,
    env,
    bscDeployerPrivateKey,
    rpcUrl,
    timeoutMs,
    onArtifact,
    onLog,
    sendAnchorMemoTxImpl,
    logTool,
  } = args;

  // Gate 1: env flag must be literally `true`. We deliberately emit no log
  // when disabled — callers constantly skip this branch during tests and a
  // noisy log would pollute every unit-test output.
  const envBag = env ?? process.env;
  if (!isAnchorOnChainEnabled(envBag)) {
    return null;
  }

  // Gate 2: deployer key required. This is the single warn log documented
  // in the pre-refactor a2a.ts block so operators see why the layer-2 upgrade
  // did not fire.
  if (bscDeployerPrivateKey === undefined) {
    narratorLog(
      onLog,
      'warn',
      'ANCHOR_ON_CHAIN=true but BSC_DEPLOYER_PRIVATE_KEY missing — skipping layer-2 memo',
      logTool,
    );
    return null;
  }

  const anchorId = computeAnchorId(tokenAddr, chapterNumber);
  const contentHash = computeContentHash(tokenAddr, chapterNumber, loreCid);

  try {
    const send = sendAnchorMemoTxImpl ?? sendAnchorMemoTx;
    const settlement = await send({
      contentHash,
      deps: {
        privateKey: bscDeployerPrivateKey,
        ...(rpcUrl !== undefined ? { rpcUrl } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    });
    await anchorLedger.markOnChain(anchorId, settlement);
    if (onArtifact !== undefined) {
      onArtifact({
        kind: 'lore-anchor',
        anchorId,
        tokenAddr,
        chapterNumber,
        loreCid,
        contentHash,
        onChainTxHash: settlement.onChainTxHash,
        chain: settlement.chain,
        explorerUrl: settlement.explorerUrl,
        ts: new Date().toISOString(),
        label: 'lore anchor (on-chain)',
      });
    }
    narratorLog(
      onLog,
      'info',
      `lore-anchor layer-2 settled on BSC mainnet: ${settlement.onChainTxHash}`,
      logTool,
    );
    return settlement;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    narratorLog(
      onLog,
      'warn',
      `lore-anchor layer-2 send failed (layer-1 evidence still emitted): ${msg}`,
      logTool,
    );
    return null;
  }
}

/**
 * Arguments passed to `anchorChapterOne`. Only the ledger + tokenAddr + loreCid
 * are required; the layer-2 fields mirror `MaybeAnchorContentArgs` one-for-one.
 */
export interface AnchorChapterOneArgs extends Omit<
  MaybeAnchorContentArgs,
  'chapterNumber' | 'tokenAddr'
> {
  /** Creator-path token address (mixed case — normalised by `computeAnchorId`). */
  tokenAddr: string;
}

/**
 * Convenience wrapper that performs the full Chapter 1 anchor dance in one
 * call: layer-1 ledger `append` + initial `lore-anchor` artifact + optional
 * layer-2 memo tx via `maybeAnchorContent`. Used by the Creator paths
 * (`invoke_creator` + `runCreatorPhase`) which emit the FIRST anchor for a
 * token — the narrator already owns layer-1 append for subsequent chapters,
 * but Creator's `lore_writer` is the first touch and needs its own ledger
 * row before layer 2 can stamp one. Chapter 1 is hard-coded because this
 * helper is only ever invoked on the initial launch.
 *
 * Non-fatal by contract: append / markOnChain / send failures are logged as
 * warns and the helper resolves null rather than throwing, so a flaky BSC
 * RPC or pg write never blocks the Creator happy path.
 */
export async function anchorChapterOne(
  args: AnchorChapterOneArgs,
): Promise<AnchorTxSettlement | null> {
  const {
    anchorLedger,
    tokenAddr,
    loreCid,
    env,
    bscDeployerPrivateKey,
    rpcUrl,
    timeoutMs,
    onArtifact,
    onLog,
    sendAnchorMemoTxImpl,
    logTool,
  } = args;

  const chapterNumber = 1;
  const anchorId = computeAnchorId(tokenAddr, chapterNumber);
  const contentHash = computeContentHash(tokenAddr, chapterNumber, loreCid);
  const ts = new Date().toISOString();

  // Layer-1: ledger row + initial lore-anchor artifact. Tolerate pg hiccups
  // so Creator path continues to return its result. The append itself is
  // idempotent (upsert on anchorId) so replays of the same chapter 1 are
  // safe.
  const layer1Input: AnchorLedgerAppendInput = {
    anchorId,
    tokenAddr,
    chapterNumber,
    loreCid,
    contentHash,
    ts,
  };
  try {
    await anchorLedger.append(layer1Input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    narratorLog(onLog, 'warn', `creator chapter 1 anchor append failed: ${msg}`, logTool);
    return null;
  }

  // Artifact fan-out is a separate concern from the ledger write: if the SSE
  // subscriber (or any other consumer wired through `onArtifact`) throws, the
  // layer-1 row is already persisted and layer-2 should still try to settle.
  // Previously both steps shared a catch block, so an `onArtifact` throw was
  // mis-logged as `append failed: ...` and wrongly short-circuited layer-2.
  if (onArtifact !== undefined) {
    try {
      onArtifact({
        kind: 'lore-anchor',
        anchorId,
        tokenAddr,
        chapterNumber,
        loreCid,
        contentHash,
        ts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      narratorLog(onLog, 'warn', `creator chapter 1 layer-1 artifact emit failed: ${msg}`, logTool);
      // Intentional fall-through: layer-2 still runs below.
    }
  }

  // Layer-2: optional, gated by `ANCHOR_ON_CHAIN` inside `maybeAnchorContent`.
  return maybeAnchorContent({
    anchorLedger,
    tokenAddr: tokenAddr as `0x${string}`,
    chapterNumber,
    loreCid,
    ...(env !== undefined ? { env } : {}),
    ...(bscDeployerPrivateKey !== undefined ? { bscDeployerPrivateKey } : {}),
    ...(rpcUrl !== undefined ? { rpcUrl } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(onArtifact !== undefined ? { onArtifact } : {}),
    ...(onLog !== undefined ? { onLog } : {}),
    ...(sendAnchorMemoTxImpl !== undefined ? { sendAnchorMemoTxImpl } : {}),
    ...(logTool !== undefined ? { logTool } : {}),
  });
}
