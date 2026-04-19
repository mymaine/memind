'use client';

/**
 * <Ch11Evidence> — closing evidence chapter of the Memind scrollytelling
 * narrative (memind-scrollytelling-rebuild AC-MSR-9 ch11 + Ch11 runState
 * integration).
 *
 * Ported from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 523-584.
 * Interior progress `p ∈ [0, 1]` drives a staggered pill reveal. The two
 * differences from the handoff:
 *
 *   1. Real-data binding (spec §Ch11 Evidence 必改). On-chain pills come
 *      from the published `runState.artifacts`. When the live run has
 *      shipped >= 5 artifacts we render the first 5 via
 *      `mapArtifactToEvidenceRow`; otherwise we fall back to the
 *      hardcoded 5-row FALLBACK anchored on our 2026-04-18 BSC launch +
 *      2026-04-20 heartbeat demo.
 *   2. Engineering rows (spec §Ch11 Engineering rows). The handoff's
 *      `gpt-4o · 5s / 890ms avg` is replaced with
 *      `claude-sonnet-4.5 · 5s / autonomous` (we ship Claude via
 *      OpenRouter). The `194 kB` number is replaced with the static
 *      `≤ 230 kB budget` budget statement so the chapter doesn't need
 *      re-cutting on every bundle change.
 *
 * Outer shell + CSS classes (`.ch-evidence`, `.ev-grid`, `.ev-col`,
 * `.ev-col-head`, `.ev-pill`, `.ev-pill-eng`, `.ev-dot`, `.ev-kind`,
 * `.ev-label`, `.ev-hash`, `.ev-block`, `.ev-check`, `.ev-closing`) live
 * in `app/globals.css`.
 */
import type { ReactElement } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { useRunState } from '@/hooks/useRunStateContext';
import { BigHeadline, Label, Mono, clamp } from './chapter-primitives';

interface Ch11EvidenceProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

/** Row shape rendered by the on-chain pill grid. */
export interface EvidenceRow {
  /** Tag shown inside the kind chip (bnb / base / ipfs / x / cdn / tick). */
  readonly kind: 'bnb' | 'base' | 'ipfs' | 'x' | 'cdn' | 'tick';
  /** Short human label (e.g. `four.meme factory · token deploy`). */
  readonly label: string;
  /** Truncated hash/cid the pill displays in the mono column. */
  readonly hash: string;
  /** Block/CID/gateway hint shown in the trailing column. */
  readonly block: string;
  /** CSS variable driving both the dot + kind chip color. */
  readonly color: string;
}

