'use client';

import { useMemo } from 'react';
import type { AgentId, AgentStatus, Artifact } from '@hack-fourmeme/shared';
import { AgentStatusBar } from '@/components/agent-status-bar';
import { ArchitectureDiagram } from '@/components/architecture-diagram';
import { ThemeInput } from '@/components/theme-input';
import { LogPanel } from '@/components/log-panel';
import { TxList } from '@/components/tx-list';
import { MemeImageCard } from '@/components/meme-image-card';
import { HeartbeatSection } from '@/components/heartbeat-section';
import { useRun, type RunState } from '@/hooks/useRun';

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

  return (
    <main className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-12 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full bg-accent"
            style={{ animation: 'signal-pulse 1500ms ease-in-out infinite' }}
          />
          <span className="font-[family-name:var(--font-sans-display)] text-[20px] font-semibold uppercase tracking-[0.5px] text-fg-primary">
            Agent Swarm
          </span>
        </div>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          four.meme × x402 · base-sepolia
        </span>
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="font-[family-name:var(--font-sans-display)] text-[36px] font-normal leading-[1.11] tracking-[-0.9px] text-fg-primary">
          First agent-to-agent commerce
          <span className="text-accent"> on Four.Meme</span>
        </h1>
        <p className="max-w-[640px] text-[16px] leading-[1.5] text-fg-secondary">
          Three agents cooperate: Creator deploys a four.meme token, Narrator writes lore, and
          Market-maker auto-pays USDC via x402 to fetch it. One prompt. Five on-chain artifacts.
        </p>
        <ThemeInput onRun={startRun} disabled={state.phase === 'running'} />
        {state.phase === 'error' ? (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] p-4 text-[14px] text-fg-primary"
          >
            <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">error · </span>
            {state.error}
          </div>
        ) : null}
      </section>

      <ArchitectureDiagram statuses={agentStatuses} artifacts={state.artifacts} />

      <AgentStatusBar statuses={agentStatuses} />

      {memeImage ? (
        <section
          aria-label="creator output"
          className="grid grid-cols-1 gap-4 md:grid-cols-[256px_1fr]"
        >
          <MemeImageCard artifact={memeImage} />
          <div className="rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-4 text-[12px] text-fg-secondary">
            <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
              creator output ·{' '}
            </span>
            The Creator agent generated this meme image, pinned it to IPFS via Pinata, and is now
            handing the freshly-minted token to the Narrator.
          </div>
        </section>
      ) : null}

      <LogPanel
        logs={state.logs}
        toolCalls={state.phase === 'idle' ? undefined : state.toolCalls}
        assistantText={state.phase === 'idle' ? undefined : state.assistantText}
      />

      <TxList artifacts={state.artifacts} />

      {/* V2-P3 Heartbeat section — owns its own useRun instance so the a2a
          flow above and this independent run never share state. Users paste
          the BSC address manually (see docs/features/dashboard-v2.md for
          the deliberate decoupling rationale). */}
      <HeartbeatSection />

      <footer className="border-t border-border-default pt-6 text-[12px] text-fg-tertiary">
        <span className="font-[family-name:var(--font-mono)]">
          Four.Meme AI Sprint · submission 2026-04-22 UTC 15:59
        </span>
      </footer>
    </main>
  );
}
