/**
 * Pure grouping helpers for `<BrainChatMessage />` — BRAIN-UAT Fix #1 / #2.
 *
 * The raw brainEvents stream is a flat, per-SSE-event list (one entry per
 * `assistant:delta` chunk, one per runtime log line, one per tool start /
 * end). Rendering that directly produces 50+ "bubbles" per launch flow — the
 * UAT screenshot problem. Chat UIs want to collapse the stream into a small
 * handful of visual rows:
 *
 *   1. Consecutive `assistant-delta` events from the same agent → one merged
 *      "thinking" row whose text is the concatenated delta (so a long stream
 *      of Brain / persona thought tokens becomes ONE bubble that appears to
 *      type itself).
 *   2. Consecutive `persona-log` events with the same agent+tool → one row
 *      whose message is the most-recent line (older lines get dropped because
 *      they are runtime noise, e.g. `loop start` → `turn 1` → `stop_reason`).
 *      Tests pin the "agent + tool" key so an interleaved tool switch opens a
 *      fresh row.
 *   3. Runtime noise (agent=brain, tool='runtime') → dropped entirely. These
 *      are the Brain's internal SDK loop chatter ("loop start", "turn N
 *      requesting completion") which the user never wants to see.
 *   4. A `tool-use-start` with agent='brain' opens a nested scope. Every
 *      subsequent persona event (agent != brain) until the matching
 *      `tool-use-end` is folded INTO that scope as children so the renderer
 *      can draw a single collapsible "Creator → narrative_generator ok →
 *      meme_image_creator ok → …" block. Events with no enclosing brain
 *      tool-use-start stay at the top level (e.g. pure runtime artifacts the
 *      Brain emits between tool calls).
 *
 * The function is pure — no React, no DOM. Tests cover every collapse rule
 * in `brain-chat-message-group.test.ts`.
 */
import type { BrainChatEvent } from '@/hooks/useBrainChat-state';

/**
 * A grouped renderable row. The renderer iterates this list and draws one
 * element per entry (plus recursively renders `children` for tool-use
 * groups).
 */
export type BrainChatGroup =
  | {
      readonly kind: 'assistant-delta';
      readonly agent: BrainChatEvent extends { agent: infer A } ? A : never;
      /** Merged delta text across the consecutive run. */
      readonly text: string;
    }
  | {
      readonly kind: 'persona-log';
      readonly agent: BrainChatEvent extends { agent: infer A } ? A : never;
      readonly tool: string;
      readonly message: string;
      readonly level: 'debug' | 'info' | 'warn' | 'error';
    }
  | {
      readonly kind: 'persona-artifact';
      readonly agent: BrainChatEvent extends { agent: infer A } ? A : never;
      readonly artifact: Extract<BrainChatEvent, { kind: 'persona-artifact' }>['artifact'];
    }
  | {
      readonly kind: 'tool-use';
      readonly agent: BrainChatEvent extends { agent: infer A } ? A : never;
      readonly toolName: string;
      readonly toolUseId: string;
      readonly input: Record<string, unknown>;
      /**
       * `null` while the tool is still running (no matching end event yet).
       * `{ isError, output }` once the tool-use-end arrived.
       */
      readonly end: {
        readonly isError: boolean;
        readonly output: Record<string, unknown>;
      } | null;
      readonly children: readonly BrainChatGroup[];
    };

/**
 * True if a log event is runtime noise we never surface to the user. Runtime
 * logs come from the Brain SDK loop itself ("loop start", "turn 1 requesting
 * completion", "turn 1 stop_reason=tool_use") and carry no product value —
 * they are the UAT #2 ask.
 */
export function isRuntimeNoise(event: Extract<BrainChatEvent, { kind: 'persona-log' }>): boolean {
  if (event.agent === 'brain' && event.tool === 'runtime') return true;
  // A couple of debug-level ops logs (e.g. "flushed buffer") are also noise —
  // we only keep info/warn/error runtime output from personas. Personas never
  // use tool='runtime', so this branch fires only for future instrumentation.
  return false;
}

/**
 * Group a flat BrainChatEvent stream into the compact render model described
 * in the module doc. The algorithm is a single linear pass with a small
 * top-level buffer and an optional "current open brain tool-use" scope; the
 * grouping is O(n) in events.
 */
