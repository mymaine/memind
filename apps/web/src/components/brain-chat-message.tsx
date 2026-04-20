/**
 * BrainChatMessage — per-turn renderer for the BrainChat transcript.
 *
 * Visual model after the UAT fixes:
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
import type { ComponentPropsWithoutRef, ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentId } from '@hack-fourmeme/shared';
import type { BrainChatTurn } from '@/hooks/useBrainChat-state';
import type { BrainChatGroup } from './brain-chat-message-group';
import { groupBrainChatEvents } from './brain-chat-message-group';
import { describeArtifact, isPillArtifact } from '@/lib/artifact-view';
import { PixelHumanGlyph } from './pixel-human-glyph';

/**
 * Size (px) for the inline work-mood mascot drawn next to pending tool-use
 * rows. Sized deliberately small (14px) so it reads as a loading affordance
 * beside the 11px mono labels without blowing out the line height — matches
 * the TopBar BrainIndicator size (16px) conceptually while nesting inside a
 * denser chat surface.
 */
const TOOL_USE_GLYPH_SIZE = 14;

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
 * users don't need to see the wire names, so we translate them.
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
      <p className="[overflow-wrap:anywhere] whitespace-pre-wrap break-all font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.5] text-fg-primary">
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
  const statusLabel = running ? 'running' : err ? 'error' : 'ok';
  const statusColor = running
    ? 'text-accent-text'
    : err
      ? 'text-[color:var(--color-danger)]'
      : 'text-accent-text';
  const completedIcon = err ? '⚠' : '✓';
  return (
    <div className="flex flex-col gap-1.5 self-start rounded-[var(--radius-card)] border border-accent bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-2 py-1.5">
      <div className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] text-accent-text">
        {/* Inline work-mood mascot replaces the static wrench icon while the
            tool-use is in flight so users get a visual heartbeat that the
            Memind is actually computing. Collapses to a green check / red
            warn once the matching tool-use-end arrives. */}
        {running ? (
          <PixelHumanGlyph
            size={TOOL_USE_GLYPH_SIZE}
            mood="work"
            ariaLabel={`invoking ${persona} persona`}
          />
        ) : (
          <span aria-hidden>🔧</span>
        )}
        <span>
          invoking {persona} persona{running ? '…' : ''}
        </span>
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
        {running ? (
          <PixelHumanGlyph
            size={TOOL_USE_GLYPH_SIZE}
            mood="work"
            ariaLabel={`${persona} persona running`}
          />
        ) : (
          <span aria-hidden>{completedIcon}</span>
        )}
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
  // final status so the bubble stays legible. While running we swap the
  // status slot for a work-mood pixel mascot so users get the same animated
  // loading affordance the outer brain scope uses (runtime logs are still
  // filtered upstream by `groupBrainChatEvents`).
  const label = group.toolName;
  const running = group.end === null;
  const ok = !running && !(group.end?.isError ?? false);
  const err = !running && (group.end?.isError ?? false);
  const completedMarker = ok ? '✓' : '✗';
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
      <span className={`ml-auto inline-flex items-center ${tone}`}>
        {running ? (
          <PixelHumanGlyph
            size={TOOL_USE_GLYPH_SIZE}
            mood="work"
            ariaLabel={`${group.agent} ${label} running`}
          />
        ) : (
          completedMarker
        )}
      </span>
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
  // UAT fix #1 (2026-04-20): surface generated meme PNGs as clickable
  // thumbnails inline in the bubble so users can preview the Creator's
  // output without opening the FooterDrawer. The pill still links to the
  // Pinata gateway in a new tab; `target="_blank"` + `rel` hardens the
  // external navigation against window.opener leaks.
  if (
    group.artifact.kind === 'meme-image' &&
    group.artifact.status === 'ok' &&
    group.artifact.gatewayUrl !== null
  ) {
    const img = group.artifact;
    const ipfsLabel = 'IPFS';
    const ipfsColorVar = '--color-chain-ipfs';
    return (
      <a
        href={img.gatewayUrl as string}
        target="_blank"
        rel="noreferrer noopener"
        className={`flex items-center gap-3 rounded-[var(--radius-card)] border bg-bg-surface px-2 py-2 text-[12px] hover:[filter:drop-shadow(0_0_4px_currentColor)] ${AGENT_TONE[group.agent]} border-l-4`}
        style={{ borderColor: `var(${ipfsColorVar})`, color: `var(${ipfsColorVar})` }}
      >
        <img
          src={img.gatewayUrl as string}
          alt={img.prompt ?? 'Generated meme'}
          className="h-20 w-20 shrink-0 rounded-[var(--radius-card)] border border-border-default object-cover"
          loading="lazy"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
            {ipfsLabel} · meme image
          </span>
          <span className="[overflow-wrap:anywhere] break-all font-[family-name:var(--font-sans-body)] text-fg-primary">
            {img.label ?? 'Generated meme'}
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[10px] text-fg-tertiary">
            click to enlarge
          </span>
        </div>
      </a>
    );
  }
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
 *
 * UAT fix (2026-04-20): every Markdown-authored link opens in a new tab via
 * `target="_blank"` + `rel="noopener noreferrer"` so clicking a BSCScan /
 * Pinata / explorer URL never navigates away from the live demo context.
 * The override is a react-markdown `components` map keyed on `a`.
 */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, ...rest }: ComponentPropsWithoutRef<'a'>) => (
    <a {...rest} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

function AssistantMarkdown({ content }: { content: string }): ReactElement {
  return (
    <div className="brain-chat-markdown font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.5] text-fg-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
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

/**
 * Short-form tokenAddr chip: `0xabcd…4444`. Keeps the bubble header legible
 * when multiple background heartbeat sessions are streaming in parallel.
 */
function shortenTokenAddr(addr: string): string {
  if (addr.length <= 11) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * HeartbeatBubble — distinct bubble for background Heartbeat tick events.
 *
 * Visual contract (per spec):
 *   - Left-aligned like the AssistantBubble (not right like user).
 *   - Accent-toned left border (matches `heartbeat` agent-tone).
 *   - Markdown-rendered `content` so tweet / IPFS links stay clickable.
 *   - Status chip reads `heartbeat · tick N/M` in mono font; the leading
 *     glyph encodes outcome (✓ success, ✗ error, ● idle, ⏹ auto-stop).
 *   - Short tokenAddr chip so users running multiple heartbeats can tell
 *     sessions apart at a glance.
 */
function HeartbeatBubble({ turn }: { turn: BrainChatTurn }): ReactElement {
  const heartbeat = turn.heartbeat;
  if (!heartbeat) {
    // Shouldn't happen — the dispatcher only routes turns of role='heartbeat'
    // here after buildHeartbeatTurn populated the payload. Render a minimal
    // placeholder so a malformed turn never crashes the transcript.
    return (
      <div data-role="heartbeat" className="mr-auto self-start">
        {turn.content}
      </div>
    );
  }
  const autoStopped = heartbeat.running === false;
  const icon = autoStopped
    ? '⏹'
    : !heartbeat.success
      ? '✗'
      : heartbeat.action === 'idle'
        ? '●'
        : '✓';
  const tone = !heartbeat.success ? 'text-[color:var(--color-danger)]' : 'text-accent-text';
  return (
    <div
      data-role="heartbeat"
      data-token-addr={heartbeat.tokenAddr}
      className={`mr-auto flex max-w-[90%] flex-col gap-2 self-start rounded-[var(--radius-card)] border border-border-default border-l-4 bg-bg-surface px-3 py-2 ${AGENT_TONE.heartbeat}`}
    >
      <div className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px]">
        <span className={`inline-flex items-center gap-1 ${tone}`}>
          <span aria-hidden>{icon}</span>
          <span>
            heartbeat · tick {heartbeat.tickNumber.toString()}/{heartbeat.maxTicks.toString()}
          </span>
        </span>
        <span className="rounded-[var(--radius-default)] border border-border-default px-1.5 py-0.5 text-fg-tertiary">
          {shortenTokenAddr(heartbeat.tokenAddr)}
        </span>
        {autoStopped ? <span className="text-fg-tertiary">auto-stopped</span> : null}
      </div>
      <AssistantMarkdown content={turn.content} />
    </div>
  );
}

export function BrainChatMessage({ turn }: BrainChatMessageProps): ReactElement {
  if (turn.role === 'user') {
    return <UserBubble turn={turn} />;
  }
  if (turn.role === 'heartbeat') {
    return <HeartbeatBubble turn={turn} />;
  }
  return <AssistantBubble turn={turn} />;
}
