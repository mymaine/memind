import { describe, expect, it } from 'vitest';
import type { Artifact } from './schema.js';
import { artifactConflictStrategy, deriveNaturalKey } from './artifact-natural-key.js';

/**
 * Natural-key contract tests. Every artifact kind gets one happy case and,
 * where relevant, its conflict strategy. These tests double as the spec for
 * the DB partial unique index the server relies on.
 */

describe('deriveNaturalKey', () => {
  it('bsc-token uses the lowercased address', () => {
    const art: Artifact = {
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: '0xAaAaaAaaAAaaaaAaAaaaAaAAAaaaAAaAaAaAaAaA',
      explorerUrl: 'https://bscscan.com/token/0xAaAaaAaaAAaaaaAaAaaaAaAAAaaaAAaAaAaAaAaA',
    };
    expect(deriveNaturalKey(art)).toBe('bsc-token:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(artifactConflictStrategy(art)).toBe('do-nothing');
  });

  it('token-deploy-tx uses the lowercased tx hash', () => {
    const txHash = `0x${'A'.repeat(64)}` as `0x${string}`;
    const art: Artifact = {
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash,
      explorerUrl: `https://bscscan.com/tx/${txHash}`,
    };
    expect(deriveNaturalKey(art)).toBe(`token-deploy-tx:${txHash.toLowerCase()}`);
    expect(artifactConflictStrategy(art)).toBe('do-nothing');
  });

  it('x402-tx uses the lowercased tx hash', () => {
    const txHash = `0x${'B'.repeat(64)}` as `0x${string}`;
    const art: Artifact = {
      kind: 'x402-tx',
      chain: 'base-sepolia',
      txHash,
      explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
      amountUsdc: '0.01',
    };
    expect(deriveNaturalKey(art)).toBe(`x402-tx:${txHash.toLowerCase()}`);
  });

  it('lore-cid keys on cid + author so creator/narrator chapters coexist', () => {
    const creator: Artifact = {
      kind: 'lore-cid',
      cid: 'bafkrei-cid',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkrei-cid',
      author: 'creator',
    };
    const narrator: Artifact = { ...creator, author: 'narrator' };
    expect(deriveNaturalKey(creator)).toBe('lore-cid:bafkrei-cid:creator');
    expect(deriveNaturalKey(narrator)).toBe('lore-cid:bafkrei-cid:narrator');
  });

  it('shill-tweet keys on tweetId', () => {
    const art: Artifact = {
      kind: 'shill-tweet',
      orderId: 'o1',
      targetTokenAddr: '0x1111111111111111111111111111111111111111',
      tweetId: '1782001',
      tweetUrl: 'https://twitter.com/i/web/status/1782001',
      tweetText: 'promo',
      ts: '2026-04-20T00:00:00.000Z',
    };
    expect(deriveNaturalKey(art)).toBe('shill-tweet:1782001');
  });

  it('tweet-url keys on tweetId', () => {
    const art: Artifact = {
      kind: 'tweet-url',
      url: 'https://twitter.com/i/web/status/9',
      tweetId: '9',
    };
    expect(deriveNaturalKey(art)).toBe('tweet-url:9');
  });

  it('shill-order keys on orderId and conflict strategy is DO UPDATE', () => {
    const art: Artifact = {
      kind: 'shill-order',
      orderId: 'ord-42',
      targetTokenAddr: '0x1111111111111111111111111111111111111111',
      paidTxHash: `0x${'0'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'queued',
      ts: '2026-04-20T00:00:00.000Z',
    };
    expect(deriveNaturalKey(art)).toBe('shill-order:ord-42');
    expect(artifactConflictStrategy(art)).toBe('do-update');
  });

  it('lore-anchor keys on anchorId and conflict strategy is DO UPDATE', () => {
    const art: Artifact = {
      kind: 'lore-anchor',
      anchorId: '0xaaa-1',
      tokenAddr: '0xaaa',
      chapterNumber: 1,
      loreCid: 'bafkrei-cid',
      contentHash: `0x${'c'.repeat(64)}`,
      ts: '2026-04-20T00:00:00.000Z',
    };
    expect(deriveNaturalKey(art)).toBe('lore-anchor:0xaaa-1');
    expect(artifactConflictStrategy(art)).toBe('do-update');
  });

  it('meme-image uses cid when status=ok and conflict strategy is DO UPDATE', () => {
    const art: Artifact = {
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafkrei-meme',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkrei-meme',
      prompt: 'a pixel bat at dusk',
    };
    expect(deriveNaturalKey(art)).toBe('meme-image:bafkrei-meme');
    expect(artifactConflictStrategy(art)).toBe('do-update');
  });

  it('meme-image upload-failed is keyless so failures can repeat without collision', () => {
    const art: Artifact = {
      kind: 'meme-image',
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: 'a pixel bat at dusk',
      errorMessage: 'pinata 500',
    };
    expect(deriveNaturalKey(art)).toBeNull();
    expect(artifactConflictStrategy(art)).toBe('no-key');
  });

  it('heartbeat-tick is keyless', () => {
    const art: Artifact = {
      kind: 'heartbeat-tick',
      tickNumber: 1,
      totalTicks: 5,
      decisions: ['check_status'],
    };
    expect(deriveNaturalKey(art)).toBeNull();
    expect(artifactConflictStrategy(art)).toBe('no-key');
  });

  it('heartbeat-decision is keyless', () => {
    const art: Artifact = {
      kind: 'heartbeat-decision',
      tickNumber: 1,
      action: 'post',
      reason: 'supply rising',
    };
    expect(deriveNaturalKey(art)).toBeNull();
    expect(artifactConflictStrategy(art)).toBe('no-key');
  });
});