export function groupBrainChatEvents(events: readonly BrainChatEvent[]): readonly BrainChatGroup[] {
  const top: BrainChatGroup[] = [];
  // Index of the currently-open brain tool-use group in `top`, or `-1` for
  // "no enclosing scope". We mutate the group's `children` array in place
  // during the pass; once the matching tool-use-end arrives we close it.
  let openToolIdx = -1;
  // Mutable shadow of the open tool-use's children (so we can push into it
  // without rebuilding the immutable struct on every event).
  let openChildren: BrainChatGroup[] | null = null;

  const push = (group: BrainChatGroup): void => {
    if (openChildren !== null) {
      openChildren.push(group);
      return;
    }
    top.push(group);
  };

  /**
   * Return the last group we appended into the current scope (top or nested
   * tool children), so we can decide whether to merge into it.
   */
  const tail = (): BrainChatGroup | null => {
    const list = openChildren ?? top;
    if (list.length === 0) return null;
    return list[list.length - 1] ?? null;
  };

  /**
   * Replace the last group in the current scope. Used by the merge path so we
   * rewrite `tail` with an updated version (text accumulated, message updated)
   * without mutating the previous object.
   */
  const replaceTail = (next: BrainChatGroup): void => {
    const list = openChildren ?? top;
    if (list.length === 0) return;
    list[list.length - 1] = next;
  };

  for (const event of events) {
    switch (event.kind) {
      case 'assistant-delta': {
        const last = tail();
        if (last !== null && last.kind === 'assistant-delta' && last.agent === event.agent) {
          replaceTail({
            kind: 'assistant-delta',
            agent: event.agent,
            text: last.text + event.delta,
          });
        } else {
          push({
            kind: 'assistant-delta',
            agent: event.agent,
            text: event.delta,
          });
        }
        break;
      }
      case 'persona-log': {
        if (isRuntimeNoise(event)) break;
        const last = tail();
        if (
          last !== null &&
          last.kind === 'persona-log' &&
          last.agent === event.agent &&
          last.tool === event.tool
        ) {
          // Same persona+tool in a row → keep the latest message only. Older
          // lines are typically progress noise ("turn 1", "turn 2") that the
          // last line already supersedes.
          replaceTail({
            kind: 'persona-log',
            agent: event.agent,
            tool: event.tool,
            message: event.message,
            level: event.level,
          });
        } else {
          push({
            kind: 'persona-log',
            agent: event.agent,
            tool: event.tool,
            message: event.message,
            level: event.level,
          });
        }
        break;
      }
      case 'persona-artifact': {
        push({
          kind: 'persona-artifact',
          agent: event.agent,
          artifact: event.artifact,
        });
        break;
      }
      case 'tool-use-start': {
        if (event.agent === 'brain') {
          // Open a new top-level brain tool-use scope.
          const children: BrainChatGroup[] = [];
          const group: BrainChatGroup = {
            kind: 'tool-use',
            agent: event.agent,
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            input: event.input,
            end: null,
            children,
          };
          top.push(group);
          openToolIdx = top.length - 1;
          openChildren = children;
        } else {
          // Persona-level tool-use (e.g. creator invoking narrative_generator)
          // → nest as a collapsed child of the currently open brain scope.
          // The renderer draws these as a single "tool ok" line (see Fix #2).
          push({
            kind: 'tool-use',
            agent: event.agent,
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            input: event.input,
            end: null,
            children: [],
          });
        }
        break;
      }
      case 'tool-use-end': {
        if (event.agent === 'brain' && openToolIdx !== -1) {
          const open = top[openToolIdx];
          if (open && open.kind === 'tool-use' && open.toolUseId === event.toolUseId) {
            top[openToolIdx] = {
              ...open,
              end: { isError: event.isError, output: event.output },
            };
            openToolIdx = -1;
            openChildren = null;
            break;
          }
        }
        // Persona tool-use-end or mismatched id → patch the matching open
        // nested group by scanning backwards in the active scope.
        const list = openChildren ?? top;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const candidate = list[i];
          if (
            candidate &&
            candidate.kind === 'tool-use' &&
            candidate.toolUseId === event.toolUseId &&
            candidate.end === null
          ) {
            list[i] = {
              ...candidate,
              end: { isError: event.isError, output: event.output },
            };
            break;
          }
        }
        break;
      }
    }
  }

  return top;
}
