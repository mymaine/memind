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
import {
  ArtifactsTab,
  mapArtifactToFooterRow,
  resolveArtifactExplorerUrl,
  shortenRef,
} from '../artifacts-tab.js';

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

  it('each artifact row renders as an <a> that opens the matching explorer in a new tab (UAT 2026-04-20)', () => {
    // UAT fix: On-chain Artifacts pills MUST be clickable so users can
    // verify the hashes independently on BSCScan / IPFS gateway / X. Each
    // row becomes an external link (target=_blank + rel=noopener noreferrer)
    // wrapping the pill content.
    const txHash = `0x${'a'.repeat(64)}`;
    const artifacts: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: `0x${'b'.repeat(40)}`,
        explorerUrl: `https://bscscan.com/token/0x${'b'.repeat(40)}`,
      },
      {
        kind: 'x402-tx',
        chain: 'base-sepolia',
        txHash,
        explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
        amountUsdc: '0.01',
      },
      {
        kind: 'lore-cid',
        cid: 'bafybeigdy123456',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeigdy123456',
        author: 'creator',
      },
    ];
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={artifacts} />);
    // Three <a> tags, each with target=_blank + rel=noopener.
    const anchors = out.match(/<a[^>]*href="[^"]+"[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(3);
    expect(out).toMatch(/<a[^>]*target="_blank"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(out).toContain(`https://bscscan.com/token/0x${'b'.repeat(40)}`);
    expect(out).toContain(`https://sepolia.basescan.org/tx/${txHash}`);
    expect(out).toContain('https://gateway.pinata.cloud/ipfs/bafybeigdy123456');
  });

  it('resolveArtifactExplorerUrl maps each artifact kind to its verification URL', () => {
    expect(
      resolveArtifactExplorerUrl({
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: `0x${'b'.repeat(40)}`,
        explorerUrl: `https://bscscan.com/token/0x${'b'.repeat(40)}`,
      }),
    ).toBe(`https://bscscan.com/token/0x${'b'.repeat(40)}`);
    expect(
      resolveArtifactExplorerUrl({
        kind: 'token-deploy-tx',
        chain: 'bsc-mainnet',
        txHash: `0x${'c'.repeat(64)}`,
        explorerUrl: `https://bscscan.com/tx/0x${'c'.repeat(64)}`,
      }),
    ).toBe(`https://bscscan.com/tx/0x${'c'.repeat(64)}`);
    expect(
      resolveArtifactExplorerUrl({
        kind: 'x402-tx',
        chain: 'base-sepolia',
        txHash: `0x${'d'.repeat(64)}`,
        explorerUrl: `https://sepolia.basescan.org/tx/0x${'d'.repeat(64)}`,
        amountUsdc: '0.01',
      }),
    ).toBe(`https://sepolia.basescan.org/tx/0x${'d'.repeat(64)}`);
    expect(
      resolveArtifactExplorerUrl({
        kind: 'lore-cid',
        cid: 'bafybeigdyabc',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeigdyabc',
        author: 'narrator',
      }),
    ).toBe('https://gateway.pinata.cloud/ipfs/bafybeigdyabc');
    expect(
      resolveArtifactExplorerUrl({
        kind: 'tweet-url',
        url: 'https://x.com/foo/status/1',
        tweetId: '1',
      }),
    ).toBe('https://x.com/foo/status/1');
    expect(
      resolveArtifactExplorerUrl({
        kind: 'meme-image',
        status: 'ok',
        cid: 'bafymemeok',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafymemeok',
        prompt: 'pixel dog',
      }),
    ).toBe('https://gateway.pinata.cloud/ipfs/bafymemeok');
    // upload-failed meme-image has no URL (no CDN to point at) → undefined.
    expect(
      resolveArtifactExplorerUrl({
        kind: 'meme-image',
        status: 'upload-failed',
        cid: null,
        gatewayUrl: null,
        prompt: 'pixel dog',
        errorMessage: 'pinata timeout',
      }),
    ).toBeUndefined();
  });

  it('rows with no resolvable URL render as plain divs, not anchors (meme-image upload-failed)', () => {
    const artifacts: Artifact[] = [
      {
        kind: 'meme-image',
        status: 'upload-failed',
        cid: null,
        gatewayUrl: null,
        prompt: 'pixel dog',
        errorMessage: 'pinata timeout',
      },
    ];
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={artifacts} />);
    expect(out).toContain('artifact-row');
    // No anchor wrapping this row.
    expect(out).not.toMatch(/<a[^>]*href[^>]*>[^<]*artifact-row|artifact-row[^<]*<\/a>/);
  });

  it('shortenRef preserves the 0x prefix and does NOT uppercase the ref (UAT 2026-04-20)', () => {
    // UAT fix: footer rendered `0X0A1A..4444` because the parent `.mono`
    // class set text-transform: uppercase. The shortenRef kernel itself
    // stays lowercase — CSS override lives in globals.css under
    // `.artifact-row .artifact-hash`. This is the kernel regression guard.
    const mixed = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
    expect(shortenRef(mixed)).toBe('0xAbCd..Ef01');
    expect(shortenRef('0xdeadbeefcafebabef00d')).toBe('0xdead..f00d');
  });

  it('renders the hash column with textTransform:none so 0x stays lowercase', () => {
    const artifacts: Artifact[] = [
      {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: '0xabcdef0123456789abcdef0123456789abcdef01',
        explorerUrl: 'https://bscscan.com/token/0xabcdef0123456789abcdef0123456789abcdef01',
      },
    ];
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={artifacts} />);
    // The hash span must carry the `artifact-hash` class plus an inline
    // text-transform:none so the parent `.mono { text-transform: uppercase }`
    // does not shout the 0x into 0X in the DOM render.
    expect(out).toContain('artifact-hash');
    expect(out).toMatch(/text-transform:\s*none/i);
  });

  it('renders an inline thumbnail <img> for successful meme-image rows (UAT 2026-04-20)', () => {
    // UAT fix #1 parity: the On-chain Artifacts tab in the FooterDrawer must
    // surface the generated meme image inline too, not only the BrainChat
    // bubble — users switching between the drawer + chat should see the
    // same preview everywhere.
    const artifacts: Artifact[] = [
      {
        kind: 'meme-image',
        status: 'ok',
        cid: 'bafybeigdymemerow',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeigdymemerow',
        prompt: 'pixel shiba with BNB helmet',
      },
    ];
    const out = renderToStaticMarkup(<ArtifactsTab artifacts={artifacts} />);
    expect(out).toMatch(
      /<img[^>]*src="https:\/\/gateway\.pinata\.cloud\/ipfs\/bafybeigdymemerow"[^>]*alt="pixel shiba with BNB helmet"/,
    );
    // Thumbnail carries the artifact-thumb class so globals.css styles it.
    expect(out).toMatch(/class="artifact-thumb"/);
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
