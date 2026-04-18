'use client';

/**
 * ResultPills — inline flex row of clickable explorer pills used by
 * LaunchPanel's `success` state and OrderPanel's `posted` state.
 *
 * This is a focused wrapper around the existing `describeArtifact` /
 * `isPillArtifact` helpers from `@/lib/artifact-view`; it deliberately
 * duplicates TxList's pill visuals so a non-dashboard surface (product
 * panel) can reuse the same look without pulling TxList's "N / 5"
 * header or "No artifacts yet" empty state.
 *
 * Visual spec (docs/design.md §4 "Tx Hash Pill"):
 *   - `inline-flex items-center gap-[6px]`
 *   - `rounded-full border px-[10px] py-[4px] bg-bg-surface`
 *   - font-mono 12px, border colour = artifact chain color var
 *
 * Behaviour:
 *   - Non-pill artifacts (heartbeat-tick / heartbeat-decision /
 *     lore-anchor / shill-order / shill-tweet) are filtered out before
 *     render — the panel can pass `state.artifacts` verbatim and trust
 *     this component to keep the pill row tight.
 *   - Empty list renders nothing at all (no empty-state copy); the
 *     panel decides whether to mount the pill row.
 *
 * A11y:
 *   - Each pill is an `<a>` with `target="_blank"` + `rel="noopener
 *     noreferrer"` for external-link hygiene.
 *   - `aria-label` is set to the artifact kindLabel so SRs announce
 *     "four.meme token" / "deploy tx" / "x402 · 0.01 USDC" etc.
 */
import type { ReactElement } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';
import { describeArtifact, isPillArtifact } from '@/lib/artifact-view';

export interface ResultPillsProps {
  /**
   * Raw artifact stream. Non-pill kinds are filtered by this component;
   * callers may pass `useRun().state.artifacts` without pre-filtering.
   */
  readonly artifacts: readonly Artifact[];
  readonly className?: string;
}

export function ResultPills({ artifacts, className }: ResultPillsProps): ReactElement {
  // Filter before render so the `<ul>` is never emitted for an entirely
  // non-pillable input — empty state is "render nothing".
  const pillables = artifacts.filter(isPillArtifact);
  if (pillables.length === 0) {
    // Empty fragment — the panel decides whether to show a placeholder.
    return <></>;
  }
  return (
    <ul
      data-testid="result-pills"
      className={`inline-flex flex-wrap items-center gap-2 ${className ?? ''}`.trim()}
    >
      {pillables.map((a, i) => {
        const d = describeArtifact(a);
        return (
          <li key={`${a.kind}-${i}`}>
            <a
              href={d.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={d.kindLabel}
              className="inline-flex items-center gap-[6px] rounded-full border bg-bg-surface px-[10px] py-[4px] font-[family-name:var(--font-mono)] text-[12px] transition-[filter] duration-150 hover:[filter:drop-shadow(0_0_4px_currentColor)]"
              style={{
                borderColor: `var(${d.chainColorVar})`,
                color: `var(${d.chainColorVar})`,
              }}
            >
              <span>{d.chainLabel}</span>
              <span className="text-fg-primary">
                {/* Strip the chain-label prefix that describeArtifact
                    bakes into primaryText ("BSC 0x12ab..cd34") so the
                    coloured chip on the left is not duplicated as plain
                    text on the right. */}
                {d.primaryText.replace(/^\S+\s/, '')}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
