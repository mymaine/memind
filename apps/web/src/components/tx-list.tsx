import type { Artifact } from '@hack-fourmeme/shared';
import { describeArtifact } from '@/lib/artifact-view';

/**
 * A read-only list of pill-shaped links for each on-chain artifact emitted by
 * a run. Data comes from the SSE `artifact` stream (see useRun). Visual spec
 * lives in docs/design.md §4 "Tx Hash Pill".
 */
export function TxList({ artifacts = [] }: { artifacts?: Artifact[] }) {
  return (
    <section
      aria-label="On-chain artifacts"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-6"
    >
      <header className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">
          On-chain artifacts
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          {artifacts.length} / 5
        </span>
      </header>
      {artifacts.length === 0 ? (
        <p className="text-[14px] text-fg-secondary">No artifacts yet — run a swarm to populate.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {artifacts.map((a, i) => {
            const d = describeArtifact(a);
            // Full text for the `title` tooltip: prefer the underlying hash /
            // cid / id so hovers reveal what the pill abbreviates.
            const fullId =
              a.kind === 'bsc-token'
                ? a.address
                : a.kind === 'token-deploy-tx'
                  ? a.txHash
                  : a.kind === 'lore-cid'
                    ? a.cid
                    : a.kind === 'x402-tx'
                      ? a.txHash
                      : a.tweetId;
            return (
              <li key={`${a.kind}-${fullId}-${i}`}>
                <a
                  href={d.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`${d.kindLabel} — ${fullId}`}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-bg-surface px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] transition-[filter] duration-150 hover:[filter:drop-shadow(0_0_4px_currentColor)]"
                  style={{
                    borderColor: `var(${d.chainColorVar})`,
                    color: `var(${d.chainColorVar})`,
                  }}
                >
                  <span>{d.chainLabel}</span>
                  <span className="text-fg-primary">
                    {/* Primary text already begins with the chain label
                        (e.g. "BSC 0x12ab..cd34"); strip the prefix we render
                        as the colored chain pill on the left. */}
                    {d.primaryText.replace(/^\S+\s/, '')}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
