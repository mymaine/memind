/**
 * BrainChatMessage — per-turn renderer for the BrainChat transcript
 * (BRAIN-P4 Task 2 / AC-BRAIN-5).
 *
 * Visual model (spec §AC-BRAIN-5):
 *   - User turn  → right-aligned bubble, accent tone, plain text only.
 *   - Assistant  → left-aligned bubble containing:
 *       1. Brain-authored content (typewriter-rendered `content` string).
 *       2. Inline `brainEvents` sequence in wire order:
 *          - tool-use-start (agent=brain) → "🔧 invoking <PersonaName>..." pill
 *          - tool-use-end   (agent=brain) → "ok" / "error" status pill
 *          - tool-use-*     (agent=persona) → persona sub-block header
 *          - persona-log     → indent + agent name + tool + message
 *          - persona-artifact → pill via describeArtifact (reuses the existing
 *            chain-colour pill style from TimelineView)
 *       3. If content is empty AND brainEvents is empty → a "thinking" pulse
 *          placeholder so the bubble is never visually absent.
 *
 * Not a client component: this file ships pure markup (no 'use client'),
 * safe for SSR. Parent BrainChat owns the 'use client' island.
 */
import type { ReactElement } from 'react';
import type { AgentId } from '@hack-fourmeme/shared';
import type { BrainChatEvent, BrainChatTurn } from '@/hooks/useBrainChat-state';
import { describeArtifact, isPillArtifact } from '@/lib/artifact-view';

export interface BrainChatMessageProps {
  readonly turn: BrainChatTurn;
}

// Mirrors timeline-view.tsx AGENT_TONE so colour associations stay consistent
// across the run surface and the chat surface.
const AGENT_TONE: Record<AgentId, string> = {
  creator: 'border-l-[color:var(--color-chain-bnb)]',
  narrator: 'border-l-[color:var(--color-chain-ipfs)]',
  'market-maker': 'border-l-[color:var(--color-chain-base)]',
  heartbeat: 'border-l-accent',
  brain: 'border-l-accent',
  shiller: 'border-l-[color:var(--color-chain-base)]',
};

/**
 * Map the Brain's tool names to user-facing persona labels. The Brain dispatches
 * `invoke_creator` / `invoke_narrator` / `invoke_shiller` / `invoke_heartbeat_tick`;
 * judges don't need to see the wire names, so we translate them.
 */
function friendlyPersonaName(toolName: string): string {
  if (toolName === 'invoke_creator') return 'Creator';
  if (toolName === 'invoke_narrator') return 'Narrator';
  if (toolName === 'invoke_shiller') return 'Pitch';
  if (toolName === 'invoke_heartbeat_tick') return 'Heartbeat';
  return toolName;
}

function UserBubble({ turn }: { turn: BrainChatTurn }): ReactElement {
  return (
    <div
      data-role="user"
      className="ml-auto flex max-w-[80%] flex-col items-end self-end rounded-[var(--radius-card)] border border-accent bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] px-3 py-2 text-right"
    >
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        you
      </span>
      <p className="whitespace-pre-wrap break-words font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.5] text-fg-primary">
        {turn.content}
      </p>
    </div>
  );
}

