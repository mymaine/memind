/**
 * Pure selectors + formatters backing AnchorLedgerPanel (AC3).
 *
 * Kept outside the component so they can be unit-tested without React and
 * reused by the timeline-merge / tx-list if anchor evidence ever needs to
 * appear in those surfaces.
 */
import type { Artifact } from '@hack-fourmeme/shared';

export type LoreAnchorArtifact = Extract<Artifact, { kind: 'lore-anchor' }>;

/** Filter a mixed artifact stream down to just the lore-anchor entries. */
export function collectAnchorArtifacts(artifacts: Artifact[]): LoreAnchorArtifact[] {
  return artifacts.filter((a): a is LoreAnchorArtifact => a.kind === 'lore-anchor');
}

/**
 * Collapse duplicate anchors by `anchorId`, keeping the latest occurrence —
 * which is how layer-2 upgrades overwrite their layer-1 predecessor. Order
 * of the returned array reflects the position of each id's LAST entry in
 * the input (so a late upgrade pushes the row to the bottom of the list).
 */
export function dedupeByAnchorId(anchors: LoreAnchorArtifact[]): LoreAnchorArtifact[] {
  // First pass: capture last-occurrence position per anchorId.
  const lastIndex = new Map<string, number>();
  for (let i = 0; i < anchors.length; i += 1) {
    const entry = anchors[i];
    if (!entry) continue;
    lastIndex.set(entry.anchorId, i);
  }
  // Second pass: walk the array in order, emit only the slot each anchorId
  // resolved to. Equivalent to a stable "last wins" dedup while preserving
  // relative order of survivors.
  const out: LoreAnchorArtifact[] = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const entry = anchors[i];
    if (!entry) continue;
    if (lastIndex.get(entry.anchorId) === i) {
      out.push(entry);
    }
  }
  return out;
}

export interface AnchorRowView {
  chapterLabel: string;
  hashShort: string;
  ts: string;
  onChainTxUrl: string | null;
  onChainLabel: string;
}

/**
 * Format one anchor for display. Truncates the 32-byte contentHash to a
 * head/tail form so the panel stays compact, and derives the on-chain
 * metadata (explorer URL + chain label) when layer-2 has landed.
 */
export function describeAnchorRow(anchor: LoreAnchorArtifact): AnchorRowView {
  const hashShort = `${anchor.contentHash.slice(0, 10)}…${anchor.contentHash.slice(-4)}`;
  // Strip millisecond precision for display so the row fits on a single
  // compact line (YYYY-MM-DD HH:MM:SS). Fall back to the raw string if the
  // input is not a parseable ISO timestamp.
  let ts = anchor.ts;
  const parsed = Date.parse(anchor.ts);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    ts = `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
  }
  const hasOnChain =
    anchor.onChainTxHash !== undefined &&
    anchor.chain !== undefined &&
    anchor.explorerUrl !== undefined;
  return {
    chapterLabel: `ch ${anchor.chapterNumber.toString()}`,
    hashShort,
    ts,
    onChainTxUrl: hasOnChain ? (anchor.explorerUrl ?? null) : null,
    onChainLabel: hasOnChain ? `${anchor.chain ?? 'on-chain'}` : 'layer-1 only',
  };
}
