'use client';

/**
 * TimelineView — chronological column rendering of every event a run produces
 * (V2-P4 Task 4-6).
 *
 * Inputs come from useRun. We merge logs + tool calls + artifacts into a
 * single time-ordered list via `mergeTimeline` (200-item cap; older items
 * collapsed behind a banner).
 *
 * Per-item renderers reuse the existing visual primitives wherever possible
 * to keep the demo visuals consistent between the 3-column and Timeline tabs:
 *   - log               → coloured agent bubble
 *   - tool_use          → ToolCallBubble (V2-P2)
 *   - artifact:meme     → MemeImageCard (V2-P1)
 *   - artifact:tweet    → TweetFeed item (single-row inlined)
 *   - artifact:x402-tx  → transfer card (from / to / amount + explorer link)
 *   - artifact:other    → simplified row (kind + summary + explorer link)
 */
import { useMemo } from 'react';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import { MemeImageCard } from './meme-image-card';
import { ToolCallBubble } from './tool-call-bubble';
import { describeArtifact } from '@/lib/artifact-view';
import type { ToolCallsByAgent } from '@/hooks/useRun-state';
import { mergeTimeline, type TimelineItem } from './timeline-merge';

export interface TimelineViewProps {
  logs: LogEvent[];
  artifacts: Artifact[];
  toolCalls: ToolCallsByAgent;
}

const AGENT_TONE: Record<LogEvent['agent'], string> = {
  creator: 'border-l-[color:var(--color-chain-bnb)]',
  narrator: 'border-l-[color:var(--color-chain-ipfs)]',
  'market-maker': 'border-l-[color:var(--color-chain-base)]',
  heartbeat: 'border-l-accent',
};

function levelColor(level: LogEvent['level']): string {
  if (level === 'warn') return 'text-[color:var(--color-warning)]';
  if (level === 'error') return 'text-[color:var(--color-danger)]';
  return 'text-fg-primary';
}

function LogBubble({ event }: { event: LogEvent }): React.ReactElement {
  return (
    <div
      className={`flex items-baseline gap-2 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 text-[12px] ${AGENT_TONE[event.agent]}`}
    >
      <span className="shrink-0 font-[family-name:var(--font-mono)] text-fg-tertiary">
        {event.ts.slice(11, 19)}
      </span>
      <span className="shrink-0 font-[family-name:var(--font-mono)] text-fg-tertiary">
        {event.agent}
      </span>
      <span className="shrink-0 font-[family-name:var(--font-mono)] text-accent-text">
        {event.tool}
      </span>
      <span className={`break-words ${levelColor(event.level)}`}>{event.message}</span>
    </div>
  );
}

function X402TransferCard({
  artifact,
}: {
  artifact: Extract<Artifact, { kind: 'x402-tx' }>;
}): React.ReactElement {
  return (
    <a
      href={artifact.explorerUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[color:var(--color-chain-base)] bg-bg-surface p-3 text-[12px] hover:[filter:drop-shadow(0_0_4px_var(--color-chain-base))]"
    >
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-sans-display)] text-[12px] uppercase tracking-[0.5px] text-[color:var(--color-chain-base)]">
          x402 settlement · {artifact.amountUsdc} USDC
        </span>
        <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">base-sepolia</span>
      </div>
      <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-fg-secondary">
        <span>market-maker</span>
        <span aria-hidden>→</span>
        <span>narrator</span>
      </div>
      <div className="font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
        {artifact.txHash.slice(0, 10)}…{artifact.txHash.slice(-8)}
      </div>
    </a>
  );
}

function TweetCard({
  artifact,
}: {
  artifact: Extract<Artifact, { kind: 'tweet-url' }>;
}): React.ReactElement {
  const isDryRun = artifact.tweetId === 'dry-run' || artifact.url === 'about:blank';
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-3 text-[12px]"
      style={isDryRun ? { opacity: 0.6 } : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
          {isDryRun ? 'X · dry-run' : 'X · live'}
        </span>
        <span className="font-[family-name:var(--font-mono)] text-accent">
          #{artifact.tweetId.slice(-6)}
        </span>
      </div>
      {artifact.label !== undefined && artifact.label !== '' ? (
        <p className="text-fg-primary">{artifact.label}</p>
      ) : null}
    </a>
  );
}

function GenericArtifactRow({ artifact }: { artifact: Artifact }): React.ReactElement {
  // Heartbeat artifacts have their own panel; render a tiny inline summary
  // here so timeline mode still surfaces them in the right time slot.
  if (artifact.kind === 'heartbeat-tick') {
    return (
      <div className="rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-2 text-[12px]">
        <span className="font-[family-name:var(--font-mono)] text-accent">
          heartbeat tick #{artifact.tickNumber.toString().padStart(2, '0')}/
          {artifact.totalTicks.toString().padStart(2, '0')}
        </span>
        <span className="ml-2 font-[family-name:var(--font-mono)] text-fg-tertiary">
          {artifact.decisions.join(' · ') || '—'}
        </span>
      </div>
    );
  }
  if (artifact.kind === 'heartbeat-decision') {
    return (
      <div className="rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-2 text-[12px]">
        <span className="font-[family-name:var(--font-mono)] text-accent">
          heartbeat decision #{artifact.tickNumber.toString().padStart(2, '0')}
        </span>
        <span className="ml-2 font-[family-name:var(--font-mono)] text-fg-primary">
          {artifact.action}
        </span>
        <span className="ml-2 text-fg-secondary">— {artifact.reason}</span>
      </div>
    );
  }
  // BSC / IPFS / token-deploy-tx all reuse the pill-style describe helper for
  // their visual identity (chain colour + short hash + explorer link).
  const d = describeArtifact(artifact);
  return (
    <a
      href={d.href}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border bg-bg-surface px-3 py-2 text-[12px] hover:[filter:drop-shadow(0_0_4px_currentColor)]"
      style={{ borderColor: `var(${d.chainColorVar})`, color: `var(${d.chainColorVar})` }}
    >
      <span className="font-[family-name:var(--font-mono)]">{d.primaryText}</span>
      <span className="text-fg-tertiary">{d.kindLabel}</span>
    </a>
  );
}

function ItemRow({ item }: { item: TimelineItem }): React.ReactElement {
  if (item.kind === 'log') return <LogBubble event={item.event} />;
  if (item.kind === 'tool_use') return <ToolCallBubble call={item.call} />;
  // artifact dispatch
  const a = item.artifact;
  if (a.kind === 'meme-image') return <MemeImageCard artifact={a} />;
  if (a.kind === 'tweet-url') return <TweetCard artifact={a} />;
  if (a.kind === 'x402-tx') return <X402TransferCard artifact={a} />;
  return <GenericArtifactRow artifact={a} />;
}

export function TimelineView({
  logs,
  artifacts,
  toolCalls,
}: TimelineViewProps): React.ReactElement {
  const merged = useMemo(
    () => mergeTimeline({ logs, artifacts, toolCalls }),
    [logs, artifacts, toolCalls],
  );

  return (
    <section
      aria-label="Run timeline"
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4"
    >
      <header className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-sans-display)] text-[12px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
          Timeline
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          {merged.items.length} events
        </span>
      </header>

      {merged.truncatedCount > 0 ? (
        <div
          role="note"
          className="rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary"
        >
          … {merged.truncatedCount} earlier events folded …
        </div>
      ) : null}

      {merged.items.length === 0 ? (
        <p className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          — Waiting for run events
        </p>
      ) : (
        <ol className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {merged.items.map((item) => (
            <li key={item.key} style={{ animation: 'log-line-in 150ms ease-out both' }}>
              <ItemRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
