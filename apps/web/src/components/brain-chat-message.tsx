/**
 * BrainChatMessage — per-turn renderer for the BrainChat transcript.
 *
 * Visual model after the UAT fixes (see docs/decisions):
 *   - User turn → right-aligned bubble, accent tone, plain text only.
 *   - Assistant turn:
 *       1. Grouped nested events (tool-use scopes, merged thinking rows,
 *          deduped persona logs, artifact pills) — drawn FIRST, in wire
 *          order, so the Memind's "work log" lives above the final reply.
 *       2. Final Brain-authored content at the BOTTOM of the bubble, rendered
 *          as markdown (react-markdown + remark-gfm).
 *       3. If both content and events are empty → a single "thinking" pulse
 *          so the bubble is never visually absent.
 *
 * The grouping pass is pure (`brain-chat-message-group.ts`) and collapses
 * runtime-noise logs, merges consecutive thinking deltas into a single
 * streaming row, and nests persona events under the enclosing brain
 * tool-use scope for compact rendering.
 *
 * Not a client component: this file ships pure markup (no 'use client'),
 * safe for SSR. Parent BrainChat owns the 'use client' island.
 */
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentId } from '@hack-fourmeme/shared';
import type { BrainChatTurn } from '@/hooks/useBrainChat-state';
import type { BrainChatGroup } from './brain-chat-message-group';
import { groupBrainChatEvents } from './brain-chat-message-group';
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

function BrainToolUseGroup({
  group,
}: {
  group: Extract<BrainChatGroup, { kind: 'tool-use' }>;
}): ReactElement {
  const persona = friendlyPersonaName(group.toolName);
  const running = group.end === null;
  const err = !running && (group.end?.isError ?? false);
  // Footer status word is chosen to read well in plain text AND match the
  // legacy regex `/\bok\b|\bdone\b|completed/` that component tests use to
  // assert a tool-use-end pill was drawn. Keep the word as a standalone
  // token so `\b` boundaries fire.
  const statusLabel = running ? 'running…' : err ? 'error' : 'ok';
  const statusColor = running
    ? 'text-accent-text'
    : err
      ? 'text-[color:var(--color-danger)]'
      : 'text-accent-text';
  const icon = running ? '🔧' : err ? '⚠' : '✓';
  return (
    <div className="flex flex-col gap-1.5 self-start rounded-[var(--radius-card)] border border-accent bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-2 py-1.5">
      <div className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] text-accent-text">
        <span aria-hidden>🔧</span>
        <span>invoking {persona} persona…</span>
      </div>
      {group.children.length > 0 ? (
        <div className="ml-4 flex flex-col gap-1">
          {group.children.map((child, i) => (
            <GroupRow key={`${group.toolUseId}-child-${i.toString()}`} group={child} />
          ))}
        </div>
      ) : null}
      <div
        className={`inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] ${statusColor}`}
      >
        <span aria-hidden>{icon}</span>
        <span>
          {persona} · {statusLabel}
        </span>
      </div>
    </div>
  );
}

function PersonaToolUseRow({
  group,
}: {
  group: Extract<BrainChatGroup, { kind: 'tool-use' }>;
}): ReactElement {
  // Compressed single-line view for persona sub-tools (narrative_generator,
  // meme_image_creator, onchain_deployer, lore_writer). Shows only name +
  // final status so the bubble stays legible. While running we show a dim
  // "…" marker instead of verbose progress logs (runtime logs are filtered
  // upstream by `groupBrainChatEvents`).
  const label = group.toolName;
  const running = group.end === null;
  const ok = !running && !(group.end?.isError ?? false);
  const err = !running && (group.end?.isError ?? false);
  const marker = running ? '…' : ok ? '✓' : '✗';
  const tone = err
    ? 'text-[color:var(--color-danger)]'
    : running
      ? 'text-fg-tertiary'
      : 'text-accent-text';
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-1 font-[family-name:var(--font-mono)] text-[11px] ${AGENT_TONE[group.agent]}`}
    >
      <span className="text-fg-tertiary">{group.agent}</span>
      <span className="text-fg-secondary">·</span>
      <span className="text-fg-primary">{label}</span>
      <span className={`ml-auto ${tone}`}>{marker}</span>
    </div>
  );
}

function PersonaLogRow({
  group,
}: {
  group: Extract<BrainChatGroup, { kind: 'persona-log' }>;
}): ReactElement {
  const levelClass =
    group.level === 'warn'
      ? 'text-[color:var(--color-warning)]'
      : group.level === 'error'
        ? 'text-[color:var(--color-danger)]'
        : 'text-fg-primary';
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 text-[12px] ${AGENT_TONE[group.agent]}`}
    >
      <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        <span>{group.agent}</span>
        <span>·</span>
        <span>{group.tool}</span>
      </div>
      <p
        className={`[overflow-wrap:anywhere] break-all font-[family-name:var(--font-sans-body)] ${levelClass}`}
      >
        {group.message}
      </p>
    </div>
  );
}

