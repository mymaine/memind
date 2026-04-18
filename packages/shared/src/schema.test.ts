import { describe, it, expect } from 'vitest';
import {
  artifactSchema,
  assistantDeltaEventPayloadSchema,
  createRequestSchema,
  createRunRequestSchema,
  runKindSchema,
  runSnapshotSchema,
  statusEventPayloadSchema,
  toolUseEndEventPayloadSchema,
  toolUseStartEventPayloadSchema,
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

  it('accepts heartbeat kind with tokenAddress param (V2-P3)', () => {
    const result = createRunRequestSchema.safeParse({
      kind: 'heartbeat',
      params: { tokenAddress: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const result = createRunRequestSchema.safeParse({ kind: 'rogue' });
    expect(result.success).toBe(false);
  });
});

// ─── heartbeat-tick / heartbeat-decision artifact kinds (V2-P3) ───────────────
// Heartbeat runs emit one `heartbeat-tick` per tick for the UI counter
// (`03 / 03 ticks`) and zero-or-more `heartbeat-decision` when the agent
// resolves on an action within a tick. Both carry `ts` so the TweetFeed / UI
// can order them independently of log arrival.
describe('artifactSchema heartbeat-tick', () => {
  it('accepts a heartbeat-tick with tickNumber + empty decisions', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-tick',
      tickNumber: 1,
      totalTicks: 3,
      decisions: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a heartbeat-tick with non-empty decisions array', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-tick',
      tickNumber: 2,
      totalTicks: 3,
      decisions: ['check_status', 'post'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a heartbeat-tick with tickNumber=0 (ticks are 1-indexed)', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-tick',
      tickNumber: 0,
      totalTicks: 3,
      decisions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a heartbeat-tick with tickNumber > totalTicks', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-tick',
      tickNumber: 4,
      totalTicks: 3,
      decisions: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('artifactSchema heartbeat-decision', () => {
  it('accepts a decision with action=post + reason', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-decision',
      tickNumber: 1,
      action: 'post',
      reason: 'bonding curve progress changed; posting announcement',
    });
    expect(result.success).toBe(true);
  });

  it('accepts action=extend_lore and action=skip', () => {
    for (const action of ['extend_lore', 'skip'] as const) {
      const result = artifactSchema.safeParse({
        kind: 'heartbeat-decision',
        tickNumber: 2,
        action,
        reason: 'fallback path',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects heartbeat-decision with unknown action', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-decision',
      tickNumber: 1,
      action: 'dance',
      reason: 'none',
    });
    expect(result.success).toBe(false);
  });

  it('rejects heartbeat-decision with empty reason', () => {
    const result = artifactSchema.safeParse({
      kind: 'heartbeat-decision',
      tickNumber: 1,
      action: 'post',
      reason: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── lore-anchor artifact kind (AC3) ─────────────────────────────────────────
// Narrator emits a `lore-anchor` after every chapter upsert. Layer 1 (always
// on) carries `contentHash` (keccak256 commitment) + `anchorId` + `ts`.
// Layer 2 (opt-in via ANCHOR_ON_CHAIN=true) populates the optional
// `onChainTxHash` / `chain` / `explorerUrl` trio once the zero-value self-tx
// lands. The optional trio must be all-present or all-absent so the UI never
// renders a broken explorer link.
describe('artifactSchema lore-anchor', () => {
  it('accepts a layer-1 only anchor (no on-chain fields)', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0x4e39d254c716d88ae52d9ca136f0a029c5f74444-1',
      tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      chapterNumber: 1,
      loreCid: 'bafkreibxxxxx',
      contentHash: `0x${'a'.repeat(64)}`,
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a layer-2 anchor with all three on-chain fields populated', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0x4e39d254c716d88ae52d9ca136f0a029c5f74444-2',
      tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      chapterNumber: 2,
      loreCid: 'bafkreibyyyyy',
      contentHash: `0x${'b'.repeat(64)}`,
      onChainTxHash: `0x${'c'.repeat(64)}`,
      chain: 'bsc-mainnet',
      explorerUrl:
        'https://bscscan.com/tx/0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      ts: '2026-04-20T10:01:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects lore-anchor with a contentHash that is not 32 bytes', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0xaaa-1',
      tokenAddr: '0xAAA',
      chapterNumber: 1,
      loreCid: 'bafy',
      contentHash: '0xabc',
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lore-anchor with chapterNumber=0 (chapters are 1-indexed)', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0xaaa-0',
      tokenAddr: '0xAAA',
      chapterNumber: 0,
      loreCid: 'bafy',
      contentHash: `0x${'a'.repeat(64)}`,
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lore-anchor with empty loreCid', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0xaaa-1',
      tokenAddr: '0xAAA',
      chapterNumber: 1,
      loreCid: '',
      contentHash: `0x${'a'.repeat(64)}`,
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lore-anchor when onChainTxHash is set but chain/explorerUrl are missing', () => {
    // All-or-nothing on the optional on-chain trio: having only the tx hash
    // without an explorer link would give the dashboard a broken pill.
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0xaaa-1',
      tokenAddr: '0xAAA',
      chapterNumber: 1,
      loreCid: 'bafy',
      contentHash: `0x${'a'.repeat(64)}`,
      onChainTxHash: `0x${'c'.repeat(64)}`,
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lore-anchor when chain is set without the matching tx hash', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0xaaa-1',
      tokenAddr: '0xAAA',
      chapterNumber: 1,
      loreCid: 'bafy',
      contentHash: `0x${'a'.repeat(64)}`,
      chain: 'bsc-mainnet',
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lore-anchor with malformed explorerUrl', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      anchorId: '0xaaa-1',
      tokenAddr: '0xAAA',
      chapterNumber: 1,
      loreCid: 'bafy',
      contentHash: `0x${'a'.repeat(64)}`,
      onChainTxHash: `0x${'c'.repeat(64)}`,
      chain: 'bsc-mainnet',
      explorerUrl: 'not-a-url',
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects lore-anchor with missing anchorId', () => {
    const result = artifactSchema.safeParse({
      kind: 'lore-anchor',
      tokenAddr: '0xAAA',
      chapterNumber: 1,
      loreCid: 'bafy',
      contentHash: `0x${'a'.repeat(64)}`,
      ts: '2026-04-20T10:00:00.000Z',
    });
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

// ─── Fine-grained SSE events (V2-P2) ─────────────────────────────────────────
// Three new `event:` names surface the agent's internal Anthropic stream to
// the dashboard: a spinner at tool_use:start, the result at tool_use:end, and
// per-token assistant text via assistant:delta. All three carry `agent` +
// `ts`; the start/end pair is correlated through `toolUseId` so the UI can
// close the right bubble when a parallel run interleaves tools.

describe('toolUseStartEventPayloadSchema', () => {
  it('accepts a well-formed tool_use:start payload', () => {
    const result = toolUseStartEventPayloadSchema.safeParse({
      agent: 'creator',
      toolName: 'create_image',
      toolUseId: 'tu_1',
      input: { prompt: 'neon shiba' },
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects tool_use:start missing toolUseId', () => {
    const result = toolUseStartEventPayloadSchema.safeParse({
      agent: 'creator',
      toolName: 'create_image',
      input: {},
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects tool_use:start with unknown agent id', () => {
    const result = toolUseStartEventPayloadSchema.safeParse({
      agent: 'orchestrator',
      toolName: 'create_image',
      toolUseId: 'tu_1',
      input: {},
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('toolUseEndEventPayloadSchema', () => {
  it('accepts a successful tool_use:end payload', () => {
    const result = toolUseEndEventPayloadSchema.safeParse({
      agent: 'creator',
      toolName: 'create_image',
      toolUseId: 'tu_1',
      output: { cid: 'bafy', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy' },
      isError: false,
      ts: '2026-04-20T10:00:01.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failed tool_use:end payload with error output', () => {
    const result = toolUseEndEventPayloadSchema.safeParse({
      agent: 'narrator',
      toolName: 'extend_lore',
      toolUseId: 'tu_2',
      output: { error: 'pinata timed out' },
      isError: true,
      ts: '2026-04-20T10:00:02.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects tool_use:end missing isError flag', () => {
    const result = toolUseEndEventPayloadSchema.safeParse({
      agent: 'narrator',
      toolName: 'extend_lore',
      toolUseId: 'tu_2',
      output: {},
      ts: '2026-04-20T10:00:02.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('assistantDeltaEventPayloadSchema', () => {
  it('accepts a non-empty delta', () => {
    const result = assistantDeltaEventPayloadSchema.safeParse({
      agent: 'creator',
      delta: 'Thinking about the theme ...',
      ts: '2026-04-20T10:00:00.500Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty delta (stream mapper drops empty deltas before emit)', () => {
    const result = assistantDeltaEventPayloadSchema.safeParse({
      agent: 'creator',
      delta: '',
      ts: '2026-04-20T10:00:00.500Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects delta payload missing ts', () => {
    const result = assistantDeltaEventPayloadSchema.safeParse({
      agent: 'creator',
      delta: 'hi',
    });
    expect(result.success).toBe(false);
  });
});

// ─── shill-order / shill-tweet artifact kinds (Phase 4.6) ────────────────────
// Shilling Market path: creators pay 0.01 USDC via x402 for an agent to shill
// their token on X. `shill-order` carries the paid queue entry (queued →
// processing → done / failed); `shill-tweet` is emitted once the Shiller agent
// posts the promotional tweet from its own X account. See
// docs/features/shilling-market.md "SSE schema 追加" section for shape.
describe('artifactSchema shill-order', () => {
  it('accepts a complete shill-order payload including optional creatorBrief', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-order',
      orderId: 'order_abc123',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      creatorBrief: 'lean cyberpunk angle, emphasise curiosity',
      paidTxHash: `0x${'a'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'queued',
      ts: '2026-04-20T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a shill-order omitting the optional creatorBrief field', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-order',
      orderId: 'order_abc124',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      paidTxHash: `0x${'b'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'processing',
      ts: '2026-04-20T10:00:01.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects shill-order with a malformed targetTokenAddr (not an EVM address)', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-order',
      orderId: 'order_abc125',
      targetTokenAddr: '0xnotAnAddress',
      paidTxHash: `0x${'c'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'queued',
      ts: '2026-04-20T10:00:02.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects shill-order with a status outside the allowed enum', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-order',
      orderId: 'order_abc126',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      paidTxHash: `0x${'d'.repeat(64)}`,
      paidAmountUsdc: '0.01',
      status: 'pending',
      ts: '2026-04-20T10:00:03.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects shill-order with a short (non-32-byte) paidTxHash', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-order',
      orderId: 'order_abc127',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      paidTxHash: '0xabc',
      paidAmountUsdc: '0.01',
      status: 'queued',
      ts: '2026-04-20T10:00:04.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('artifactSchema shill-tweet', () => {
  it('accepts a complete shill-tweet payload', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-tweet',
      orderId: 'order_abc123',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      tweetId: '1843219876543210000',
      tweetUrl: 'https://x.com/shiller/status/1843219876543210000',
      tweetText: '$MEMEA — stumbled on this one, the lore reads like a fever dream',
      ts: '2026-04-20T10:01:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects shill-tweet when tweetUrl is not a URL', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-tweet',
      orderId: 'order_abc123',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      tweetId: '1843219876543210000',
      tweetUrl: 'not-a-url',
      tweetText: '$MEMEA curious find',
      ts: '2026-04-20T10:01:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects shill-tweet with empty tweetText', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-tweet',
      orderId: 'order_abc123',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      tweetId: '1843219876543210000',
      tweetUrl: 'https://x.com/shiller/status/1843219876543210000',
      tweetText: '',
      ts: '2026-04-20T10:01:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects shill-tweet with tweetText exceeding the 280-char X cap', () => {
    const result = artifactSchema.safeParse({
      kind: 'shill-tweet',
      orderId: 'order_abc123',
      targetTokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
      tweetId: '1843219876543210000',
      tweetUrl: 'https://x.com/shiller/status/1843219876543210000',
      tweetText: 'a'.repeat(281),
      ts: '2026-04-20T10:01:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('runKindSchema (Phase 4.6 adds shill-market)', () => {
  it('accepts shill-market as a new run kind', () => {
    const result = runKindSchema.safeParse('shill-market');
    expect(result.success).toBe(true);
  });

  it('still accepts the pre-existing creator / a2a / heartbeat kinds', () => {
    for (const kind of ['creator', 'a2a', 'heartbeat'] as const) {
      const result = runKindSchema.safeParse(kind);
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown run kind', () => {
    const result = runKindSchema.safeParse('unknown-kind');
    expect(result.success).toBe(false);
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
