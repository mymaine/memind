'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentId, AgentStatus, Artifact } from '@hack-fourmeme/shared';
import { ArchitectureDiagram } from '@/components/architecture-diagram';
import { ThemeInput } from '@/components/theme-input';
import { LogPanel } from '@/components/log-panel';
import { TimelineView } from '@/components/timeline-view';
import { TxList } from '@/components/tx-list';
import { MemeImageCard } from '@/components/meme-image-card';
import { HeartbeatSection } from '@/components/heartbeat-section';
import { AnchorLedgerPanel } from '@/components/anchor-ledger-panel';
import { Toast } from '@/components/toast';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';
import { useRun, type RunState } from '@/hooks/useRun';

type ViewMode = 'columns' | 'timeline';

/**
 * Pull the latest meme-image artifact from the run, if any. We pick the most
 * recent one because the Creator agent only emits a single image per run, but
 * artifact lists are append-only so taking the tail is the safe default.
 */
function latestMemeImage(state: RunState): Extract<Artifact, { kind: 'meme-image' }> | null {
  for (let i = state.artifacts.length - 1; i >= 0; i -= 1) {
    const a = state.artifacts[i];
    if (a && a.kind === 'meme-image') return a;
  }
  return null;
}

/**
 * Derive per-agent status from the run state. Rules:
 *   - idle phase: every agent idle.
 *   - running phase: agent has ≥1 log entry → running. An error log on an
 *     agent promotes it to 'error'. Specific completion signals flip an agent
 *     to 'done' ahead of the terminal status event:
 *       narrator     → done once a lore-cid artifact from narrator arrives
 *       market-maker → done once an x402-tx artifact arrives
 *     Creator stays idle for a2a runs — pre-seed artifacts show up but the
 *     Creator agent does not actually execute.
 *   - done phase: anything still running becomes 'done'.
 *   - error phase: anything still running becomes 'error'.
 */
function deriveAgentStatuses(state: RunState): Record<AgentId, AgentStatus> {
  const next: Record<AgentId, AgentStatus> = {
    creator: 'idle',
    narrator: 'idle',
    'market-maker': 'idle',
    heartbeat: 'idle',
  };
  if (state.phase === 'idle') return next;

  for (const log of state.logs) {
    // a2a runs do not emit heartbeat logs — treat defensively anyway.
    if (log.agent === 'heartbeat') continue;
    if (log.level === 'error') {
      next[log.agent] = 'error';
    } else if (next[log.agent] !== 'error') {
      next[log.agent] = 'running';
    }
  }

  for (const artifact of state.artifacts) {
    if (artifact.kind === 'lore-cid' && artifact.author === 'narrator') {
      if (next.narrator !== 'error') next.narrator = 'done';
    }
    if (artifact.kind === 'lore-cid' && artifact.author === 'creator') {
      // Creator finishes once it has pinned its own lore chapter — that
      // happens after the four-tool sequence completes successfully. The
      // dry-run fallback also emits a creator lore-cid, so this single
      // signal covers both paths.
      if (next.creator !== 'error') next.creator = 'done';
    }
    if (artifact.kind === 'x402-tx') {
      if (next['market-maker'] !== 'error') next['market-maker'] = 'done';
    }
  }

  if (state.phase === 'done') {
    for (const k of Object.keys(next) as AgentId[]) {
      if (next[k] === 'running') next[k] = 'done';
    }
  } else if (state.phase === 'error') {
    for (const k of Object.keys(next) as AgentId[]) {
      if (next[k] === 'running') next[k] = 'error';
    }
  }

  return next;
}