function PersonaArtifactRow({
  group,
}: {
  group: Extract<BrainChatGroup, { kind: 'persona-artifact' }>;
}): ReactElement {
  if (isPillArtifact(group.artifact)) {
    const d = describeArtifact(group.artifact);
    return (
      <a
        href={d.href}
        target="_blank"
        rel="noreferrer noopener"
        className={`flex items-center justify-between gap-3 rounded-[var(--radius-card)] border bg-bg-surface px-3 py-2 text-[12px] hover:[filter:drop-shadow(0_0_4px_currentColor)] ${AGENT_TONE[group.agent]} border-l-4`}
        style={{ borderColor: `var(${d.chainColorVar})`, color: `var(${d.chainColorVar})` }}
      >
        <span className="[overflow-wrap:anywhere] min-w-0 break-all font-[family-name:var(--font-mono)]">
          {d.primaryText}
        </span>
        <span className="shrink-0 text-fg-tertiary">{d.kindLabel}</span>
      </a>
    );
  }
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-fg-secondary ${AGENT_TONE[group.agent]}`}
    >
      {group.agent} · {group.artifact.kind}
    </div>
  );
}

function ThinkingRow({
  group,
}: {
  group: Extract<BrainChatGroup, { kind: 'assistant-delta' }>;
}): ReactElement {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 text-[12px] italic ${AGENT_TONE[group.agent]}`}
    >
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        {group.agent} · thinking
      </span>
      <p className="[overflow-wrap:anywhere] break-all text-fg-secondary">{group.text}</p>
    </div>
  );
}

function GroupRow({ group }: { group: BrainChatGroup }): ReactElement {
  switch (group.kind) {
    case 'assistant-delta':
      return <ThinkingRow group={group} />;
    case 'persona-log':
      return <PersonaLogRow group={group} />;
    case 'persona-artifact':
      return <PersonaArtifactRow group={group} />;
    case 'tool-use':
      if (group.agent === 'brain') {
        return <BrainToolUseGroup group={group} />;
      }
      return <PersonaToolUseRow group={group} />;
  }
}

/**
 * Final assistant text — Markdown-rendered via react-markdown + remark-gfm.
 * We scope the styles under `.brain-chat-markdown` in globals.css so heading
 * sizes, list padding, and code-block borders match the Terminal Cyber
 * theme without leaking to other surfaces.
 */
function AssistantMarkdown({ content }: { content: string }): ReactElement {
  return (
    <div className="brain-chat-markdown font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.5] text-fg-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function AssistantBubble({ turn }: { turn: BrainChatTurn }): ReactElement {
  const events = turn.brainEvents ?? [];
  const groups = groupBrainChatEvents(events);
  const isEmpty = turn.content === '' && groups.length === 0;

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
      {/* Nested work log first: tool-use scopes, persona logs, artifacts,
          thinking rows. This is the Memind's "how" surface and lives ABOVE
          the final reply so the reader's eye lands on the Markdown answer
          last (UAT fix #3). */}
      {groups.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {groups.map((g, i) => (
            <GroupRow key={`${turn.id}-g-${i.toString()}-${g.kind}`} group={g} />
          ))}
        </div>
      ) : null}
      {turn.content !== '' ? <AssistantMarkdown content={turn.content} /> : null}
    </div>
  );
}

export function BrainChatMessage({ turn }: BrainChatMessageProps): ReactElement {
  if (turn.role === 'user') {
    return <UserBubble turn={turn} />;
  }
  return <AssistantBubble turn={turn} />;
}
