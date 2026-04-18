/**
 * Timeline merge — pure projection used by TimelineView (V2-P4 Tasks 4 + 6).
 *
 * Inputs come straight from useRun:
 *   - `logs`     LogEvent[]                 (each carries an ISO `ts`)
 *   - `artifacts` Artifact[]                (no ts; we use append index as the
 *                                           ordering hint and bias them to the
 *                                           latest log timestamp known so far)
 *   - `toolCalls` ToolCallsByAgent          (each ToolCallState bears an
 *                                           opaque id; we did not record ts in
 *                                           the reducer — see note below)
 *
 * The merge produces a single chronologically ordered `TimelineItem[]` list
 * the view can render top-to-bottom.
 *
 * Time ordering rules:
 *   1. `log` events have an authoritative `ts` and are sorted lexicographically
 *      (ISO-8601 strings sort identically to Date order).
 *   2. `tool_use` items inherit the timestamp of the *running* (start) entry
 *      from the LogEvent that the runtime emits alongside `tool_use:start`,
 *      via a lookup keyed by `toolUseId` if present in any log meta. When no
 *      such lookup hits, the item gets a synthetic ts that places it just
 *      after the latest log seen so far so the bubble shows up in the right
 *      neighbourhood without breaking sort.
 *   3. `artifact` items have no ts; they are appended in arrival order and
 *      assigned synthetic ts as the latest known timestamp + a tiny epsilon so
 *      they consistently follow the run-final logs.
 *
 * 200-item cap is applied LAST: if the merged list exceeds the cap we keep the
 * latest N items and report `truncatedCount` (number dropped from the head).
 */
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { ToolCallsByAgent, ToolCallState } from '../hooks/useRun-state';

export const TIMELINE_MAX_ITEMS = 200;

export type TimelineItem =
  | { kind: 'log'; ts: string; key: string; agent: LogEvent['agent']; event: LogEvent }
  | {
      kind: 'tool_use';
      ts: string;
      key: string;
      agent: keyof ToolCallsByAgent;
      call: ToolCallState;
    }
  | { kind: 'artifact'; ts: string; key: string; artifact: Artifact };

export interface TimelineMergeResult {
  items: TimelineItem[];
  truncatedCount: number;
}

export interface TimelineMergeInput {
  logs: LogEvent[];
  artifacts: Artifact[];
  toolCalls: ToolCallsByAgent;
}

/**
 * Build a stable, deduplicating key for an Artifact so React's reconciliation
 * stays calm even though the upstream array is append-only and we re-merge
 * on every render.
 */
function artifactKey(a: Artifact, index: number): string {
  switch (a.kind) {
    case 'bsc-token':
      return `bsc-token:${a.address}`;
    case 'token-deploy-tx':
      return `token-deploy-tx:${a.txHash}`;
    case 'lore-cid':
      return `lore-cid:${a.author}:${a.cid}`;
    case 'x402-tx':
      return `x402-tx:${a.txHash}`;
    case 'tweet-url':
      return `tweet-url:${a.tweetId}`;
    case 'meme-image':
      return `meme-image:${a.cid ?? `failed:${index.toString()}`}`;
    case 'heartbeat-tick':
      return `heartbeat-tick:${a.tickNumber.toString()}`;
    case 'heartbeat-decision':
      return `heartbeat-decision:${a.tickNumber.toString()}:${a.action}`;
    case 'lore-anchor':
      // `anchorId` is already `${tokenAddr-lower}-${chapterNumber}`, so it is
      // unique across rewrites of the same chapter for the same token and
      // stable enough for React reconciliation.
      return `lore-anchor:${a.anchorId}`;
  }
}

/**
 * Synthesize an ISO timestamp ordering value for items that don't carry one.
 * We add a microsecond-scale offset so two items synthesised in the same call
 * keep their input order. The offset is encoded as the trailing fractional
 * digits of the ms field (still a valid ISO timestamp because we just write
 * the resulting Date back out).
 */
function syntheticTs(base: string, offsetMs: number): string {
  const t = Date.parse(base);
  if (Number.isNaN(t)) {
    // Fallback: use base unchanged + a stable suffix so sort still picks it up
    // deterministically.
    return base + `\u0001${offsetMs.toString().padStart(6, '0')}`;
  }
  return new Date(t + offsetMs).toISOString();
}

export function mergeTimeline(input: TimelineMergeInput): TimelineMergeResult {
  const items: TimelineItem[] = [];

  // 1. Log events first; they are the authoritative timeline backbone.
  for (let i = 0; i < input.logs.length; i += 1) {
    const e = input.logs[i];
    if (!e) continue;
    items.push({
      kind: 'log',
      ts: e.ts,
      key: `log:${e.ts}:${i.toString()}`,
      agent: e.agent,
      event: e,
    });
  }

  // 2. Tool calls. We bias them slightly forward of the latest log seen so far
  //    so they slot in around the LogEvent the runtime emits alongside tool
  //    invocations. Without per-call ts the next-best option is "just after
  //    the previous log".
  const sortedLogs = [...input.logs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const latestLogTs =
    sortedLogs.length > 0
      ? (sortedLogs[sortedLogs.length - 1]?.ts ?? '1970-01-01T00:00:00.000Z')
      : '1970-01-01T00:00:00.000Z';
  let toolOffset = 1;
  for (const agent of Object.keys(input.toolCalls) as (keyof ToolCallsByAgent)[]) {
    const calls = input.toolCalls[agent];
    for (const c of calls) {
      items.push({
        kind: 'tool_use',
        ts: syntheticTs(latestLogTs, toolOffset),
        key: `tool:${agent}:${c.id}`,
        agent,
        call: c,
      });
      toolOffset += 1;
    }
  }

  // 3. Artifacts last. They land after both logs and tool calls so the row of
  //    "the run produced this" hashes shows up at the end of each phase
  //    cluster. Append-order preserved within the artifact group.
  let artifactOffset = 1000; // headroom: artifacts always after tool calls
  for (let i = 0; i < input.artifacts.length; i += 1) {
    const a = input.artifacts[i];
    if (!a) continue;
    items.push({
      kind: 'artifact',
      ts: syntheticTs(latestLogTs, artifactOffset),
      key: `artifact:${artifactKey(a, i)}`,
      artifact: a,
    });
    artifactOffset += 1;
  }

  // Final lexical ts sort. ISO-8601 + our synthetic offsets keep sort stable
  // and chronologically meaningful.
  items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // Truncation: keep only the latest TIMELINE_MAX_ITEMS entries. The "early N
  // items folded" banner uses the returned `truncatedCount`.
  if (items.length > TIMELINE_MAX_ITEMS) {
    const dropped = items.length - TIMELINE_MAX_ITEMS;
    return { items: items.slice(dropped), truncatedCount: dropped };
  }
  return { items, truncatedCount: 0 };
}
