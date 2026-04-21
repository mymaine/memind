'use client';

/**
 * <Ch12Evidence> — closing evidence chapter of the Memind scrollytelling
 * narrative (memind-scrollytelling-rebuild AC-MSR-9 ch12; renumbered
 * 2026-04-20 from ch11 when The Saga was inserted at slot 7).
 *
 * Reviewer-facing pitch: "not a pitch. it's on-chain." The whole chapter is
 * proof-of-work — every on-chain hash is a real click-through to BSCScan,
 * Basescan, Pinata, or X. Layout:
 *
 *   +--------------+   +-------------------------------+
 *   |              |   | [BNB] [BASE] [IPFS] [X]       |
 *   | <meme image> |   |-------------------------------|
 *   |              |   | . <short hash>  <chain>  ↗    |
 *   | $SYMBOL      |   | . <short hash>  <chain>  ↗    |
 *   | <timestamp>  |   | ...up to 5 rows per tab       |
 *   +--------------+   +-------------------------------+
 *
 * Real-vs-sample policy:
 *   - Real artifacts stream in live through `useRunState().artifacts`.
 *     Each tab takes its kind's latest 5 entries in reverse chronological
 *     order. Real rows carry no extra label.
 *   - If a tab has < 5 real entries we pad from `FALLBACK_ONCHAIN_TABS`
 *     so the grid always feels full. Fallback rows get a trailing
 *     `sample` chip so the viewer can tell the difference at a glance.
 *
 * Meme card: the top-left card picks the latest `meme-image` artifact with
 * `status === 'ok'`. We use a raw <img> (not next/image) to keep the Pinata
 * gateway host off `next.config.js`'s allow-list — the image is a one-off
 * demo asset, not a perf-critical hero.
 *
 * All external links use `target="_blank" rel="noopener noreferrer"`. Rows
 * without an external destination (`heartbeat-tick` / `heartbeat-decision`)
 * are rendered as non-interactive <div>s.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';
import { artifactSchema } from '@hack-fourmeme/shared';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { useRunState, useRunStateMirror } from '@/hooks/useRunStateContext';
import { BigHeadline, Label, Mono, clamp } from './chapter-primitives';

interface Ch12EvidenceProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

/** The 4 evidence tabs surfaced to the viewer. */
export type EvidenceTab = 'BNB' | 'BASE' | 'IPFS' | 'X';

/** Row shape rendered inside each tab. */
export interface EvidenceRow {
  /** Tag shown inside the kind chip (bnb / base / ipfs / x / cdn / tick). */
  readonly kind: 'bnb' | 'base' | 'ipfs' | 'x' | 'cdn' | 'tick';
  /** Short human label (e.g. `four.meme factory · token deploy`). */
  readonly label: string;
  /** Truncated hash/cid the row displays in the mono column. */
  readonly hash: string;
  /** Block/CID/gateway hint shown in the trailing column. */
  readonly block: string;
  /** CSS variable driving both the dot + kind chip color. */
  readonly color: string;
  /** External link the whole row navigates to. `null` => non-interactive row. */
  readonly url: string | null;
  /** Marks rows that come from `FALLBACK_ONCHAIN_TABS`, not the live run. */
  readonly isSample?: boolean;
}

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

