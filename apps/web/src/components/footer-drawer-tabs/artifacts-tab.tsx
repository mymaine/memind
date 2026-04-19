'use client';

/**
 * <ArtifactsTab /> — On-chain Artifacts tab of the FooterDrawer (P0-14).
 *
 * Binds directly to `runState.artifacts: Artifact[]`. Each row is a mono
 * horizontal flex with `.ev-dot` colored chip, chain label, artifact label,
 * shortened hash, and a trailing `.ev-check`. Row CSS (`.artifact-row`,
 * `.artifacts-pane`, `.ev-dot`, `.ev-check`, `.artifact-label`) lives in
 * globals.css.
 *
 * `mapArtifactToFooterRow` is the pure kernel — exported so the mapping
 * table is unit-testable without pulling React. It mirrors the spec:
 *
 *   bsc-token / token-deploy-tx / shill-order / shill-tweet → BNB
 *   x402-tx                                                 → BASE
 *   lore-cid / lore-anchor                                  → IPFS
 *   tweet-url                                               → X
 *   meme-image                                              → CDN
 *   heartbeat-tick / heartbeat-decision                     → TICK
 *
 * Hash shortening: when the reference length exceeds 12 chars we render
 * `${slice(0,6)}..${slice(-4)}`; otherwise the full string.
 *
 * Empty state: `no artifacts yet · launch a token or order a shill`.
 */
import type { ReactElement } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';

export interface FooterArtifactRow {
  /** Short chain label rendered in the mono column (BNB / BASE / IPFS / X / CDN / TICK). */
  readonly chain: string;
  /** CSS color variable reference used for the dot + chain text. */
  readonly color: string;
  /** Human-readable artifact label. */
  readonly label: string;
  /** Hash / CID truncated to 12-char max-width. */
  readonly hashShort: string;
}

export function shortenRef(ref: string): string {
  if (ref.length <= 12) return ref;
  return `${ref.slice(0, 6)}..${ref.slice(-4)}`;
}

export function mapArtifactToFooterRow(a: Artifact): FooterArtifactRow {
  switch (a.kind) {
    case 'bsc-token':
      return {
        chain: 'BNB',
        color: 'var(--chain-bnb)',
        label: a.label ?? 'token contract',
        hashShort: shortenRef(a.address),
      };
    case 'token-deploy-tx':
      return {
        chain: 'BNB',
        color: 'var(--chain-bnb)',
        label: a.label ?? 'token deploy tx',
        hashShort: shortenRef(a.txHash),
      };
    case 'shill-order':
      return {
        chain: 'BNB',
        color: 'var(--chain-bnb)',
        label: a.label ?? `shill order · ${a.status}`,
        hashShort: shortenRef(a.paidTxHash),
      };
    case 'shill-tweet':
      return {
        chain: 'BNB',
        color: 'var(--chain-bnb)',
        label: a.label ?? 'shill tweet posted',
        hashShort: shortenRef(a.tweetId),
      };
    case 'x402-tx':
      return {
        chain: 'BASE',
        color: 'var(--chain-base)',
        label: a.label ?? 'x402 USDC settlement',
        hashShort: shortenRef(a.txHash),
      };
    case 'lore-cid':
      return {
        chain: 'IPFS',
        color: 'var(--chain-ipfs)',
        label: a.label ?? `${a.author} lore cid`,
        hashShort: shortenRef(a.cid),
      };
    case 'lore-anchor':
      return {
        chain: 'IPFS',
        color: 'var(--chain-ipfs)',
        label: a.label ?? 'lore anchor',
        hashShort: shortenRef(a.contentHash),
      };
    case 'tweet-url':
      return {
        chain: 'X',
        color: 'var(--accent)',
        label: a.label ?? 'tweet posted',
        hashShort: shortenRef(a.tweetId),
      };
    case 'meme-image':
      return {
        chain: 'CDN',
        color: 'var(--fg-secondary)',
        label: a.label ?? 'meme image',
        hashShort: a.cid !== null ? shortenRef(a.cid) : 'upload failed',
      };
    case 'heartbeat-tick':
      return {
        chain: 'TICK',
        color: 'var(--accent)',
        label: a.label ?? `tick ${a.tickNumber.toString()}/${a.totalTicks.toString()}`,
        hashShort: shortenRef(a.decisions.join('·')),
      };
    case 'heartbeat-decision':
      return {
        chain: 'TICK',
        color: 'var(--accent)',
        label: a.label ?? `tick ${a.tickNumber.toString()} · ${a.action}`,
        hashShort: shortenRef(a.reason),
      };
  }
}

export interface ArtifactsTabProps {
  readonly artifacts: readonly Artifact[];
}

export function ArtifactsTab(props: ArtifactsTabProps): ReactElement {
  const { artifacts } = props;

  if (artifacts.length === 0) {
    return (
      <div className="artifacts-pane">
        <div
          className="mono"
          style={{
            padding: '24px 0',
            textAlign: 'center',
            color: 'var(--fg-tertiary)',
          }}
        >
          no artifacts yet · launch a token or order a shill
        </div>
      </div>
    );
  }

  return (
    <div className="artifacts-pane">
      {artifacts.map((a, idx) => {
        const row = mapArtifactToFooterRow(a);
        return (
          <div key={`${row.chain}-${idx.toString()}`} className="artifact-row">
            <span className="ev-dot" style={{ background: row.color }} />
            <span className="mono" style={{ color: row.color, width: 60 }}>
              {row.chain}
            </span>
            <span className="artifact-label">{row.label}</span>
            <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
              {row.hashShort}
            </span>
            <span className="ev-check" style={{ marginLeft: 'auto' }}>
              ✓
            </span>
          </div>
        );
      })}
    </div>
  );
}