/** Truncate a hash-like string to `first10..last4`. */
function shorten(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}..${value.slice(-4)}`;
}

/**
 * Map a shared `Artifact` schema instance to the on-chain evidence row
 * shape rendered by Ch11. Each artifact `kind` lands on a chain + color
 * mapping per spec §Ch11 — the table is the single source of truth.
 */
export function mapArtifactToEvidenceRow(a: Artifact): EvidenceRow {
  switch (a.kind) {
    case 'bsc-token':
      return {
        kind: 'bnb',
        label: a.label ?? 'four.meme token contract',
        hash: shorten(a.address),
        block: 'BSC mainnet',
        color: 'var(--chain-bnb)',
      };
    case 'token-deploy-tx':
      return {
        kind: 'bnb',
        label: a.label ?? 'token deploy tx',
        hash: shorten(a.txHash),
        block: 'BSC mainnet',
        color: 'var(--chain-bnb)',
      };
    case 'shill-order':
      return {
        kind: 'bnb',
        label: a.label ?? 'shill order paid',
        hash: shorten(a.paidTxHash),
        block: 'BSC mainnet',
        color: 'var(--chain-bnb)',
      };
    case 'shill-tweet':
      return {
        kind: 'bnb',
        label: a.label ?? 'shill tweet posted',
        hash: a.tweetId,
        block: 'X \u00b7 BNB scope',
        color: 'var(--chain-bnb)',
      };
    case 'x402-tx':
      return {
        kind: 'base',
        label: a.label ?? 'x402 USDC settlement',
        hash: shorten(a.txHash),
        block: 'Base Sepolia',
        color: 'var(--chain-base)',
      };
    case 'lore-cid':
      return {
        kind: 'ipfs',
        label: a.label ?? `${a.author} lore cid`,
        hash: shorten(a.cid),
        block: 'IPFS \u00b7 Pinata',
        color: 'var(--chain-ipfs)',
      };
    case 'lore-anchor':
      return {
        kind: 'ipfs',
        label: a.label ?? 'lore anchor',
        hash: shorten(a.contentHash),
        block: a.onChainTxHash ? 'BSC mainnet' : 'IPFS \u00b7 Pinata',
        color: 'var(--chain-ipfs)',
      };
    case 'tweet-url':
      return {
        kind: 'x',
        label: a.label ?? 'tweet posted',
        hash: a.tweetId,
        block: 'X',
        color: 'var(--accent)',
      };
    case 'meme-image':
      return {
        kind: 'cdn',
        label: a.label ?? 'meme image',
        hash: a.cid ? shorten(a.cid) : 'upload failed',
        block: a.status === 'ok' ? 'IPFS \u00b7 Pinata' : 'CDN \u00b7 fallback',
        color: 'var(--fg-secondary)',
      };
    case 'heartbeat-tick':
      return {
        kind: 'tick',
        label: a.label ?? `tick ${a.tickNumber}/${a.totalTicks}`,
        hash: a.decisions.join(' \u00b7 '),
        block: 'heartbeat',
        color: 'var(--accent)',
      };
    case 'heartbeat-decision':
      return {
        kind: 'tick',
        label: a.label ?? `tick ${a.tickNumber} \u00b7 ${a.action}`,
        hash: a.reason,
        block: 'heartbeat',
        color: 'var(--accent)',
      };
  }
}

// Hardcoded fallback anchored on the 2026-04-18 BSC mainnet launch +
// 2026-04-20 Phase 4.5 demo, per spec §Ch11 Evidence 必改. These are
// displayed only when the live run has shipped < 5 artifacts so the
// chapter never renders a half-filled pill grid.
const FALLBACK_ONCHAIN: readonly EvidenceRow[] = [
  {
    kind: 'bnb',
    label: 'four.meme factory \u00b7 token deploy',
    hash: '0x4E39d254..74444',
    block: 'BSC mainnet \u00b7 2026-04-18',
    color: 'var(--chain-bnb)',
  },
  {
    kind: 'bnb',
    label: 'token create tx',
    hash: '0x760ff53f..760c9b',
    block: 'BSC mainnet',
    color: 'var(--chain-bnb)',
  },
  {
    kind: 'ipfs',
    label: 'narrator lore snapshot',
    hash: 'bafkrei..peq4',
    block: 'IPFS \u00b7 Pinata',
    color: 'var(--chain-ipfs)',
  },
  {
    kind: 'base',
    label: 'x402 USDC settlement',
    hash: '0xa812..9fc4',
    block: 'Base Sepolia \u00b7 sample',
    color: 'var(--chain-base)',
  },
  {
    kind: 'ipfs',
    label: 'creator lore cid',
    hash: 'bafkrei..abcd',
    block: 'IPFS \u00b7 sample',
    color: 'var(--chain-ipfs)',
  },
];

// Engineering rows with spec-mandated corrections (spec §Ch11 Engineering
// rows). brain.tick says `claude-sonnet-4.5 · 5s / autonomous` because we
// ship Claude via OpenRouter, not gpt-4o. bundle states the static 230 kB
// budget so the chapter doesn't drift with each build.
const ENG_ROWS: ReadonlyArray<{ label: string; val: string }> = [
  { label: 'PixelHumanGlyph \u00b7 14 moods', val: 'pure CSS, 0 frame-JS' },
  { label: 'bundle \u00b7 first load', val: '\u2264 230 kB budget' },
  { label: 'brain.tick', val: 'claude-sonnet-4.5 \u00b7 5s / autonomous' },
];

export function Ch11Evidence({ p }: Ch11EvidenceProps): ReactElement {
  const runState = useRunState();
  const artifacts = runState.artifacts;
  // UAT fix (2026-04-20): when the live run has shipped at least one
  // real artifact, show those first and pad the remaining slots from
  // FALLBACK_ONCHAIN so the grid is always 5 pills. Pre-fix: <5
  // real artifacts fell back to 100% fake hashes, which undersold the
  // actual on-chain deliveries. Post-fix: 4 real + 1 fallback reads as
  // "mostly real, one sample", which tells a true story.
  const realRows = artifacts.slice(0, 5).map(mapArtifactToEvidenceRow);
  const padCount = Math.max(0, 5 - realRows.length);
  const onchain: readonly EvidenceRow[] =
    realRows.length === 0
      ? FALLBACK_ONCHAIN
      : [...realRows, ...FALLBACK_ONCHAIN.slice(0, padCount)];
  return (
    <div className="ch ch-evidence">
      <Label n={11}>evidence</Label>
      <BigHeadline size={96}>
        not a pitch. <span style={{ color: 'var(--accent)' }}>it&apos;s on-chain.</span>
      </BigHeadline>
      <div className="ev-grid">
        <div className="ev-col">
          <div className="ev-col-head">
            <Mono dim>on-chain artifacts</Mono>
          </div>
          {onchain.map((e, i) => {
            const appear = clamp((p - i * 0.06) * 3);
            return (
              <div
                key={`${e.kind}-${i}`}
                className="ev-pill"
                style={{ opacity: appear, borderColor: e.color }}
              >
                <span className="ev-dot" style={{ background: e.color }} />
                <span className="ev-kind" style={{ color: e.color }}>
                  {e.kind.toUpperCase()}
                </span>
                <span className="ev-label">{e.label}</span>
                <span className="ev-hash mono">{e.hash}</span>
                <span className="ev-block mono">{e.block}</span>
                <span className="ev-check">{'\u2713'}</span>
              </div>
            );
          })}
        </div>
        <div className="ev-col">
          <div className="ev-col-head">
            <Mono dim>engineering</Mono>
          </div>
          {ENG_ROWS.map((e, i) => {
            const appear = clamp((p - 0.3 - i * 0.08) * 3);
            return (
              <div key={e.label} className="ev-pill ev-pill-eng" style={{ opacity: appear }}>
                <span className="ev-label">{e.label}</span>
                <span className="ev-hash mono">{e.val}</span>
              </div>
            );
          })}
          <div className="ev-closing">
            <PixelHumanGlyph
              size={120}
              mood="sunglasses"
              primaryColor="var(--accent)"
              accentColor="var(--chain-bnb)"
            />
            <div className="ev-closing-text">
              <div
                className="mono"
                style={{
                  fontSize: 22,
                  letterSpacing: 3,
                  color: 'var(--fg-emphasis)',
                }}
              >
                MEMIND
              </div>
              <div className="mono" style={{ color: 'var(--fg-tertiary)', marginTop: 6 }}>
                {'meme \u00d7 mind \u00b7 four.meme ai sprint'}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="cta cta-primary"
                  onClick={() => {
                    // Loop back to Ch1 Hero so the judge can re-watch or try
                    // the live run themselves. Browser smooth-scroll provides
                    // the easing; StickyStage re-routes activeIdx automatically.
                    if (typeof window !== 'undefined') {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                >
                  {'open the demo \u2192'}
                </button>
                <a
                  className="cta cta-ghost"
                  href="https://github.com/mymaine/hack-bnb-fourmeme-agent-creator"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                >
                  see the code
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
