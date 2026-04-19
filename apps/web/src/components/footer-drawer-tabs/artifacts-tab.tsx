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
 * UAT fix (2026-04-20): each row wraps in an <a> that opens the matching
 * verifier (BSCScan / Base Sepolia / Pinata gateway / X) in a new tab so
 * judges can independently verify the hash. Rows whose artifact has no
 * resolvable URL (e.g. meme-image upload-failed) render as plain divs.
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

/**
 * Map an artifact to the external verifier URL that proves the hash is
 * real. Returns undefined when no link target exists (e.g. meme-image
 * whose Pinata upload failed — there's nothing to open). Each artifact
 * kind already carries its own explorerUrl / gatewayUrl / url / tweetUrl
 * field; this helper just selects the right one so the UI does not have
 * to branch inline.
 */
export function resolveArtifactExplorerUrl(a: Artifact): string | undefined {
  switch (a.kind) {
    case 'bsc-token':
    case 'token-deploy-tx':
    case 'x402-tx':
      return a.explorerUrl;
    case 'lore-cid':
      return a.gatewayUrl;
    case 'lore-anchor':
      // Layer-2 on-chain anchor trio is all-or-nothing; prefer the BSC
      // tx link when it exists so judges can verify the memo. Otherwise
      // there is no public URL for the content hash alone.
      return a.explorerUrl;
    case 'tweet-url':
      return a.url;
    case 'shill-order':
      // Paid tx lives on BSC mainnet — use the canonical BSCScan tx URL.
      return `https://bscscan.com/tx/${a.paidTxHash}`;
    case 'shill-tweet':
      return a.tweetUrl;
    case 'meme-image':
      return a.gatewayUrl ?? undefined;
    case 'heartbeat-tick':
    case 'heartbeat-decision':
      // These are run-local artifacts without an external verifier.
      return undefined;
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
        const href = resolveArtifactExplorerUrl(a);
        const rowKey = `${row.chain}-${idx.toString()}`;
        // UAT fix (2026-04-20): for successful meme-image artifacts, inline a
        // 24x24 thumbnail before the chain label so judges spot the Creator's
        // output at a glance. The row still links to the Pinata gateway in a
        // new tab via the shared <a> wrapper below.
        const thumbSrc =
          a.kind === 'meme-image' && a.status === 'ok' && a.gatewayUrl !== null
            ? a.gatewayUrl
            : null;
        const children = (
          <>
            {thumbSrc !== null ? (
              <img
                src={thumbSrc}
                alt={a.kind === 'meme-image' ? (a.prompt ?? 'Generated meme') : 'thumbnail'}
                className="artifact-thumb"
                loading="lazy"
              />
            ) : (
              <span className="ev-dot" style={{ background: row.color }} />
            )}
            <span className="mono" style={{ color: row.color, width: 60 }}>
              {row.chain}
            </span>
            <span className="artifact-label">{row.label}</span>
            <span
              className="mono artifact-hash"
              style={{ color: 'var(--fg-tertiary)', textTransform: 'none' }}
            >
              {row.hashShort}
            </span>
            <span className="ev-check" style={{ marginLeft: 'auto' }}>
              ✓
            </span>
          </>
        );
        // When a verifier URL exists, wrap the row in an <a> so clicks
        // open BSCScan / IPFS gateway / X in a new tab. Otherwise keep
        // the plain div so no-op rows do not look pretend-interactive.
        if (href !== undefined) {
          return (
            <a
              key={rowKey}
              className="artifact-row artifact-row-link"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        }
        return (
          <div key={rowKey} className="artifact-row">
            {children}
          </div>
        );
      })}
    </div>
  );
}
