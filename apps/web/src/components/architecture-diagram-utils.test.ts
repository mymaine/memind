import { describe, it, expect } from 'vitest';
import type { Artifact } from '@hack-fourmeme/shared';
import {
  X402_FLOW_DURATION_MS,
  X402_FLOW_ITERATIONS,
  X402_FLOW_LOOP_MS,
  nodeVisualTokensFor,
  pickLatestX402TxHash,
} from './architecture-diagram-utils';

describe('nodeVisualTokensFor', () => {
  it('uses the warning stroke + pulse for running', () => {
    const t = nodeVisualTokensFor('running');
    expect(t.strokeVar).toContain('warning');
    expect(t.pulse).toBe(true);
  });

  it('uses the accent stroke for done with no pulse', () => {
    const t = nodeVisualTokensFor('done');
    expect(t.strokeVar).toContain('accent');
    expect(t.pulse).toBe(false);
  });

  it('uses the danger stroke for error', () => {
    const t = nodeVisualTokensFor('error');
    expect(t.strokeVar).toContain('danger');
    expect(t.pulse).toBe(false);
  });

  it('uses the default border stroke for idle', () => {
    const t = nodeVisualTokensFor('idle');
    expect(t.strokeVar).toContain('border-default');
    expect(t.pulse).toBe(false);
  });

  it('keeps the surface fill across every status so the diagram stays flat', () => {
    for (const s of ['idle', 'running', 'done', 'error'] as const) {
      const t = nodeVisualTokensFor(s);
      expect(t.fillVar).toContain('bg-surface');
    }
  });
});

describe('pickLatestX402TxHash', () => {
  const txA: Artifact = {
    kind: 'x402-tx',
    chain: 'base-sepolia',
    txHash: '0x' + 'a'.repeat(64),
    explorerUrl: 'https://sepolia.basescan.org/tx/0x' + 'a'.repeat(64),
    amountUsdc: '0.10',
  };
  const txB: Artifact = {
    kind: 'x402-tx',
    chain: 'base-sepolia',
    txHash: '0x' + 'b'.repeat(64),
    explorerUrl: 'https://sepolia.basescan.org/tx/0x' + 'b'.repeat(64),
    amountUsdc: '0.10',
  };
  const unrelated: Artifact = {
    kind: 'lore-cid',
    cid: 'bafy',
    gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy',
    author: 'narrator',
  };

  it('returns null when there are no x402-tx artifacts', () => {
    expect(pickLatestX402TxHash([])).toBeNull();
    expect(pickLatestX402TxHash([unrelated])).toBeNull();
  });

  it('returns the txHash of the latest x402-tx', () => {
    expect(pickLatestX402TxHash([txA])).toBe(txA.txHash);
    expect(pickLatestX402TxHash([txA, unrelated, txB])).toBe(txB.txHash);
  });

  it('skips non-x402 trailing artifacts and still finds the prior x402', () => {
    expect(pickLatestX402TxHash([txA, unrelated])).toBe(txA.txHash);
  });
});

describe('animation timing constants', () => {
  it('runs 3 loops of 1.2s = 3.6s total', () => {
    expect(X402_FLOW_LOOP_MS).toBe(1200);
    expect(X402_FLOW_ITERATIONS).toBe(3);
    expect(X402_FLOW_DURATION_MS).toBe(X402_FLOW_LOOP_MS * X402_FLOW_ITERATIONS);
  });
});