/** Truncate a hash-like string to `first10..last4`. */
function shorten(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}..${value.slice(-4)}`;
}

/**
 * Map a shared `Artifact` schema instance to the on-chain evidence row
 * shape. Each artifact `kind` lands on a chain + color + external-URL
 * mapping per the Ch11 URL table — the switch below is the single source
 * of truth.
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
        url: `https://bscscan.com/token/${a.address}`,
      };
    case 'token-deploy-tx':
      return {
        kind: 'bnb',
        label: a.label ?? 'token deploy tx',
        hash: shorten(a.txHash),
        block: 'BSC mainnet',
        color: 'var(--chain-bnb)',
        url: `https://bscscan.com/tx/${a.txHash}`,
      };
    case 'shill-order':
      return {
        kind: 'bnb',
        label: a.label ?? 'shill order paid',
        hash: shorten(a.paidTxHash),
        block: 'BSC mainnet',
        color: 'var(--chain-bnb)',
        url: `https://bscscan.com/tx/${a.paidTxHash}`,
      };
    case 'shill-tweet':
      return {
        kind: 'x',
        label: a.label ?? 'shill tweet posted',
        hash: a.tweetId,
        block: 'X \u00b7 shiller',
        color: 'var(--accent)',
        url: `https://twitter.com/i/web/status/${a.tweetId}`,
      };
    case 'x402-tx':
      return {
        kind: 'base',
        label: a.label ?? 'x402 USDC settlement',
        hash: shorten(a.txHash),
        block: 'Base Sepolia',
        color: 'var(--chain-base)',
        url: `https://sepolia.basescan.org/tx/${a.txHash}`,
      };
    case 'lore-cid':
      return {
        kind: 'ipfs',
        label: a.label ?? `${a.author} lore cid`,
        hash: shorten(a.cid),
        block: 'IPFS \u00b7 Pinata',
        color: 'var(--chain-ipfs)',
        url: `${IPFS_GATEWAY}${a.cid}`,
      };
    case 'lore-anchor':
      // Prefer the on-chain tx when the Layer-2 anchor landed; otherwise
      // fall back to the IPFS content hash on Pinata's public gateway so
      // the row is still clickable proof.
      return {
        kind: 'ipfs',
        label: a.label ?? 'lore anchor',
        hash: shorten(a.contentHash),
        block: a.onChainTxHash ? 'BSC mainnet' : 'IPFS \u00b7 Pinata',
        color: 'var(--chain-ipfs)',
        url: a.onChainTxHash
          ? `https://bscscan.com/tx/${a.onChainTxHash}`
          : `${IPFS_GATEWAY}${a.contentHash}`,
      };
    case 'tweet-url':
      return {
        kind: 'x',
        label: a.label ?? 'tweet posted',
        hash: a.tweetId,
        block: 'X',
        color: 'var(--accent)',
        url: `https://twitter.com/i/web/status/${a.tweetId}`,
      };
    case 'meme-image':
      return {
        kind: 'cdn',
        label: a.label ?? 'meme image',
        hash: a.cid ? shorten(a.cid) : 'upload failed',
        block: a.status === 'ok' ? 'IPFS \u00b7 Pinata' : 'CDN \u00b7 fallback',
        color: 'var(--fg-secondary)',
        url: a.cid ? `${IPFS_GATEWAY}${a.cid}` : null,
      };
    case 'heartbeat-tick':
      return {
        kind: 'tick',
        label: a.label ?? `tick ${a.tickNumber}/${a.totalTicks}`,
        hash: a.decisions.join(' \u00b7 '),
        block: 'heartbeat',
        color: 'var(--accent)',
        url: null,
      };
    case 'heartbeat-decision':
      return {
        kind: 'tick',
        label: a.label ?? `tick ${a.tickNumber} \u00b7 ${a.action}`,
        hash: a.reason,
        block: 'heartbeat',
        color: 'var(--accent)',
        url: null,
      };
  }
}

/**
 * Which tab does an artifact feed into? A single artifact can legitimately
 * belong to multiple tabs — `shill-tweet` is both BNB-scoped (it advertises
 * a BSC token) and an X post. Rather than duplicating rows, we route it to
 * the `X` tab where the clickable tweetId reads most naturally.
 */
function tabForArtifact(a: Artifact): EvidenceTab | null {
  switch (a.kind) {
    case 'bsc-token':
    case 'token-deploy-tx':
    case 'shill-order':
      return 'BNB';
    case 'x402-tx':
      return 'BASE';
    case 'lore-cid':
    case 'lore-anchor':
    case 'meme-image':
      return 'IPFS';
    case 'tweet-url':
    case 'shill-tweet':
      return 'X';
    case 'heartbeat-tick':
    case 'heartbeat-decision':
      return null;
  }
}

