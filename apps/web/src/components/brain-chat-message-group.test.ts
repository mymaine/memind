/**
 * Pure tests for `groupBrainChatEvents` — the UAT bubble-compression pass.
 *
 * Scenarios pinned:
 *   1. Consecutive assistant-delta events from the same agent merge into a
 *      single thinking row whose text is concatenated.
 *   2. Consecutive persona-log events with same agent+tool collapse to the
 *      most-recent message (older runtime progress lines are dropped).
 *   3. Runtime noise (agent=brain, tool='runtime') is filtered out entirely.
 *   4. A brain tool-use-start opens a scope; persona events between it and
 *      the matching tool-use-end nest under its `children`.
 *   5. A persona tool-use (agent=creator) nested inside a brain scope lands
 *      in children as its own compact row.
 *   6. tool-use-end marks the open tool-use group finished (`end !== null`).
 *   7. Artifacts always render as their own row and never merge.
 *   8. Two back-to-back brain tool-use scopes do NOT nest inside each other —
 *      each closes cleanly before the next opens.
 */
import { describe, it, expect } from 'vitest';
import type { Artifact } from '@hack-fourmeme/shared';
import type { BrainChatEvent } from '@/hooks/useBrainChat-state';
import { groupBrainChatEvents, isRuntimeNoise } from './brain-chat-message-group';

function delta(
  agent: BrainChatEvent extends { agent: infer A } ? A : never,
  text: string,
): BrainChatEvent {
  return { kind: 'assistant-delta', agent, delta: text };
}

function log(
  agent: BrainChatEvent extends { agent: infer A } ? A : never,
  tool: string,
  message: string,
  level: 'debug' | 'info' | 'warn' | 'error' = 'info',
): BrainChatEvent {
  return { kind: 'persona-log', agent, tool, message, level };
}

function toolStart(
  agent: BrainChatEvent extends { agent: infer A } ? A : never,
  toolName: string,
  toolUseId: string,
  input: Record<string, unknown> = {},
): BrainChatEvent {
  return { kind: 'tool-use-start', agent, toolName, toolUseId, input };
}

function toolEnd(
  agent: BrainChatEvent extends { agent: infer A } ? A : never,
  toolName: string,
  toolUseId: string,
  isError = false,
  output: Record<string, unknown> = {},
): BrainChatEvent {
  return { kind: 'tool-use-end', agent, toolName, toolUseId, output, isError };
}

