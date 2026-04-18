import type { Artifact } from '@hack-fourmeme/shared';
import { describeArtifact, isPillArtifact } from '@/lib/artifact-view';

/**
 * A read-only list of pill-shaped links for each on-chain artifact emitted by
 * a run. Data comes from the SSE `artifact` stream (see useRun). Visual spec
 * lives in docs/design.md §4 "Tx Hash Pill".
 */
export function TxList({ artifacts = [] }: { artifacts?: Artifact[] }) {
  // Drop heartbeat-tick / heartbeat-decision before rendering — those belong
  // to the HeartbeatPanel and are not part of the "5 chain artifacts" pill row.
  const pillArtifacts = artifacts.filter(isPillArtifact);
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
          {pillArtifacts.length} / 5
        </span>
      </header>
      {pillArtifacts.length === 0 ? (
        <p className="text-[14px] text-fg-secondary">No artifacts yet — run a swarm to populate.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {pillArtifacts.map((a, i) => {
            const d = describeArtifact(a);
            // Full text for the `title` tooltip: prefer the underlying hash /
            // cid / id so hovers reveal what the pill abbreviates. Exhaustive
            // switch over the pill-eligible kinds keeps TS narrowing tight.
            let fullId: string;
            switch (a.kind) {
              case 'bsc-token':
                fullId = a.address;
                break;
              case 'token-deploy-tx':
                fullId = a.txHash;
                break;
              case 'lore-cid':
                fullId = a.cid;
                break;
              case 'x402-tx':
                fullId = a.txHash;
                break;
              case 'tweet-url':
                fullId = a.tweetId;
                break;
              case 'meme-image':
                // `cid` is null on upload-failed; fall back to a
                // `prompt:<truncated>` so the title tooltip still shows
                // something meaningful and the React key stays unique across
                // multiple failed-upload artifacts.
                fullId = a.cid ?? `prompt:${a.prompt.slice(0, 32)}`;
                break;
            }
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