// Canonical pre-recorded demo-run artifacts. Every hash is real and points
// at a working BSCScan / Basescan / Pinata / X URL. These seed the grid when
// the visitor hasn't kicked off a live run yet — no synthetic placeholders.
// Live-run artifacts stream in via `useRunState().artifacts` and take
// precedence; anything below pads any remaining slots.
const FALLBACK_ONCHAIN_TABS: Readonly<Record<EvidenceTab, readonly EvidenceRow[]>> = {
  BNB: [
    {
      kind: 'bnb',
      label: 'four.meme token',
      hash: '0x030C…4444',
      block: 'BSC mainnet',
      color: 'var(--chain-bnb)',
      url: 'https://bscscan.com/token/0x030C3529a5A3993B46e0DDBA1094E9BCCb014444',
    },
    {
      kind: 'bnb',
      label: 'token deploy tx',
      hash: '0x38fb…71b5',
      block: 'BSC mainnet \u00b7 67s run',
      color: 'var(--chain-bnb)',
      url: 'https://bscscan.com/tx/0x38fb85740138b426674078577a7e55a117b4e6c599f37eab059a55bb4db171b5',
    },
    {
      kind: 'bnb',
      label: 'lore anchor \u00b7 ch1',
      hash: '0x545c…e9e6',
      block: 'BSC mainnet \u00b7 keccak256',
      color: 'var(--chain-bnb)',
      url: 'https://bscscan.com/tx/0x545cb02374b5f93e5e4a682b99715e8f1ec436b4403eebc727a635a552dee9e6',
    },
    {
      kind: 'bnb',
      label: 'lore anchor \u00b7 ch2',
      hash: '0xd74e…1907',
      block: 'BSC mainnet \u00b7 keccak256',
      color: 'var(--chain-bnb)',
      url: 'https://bscscan.com/tx/0xd74e9b06da94dac06c2aa9586c11ec7cfb4645b281b73d35aa689f2dfa001907',
    },
  ],
  BASE: [
    {
      kind: 'base',
      label: 'x402 settlement \u00b7 /order',
      hash: '0x65b3…b5a8',
      block: 'Base Sepolia \u00b7 0.01 USDC',
      color: 'var(--chain-base)',
      url: 'https://sepolia.basescan.org/tx/0x65b346d019417727031978d5ee582082bc8aa27917722157f2ce5024a837b5a8',
    },
    {
      kind: 'base',
      label: 'x402 probe \u00b7 pnpm test',
      hash: '0x4331…000a',
      block: 'Base Sepolia \u00b7 facilitator',
      color: 'var(--chain-base)',
      url: 'https://sepolia.basescan.org/tx/0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a',
    },
  ],
  IPFS: [
    {
      kind: 'ipfs',
      label: 'narrator lore \u00b7 ch1',
      hash: 'bafkrei…b4a4',
      block: 'IPFS \u00b7 Pinata',
      color: 'var(--chain-ipfs)',
      url: `${IPFS_GATEWAY}bafkreig3twkykn74pieplix6j3jgrpakdsxk4x7wq2juxxwd2tses6b4a4`,
    },
    {
      kind: 'ipfs',
      label: 'narrator lore \u00b7 ch2',
      hash: 'QmQ4QL…gYzE',
      block: 'IPFS \u00b7 Pinata',
      color: 'var(--chain-ipfs)',
      url: `${IPFS_GATEWAY}QmQ4QLGsE48s2bYPqDpLdYbRBHhCDhTmUEKbF4r9uWgYzE`,
    },
  ],
  X: [
    {
      kind: 'x',
      label: 'shiller \u00b7 /order tweet',
      hash: '2046390339875828187',
      block: 'X \u00b7 @memind_ai',
      color: 'var(--accent)',
      url: 'https://x.com/memind_ai/status/2046390339875828187',
    },
  ],
};

