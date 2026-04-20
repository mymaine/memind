/**
 * Pure tests for `groupBrainChatEvents` — the UAT bubble-compression pass.
 *
 * Scenarios pinned:
 *   1. Consecutive assistant-delta events from the same agent merge into a
 *      single thinking row whose text is concatenated.
 *   2. Consecutive persona-log events with same agent+tool collapse to the
 *      most-recent message (older runtime progress lines are dropped).
 *   3. Noise logs (SDK runtime chatter + executeToolBlock echo lines) are
 *      hidden from the grouped output entirely, while warn/error and genuine
 *      business logs pass through untouched.
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
import { groupBrainChatEvents } from './brain-chat-message-group';

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

describe('groupBrainChatEvents — noise hiding (scenario 3)', () => {
  it('drops info-level brain runtime logs entirely', () => {
    // SDK loop chatter ("loop start", "turn N requesting completion",
    // stop_reason lines) is pure debug noise — the left LogsDrawer still
    // streams the raw SSE for power users, so the transcript hides them.
    const groups = groupBrainChatEvents([
      log('brain', 'runtime', 'loop start', 'info'),
      log('brain', 'runtime', 'turn 1 requesting completion', 'debug'),
      log('brain', 'runtime', 'turn 1 stop_reason=tool_use', 'debug'),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('drops persona runtime logs too (creator/narrator/heartbeat)', () => {
    // Persona runtime loops emit the same SDK chatter under their own agent
    // attribution; we filter them alongside the brain variant.
    const groups = groupBrainChatEvents([
      log('creator', 'runtime', 'loop start', 'info'),
      log('narrator', 'runtime', 'turn 2 requesting completion', 'debug'),
      log('heartbeat', 'runtime', 'loop end stop_reason=end_turn', 'info'),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('keeps warn/error runtime logs so real failures stay visible', () => {
    // Consecutive same-agent+tool logs still collapse to the latest message
    // (scenario 2's dedup rule also applies to warn/error), so two
    // back-to-back errors on `brain/runtime` condense into one row whose
    // message is the most recent failure.
    const groups = groupBrainChatEvents([
      log('brain', 'runtime', 'stream failed: boom', 'error'),
      log('brain', 'runtime', 'loop exceeded maxTurns=8', 'error'),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('persona-log');
    if (g.kind === 'persona-log') {
      expect(g.tool).toBe('runtime');
      expect(g.level).toBe('error');
      expect(g.message).toBe('loop exceeded maxTurns=8');
    }
  });

  it('drops executeToolBlock echo logs (`invoke tool X` / `tool X ok`)', () => {
    // These info-level echoes are emitted by the runtime alongside the real
    // tool-use-start/end events — they duplicate the nested tool-use row and
    // add no information, so the grouping pass filters them out.
    const groups = groupBrainChatEvents([
      log('creator', 'narrative_generator', 'invoke tool narrative_generator', 'info'),
      log('creator', 'narrative_generator', 'tool narrative_generator ok', 'info'),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('keeps warn/error echo logs even though they match the echo pattern', () => {
    // Consistency rule: level-based escape hatch wins so a rare warn-level
    // "tool X ok" (e.g. tagged during an internal rate-limit path) still
    // surfaces rather than being swallowed by the echo filter.
    const groups = groupBrainChatEvents([
      log('creator', 'narrative_generator', 'tool narrative_generator ok', 'warn'),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('persona-log');
    if (g.kind === 'persona-log') {
      expect(g.level).toBe('warn');
    }
  });

  it('keeps business persona logs (e.g. narrator IPFS upload) untouched', () => {
    const groups = groupBrainChatEvents([
      log('narrator', 'lore_writer', 'uploaded to IPFS cid=bafy1', 'info'),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('persona-log');
    if (g.kind === 'persona-log') {
      expect(g.tool).toBe('lore_writer');
      expect(g.message).toBe('uploaded to IPFS cid=bafy1');
    }
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
