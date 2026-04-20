import { describe, it, expect, vi } from 'vitest';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import {
  anchorChapterOne,
  buildAnchorTxRequest,
  isAnchorOnChainEnabled,
  maybeAnchorContent,
  sendAnchorMemoTx,
  type AnchorTxDeps,
  type AnchorTxSettlement,
} from './anchor-tx.js';
import { AnchorLedger, computeAnchorId, computeContentHash } from '../state/anchor-ledger.js';

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

// ---------------------------------------------------------------------------
// maybeAnchorContent — cross-path layer-2 helper.
// ---------------------------------------------------------------------------
// The helper owns the ANCHOR_ON_CHAIN env gate + deployer-key presence check
// + sendAnchorMemoTx + markOnChain + upgraded lore-anchor artifact emission.
// Every lore-producing path (a2a narrator, brain-chat invoke_narrator,
// brain-chat invoke_creator, demo:creator runCreatorPhase) funnels through
// it, so these tests pin down the full behavioural surface.
// ---------------------------------------------------------------------------

describe('maybeAnchorContent', () => {
  const TOKEN_ADDR = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
  const CHAPTER = 1;
  const LORE_CID = 'bafkrei-stub';
  const DEPLOYER_PK = `0x${'9'.repeat(64)}` as const;
  const TX_HASH = `0x${'f'.repeat(64)}` as const;

  function fakeSettlement(): AnchorTxSettlement {
    return {
      onChainTxHash: TX_HASH,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/${TX_HASH}`,
    };
  }

  it('returns null + no side effects when ANCHOR_ON_CHAIN is disabled', async () => {
    const ledger = new AnchorLedger();
    // Pre-seed a layer-1 row so we can verify markOnChain is NOT called by
    // inspecting that the onChainTxHash stays undefined afterwards.
    const anchorId = computeAnchorId(TOKEN_ADDR, CHAPTER);
    await ledger.append({
      anchorId,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      contentHash: computeContentHash(TOKEN_ADDR, CHAPTER, LORE_CID),
      ts: '2026-04-21T00:00:00.000Z',
    });

    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy = vi.fn();

    const result = await maybeAnchorContent({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'false' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy as unknown as typeof sendAnchorMemoTx,
    });

    expect(result).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(onArtifact).not.toHaveBeenCalled();
    // Disabled path is silent — no logs.
    expect(onLog).not.toHaveBeenCalled();
    const entry = await ledger.get(anchorId);
    expect(entry?.onChainTxHash).toBeUndefined();
  });

  it('returns null + warn log when enabled but BSC_DEPLOYER_PRIVATE_KEY missing', async () => {
    const ledger = new AnchorLedger();
    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy = vi.fn();

    const result = await maybeAnchorContent({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: undefined,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy as unknown as typeof sendAnchorMemoTx,
    });

    expect(result).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(onArtifact).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledTimes(1);
    const logged = onLog.mock.calls[0]?.[0];
    expect(logged?.level).toBe('warn');
    expect(logged?.message).toMatch(/BSC_DEPLOYER_PRIVATE_KEY/);
  });

  it('sends tx + marks ledger + emits upgraded artifact when enabled with key', async () => {
    const ledger = new AnchorLedger();
    const anchorId = computeAnchorId(TOKEN_ADDR, CHAPTER);
    await ledger.append({
      anchorId,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      contentHash: computeContentHash(TOKEN_ADDR, CHAPTER, LORE_CID),
      ts: '2026-04-21T00:00:00.000Z',
    });

    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const settlement = fakeSettlement();
    const sendSpy: typeof sendAnchorMemoTx = vi.fn(async () => settlement);

    const result = await maybeAnchorContent({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy,
    });

    expect(result).toEqual(settlement);
    // sendAnchorMemoTx invoked with the expected contentHash + deployer key.
    const sendMock = sendSpy as unknown as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMock.mock.calls[0]?.[0] as {
      contentHash: string;
      deps: { privateKey: string };
    };
    expect(sendArgs.contentHash).toBe(computeContentHash(TOKEN_ADDR, CHAPTER, LORE_CID));
    expect(sendArgs.deps.privateKey).toBe(DEPLOYER_PK);

    // Ledger markOnChain has been applied to the existing row.
    const entry = await ledger.get(anchorId);
    expect(entry?.onChainTxHash).toBe(TX_HASH);
    expect(entry?.chain).toBe('bsc-mainnet');
    expect(entry?.explorerUrl).toBe(settlement.explorerUrl);

    // Upgraded artifact carries the full on-chain trio.
    expect(onArtifact).toHaveBeenCalledTimes(1);
    const artifact = onArtifact.mock.calls[0]?.[0];
    expect(artifact?.kind).toBe('lore-anchor');
    if (artifact?.kind === 'lore-anchor') {
      expect(artifact.onChainTxHash).toBe(TX_HASH);
      expect(artifact.chain).toBe('bsc-mainnet');
      expect(artifact.explorerUrl).toBe(settlement.explorerUrl);
      expect(artifact.label).toBe('lore anchor (on-chain)');
    }

    // A settled info log lands on the narrator bucket.
    const infoLog = onLog.mock.calls.find((c) => c[0].level === 'info');
    expect(infoLog?.[0].message).toContain(TX_HASH);
  });

  it('returns null + warn log when sendAnchorMemoTxImpl throws (no rethrow)', async () => {
    const ledger = new AnchorLedger();
    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy = vi.fn(async () => {
      throw new Error('rpc 502 bad gateway');
    });

    const result = await maybeAnchorContent({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy as unknown as typeof sendAnchorMemoTx,
    });

    expect(result).toBeNull();
    expect(onArtifact).not.toHaveBeenCalled();
    const warnLog = onLog.mock.calls.find((c) => c[0].level === 'warn');
    expect(warnLog?.[0].message).toMatch(/rpc 502 bad gateway/);
  });

  it('returns null + warn log when ledger.markOnChain throws (no rethrow)', async () => {
    // Build a minimal AnchorLedger-shaped stub whose markOnChain blows up.
    // TypeScript structural typing means the helper will treat this as an
    // AnchorLedger — no need to subclass / construct a real one.
    const brokenLedger = {
      append: vi.fn(async () => undefined),
      markOnChain: vi.fn(async () => {
        throw new Error('pg pool exhausted');
      }),
      get: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
      size: vi.fn(async () => 0),
    } as unknown as AnchorLedger;

    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy = vi.fn(async () => fakeSettlement());

    const result = await maybeAnchorContent({
      anchorLedger: brokenLedger,
      tokenAddr: TOKEN_ADDR,
      chapterNumber: CHAPTER,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy as unknown as typeof sendAnchorMemoTx,
    });

    expect(result).toBeNull();
    // Artifact must not land — we only emit after markOnChain succeeds.
    expect(onArtifact).not.toHaveBeenCalled();
    const warnLog = onLog.mock.calls.find((c) => c[0].level === 'warn');
    expect(warnLog?.[0].message).toMatch(/pg pool exhausted/);
  });
});

// ---------------------------------------------------------------------------
// anchorChapterOne — Creator path wrapper for the first chapter.
// ---------------------------------------------------------------------------
// The helper owns the Chapter 1 layer-1 append + initial lore-anchor artifact
// emission, then delegates layer-2 to `maybeAnchorContent`. The four cases
// below pin down each arm of the branching: ANCHOR_ON_CHAIN off, on + valid
// settlement, append throw, onArtifact throw (layer-1 already landed so
// layer-2 must still run).
// ---------------------------------------------------------------------------

describe('anchorChapterOne', () => {
  const TOKEN_ADDR = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
  const LORE_CID = 'bafkrei-chapter-one';
  const DEPLOYER_PK = `0x${'9'.repeat(64)}` as const;
  const TX_HASH = `0x${'f'.repeat(64)}` as const;

  function fakeSettlement(): AnchorTxSettlement {
    return {
      onChainTxHash: TX_HASH,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/${TX_HASH}`,
    };
  }

  it('appends layer-1 row + emits initial artifact when ANCHOR_ON_CHAIN=false', async () => {
    const ledger = new AnchorLedger();
    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy: typeof sendAnchorMemoTx = vi.fn(async () => {
      throw new Error('layer-2 must not run when ANCHOR_ON_CHAIN=false');
    });

    const result = await anchorChapterOne({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'false' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy,
    });

    expect(result).toBeNull();

    // Layer-1 ledger row was persisted but NOT marked on-chain.
    const anchorId = computeAnchorId(TOKEN_ADDR, 1);
    const entry = await ledger.get(anchorId);
    expect(entry?.chapterNumber).toBe(1);
    expect(entry?.loreCid).toBe(LORE_CID);
    expect(entry?.onChainTxHash).toBeUndefined();

    // Exactly one lore-anchor artifact emitted — the initial layer-1 shape
    // without the on-chain trio.
    expect(onArtifact).toHaveBeenCalledTimes(1);
    const artifact = onArtifact.mock.calls[0]?.[0];
    expect(artifact?.kind).toBe('lore-anchor');
    if (artifact?.kind === 'lore-anchor') {
      expect(artifact.anchorId).toBe(anchorId);
      expect(artifact.chapterNumber).toBe(1);
      expect(artifact.loreCid).toBe(LORE_CID);
      expect(artifact.onChainTxHash).toBeUndefined();
    }

    // Send impl never touched — disabled flag short-circuits inside
    // maybeAnchorContent before the factory runs.
    const sendMock = sendSpy as unknown as ReturnType<typeof vi.fn>;
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('appends layer-1 + fires layer-2 + emits upgraded artifact when ANCHOR_ON_CHAIN=true', async () => {
    const ledger = new AnchorLedger();
    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const settlement = fakeSettlement();
    const sendSpy: typeof sendAnchorMemoTx = vi.fn(async () => settlement);

    const result = await anchorChapterOne({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy,
    });

    expect(result).toEqual(settlement);

    // Ledger row has been upgraded with the on-chain trio via markOnChain.
    const anchorId = computeAnchorId(TOKEN_ADDR, 1);
    const entry = await ledger.get(anchorId);
    expect(entry?.onChainTxHash).toBe(TX_HASH);
    expect(entry?.chain).toBe('bsc-mainnet');

    // Exactly two lore-anchor artifacts: layer-1 init + layer-2 upgrade.
    const anchorArtifacts = onArtifact.mock.calls
      .map((c) => c[0])
      .filter((a) => a.kind === 'lore-anchor');
    expect(anchorArtifacts).toHaveLength(2);
    const upgraded = anchorArtifacts.find(
      (a) => a.kind === 'lore-anchor' && 'onChainTxHash' in a && a.onChainTxHash !== undefined,
    );
    expect(upgraded).toBeDefined();
    if (upgraded?.kind === 'lore-anchor') {
      expect(upgraded.onChainTxHash).toBe(TX_HASH);
      expect(upgraded.explorerUrl).toBe(settlement.explorerUrl);
    }

    const sendMock = sendSpy as unknown as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('returns null + warn log when layer-1 append throws, never calls layer-2', async () => {
    // Broken ledger where append blows up — layer-2 must not run because the
    // commitment row never landed.
    const brokenLedger = {
      append: vi.fn(async () => {
        throw new Error('pg connection refused');
      }),
      markOnChain: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
      size: vi.fn(async () => 0),
    } as unknown as AnchorLedger;

    const onArtifact = vi.fn<(a: Artifact) => void>();
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy: typeof sendAnchorMemoTx = vi.fn(async () => fakeSettlement());

    const result = await anchorChapterOne({
      anchorLedger: brokenLedger,
      tokenAddr: TOKEN_ADDR,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy,
    });

    expect(result).toBeNull();
    // No layer-1 artifact emitted because append failed.
    expect(onArtifact).not.toHaveBeenCalled();
    // Layer-2 was skipped.
    const sendMock = sendSpy as unknown as ReturnType<typeof vi.fn>;
    expect(sendMock).not.toHaveBeenCalled();
    // A warn log explaining the append failure must be present.
    const warnLog = onLog.mock.calls.find((c) => c[0].level === 'warn');
    expect(warnLog?.[0].message).toMatch(/append failed|pg connection refused/);
  });

  it('still runs layer-2 when onArtifact throws (layer-1 ledger row already landed)', async () => {
    // onArtifact throw must NOT be mistaken for an append failure: the ledger
    // row is persisted and layer-2 (the on-chain memo tx) still fires. This
    // pins down the split between ledger write and artifact fan-out that
    // `anchorChapterOne` enforces via two separate try/catch blocks.
    const ledger = new AnchorLedger();
    const onArtifact = vi.fn<(a: Artifact) => void>(() => {
      throw new Error('SSE subscriber blew up');
    });
    const onLog = vi.fn<(e: LogEvent) => void>();
    const sendSpy: typeof sendAnchorMemoTx = vi.fn(async () => fakeSettlement());

    const result = await anchorChapterOne({
      anchorLedger: ledger,
      tokenAddr: TOKEN_ADDR,
      loreCid: LORE_CID,
      env: { ANCHOR_ON_CHAIN: 'true' },
      bscDeployerPrivateKey: DEPLOYER_PK,
      onArtifact,
      onLog,
      sendAnchorMemoTxImpl: sendSpy,
    });

    // Layer-1 ledger row landed despite the artifact-emit throw.
    const anchorId = computeAnchorId(TOKEN_ADDR, 1);
    const entry = await ledger.get(anchorId);
    expect(entry).toBeDefined();
    expect(entry?.chapterNumber).toBe(1);

    // Layer-2 still fired — send impl was called exactly once. This is the
    // load-bearing assertion: pre-fix, the layer-1 emit throw landed in a
    // shared catch block that short-circuited layer-2 and misreported the
    // failure as `append failed`.
    const sendMock = sendSpy as unknown as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledTimes(1);
    // `result` may still be null because the same throwing onArtifact is
    // invoked for the layer-2 upgrade artifact inside `maybeAnchorContent` —
    // that downstream path is outside the scope of this fix. What matters is
    // that layer-2 was reached at all.
    void result;

    // The layer-1 emit failure surfaces as a dedicated warn log (distinct
    // from the `append failed` message the previous case exercised).
    const emitWarn = onLog.mock.calls.find(
      (c) => c[0].level === 'warn' && c[0].message.includes('artifact emit'),
    );
    expect(emitWarn).toBeDefined();
    expect(emitWarn?.[0].message).toMatch(/SSE subscriber blew up/);
  });
});