describe('groupBrainChatEvents — thinking merge (scenario 1)', () => {
  it('merges consecutive same-agent assistant-delta events into one row', () => {
    const groups = groupBrainChatEvents([
      delta('brain', 'Deploy'),
      delta('brain', 'ing '),
      delta('brain', 'token…'),
    ]);
    expect(groups).toHaveLength(1);
    const first = groups[0]!;
    expect(first.kind).toBe('assistant-delta');
    if (first.kind === 'assistant-delta') {
      expect(first.text).toBe('Deploying token…');
      expect(first.agent).toBe('brain');
    }
  });

  it('splits merged rows when the agent switches mid-stream', () => {
    const groups = groupBrainChatEvents([
      delta('creator', 'stanza 1 '),
      delta('creator', 'stanza 2'),
      delta('narrator', 'chapter 1'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kind).toBe('assistant-delta');
    expect(groups[1]!.kind).toBe('assistant-delta');
    if (groups[0]!.kind === 'assistant-delta') expect(groups[0]!.agent).toBe('creator');
    if (groups[1]!.kind === 'assistant-delta') expect(groups[1]!.agent).toBe('narrator');
  });
});

describe('groupBrainChatEvents — persona log dedup (scenario 2)', () => {
  it('collapses consecutive same-agent+tool logs to the most-recent message', () => {
    const groups = groupBrainChatEvents([
      log('creator', 'onchain_deployer', 'preparing tx'),
      log('creator', 'onchain_deployer', 'waiting for receipt'),
      log('creator', 'onchain_deployer', 'tx confirmed 0xabc'),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('persona-log');
    if (g.kind === 'persona-log') {
      expect(g.message).toBe('tx confirmed 0xabc');
    }
  });

  it('opens a fresh row when the tool switches even for the same agent', () => {
    const groups = groupBrainChatEvents([
      log('creator', 'narrative_generator', 'drafting'),
      log('creator', 'meme_image_creator', 'uploading'),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('groupBrainChatEvents — runtime noise tagging (scenario 3)', () => {
  it('retains brain runtime logs but tags them as noise', () => {
    // Previously the grouping pass dropped these outright. The UX now keeps
    // them so the renderer can fold them into a details/summary toggle and
    // power users can still inspect the SDK loop chatter on demand.
    const groups = groupBrainChatEvents([
      log('brain', 'runtime', 'loop start'),
      log('brain', 'runtime', 'turn 1 requesting completion'),
      log('brain', 'runtime', 'turn 1 stop_reason=tool_use'),
    ]);
    // Consecutive same-agent+tool still collapse to the most-recent line.
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('persona-log');
    if (g.kind === 'persona-log') {
      expect(g.isRuntimeNoise).toBe(true);
      expect(g.tool).toBe('runtime');
      expect(g.message).toBe('turn 1 stop_reason=tool_use');
    }
  });

  it('tags persona runtime logs as noise too (creator/narrator/heartbeat)', () => {
    // Persona runtime loops emit the same SDK chatter under their own agent
    // attribution; we collapse them alongside the brain variant rather than
    // playing an agent whitelist.
    const groups = groupBrainChatEvents([
      log('brain', 'chat', 'replying'),
      log('creator', 'runtime', 'loop start'),
    ]);
    expect(groups).toHaveLength(2);
    const first = groups[0]!;
    const second = groups[1]!;
    expect(first.kind).toBe('persona-log');
    if (first.kind === 'persona-log') expect(first.isRuntimeNoise).toBe(false);
    expect(second.kind).toBe('persona-log');
    if (second.kind === 'persona-log') expect(second.isRuntimeNoise).toBe(true);
  });

  it('never collapses a runtime-noise row into a non-runtime persona log', () => {
    // The dedup path keys on `agent + tool + isRuntimeNoise`. A real
    // persona log immediately followed by a runtime-tool log must surface
    // as two rows so the UI can fold the noise one separately.
    const groups = groupBrainChatEvents([
      log('creator', 'lore_writer', 'pinning chapter 1'),
      log('creator', 'runtime', 'loop start'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('isRuntimeNoise helper pins the filter key (any agent + tool=runtime)', () => {
    expect(
      isRuntimeNoise({
        kind: 'persona-log',
        agent: 'brain',
        tool: 'runtime',
        message: 'loop start',
        level: 'info',
      }),
    ).toBe(true);
    expect(
      isRuntimeNoise({
        kind: 'persona-log',
        agent: 'creator',
        tool: 'runtime',
        message: 'loop start',
        level: 'info',
      }),
    ).toBe(true);
    expect(
      isRuntimeNoise({
        kind: 'persona-log',
        agent: 'creator',
        tool: 'lore_writer',
        message: 'x',
        level: 'info',
      }),
    ).toBe(false);
  });
});

describe('groupBrainChatEvents — brain tool-use scope (scenario 4/6)', () => {
  it('nests persona events between brain tool-use-start/end into children', () => {
    const groups = groupBrainChatEvents([
      toolStart('brain', 'invoke_creator', 'tu-1', { theme: 'BNB' }),
      log('creator', 'narrative_generator', 'done'),
      log('creator', 'meme_image_creator', 'done'),
      toolEnd('brain', 'invoke_creator', 'tu-1', false, { tokenAddr: '0xabc' }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('tool-use');
    if (g.kind === 'tool-use') {
      expect(g.agent).toBe('brain');
      expect(g.toolName).toBe('invoke_creator');
      expect(g.end).not.toBeNull();
      expect(g.end?.isError).toBe(false);
      expect(g.children).toHaveLength(2);
      expect(g.children[0]!.kind).toBe('persona-log');
      expect(g.children[1]!.kind).toBe('persona-log');
    }
  });
});

describe('groupBrainChatEvents — persona tool-use nested (scenario 5)', () => {
  it('puts a persona tool-use as a compact row inside the open brain scope', () => {
    const groups = groupBrainChatEvents([
      toolStart('brain', 'invoke_creator', 'tu-1'),
      toolStart('creator', 'narrative_generator', 'tu-sub-1'),
      toolEnd('creator', 'narrative_generator', 'tu-sub-1', false),
      toolEnd('brain', 'invoke_creator', 'tu-1', false),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('tool-use');
    if (g.kind === 'tool-use') {
      expect(g.children).toHaveLength(1);
      const sub = g.children[0]!;
      expect(sub.kind).toBe('tool-use');
      if (sub.kind === 'tool-use') {
        expect(sub.agent).toBe('creator');
        expect(sub.end).not.toBeNull();
        expect(sub.end?.isError).toBe(false);
      }
    }
  });
});

describe('groupBrainChatEvents — artifacts (scenario 7)', () => {
  it('emits artifacts as their own rows and never merges them', () => {
    const artifact: Artifact = {
      kind: 'lore-cid',
      cid: 'bafy1',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafy1',
      author: 'narrator',
      chapterNumber: 1,
    };
    const groups = groupBrainChatEvents([
      { kind: 'persona-artifact', agent: 'narrator', artifact },
      { kind: 'persona-artifact', agent: 'narrator', artifact },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kind).toBe('persona-artifact');
    expect(groups[1]!.kind).toBe('persona-artifact');
  });
});

describe('groupBrainChatEvents — back-to-back brain scopes (scenario 8)', () => {
  it('closes one scope before opening the next; they are siblings', () => {
    const groups = groupBrainChatEvents([
      toolStart('brain', 'invoke_creator', 'tu-1'),
      toolEnd('brain', 'invoke_creator', 'tu-1', false),
      toolStart('brain', 'invoke_narrator', 'tu-2'),
      toolEnd('brain', 'invoke_narrator', 'tu-2', false),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.kind).toBe('tool-use');
    expect(groups[1]!.kind).toBe('tool-use');
    if (groups[0]!.kind === 'tool-use') expect(groups[0]!.end).not.toBeNull();
    if (groups[1]!.kind === 'tool-use') expect(groups[1]!.end).not.toBeNull();
  });
});
