'use client';

import { useEffect, useRef } from 'react';
import type { AgentId, LogEvent } from '@hack-fourmeme/shared';
import { ToolCallBubble } from './tool-call-bubble';
import type { AssistantTextByAgent, ToolCallsByAgent, ToolCallState } from '@/hooks/useRun-state';

/**
 * Three-column log stream: one column per agent (creator / narrator /
 * market-maker). Heartbeat logs are filtered out — a2a runs never emit them.
 *
 * V2-P2: each column now also renders, above the coarse log lines:
 *   - live assistant text (token-by-token) from `assistant:delta` events
 *   - ToolCallBubble entries for every `tool_use:start/end` pair
 *
 * The log lines stay as the post-run readable summary; the new visuals are
 * the live "what is the agent doing RIGHT NOW" layer.
 *
 * Visual spec: docs/design.md §4 "Log Panel" + §7 "log-line-in" animation.
 */

const COLUMNS: { id: Exclude<AgentId, 'heartbeat'>; label: string }[] = [
  { id: 'creator', label: 'creator' },
  { id: 'narrator', label: 'narrator' },
  { id: 'market-maker', label: 'market-maker' },
];

function levelClass(level: LogEvent['level']): string {
  if (level === 'warn') return 'text-[color:var(--color-warning)]';
  if (level === 'error') return 'text-[color:var(--color-danger)]';
  return 'text-fg-primary';
}

function AgentColumn({
  agent,
  label,
  logs,
  toolCalls,
  assistantText,
}: {
  agent: Exclude<AgentId, 'heartbeat'>;
  label: string;
  logs: LogEvent[];
  toolCalls: ToolCallState[];
  assistantText: string;
}): React.ReactElement {
  const scrollRef = useRef<HTMLOListElement | null>(null);

  // Keep the newest entry visible as logs stream in. The dependency is the
  // count, not the array — we only care that something was appended.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4">
      <header className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-sans-display)] text-[12px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
          {label}
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          {logs.length}
        </span>
      </header>
      {/* V2-P2: live tool-use bubbles + assistant delta text. Rendered above
          the coarse log so the demo viewer sees the live affordances first. */}
      {toolCalls.length > 0 || assistantText.length > 0 ? (
        <div className="flex flex-col gap-2 border-b border-border-default pb-2">
          {toolCalls.map((call) => (
            <ToolCallBubble key={call.id} call={call} />
          ))}
          {assistantText.length > 0 ? (
            <div
              aria-label={`${agent} assistant text`}
              className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-card)] bg-bg-surface p-2 font-[family-name:var(--font-mono)] text-[12px] text-fg-secondary"
            >
              {assistantText}
            </div>
          ) : null}
        </div>
      ) : null}
      <ol
        ref={scrollRef}
        aria-label={`${agent} log column`}
        // V2-P5: capped at ~240px (tight 1920x960 single-screen budget).
        // Older bound was 60vh which blew the budget on laptop viewports.
        className="max-h-[240px] space-y-1 overflow-y-auto font-[family-name:var(--font-mono)] text-[12px] leading-[1.4]"
      >
        {logs.length === 0 ? (
          <li className="text-fg-tertiary">—</li>
        ) : (
          logs.map((e, i) => (
            <li
              // Per-agent list so ts+idx is sufficient for a stable key.
              key={`${e.ts}-${i.toString()}`}
              className="flex flex-wrap items-baseline gap-x-2"
              style={{ animation: 'log-line-in 150ms ease-out both' }}
            >
              <span className="shrink-0 text-[12px] text-fg-tertiary">{e.ts.slice(11, 19)}</span>
              <span className="shrink-0 text-accent-text">{e.tool}</span>
              <span className={levelClass(e.level)}>{e.message}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

export function LogPanel({
  logs = [],
  toolCalls,
  assistantText,
}: {
  logs?: LogEvent[];
  toolCalls?: ToolCallsByAgent;
  assistantText?: AssistantTextByAgent;
}) {
  // a2a runs emit no heartbeat entries, but filter defensively so adding the
  // heartbeat kind later does not regress the 3-column layout.
  const byAgent: Record<Exclude<AgentId, 'heartbeat'>, LogEvent[]> = {
    creator: [],
    narrator: [],
    'market-maker': [],
  };
  for (const e of logs) {
    if (e.agent === 'heartbeat') continue;
    byAgent[e.agent].push(e);
  }

  return (
    <section aria-label="Agent log stream" className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">Log stream</span>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          SSE · {logs.length} events
        </span>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map((c) => (
          <AgentColumn
            key={c.id}
            agent={c.id}
            label={c.label}
            logs={byAgent[c.id]}
            toolCalls={toolCalls?.[c.id] ?? []}
            assistantText={assistantText?.[c.id] ?? ''}
          />
        ))}
      </div>
    </section>
  );
}