function ToolUseStartPill({
  event,
}: {
  event: Extract<BrainChatEvent, { kind: 'tool-use-start' }>;
}): ReactElement {
  const isBrain = event.agent === 'brain';
  const persona = friendlyPersonaName(event.toolName);
  if (isBrain) {
    return (
      <div className="inline-flex items-center gap-1.5 self-start rounded-[var(--radius-card)] border border-accent bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-accent-text">
        <span aria-hidden>🔧</span>
        <span>invoking {persona} persona…</span>
      </div>
    );
  }
  // Persona-level tool use (nested) — shown as a muted sub-label.
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] ${AGENT_TONE[event.agent]}`}
    >
      <span className="text-fg-tertiary">{event.agent}</span>
      <span className="text-accent-text">{event.toolName}</span>
      <span className="text-fg-tertiary">starting…</span>
    </div>
  );
}

function ToolUseEndPill({
  event,
}: {
  event: Extract<BrainChatEvent, { kind: 'tool-use-end' }>;
}): ReactElement {
  const isBrain = event.agent === 'brain';
  const persona = friendlyPersonaName(event.toolName);
  const label = event.isError ? 'error' : 'ok';
  if (isBrain) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 self-start rounded-[var(--radius-card)] border px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] ${
          event.isError
            ? 'border-[color:var(--color-danger)] text-[color:var(--color-danger)]'
            : 'border-accent bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] text-accent-text'
        }`}
      >
        <span aria-hidden>{event.isError ? '⚠' : '✓'}</span>
        <span>
          {persona} · {label}
        </span>
      </div>
    );
  }
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] ${AGENT_TONE[event.agent]}`}
    >
      <span className="text-fg-tertiary">{event.agent}</span>
      <span className="text-accent-text">{event.toolName}</span>
      <span className={event.isError ? 'text-[color:var(--color-danger)]' : 'text-accent-text'}>
        {label}
      </span>
    </div>
  );
}

function PersonaLogBlock({
  event,
}: {
  event: Extract<BrainChatEvent, { kind: 'persona-log' }>;
}): ReactElement {
  const levelClass =
    event.level === 'warn'
      ? 'text-[color:var(--color-warning)]'
      : event.level === 'error'
        ? 'text-[color:var(--color-danger)]'
        : 'text-fg-primary';
  return (
    <div
      className={`ml-4 flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 text-[12px] ${AGENT_TONE[event.agent]}`}
    >
      <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        <span>{event.agent}</span>
        <span>·</span>
        <span>{event.tool}</span>
      </div>
      <p className={`break-words font-[family-name:var(--font-sans-body)] ${levelClass}`}>
        {event.message}
      </p>
    </div>
  );
}

function PersonaArtifactBlock({
  event,
}: {
  event: Extract<BrainChatEvent, { kind: 'persona-artifact' }>;
}): ReactElement {
  // The shared pill artifacts (bsc-token / token-deploy-tx / lore-cid /
  // x402-tx / tweet-url / meme-image) go through `describeArtifact`. Non-pill
  // kinds get a terse generic row — same fallback the timeline view uses.
  if (isPillArtifact(event.artifact)) {
    const d = describeArtifact(event.artifact);
    return (
      <a
        href={d.href}
        target="_blank"
        rel="noreferrer noopener"
        className={`ml-4 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border bg-bg-surface px-3 py-2 text-[12px] hover:[filter:drop-shadow(0_0_4px_currentColor)] ${AGENT_TONE[event.agent]} border-l-4`}
        style={{ borderColor: `var(${d.chainColorVar})`, color: `var(${d.chainColorVar})` }}
      >
        <span className="font-[family-name:var(--font-mono)]">{d.primaryText}</span>
        <span className="text-fg-tertiary">{d.kindLabel}</span>
      </a>
    );
  }
  // Non-pill artifact kinds — keep a tiny descriptor so nothing is lost.
  return (
    <div
      className={`ml-4 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-fg-secondary ${AGENT_TONE[event.agent]}`}
    >
      {event.agent} · {event.artifact.kind}
    </div>
  );
}

function PersonaDeltaBlock({
  event,
}: {
  event: Extract<BrainChatEvent, { kind: 'assistant-delta' }>;
}): ReactElement {
  return (
    <div
      className={`ml-4 flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 text-[12px] italic ${AGENT_TONE[event.agent]}`}
    >
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        {event.agent} · thinking
      </span>
      <p className="break-words text-fg-secondary">{event.delta}</p>
    </div>
  );
}

function BrainEventRow({ event }: { event: BrainChatEvent }): ReactElement {
  switch (event.kind) {
    case 'tool-use-start':
      return <ToolUseStartPill event={event} />;
    case 'tool-use-end':
      return <ToolUseEndPill event={event} />;
    case 'persona-log':
      return <PersonaLogBlock event={event} />;
    case 'persona-artifact':
      return <PersonaArtifactBlock event={event} />;
    case 'assistant-delta':
      return <PersonaDeltaBlock event={event} />;
  }
}

function AssistantBubble({ turn }: { turn: BrainChatTurn }): ReactElement {
  const events = turn.brainEvents ?? [];
  const isEmpty = turn.content === '' && events.length === 0;

  return (
    <div
      data-role="assistant"
      className="mr-auto flex max-w-[90%] flex-col gap-2 self-start rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-2"
    >
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        Memind
      </span>
      {isEmpty ? (
        <p
          className="font-[family-name:var(--font-mono)] text-[12px] italic text-fg-tertiary"
          aria-live="polite"
        >
          thinking…
        </p>
      ) : null}
      {turn.content !== '' ? (
        <p className="whitespace-pre-wrap break-words font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.5] text-fg-primary">
          {turn.content}
        </p>
      ) : null}
      {events.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {events.map((ev, i) => (
            <BrainEventRow key={`${turn.id}-ev-${i.toString()}`} event={ev} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BrainChatMessage({ turn }: BrainChatMessageProps): ReactElement {
  if (turn.role === 'user') {
    return <UserBubble turn={turn} />;
  }
  return <AssistantBubble turn={turn} />;
}
