'use client';

/**
 * EvidenceScene — "trust anchor" scene (AC-P4.7-7).
 *
 * Two stacked sub-blocks inside an auto-height `<section id="evidence">`:
 *
 *   1. 5 on-chain artifact pills (fixed demo-proof, NOT derived from the
 *      current run): BSC token · BSC deploy tx · IPFS creator lore CID ·
 *      Base Sepolia x402 settlement tx · Base Sepolia phase-1 probe tx.
 *      Each pill is an external <a> opening the real explorer in a new tab
 *      with `rel="noopener noreferrer"` (safe target=_blank, see design.md
 *      §9 a11y). Data source: narrative-copy.ts `EVIDENCE_ARTIFACTS`.
 *
 *   2. 3 engineering stats badges (static, no links): e.g. "716 tests green",
 *      "strict TypeScript", "AGPL-3.0 open source" — pulled verbatim from
 *      narrative-copy.ts `STATS_BADGES` so the snapshot test catches drift.
 *
 * The outer <section> carries id="evidence" — this is the target of the
 * Header's Evidence nav entry (spec roadmap V4.7-P4 Task 10). Breaking the
 * id breaks the anchor jump on both `/` and `/market`.
 *
 * Why fixed artifacts, not derived:
 *   Spec explicitly pins this (clean-up plan row: "Evidence scene 如有『當前
 *   run 動態 pill』實作 → 固定 5 個 demo-proof pill"). Live-run pills belong
 *   inside the ProductScene result / DevLogsDrawer Tx tab; Evidence is a
 *   README-backed "trust me, it really ran" surface that must paint even
 *   before any run happens.
 *
 * Scroll reveal (AC-P4.7-8):
 *   Outer section carries `.scene`; useScrollReveal adds `.scene--revealed`
 *   on first entry. The `freeze` prop (tests) forces the revealed class so
 *   markup paints deterministically without depending on IntersectionObserver.
 *
 * Chain label / color mapping mirrors apps/web/src/lib/artifact-view.ts:
 *   - bsc-mainnet  → "BSC"  → --color-chain-bnb
 *   - ipfs         → "IPFS" → --color-chain-ipfs
 *   - base-sepolia → "BASE" → --color-chain-base
 */
import { useRef } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { EVIDENCE_ARTIFACTS, STATS_BADGES, type EvidenceArtifact } from '@/lib/narrative-copy';

export interface EvidenceSceneProps {
  /** Deterministic reveal for tests — applies `.scene--revealed` regardless
   *  of IntersectionObserver firing. Mirrors the Vision/Solution pattern. */
  readonly freeze?: boolean;
  /** Optional className merged into the outer section — lets page.tsx layer
   *  vertical rhythm utilities without forking the component. */
  readonly className?: string;
}

/**
 * Truncate a hash-like string to `head..tail` while preserving readability.
 * Identical algorithm to `apps/web/src/lib/artifact-view.ts` — duplicated
 * here (not imported) because EVIDENCE_ARTIFACTS uses a different shape
 * (pinned constants) than the live Artifact union and we want this scene to
 * stay decoupled from the run-time artifact renderer.
 */
function shortHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}..${value.slice(-tail)}`;
}

/** Chain display metadata for the 3 chains that appear in EVIDENCE_ARTIFACTS. */
interface ChainMeta {
  readonly label: string;
  readonly colorVar: string;
}

const CHAIN_META: Record<EvidenceArtifact['chain'], ChainMeta> = {
  'bsc-mainnet': { label: 'BSC', colorVar: '--color-chain-bnb' },
  ipfs: { label: 'IPFS', colorVar: '--color-chain-ipfs' },
  'base-sepolia': { label: 'BASE', colorVar: '--color-chain-base' },
};

/**
 * Human-readable artifact kind shown in the aria-label / hover title so the
 * tooltip reads as "BSC four.meme token: 0x4E39..4444" rather than just the
 * raw hash. The two Base Sepolia txs both render as "x402 settlement" — the
 * spec notes one is the phase-1 probe but narrative-copy carries no per-
 * artifact label, so we keep the display copy uniform and let the README
 * Evidence table disambiguate if a reader cares.
 */
function kindLabel(artifact: EvidenceArtifact): string {
  switch (artifact.kind) {
    case 'token':
      return 'four.meme token';
    case 'cid':
      return 'IPFS content';
    case 'tx':
      return artifact.chain === 'bsc-mainnet' ? 'deploy tx' : 'x402 settlement';
  }
}

/**
 * Single artifact pill — external link that opens the explorer in a new tab.
 * Styled after the design.md §4 Tx Hash Pill spec: chain-colored border +
 * chain-colored label chip on the left, short hash in the primary fg color
 * on the right, arrow glyph on the far right to echo "goes off-site".
 */
function ArtifactPill({ artifact }: { readonly artifact: EvidenceArtifact }): React.ReactElement {
  const meta = CHAIN_META[artifact.chain];
  const short = shortHash(artifact.value);
  const label = kindLabel(artifact);

  return (
    <a
      href={artifact.explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${meta.label} ${label}: ${artifact.value}`}
      aria-label={`${meta.label} ${label}: ${short} (opens explorer in new tab)`}
      className="group inline-flex items-center gap-3 rounded-[var(--radius-card)] border bg-bg-surface px-4 py-3 transition-[filter,transform] duration-150 hover:-translate-y-[1px] hover:[filter:drop-shadow(0_0_6px_currentColor)]"
      style={{ borderColor: `var(${meta.colorVar})`, color: `var(${meta.colorVar})` }}
    >
      <span className="font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.6px]">
        {meta.label}
      </span>
      <span className="font-[family-name:var(--font-mono)] text-[13px] text-fg-primary">
        {short}
      </span>
      <span
        aria-hidden="true"
        className="text-[13px] opacity-70 transition-opacity group-hover:opacity-100"
      >
        ↗
      </span>
    </a>
  );
}

/**
 * Engineering stats badge — static, non-link, reads as "here's what backs
 * the claim". The leading glyph is a unicode check for "green" (first badge)
 * and a filled dot for the rest so the eye groups them without needing an
 * icon font.
 */
function StatsBadge({
  text,
  index,
}: {
  readonly text: string;
  readonly index: number;
}): React.ReactElement {
  // Pick the leading glyph: a check for the "tests green" badge so it reads
  // as a pass mark, otherwise a filled dot so badges line up visually.
  const glyph = index === 0 ? '✓' : '●';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-default bg-bg-surface px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] text-fg-secondary">
      <span aria-hidden="true" className="text-accent-text">
        {glyph}
      </span>
      <span>{text}</span>
    </span>
  );
}

export function EvidenceScene({
  freeze = false,
  className,
}: EvidenceSceneProps): React.ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRevealed = useScrollReveal(sectionRef);
  const revealed = scrollRevealed || freeze;

  const sceneClass = [
    'scene relative flex min-h-[60vh] flex-col items-center overflow-hidden px-6 py-16',
    revealed ? 'scene--revealed' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={sectionRef} id="evidence" aria-label="Evidence" className={sceneClass}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        {/* Overline heading — same rhythm as Vision so the two "proof" scenes
         *  read as a pair. */}
        <div className="flex flex-col items-center gap-3">
          <h2
            className="font-[family-name:var(--font-sans-display)] text-[18px] font-semibold uppercase tracking-[0.45px] text-fg-tertiary"
            data-testid="evidence-overline"
          >
            On-chain evidence
          </h2>
          <span aria-hidden="true" className="block h-[2px] w-20 rounded-full bg-accent" />
        </div>

        {/* ─── Sub-block 1 · 5 on-chain artifact pills ─────────────────── */}
        <div className="flex flex-col items-center gap-4">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Live on-chain proof (recorded 2026-04-19 demo run)
          </span>
          <ul className="flex flex-wrap justify-center gap-3" data-testid="evidence-pill-row">
            {EVIDENCE_ARTIFACTS.map((artifact) => (
              <li key={`${artifact.chain}-${artifact.value}`}>
                <ArtifactPill artifact={artifact} />
              </li>
            ))}
          </ul>
        </div>

        {/* ─── Sub-block 2 · 3 engineering stats badges ────────────────── */}
        <div className="flex flex-col items-center gap-3">
          <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
            Engineering evidence
          </span>
          <div
            className="inline-flex flex-wrap justify-center gap-2"
            data-testid="evidence-stats-row"
          >
            {STATS_BADGES.map((text, i) => (
              <StatsBadge key={text} text={text} index={i} />
            ))}
          </div>
        </div>

        {/* ─── Footer caption ──────────────────────────────────────────── */}
        <p className="text-center font-[family-name:var(--font-sans-body)] text-[12px] leading-[1.5] text-fg-tertiary">
          All artifacts captured 2026-04-19 from a real demo run. Click any pill to verify on-chain.
        </p>
      </div>
    </section>
  );
}
