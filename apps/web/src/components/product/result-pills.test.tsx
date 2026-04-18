/**
 * Red tests for `<ResultPills />` (V4.7-P4 Task 3 / AC-P4.7-5).
 *
 * ResultPills is the shared explorer-pill row rendered by LaunchPanel's
 * `success` state and OrderPanel's `posted` state. It is a slim wrapper
 * around the existing `describeArtifact` / `isPillArtifact` helpers from
 * `@/lib/artifact-view` so the pill visuals stay identical to TxList.
 *
 * Contract pinned here (spec demo-narrative-ui.md AC-P4.7-5):
 *   - Empty artifact list renders nothing (no `<a>` tags, no pill row).
 *   - Single pillable artifact → exactly one `<a>` pill with the
 *     explorer URL as `href` and `target="_blank"` + `rel="noopener
 *     noreferrer"` (external link hygiene).
 *   - Mixed 5-artifact success set → 5 pills, one per artifact.
 *   - Non-pill artifact kinds (heartbeat-tick / lore-anchor / shill-order
 *     / shill-tweet) are filtered out before rendering so the panel
 *     cannot accidentally leak them into the pill row.
 *   - Chain label text ('BSC' / 'BASE' / 'IPFS' / 'X') is visible on the
 *     pill so the eye can scan by chain.
 *   - Each pill carries an `aria-label` derived from the artifact's
 *     kindLabel so screen readers announce the pill purpose.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact } from '@hack-fourmeme/shared';
import { ResultPills } from './result-pills.js';

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEPLOY_TX = `0x${'a'.repeat(64)}`;
const X402_TX = `0x${'b'.repeat(64)}`;
const TWEET_ID = '1798765432100000000';

function bscToken(): Artifact {
  return {
    kind: 'bsc-token',
    chain: 'bsc-mainnet',
    address: TOKEN_ADDR,
    explorerUrl: `https://bscscan.com/token/${TOKEN_ADDR}`,
  };
}

function deployTx(): Artifact {
  return {
    kind: 'token-deploy-tx',
    chain: 'bsc-mainnet',
    txHash: DEPLOY_TX,
    explorerUrl: `https://bscscan.com/tx/${DEPLOY_TX}`,
  };
}

function loreCid(author: 'creator' | 'narrator'): Artifact {
  return {
    kind: 'lore-cid',
    cid: `bafylore-${author}`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/bafylore-${author}`,
    author,
  };
}

function x402Tx(): Artifact {
  return {
    kind: 'x402-tx',
    chain: 'base-sepolia',
    txHash: X402_TX,
    explorerUrl: `https://sepolia.basescan.org/tx/${X402_TX}`,
    amountUsdc: '0.01',
  };
}

function tweetUrl(): Artifact {
  return {
    kind: 'tweet-url',
    tweetId: TWEET_ID,
    url: `https://twitter.com/shiller_x/status/${TWEET_ID}`,
  };
}

function heartbeatTick(): Artifact {
  return {
    kind: 'heartbeat-tick',
    tickNumber: 1,
    totalTicks: 3,
    decisions: [],
  };
}

function shillOrder(): Artifact {
  return {
    kind: 'shill-order',
    orderId: 'order_test',
    targetTokenAddr: TOKEN_ADDR,
    paidTxHash: `0x${'c'.repeat(64)}`,
    paidAmountUsdc: '0.01',
    status: 'done',
    ts: '2026-04-19T00:00:00.000Z',
  };
}

function loreAnchor(): Artifact {
  return {
    kind: 'lore-anchor',
    anchorId: `${TOKEN_ADDR.toLowerCase()}-1`,
    tokenAddr: TOKEN_ADDR,
    chapterNumber: 1,
    loreCid: 'bafyanchor',
    contentHash: `0x${'e'.repeat(64)}`,
    ts: '2026-04-19T00:00:00.000Z',
  };
}

describe('<ResultPills /> static markup', () => {
  it('empty artifacts → no <a> elements emitted', () => {
    const out = renderToStaticMarkup(<ResultPills artifacts={[]} />);
    expect(out).not.toMatch(/<a\b/);
  });

  it('single bsc-token artifact → one pill with bscscan href', () => {
    const out = renderToStaticMarkup(<ResultPills artifacts={[bscToken()]} />);
    const matches = out.match(/<a\b/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(out).toContain(`https://bscscan.com/token/${TOKEN_ADDR}`);
  });

  it('mixed 5-artifact success set → 5 pills', () => {
    const five: Artifact[] = [
      bscToken(),
      deployTx(),
      loreCid('creator'),
      loreCid('narrator'),
      x402Tx(),
    ];
    const out = renderToStaticMarkup(<ResultPills artifacts={five} />);
    const anchors = out.match(/<a\b/g) ?? [];
    expect(anchors).toHaveLength(5);
  });

  it('filters out non-pill artifacts (heartbeat-tick / shill-order / lore-anchor)', () => {
    // Feed one pillable + three non-pillable; expect exactly one anchor and
    // none of the non-pillable payload tokens leak into markup.
    const mixed: Artifact[] = [bscToken(), heartbeatTick(), shillOrder(), loreAnchor()];
    const out = renderToStaticMarkup(<ResultPills artifacts={mixed} />);
    const anchors = out.match(/<a\b/g) ?? [];
    expect(anchors).toHaveLength(1);
    // The non-pill identifiers should not appear anywhere in markup.
    expect(out).not.toContain('order_test');
    expect(out).not.toContain('bafyanchor');
  });

  it('pills carry target=_blank + rel=noopener noreferrer', () => {
    const out = renderToStaticMarkup(<ResultPills artifacts={[bscToken()]} />);
    expect(out).toContain('target="_blank"');
    expect(out).toMatch(/rel="noopener noreferrer"|rel="noreferrer noopener"/);
  });

  it('renders visible chain labels (BSC / BASE / IPFS / X) on the pill row', () => {
    const all: Artifact[] = [bscToken(), loreCid('creator'), x402Tx(), tweetUrl()];
    const out = renderToStaticMarkup(<ResultPills artifacts={all} />);
    expect(out).toContain('BSC');
    expect(out).toContain('BASE');
    expect(out).toContain('IPFS');
    expect(out).toContain('>X<');
  });

  it('each pill carries aria-label derived from the artifact kindLabel', () => {
    const labeled: Artifact = {
      kind: 'bsc-token',
      chain: 'bsc-mainnet',
      address: TOKEN_ADDR,
      explorerUrl: `https://bscscan.com/token/${TOKEN_ADDR}`,
      label: 'My Shiny Token',
    };
    const out = renderToStaticMarkup(<ResultPills artifacts={[labeled]} />);
    expect(out).toMatch(/aria-label="My Shiny Token"/);
  });
});
