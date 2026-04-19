/**
 * Tests for `<ArtifactsTab />` (P0-14 / FooterDrawer On-chain Artifacts tab).
 *
 * Static-markup coverage for the chain → color mapping table, the
 * hash-shortening rule, and the empty-state copy. The pure
 * `mapArtifactToFooterRow` kernel is exercised directly so the mapping
 * table doubles as a unit-test surface.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact } from '@hack-fourmeme/shared';
import { ArtifactsTab, mapArtifactToFooterRow, shortenRef } from '../artifacts-tab.js';

const TX_HASH = `0x${'a'.repeat(64)}`;
const TX_HASH_SHORT = `0xaaaa..aaaa`;

describe('<ArtifactsTab />', () => {
  it('renders the empty-state CTA when artifacts is empty', () => {
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={[]} />);
    expect(out).toContain('no artifacts yet');
    expect(out).toContain('launch a token or order a shill');
    expect(out).not.toContain('artifact-row');
  });

  it('renders a BASE row for an x402-tx artifact with the chain-base color', () => {
    const artifacts: Artifact[] = [
      {
        kind: 'x402-tx',
        chain: 'base-sepolia',
        txHash: TX_HASH,
        explorerUrl: `https://sepolia.basescan.org/tx/${TX_HASH}`,
        amountUsdc: '0.01',
      },
    ];
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={artifacts} />);
    expect(out).toContain('artifact-row');
    expect(out).toContain('BASE');
    // Color variable reference is inlined as CSS custom property.
    expect(out).toContain('--chain-base');
    // Shortened hash rendered.
    expect(out).toContain(TX_HASH_SHORT);
  });

  it('renders an IPFS row for a lore-cid artifact with the chain-ipfs color', () => {
    const artifacts: Artifact[] = [
      {
        kind: 'lore-cid',
        cid: 'bafybeigdyabcdefghijklmnop',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeigdyabcdefghijklmnop',
        author: 'creator',
      },
    ];
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={artifacts} />);
    expect(out).toContain('IPFS');
    expect(out).toContain('--chain-ipfs');
    // Hash shortened (len > 12 → 6..4).
    expect(out).toContain('bafybe..mnop');
  });

  it('shortenRef truncates only when the ref is longer than 12 chars', () => {
    expect(shortenRef('short')).toBe('short');
    expect(shortenRef('exactly12chr')).toBe('exactly12chr');
    expect(shortenRef('thisislongerthantwelve')).toBe('thisis..elve');
    expect(shortenRef(TX_HASH)).toBe(TX_HASH_SHORT);
  });

  it('mapArtifactToFooterRow maps each artifact kind to its chain / color', () => {
    const cases: { artifact: Artifact; expectedChain: string; expectedColor: string }[] = [
      {
        artifact: {
          kind: 'bsc-token',
          chain: 'bsc-mainnet',
          address: `0x${'b'.repeat(40)}`,
          explorerUrl: 'https://bscscan.com/token/0xb',
        },
        expectedChain: 'BNB',
        expectedColor: 'var(--chain-bnb)',
      },
      {
        artifact: {
          kind: 'tweet-url',
          url: 'https://x.com/foo/status/1',
          tweetId: '1234567890',
        },
        expectedChain: 'X',
        expectedColor: 'var(--accent)',
      },
      {
        artifact: {
          kind: 'meme-image',
          status: 'ok',
          cid: 'bafymemememe',
          gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafymemememe',
          prompt: 'pixel dog',
        },
        expectedChain: 'CDN',
        expectedColor: 'var(--fg-secondary)',
      },
      {
        artifact: {
          kind: 'heartbeat-decision',
          tickNumber: 1,
          action: 'post',
          reason: 'momentum high',
        },
        expectedChain: 'TICK',
        expectedColor: 'var(--accent)',
      },
    ];
    for (const c of cases) {
      const row = mapArtifactToFooterRow(c.artifact);
      expect(row.chain).toBe(c.expectedChain);
      expect(row.color).toBe(c.expectedColor);
    }
  });

  it('mapArtifactToFooterRow handles meme-image upload-failed by labelling the hash', () => {
    const row = mapArtifactToFooterRow({
      kind: 'meme-image',
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: 'pixel dog',
      errorMessage: 'pinata timeout',
    });
    expect(row.chain).toBe('CDN');
    expect(row.hashShort).toBe('upload failed');
  });
});
