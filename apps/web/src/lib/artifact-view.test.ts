import { describe, it, expect } from 'vitest';
import type { Artifact } from '@hack-fourmeme/shared';
import { describeArtifact, isPillArtifact } from './artifact-view';

/**
 * Pure-render unit coverage for describeArtifact. Existing five kinds are
 * exercised against representative shapes; the V2-P1 meme-image kind gets
 * dedicated cases for both `status` branches.
 */

describe('describeArtifact', () => {
  it('describes a bsc-token artifact', () => {
    const a: Artifact = {
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      explorerUrl: 'https://bscscan.com/token/0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
    };
    const d = describeArtifact(a);
    expect(d.chainLabel).toBe('BSC');
    expect(d.href).toContain('bscscan.com/token/');
  });

  it('describes a tweet-url artifact with the X chain label', () => {
    const a: Artifact = {
      kind: 'tweet-url',
      url: 'https://x.com/agent/status/1234567890',
      tweetId: '1234567890',
    };
    const d = describeArtifact(a);
    expect(d.chainLabel).toBe('X');
  });

  // ─── meme-image (V2-P1 Task 5) ─────────────────────────────────────────────

  it('describes a meme-image with status=ok using the IPFS chain colour', () => {
    const a: Artifact = {
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafybeibmemexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      gatewayUrl:
        'https://gateway.pinata.cloud/ipfs/bafybeibmemexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      prompt: 'a cat in space',
    };
    const d = describeArtifact(a);
    expect(d.chainLabel).toBe('IPFS');
    expect(d.chainColorVar).toBe('--color-chain-ipfs');
    expect(d.primaryText.startsWith('IMG')).toBe(true);
    expect(d.href).toContain('gateway.pinata.cloud/ipfs/');
    expect(d.kindLabel).toBe('meme image');
  });

  it('describes a meme-image with status=upload-failed using the danger colour', () => {
    const a: Artifact = {
      kind: 'meme-image',
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: 'a cat in space',
      errorMessage: 'pinata 503: gateway down',
    };
    const d = describeArtifact(a);
    expect(d.chainColorVar).toBe('--color-danger');
    expect(d.primaryText).toContain('upload-failed');
    expect(d.href).toBe('#');
    expect(d.kindLabel).toMatch(/pinata 503/);
  });

  it('falls back to a generic kindLabel when no errorMessage is present (defensive)', () => {
    const a: Artifact = {
      kind: 'meme-image',
      // We craft a malformed runtime shape — schema would normally reject this
      // but the renderer must still produce something printable to avoid a
      // dashboard crash on bad data.
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: 'p',
    } as Artifact;
    if (
      a.kind === 'heartbeat-tick' ||
      a.kind === 'heartbeat-decision' ||
      a.kind === 'lore-anchor' ||
      a.kind === 'shill-order' ||
      a.kind === 'shill-tweet'
    ) {
      throw new Error('unreachable: test fixture is a meme-image');
    }
    const d = describeArtifact(a);
    expect(d.kindLabel).toMatch(/unknown error/);
  });

  // ─── lore-anchor (UX fix 2026-04-21) ───────────────────────────────────────
  //
  // Layer-1 lore-anchor (no on-chain tx hash yet) stays off the pill row —
  // clicking would dead-link. Layer-2 upgraded lore-anchor (carries the full
  // on-chain trio) opts into the pill row and renders a clickable BSC scan
  // link so users can verify the anchor settled on-chain.

  it('keeps lore-anchor OFF the pill row when only layer-1 fields are present', () => {
    const a: Artifact = {
      kind: 'lore-anchor',
      anchorId: '0xabc-1',
      tokenAddr: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
      chapterNumber: 1,
      loreCid: 'bafkrei-ch1',
      contentHash: `0x${'a'.repeat(64)}`,
      ts: '2026-04-21T00:00:00.000Z',
    };
    expect(isPillArtifact(a)).toBe(false);
  });

  it('describes a layer-2 lore-anchor with BSC chain colour + bscscan href', () => {
    const txHash = `0x${'e'.repeat(64)}`;
    const a: Artifact = {
      kind: 'lore-anchor',
      anchorId: '0xabc-1',
      tokenAddr: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
      chapterNumber: 1,
      loreCid: 'bafkrei-ch1',
      contentHash: `0x${'a'.repeat(64)}`,
      ts: '2026-04-21T00:00:00.000Z',
      onChainTxHash: txHash,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/${txHash}`,
      label: 'lore anchor (on-chain)',
    };
    expect(isPillArtifact(a)).toBe(true);
    if (!isPillArtifact(a)) throw new Error('unreachable: settled lore-anchor must be pillable');
    const d = describeArtifact(a);
    expect(d.chainLabel).toBe('BSC');
    expect(d.chainColorVar).toBe('--color-chain-bnb');
    expect(d.primaryText.startsWith('BSC ')).toBe(true);
    expect(d.href).toBe(`https://bscscan.com/tx/${txHash}`);
    expect(d.kindLabel).toBe('lore anchor (on-chain)');
  });

  it('falls back to a chapter-aware kindLabel when no label is provided', () => {
    const txHash = `0x${'f'.repeat(64)}`;
    const a: Artifact = {
      kind: 'lore-anchor',
      anchorId: '0xabc-3',
      tokenAddr: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
      chapterNumber: 3,
      loreCid: 'bafkrei-ch3',
      contentHash: `0x${'b'.repeat(64)}`,
      ts: '2026-04-21T00:01:00.000Z',
      onChainTxHash: txHash,
      chain: 'bsc-mainnet',
      explorerUrl: `https://bscscan.com/tx/${txHash}`,
    };
    if (!isPillArtifact(a)) throw new Error('unreachable: settled lore-anchor must be pillable');
    const d = describeArtifact(a);
    expect(d.kindLabel).toBe('lore anchor (ch.3)');
  });
});
