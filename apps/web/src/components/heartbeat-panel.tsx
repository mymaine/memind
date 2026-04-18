'use client';

import type { Artifact } from '@hack-fourmeme/shared';
import { useMemo } from 'react';
import { decisionForTick, formatTickCounter, selectHeartbeatView } from './heartbeat-derive';
import { TweetFeed } from './tweet-feed';

/**
 * HeartbeatPanel — dashboard Heartbeat section for V2-P3 (AC-V2-4).
 *
 * Three visual rows:
 *   1. Tick counter: `01 / 03 ticks` + a simple bar showing progress.
 *   2. Decision tree: one row per tick carrying the action (post / extend_lore
 *      / skip) + the agent's short reason. Rows for ticks that have not yet
 *      emitted a decision are rendered as 'pending …' placeholders so the
 *      agent's `check_status → decide → act` sequence is visible.
 *   3. TweetFeed (see ./tweet-feed).
 *
 * Inputs are a filtered `artifacts` array (pulled from useRun) plus the
 * active run phase. Rendering is pure; the heartbeat-derive helpers do all
 * the projection so this module stays lean.
 */

type RunPhase = 'idle' | 'running' | 'done' | 'error';

export function HeartbeatPanel({
  artifacts,
  phase,
  tokenAddress,
}: {
  artifacts: Artifact[];
  phase: RunPhase;
  tokenAddress: string | null;
}) {
  const view = useMemo(() => selectHeartbeatView(artifacts), [artifacts]);

  return (
    <section
      aria-label="Heartbeat agent"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-[family-name:var(--font-sans-display)] text-[16px] font-semibold uppercase tracking-[0.5px] text-fg-primary">
            Heartbeat
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
            {tokenAddress ? `${tokenAddress.slice(0, 6)}..${tokenAddress.slice(-4)}` : '—'}
          </span>
        </div>
        <span
          className="font-[family-name:var(--font-mono)] text-[14px] text-fg-primary"
          aria-label="tick counter"
        >
          {view.totalTicks > 0
            ? formatTickCounter(view.currentTick, view.totalTicks)
            : phase === 'running'
              ? '00 / 03 ticks'
              : 'idle'}
        </span>
      </header>

      {/* Progress bar — fills from 0 to currentTick / totalTicks. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-primary">
        <div
          aria-label="heartbeat progress"
          className="h-full bg-accent transition-[width] duration-300"
          style={{
            width:
              view.totalTicks > 0
                ? `${Math.round((view.currentTick / view.totalTicks) * 100).toString()}%`
                : '0%',
          }}
        />
      </div>

      {/* Decision tree */}
      <ol className="flex flex-col gap-2" aria-label="Heartbeat decision tree">
        {view.ticks.length === 0 ? (
          <li className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">—</li>
        ) : (
          view.ticks.map((t) => {
            const d = decisionForTick(view.decisions, t.tickNumber);
            return (
              <li
                key={`tick-${t.tickNumber.toString()}`}
                className="flex items-baseline gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-3 text-[13px]"
              >
                <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
                  {`#${t.tickNumber.toString().padStart(2, '0')}`}
                </span>
                <span className="font-[family-name:var(--font-mono)] text-accent-text">
                  check_status →
                </span>
                {d ? (
                  <>
                    <span className="font-[family-name:var(--font-mono)] font-semibold text-fg-primary">
                      {d.action}
                    </span>
                    <span className="truncate text-fg-secondary">— {d.reason}</span>
                  </>
                ) : (
                  <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
                    deciding …
                  </span>
                )}
              </li>
            );
          })
        )}
      </ol>

      {/* TweetFeed */}
      <div className="flex flex-col gap-2">
        <span className="text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">Tweet feed</span>
        <TweetFeed tweets={view.tweets} />
      </div>
    </section>
  );
}
