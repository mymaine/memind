import { describe, it, expect } from 'vitest';
import {
  artifactSchema,
  createRequestSchema,
  createRunRequestSchema,
  runSnapshotSchema,
  statusEventPayloadSchema,
  txRefSchema,
} from './schema.js';

describe('createRequestSchema', () => {
  it('accepts a valid theme string', () => {
    const result = createRequestSchema.safeParse({ theme: 'a meme for BNB Chain 2026' });
    expect(result.success).toBe(true);
  });

  it('rejects a theme shorter than 3 characters', () => {
    const result = createRequestSchema.safeParse({ theme: 'hi' });
    expect(result.success).toBe(false);
  });
});

describe('txRefSchema', () => {
  it('accepts valid BSC mainnet tx ref', () => {
    const result = txRefSchema.safeParse({
      chain: 'bsc-mainnet',
      hash: '0xabcdef',
      explorerUrl: 'https://bscscan.com/tx/0xabcdef',
    });
    expect(result.success).toBe(true);
  });

  it('still accepts BSC testnet (probe compatibility)', () => {
    const result = txRefSchema.safeParse({
      chain: 'bsc-testnet',
      hash: '0xabc',
      explorerUrl: 'https://testnet.bscscan.com/tx/0xabc',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown chain value', () => {
    const result = txRefSchema.safeParse({
      chain: 'mainnet',
      hash: '0xabc',
      explorerUrl: 'https://example.com/tx/0xabc',
    });
    expect(result.success).toBe(false);
  });
});

describe('artifactSchema', () => {
  it('accepts a bsc-token artifact', () => {
    const result = artifactSchema.safeParse({
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      explorerUrl: 'https://bscscan.com/token/0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a token-deploy-tx artifact with full 64-char hash', () => {
    const result = artifactSchema.safeParse({
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash: `0x${'a'.repeat(64)}`,
      explorerUrl: `https://bscscan.com/tx/0x${'a'.repeat(64)}`,
    });
    expect(result.success).toBe(true);
  });

  it('rejects token-deploy-tx with short hash', () => {
    const result = artifactSchema.safeParse({
      kind: 'token-deploy-tx',
      chain: 'bsc-mainnet',
      txHash: '0xabc',
      explorerUrl: 'https://bscscan.com/tx/0xabc',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a lore-cid artifact from narrator with chapter number', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-cid',
      cid: 'bafkreibxxxxx',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreibxxxxx',
      author: 'narrator',
      chapterNumber: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects lore-cid with unknown author', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-cid',
      cid: 'bafkreibxxxxx',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreibxxxxx',
      author: 'stranger',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an x402-tx artifact on base-sepolia', () => {
    const result = artifactSchema.safeParse({
      kind: 'x402-tx',
      chain: 'base-sepolia',
      txHash: `0x${'b'.repeat(64)}`,
      explorerUrl: `https://sepolia.basescan.org/tx/0x${'b'.repeat(64)}`,
      amountUsdc: '0.01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects x402-tx pretending to be on bsc-mainnet', () => {
    const result = artifactSchema.safeParse({
      kind: 'x402-tx',
      chain: 'bsc-mainnet',
      txHash: `0x${'b'.repeat(64)}`,
      explorerUrl: 'https://bscscan.com/tx/0xbbb',
      amountUsdc: '0.01',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a tweet-url artifact', () => {
    const result = artifactSchema.safeParse({
      kind: 'tweet-url',
      url: 'https://x.com/agent/status/1234567890',
      tweetId: '1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an artifact with unknown kind', () => {
    const result = artifactSchema.safeParse({
      kind: 'mystery',
      payload: 'whatever',
    });
    expect(result.success).toBe(false);
  });

  // ─── meme-image artifact (V2-P1) ───────────────────────────────────────────
  // Two-state shape: `status: 'ok'` carries cid + gatewayUrl; `status:
  // 'upload-failed'` carries errorMessage + null cid/gatewayUrl. The Creator
  // flow MUST NOT crash when Pinata is down; it emits the failed-status variant
  // and the dashboard renders a placeholder card. base64 data URL fallback is
  // explicitly rejected (PNGs can be 1-2MB and would wedge SSE clients).

  it('accepts a meme-image artifact with status=ok + cid + gatewayUrl', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafybeibmemeimagexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      gatewayUrl:
        'https://gateway.pinata.cloud/ipfs/bafybeibmemeimagexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      prompt: 'a cyberpunk neko detective in neo-tokyo 2099',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a meme-image artifact with status=upload-failed + errorMessage', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: 'a cyberpunk neko detective in neo-tokyo 2099',
      errorMessage: 'pinata upload timed out after 10s',
    });
    expect(result.success).toBe(true);
  });

  it('rejects meme-image with status=ok but missing cid', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'ok',
      cid: null,
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeib',
      prompt: 'p',
    });
    expect(result.success).toBe(false);
  });

  it('rejects meme-image with status=upload-failed but missing errorMessage', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'upload-failed',
      cid: null,
      gatewayUrl: null,
      prompt: 'p',
    });
    expect(result.success).toBe(false);
  });

  it('rejects meme-image with empty prompt', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafy',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
      prompt: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects meme-image with base64 data URL gatewayUrl (no inline data fallback)', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'ok',
      cid: 'bafy',
      gatewayUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0',
      prompt: 'p',
    });
    expect(result.success).toBe(false);
  });

  it('rejects meme-image with unknown status value', () => {
    const result = artifactSchema.safeParse({
      kind: 'meme-image',
      status: 'pending',
      cid: 'bafy',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
      prompt: 'p',
    });
    expect(result.success).toBe(false);
  });
});

describe('createRunRequestSchema', () => {
  it('accepts a2a kind with no params', () => {
    const result = createRunRequestSchema.safeParse({ kind: 'a2a' });
    expect(result.success).toBe(true);
  });

  it('accepts a2a kind with arbitrary params object', () => {
    const result = createRunRequestSchema.safeParse({
      kind: 'a2a',
      params: { tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const result = createRunRequestSchema.safeParse({ kind: 'rogue' });
    expect(result.success).toBe(false);
  });
});

describe('statusEventPayloadSchema', () => {
  it('accepts a running status without errorMessage', () => {
    const result = statusEventPayloadSchema.safeParse({
      runId: 'run_abc',
      status: 'running',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an error status with errorMessage', () => {
    const result = statusEventPayloadSchema.safeParse({
      runId: 'run_abc',
      status: 'error',
      errorMessage: 'OpenRouter key missing',
    });
    expect(result.success).toBe(true);
  });
});

describe('runSnapshotSchema', () => {
  it('accepts a minimal snapshot with empty artifacts/logs', () => {
    const result = runSnapshotSchema.safeParse({
      runId: 'run_abc',
      kind: 'a2a',
      status: 'pending',
      startedAt: '2026-04-20T10:00:00.000Z',
      artifacts: [],
      logs: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a done snapshot with one artifact and one log', () => {
    const result = runSnapshotSchema.safeParse({
      runId: 'run_abc',
      kind: 'a2a',
      status: 'done',
      startedAt: '2026-04-20T10:00:00.000Z',
      endedAt: '2026-04-20T10:01:10.000Z',
      artifacts: [
        {
          kind: 'lore-cid',
          cid: 'bafkreibxxxxx',
          gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafkreibxxxxx',
          author: 'narrator',
        },
      ],
      logs: [
        {
          ts: '2026-04-20T10:00:15.000Z',
          agent: 'narrator',
          tool: 'extend_lore',
          level: 'info',
          message: 'published chapter 1',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
