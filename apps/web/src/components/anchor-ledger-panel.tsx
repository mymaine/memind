'use client';

/**
 * AnchorLedgerPanel — AC3 Anchor Evidence surface.
 *
 * Consumes the SSE artifact stream and renders every `lore-anchor` the
 * Narrator emits as a row carrying the chapter number, a truncated contentHash
 * and a link to the BscScan tx when layer-2 has landed. Collapsed by default
 * so it does not steal budget from the single-screen main flow; expanding
 * reveals the full list with internal scroll on small viewports.
 *
 * This component intentionally mirrors the HeartbeatSection shape (collapsible
 * header + expanded body, same border / typography tokens) so the dashboard
 * reads as a single visual system.
 */
import { useState } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';
import { collectAnchorArtifacts, dedupeByAnchorId, describeAnchorRow } from './anchor-ledger-utils';

export function AnchorLedgerPanel({ artifacts }: { artifacts: Artifact[] }): React.ReactElement {
  // Collapsed by default — the row count summary in the header is sufficient
  // for at-a-glance viewing during the demo.
  const [expanded, setExpanded] = useState(false);

  const anchors = dedupeByAnchorId(collectAnchorArtifacts(artifacts));
  const onChainCount = anchors.filter((a) => a.onChainTxHash !== undefined).length;

  return (
    <section
      aria-label="Anchor Evidence"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            {'>'}
          </span>
          <span className="font-[family-name:var(--font-sans-display)] text-[13px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
            Anchor Evidence — AC3
          </span>
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
          {anchors.length} anchors · {onChainCount} on-chain ·{' '}
          {expanded ? 'click to collapse' : 'click to expand'}
        </span>
      </button>

      {!expanded ? null : anchors.length === 0 ? (
        <p className="text-[13px] text-fg-secondary">
          No anchors yet — Narrator will emit one per chapter upsert.
        </p>
      ) : (
        <ul className="flex max-h-[200px] flex-col gap-1 overflow-y-auto pr-1">
          {anchors.map((anchor) => {
            const view = describeAnchorRow(anchor);
            return (
              <li
                key={anchor.anchorId}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-1.5 text-[12px]"
              >
                <div className="flex items-center gap-3 font-[family-name:var(--font-mono)]">
                  <span className="text-[color:var(--color-chain-ipfs)]">{view.chapterLabel}</span>
                  <span className="text-fg-primary" title={`contentHash ${anchor.contentHash}`}>
                    {view.hashShort}
                  </span>
                  <span className="text-fg-tertiary">{view.ts}</span>
                </div>
                {view.onChainTxUrl !== null ? (
                  <a
                    href={view.onChainTxUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-[var(--radius-card)] border border-[color:var(--color-chain-bnb)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-chain-bnb)] hover:[filter:drop-shadow(0_0_4px_currentColor)]"
                    title={`BscScan ${anchor.onChainTxHash ?? ''}`}
                  >
                    {view.onChainLabel}
                  </a>
                ) : (
                  <span className="font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
                    {view.onChainLabel}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