export default function HomePage() {
  const { state, startRun } = useRun();
  const agentStatuses = useMemo(() => deriveAgentStatuses(state), [state]);
  const memeImage = useMemo(() => latestMemeImage(state), [state]);
  // V2-P4: 3-column vs Timeline view toggle. State lives here so switching
  // does not unsubscribe SSE; the underlying run state stays in `useRun`.
  const [viewMode, setViewMode] = useState<ViewMode>('columns');

  // V2-P5 Task 6: surface 409 concurrency errors as a toast. The `error`
  // phase already shows an inline alert; the toast adds a right-corner flash
  // that decays after 3s so subsequent successful runs read cleanly.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Extracted so the effect dep is a simple string|null, not a ternary.
  const errorMessage = state.phase === 'error' ? state.error : null;
  useEffect(() => {
    if (errorMessage !== null && errorMessage.length > 0) {
      setToastMessage(errorMessage);
    }
  }, [errorMessage]);
  const clearToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  // Both renderers want toolCalls / assistantText in the post-idle state; we
  // pre-compute once so the JSX below stays slim.
  const toolCalls = state.phase === 'idle' ? EMPTY_TOOL_CALLS : state.toolCalls;
  const assistantText = state.phase === 'idle' ? EMPTY_ASSISTANT_TEXT : state.assistantText;

  return (
    // V2-P5 Task 3: layout compressed for a single 1920x960 viewport.
    // Budget breakdown (approx): header 36 + title+input 96 + architecture
    // 170 + meme+view 380 + pills 80 + heartbeat (collapsed) 56 + footer 40
    // + gaps 60 ≈ 918px. Heartbeat expands in place and scrolls internally.
    <main className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 px-6 py-4">
      {/* Shared <Header /> is mounted at the layout level (V4.7-P1 Task 4);
          the page-level "Agent Swarm" header block lived here before and
          has been removed. The min-h/padding tuning for the now-shorter
          viewport lands in V4.7-P1 Task 5 (min-h-[calc(100vh-56px)]). */}
      <section className="flex flex-col gap-2">
        <ThemeInput onRun={startRun} disabled={state.phase === 'running'} />
        {state.phase === 'error' ? (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-2 text-[13px] text-fg-primary"
          >
            <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">error · </span>
            {state.error}
          </div>
        ) : null}
      </section>

      <ArchitectureDiagram statuses={agentStatuses} artifacts={state.artifacts} />

      <section aria-label="Run view" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Run view mode"
            className="flex w-fit items-center gap-1 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'columns'}
              onClick={() => setViewMode('columns')}
              className={`rounded-[var(--radius-card)] px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] transition-colors ${
                viewMode === 'columns'
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg-tertiary hover:text-fg-primary'
              }`}
            >
              3 columns
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'timeline'}
              onClick={() => setViewMode('timeline')}
              className={`rounded-[var(--radius-card)] px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.5px] transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg-tertiary hover:text-fg-primary'
              }`}
            >
              timeline
            </button>
          </div>
          {/* V2-P5 Task 3: inline 96px meme thumb next to the tabs so the
              Creator visual stays on the single-screen budget without its own
              full-width row. Click opens the modal (full-size view). */}
          {memeImage ? <MemeImageCard artifact={memeImage} /> : null}
        </div>

        {viewMode === 'columns' ? (
          <LogPanel
            logs={state.logs}
            toolCalls={state.phase === 'idle' ? undefined : toolCalls}
            assistantText={state.phase === 'idle' ? undefined : assistantText}
          />
        ) : (
          <TimelineView logs={state.logs} artifacts={state.artifacts} toolCalls={toolCalls} />
        )}
      </section>

      <TxList artifacts={state.artifacts} />

      {/* AC3 Anchor Evidence — collapsible so the main single-screen budget
          stays intact. The header row always reports anchor counts so the
          evidence is discoverable even when the body is collapsed. */}
      <AnchorLedgerPanel artifacts={state.phase === 'idle' ? [] : state.artifacts} />

      {/* V2-P3 Heartbeat section — owns its own useRun instance so the a2a
          flow above and this independent run never share state. Users paste
          the BSC address manually (see docs/features/dashboard-v2.md for
          the deliberate decoupling rationale). */}
      <HeartbeatSection />

      <footer className="border-t border-border-default pt-2 text-[11px] text-fg-tertiary">
        <span className="font-[family-name:var(--font-mono)]">
          Four.Meme AI Sprint · submission 2026-04-22 UTC 15:59
        </span>
      </footer>

      <Toast message={toastMessage} onDismiss={clearToast} />
    </main>
  );
}