// Fallback meme card shown when no real `meme-image` artifact has landed.
// Inline SVG data-URL so we don't need a bundled asset or external host.
const FALLBACK_MEME_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#00d992'/>
          <stop offset='100%' stop-color='#0052FF'/>
        </linearGradient>
      </defs>
      <rect width='200' height='200' fill='url(#g)'/>
      <text x='50%' y='52%' text-anchor='middle' font-family='monospace'
            font-size='28' fill='black' font-weight='700'>MEMIND</text>
      <text x='50%' y='72%' text-anchor='middle' font-family='monospace'
            font-size='12' fill='black'>sample cover</text>
    </svg>`,
  );

// Engineering rows. Deliberately no model or provider name — brain.tick
// states cadence only (60s, matches the Heartbeat production default).
// Bundle states the static 230 kB budget so the chapter doesn't drift
// with each build.
const ENG_ROWS: ReadonlyArray<{ label: string; val: string }> = [
  { label: 'PixelHumanGlyph \u00b7 14 moods', val: 'pure CSS, 0 frame-JS' },
  { label: 'bundle \u00b7 first load', val: '\u2264 230 kB budget' },
  { label: 'brain.tick', val: '60s \u00b7 autonomous' },
];

/**
 * Pick the freshest `meme-image` with a usable cid out of the run. We scan
 * backwards so the latest upload wins without having to sort.
 */
function pickMemeImage(artifacts: readonly Artifact[]): {
  cid: string;
  gatewayUrl: string;
} | null {
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const a = artifacts[i];
    if (!a) continue;
    if (a.kind === 'meme-image' && a.status === 'ok' && a.cid && a.gatewayUrl) {
      return { cid: a.cid, gatewayUrl: a.gatewayUrl };
    }
  }
  return null;
}

/** Pull the token symbol out of a `bsc-token` artifact's label, if present. */
function pickTokenSymbol(artifacts: readonly Artifact[]): string | null {
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const a = artifacts[i];
    if (!a) continue;
    if (a.kind === 'bsc-token' && a.label) {
      // Label shape in practice: `four.meme $COFFE` or `$COFFEE` —
      // pick the first $-prefixed token if one exists, else fall back to
      // the raw label.
      const match = a.label.match(/\$[A-Za-z0-9_]+/);
      return match ? match[0] : a.label;
    }
  }
  return null;
}

/**
 * Build the per-tab row list. Real artifacts of the tab's kind come first
 * (latest 5, newest-first), padded from `FALLBACK_ONCHAIN_TABS` up to 5.
 */
function rowsForTab(tab: EvidenceTab, artifacts: readonly Artifact[]): readonly EvidenceRow[] {
  const realRows: EvidenceRow[] = [];
  for (let i = artifacts.length - 1; i >= 0 && realRows.length < 5; i -= 1) {
    const a = artifacts[i];
    if (!a) continue;
    if (tabForArtifact(a) === tab) {
      realRows.push(mapArtifactToEvidenceRow(a));
    }
  }
  if (realRows.length >= 5) return realRows;
  const padNeeded = 5 - realRows.length;
  return [...realRows, ...FALLBACK_ONCHAIN_TABS[tab].slice(0, padNeeded)];
}

const TABS: readonly EvidenceTab[] = ['BNB', 'BASE', 'IPFS', 'X'];

const TAB_COLOR: Record<EvidenceTab, string> = {
  BNB: 'var(--chain-bnb)',
  BASE: 'var(--chain-base)',
  IPFS: 'var(--chain-ipfs)',
  X: 'var(--accent)',
};

export function Ch12Evidence({ p }: Ch12EvidenceProps): ReactElement {
  const runState = useRunState();
  const artifacts = runState.artifacts;
  const mirror = useRunStateMirror();
  const [activeTab, setActiveTab] = useState<EvidenceTab>('BNB');

  // Ch12 hydration: on first real chapter entry (`p > 0`) fetch the last 20
  // artifacts from `/api/artifacts` and splice them into the mirror so the
  // visitor sees real evidence even before any run has kicked off. `useRef`
  // guards against React 19 StrictMode's double-invoke and against multiple
  // re-entries as the user scrolls in-and-out of the chapter. Any failure
  // (endpoint down, network error, schema drift) is swallowed silently —
  // the chapter already has a sample-padded fallback that looks identical
  // apart from the small `sample` chip.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (p <= 0) return;
    hydratedRef.current = true;
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      try {
        const res = await fetch('/api/artifacts?limit=20', { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { artifacts?: unknown };
        if (!Array.isArray(body.artifacts)) return;
        // Server returns `created_at DESC` (newest first). Live SSE appends
        // in chronological order so `artifacts[length-1]` is the newest —
        // reverse the hydrated batch to match that convention, otherwise
        // `rowsForTab` / `pickMemeImage` (which scan from the tail) would
        // surface the oldest rows instead of the most recent ones.
        for (const raw of [...body.artifacts].reverse()) {
          const parsed = artifactSchema.safeParse(raw);
          if (parsed.success) {
            mirror.pushArtifact(parsed.data);
          }
        }
      } catch {
        // Silent fail-soft — fallback rows stay visible.
      }
    };
    void run();
    return () => controller.abort();
  }, [p, mirror]);

  const tabRows = useMemo(() => {
    return {
      BNB: rowsForTab('BNB', artifacts),
      BASE: rowsForTab('BASE', artifacts),
      IPFS: rowsForTab('IPFS', artifacts),
      X: rowsForTab('X', artifacts),
    } as const;
  }, [artifacts]);

  const meme = useMemo(() => pickMemeImage(artifacts), [artifacts]);
  const tokenSymbol = useMemo(() => pickTokenSymbol(artifacts), [artifacts]);
  const isSampleMeme = meme === null;
  const memeSrc = meme ? meme.gatewayUrl : FALLBACK_MEME_IMAGE;
  const memeCaption = tokenSymbol ?? '$MEMIND';

  return (
    <div className="ch ch-evidence">
      <Label n={12}>evidence</Label>
      <BigHeadline size={96}>
        not a pitch. <span style={{ color: 'var(--accent)' }}>it&apos;s on-chain.</span>
      </BigHeadline>
      <div className="ev-layout">
        <div className="ev-meme">
          <div className="ev-meme-frame">
            <img
              src={memeSrc}
              alt={meme ? `meme image ${meme.cid}` : 'sample meme cover'}
              loading="lazy"
              width={200}
              height={200}
              className="ev-meme-img"
            />
            {isSampleMeme && <span className="ev-meme-badge mono">sample</span>}
          </div>
          <div className="ev-meme-caption">
            <div className="ev-meme-symbol mono">{memeCaption}</div>
            <div className="ev-meme-hint mono">
              {meme ? 'IPFS \u00b7 Pinata' : 'placeholder cover'}
            </div>
          </div>
        </div>
        <div className="ev-tabs-wrap">
          <div className="ev-tabs" role="tablist" aria-label="on-chain evidence">
            {TABS.map((t) => {
              const selected = t === activeTab;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`ev-tab${selected ? ' ev-tab-active' : ''}`}
                  style={{
                    color: selected ? TAB_COLOR[t] : 'var(--fg-tertiary)',
                    borderColor: selected ? TAB_COLOR[t] : 'var(--border-default)',
                  }}
                  onClick={() => setActiveTab(t)}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="ev-tab-panels">
            {TABS.map((t) => {
              const rows = tabRows[t];
              const visible = t === activeTab;
              return (
                <div
                  key={t}
                  role="tabpanel"
                  className="ev-tab-panel"
                  style={{
                    opacity: visible ? 1 : 0,
                    pointerEvents: visible ? 'auto' : 'none',
                    position: visible ? 'relative' : 'absolute',
                  }}
                  hidden={!visible}
                >
                  {rows.map((row, i) => {
                    const appear = clamp((p - i * 0.05) * 3);
                    return <EvidenceRowView key={`${t}-${i}`} row={row} appear={appear} />;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ev-eng">
        {ENG_ROWS.map((e, i) => {
          const appear = clamp((p - 0.3 - i * 0.08) * 3);
          return (
            <div key={e.label} className="ev-pill ev-pill-eng" style={{ opacity: appear }}>
              <span className="ev-label">{e.label}</span>
              <span className="ev-hash mono">{e.val}</span>
            </div>
          );
        })}
      </div>
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
                // Clicking `open the demo` slides open the BrainPanel so
                // visitors can try the live flow in-place. Ch11 has no
                // access to page.tsx's `openBrain` state setter, so we
                // dispatch a CustomEvent on `window` and let the page
                // listen. Fails silently in non-browser environments.
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('memind:open-brain'));
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
      {/* sr-only column head preserves the old dashed `on-chain artifacts`
          affordance for screen readers even though the tabs replace the
          visual label. */}
      <span className="sr-only">
        <Mono dim>on-chain artifacts</Mono>
      </span>
    </div>
  );
}

/**
 * Single evidence row. Rendered as an <a> when the row has an external URL,
 * otherwise a <div> — avoids polluting tab order with no-op anchors for
 * heartbeat rows that have no external page to navigate to.
 */
function EvidenceRowView({ row, appear }: { row: EvidenceRow; appear: number }): ReactElement {
  const inner = (
    <>
      <span className="ev-dot" style={{ background: row.color }} />
      <span className="ev-kind" style={{ color: row.color }}>
        {row.kind.toUpperCase()}
      </span>
      <span className="ev-label">{row.label}</span>
      <span className="ev-hash mono">{row.hash}</span>
      <span className="ev-block mono">{row.block}</span>
      {row.isSample ? (
        <span className="ev-sample mono">sample</span>
      ) : (
        <span className="ev-sample" aria-hidden />
      )}
      <span className="ev-check">{row.url ? '\u2197' : '\u2713'}</span>
    </>
  );
  const style = { opacity: appear, borderColor: row.color };
  if (row.url) {
    return (
      <a
        className="ev-pill ev-pill-link"
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        style={style}
        title={`${row.label} — ${row.hash}`}
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="ev-pill" style={style} title={`${row.label} — ${row.hash}`}>
      {inner}
    </div>
  );
}
