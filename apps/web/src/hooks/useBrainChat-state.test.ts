/**
 * Red tests for the pure reducer behind `useBrainChat` (BRAIN-P4 Task 1).
 *
 * This repo runs vitest in the node environment (no jsdom, no RTL — see
 * apps/web/vitest.config.ts). To stay testable, the hook's event-aggregation
 * logic lives in pure functions on `useBrainChat-state.ts`:
 *
 *   - buildUserTurn(id, content)               → new user BrainChatTurn
 *   - buildAssistantTurn(id)                   → empty assistant turn
 *   - applyAssistantDelta(turn, payload)       → append delta / nested event
 *   - applyToolUseStart(turn, payload)         → append tool-use-start event
 *   - applyToolUseEnd(turn, payload)           → append tool-use-end event
 *   - applyPersonaLog(turn, logEvent)          → append persona-log event
 *   - applyPersonaArtifact(turn, artifact)     → append persona-artifact event
 *   - turnToApiMessage(turn)                   → ChatMessage payload shape
 *
 * The hook wires these into `setState(prev => ...)` callbacks; tests cover
 * the reducers without needing React, EventSource, or fetch.
 *
 * Four user-visible scenarios from the brief:
 *   1. `send` primitive — building the user turn + normalising to API payload
 *   2. `assistant:delta` (agent='brain') accumulates into the assistant turn content
 *   3. nested persona `tool_use:start` (agent='creator') → brainEvents (not content)
 *   4. `reset` contract (empty initial state shape)
 */
import { describe, it, expect } from 'vitest';
import type {
  Artifact,
  AssistantDeltaEventPayload,
  LogEvent,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import {
  applyAssistantDelta,
  applyPersonaArtifact,
  applyPersonaLog,
  applyToolUseEnd,
  applyToolUseStart,
  buildAssistantTurn,
  buildUserTurn,
  EMPTY_BRAIN_CHAT_STATE,
  turnToApiMessage,
  type BrainChatTurn,
} from './useBrainChat-state.js';

function assistantDelta(
  agent: AssistantDeltaEventPayload['agent'],
  delta: string,
): AssistantDeltaEventPayload {
  return { agent, delta, ts: '2026-04-19T00:00:00.000Z' };
}

function toolUseStart(
  agent: ToolUseStartEventPayload['agent'],
  toolName: string,
  toolUseId: string,
  input: Record<string, unknown> = {},
): ToolUseStartEventPayload {
  return { agent, toolName, toolUseId, input, ts: '2026-04-19T00:00:00.000Z' };
}

function toolUseEnd(
  agent: ToolUseEndEventPayload['agent'],
  toolName: string,
  toolUseId: string,
  output: Record<string, unknown> = {},
  isError = false,
): ToolUseEndEventPayload {
  return { agent, toolName, toolUseId, output, isError, ts: '2026-04-19T00:00:00.000Z' };
}

function logEvent(agent: LogEvent['agent'], tool: string, message: string): LogEvent {
  return {
    ts: '2026-04-19T00:00:00.000Z',
    agent,
    tool,
    level: 'info',
    message,
  };
}

describe('EMPTY_BRAIN_CHAT_STATE', () => {
  it('starts with no turns and idle status', () => {
    expect(EMPTY_BRAIN_CHAT_STATE.turns).toEqual([]);
    expect(EMPTY_BRAIN_CHAT_STATE.status).toBe('idle');
    expect(EMPTY_BRAIN_CHAT_STATE.errorMessage).toBeNull();
  });
});

describe('buildUserTurn + turnToApiMessage — send primitive (scenario 1)', () => {
  it('constructs a user turn with id + content and normalises to API ChatMessage', () => {
    const turn = buildUserTurn('u1', 'Launch a meme about BNB Chain 2026.');
    expect(turn.role).toBe('user');
    expect(turn.id).toBe('u1');
    expect(turn.content).toBe('Launch a meme about BNB Chain 2026.');
    expect(turn.brainEvents).toBeUndefined();
    expect(turnToApiMessage(turn)).toEqual({
      role: 'user',
      content: 'Launch a meme about BNB Chain 2026.',
    });
  });

  it('normalises an assistant turn to the API ChatMessage shape (UAT multi-turn regression)', () => {
    // The hook's `send` path `[...priorTurns, userTurn].map(turnToApiMessage)`
    // is the pipeline that produces the `messages` array POSTed to the
    // server. Assistant turns carry the Brain's finished Markdown reply in
    // `content`; the API consumer (server runtime) treats this as real
    // multi-turn history so the LLM can reread prior factual outputs
    // (deployed addresses, CIDs, tweet URLs). This test pins the shape so
    // a future reducer refactor cannot silently drop the assistant content
    // from the wire payload, re-introducing the "brain forgets" bug.
    const assistant: BrainChatTurn = {
      id: 'a1',
      role: 'assistant',
      content: 'Deployed HBNB2026-CHAIN at 0xabc.',
      brainEvents: [],
    };
    expect(turnToApiMessage(assistant)).toEqual({
      role: 'assistant',
      content: 'Deployed HBNB2026-CHAIN at 0xabc.',
    });
  });
});

describe('applyAssistantDelta — brain agent accumulates into content (scenario 2)', () => {
  it('appends a brain delta to the assistant turn content', () => {
    const turn = buildAssistantTurn('a1');
    const after = applyAssistantDelta(turn, assistantDelta('brain', 'Deploying '));
    expect(after.content).toBe('Deploying ');
    const after2 = applyAssistantDelta(after, assistantDelta('brain', 'token...'));
    expect(after2.content).toBe('Deploying token...');
    // brainEvents should remain empty — brain deltas belong to `content`.
    expect(after2.brainEvents).toEqual([]);
  });

  it('routes persona deltas (agent != brain) into brainEvents instead of content', () => {
    const turn = buildAssistantTurn('a1');
    const after = applyAssistantDelta(turn, assistantDelta('creator', 'thinking...'));
    // Content stays empty because creator's delta is a persona-level log, not
    // the Brain's own reply text.
    expect(after.content).toBe('');
    expect(after.brainEvents).toHaveLength(1);
    const event = after.brainEvents![0]!;
    expect(event.kind).toBe('assistant-delta');
    if (event.kind === 'assistant-delta') {
      expect(event.agent).toBe('creator');
      expect(event.delta).toBe('thinking...');
    }
  });
});

describe('applyToolUseStart / applyToolUseEnd — nested persona events (scenario 3)', () => {
  it('records a brain tool_use:start as a top-level brainEvent', () => {
    const turn = buildAssistantTurn('a1');
    const after = applyToolUseStart(
      turn,
      toolUseStart('brain', 'invoke_creator', 'tu-1', { theme: 'BNB 2026' }),
    );
    expect(after.brainEvents).toHaveLength(1);
    const event = after.brainEvents![0]!;
    expect(event.kind).toBe('tool-use-start');
    if (event.kind === 'tool-use-start') {
      expect(event.agent).toBe('brain');
      expect(event.toolName).toBe('invoke_creator');
      expect(event.toolUseId).toBe('tu-1');
      expect(event.input).toEqual({ theme: 'BNB 2026' });
    }
  });

  it('records a nested persona tool_use:start (agent=creator) as a persona event', () => {
    const turn = buildAssistantTurn('a1');
    const after = applyToolUseStart(turn, toolUseStart('creator', 'narrative_generator', 'tu-2'));
    expect(after.brainEvents).toHaveLength(1);
    const event = after.brainEvents![0]!;
    expect(event.kind).toBe('tool-use-start');
    if (event.kind === 'tool-use-start') {
      expect(event.agent).toBe('creator');
      expect(event.toolName).toBe('narrative_generator');
    }
  });

  it('records tool_use:end alongside its matching start entry', () => {
    let turn: BrainChatTurn = buildAssistantTurn('a1');
    turn = applyToolUseStart(turn, toolUseStart('brain', 'invoke_creator', 'tu-1'));
    turn = applyToolUseEnd(
      turn,
      toolUseEnd('brain', 'invoke_creator', 'tu-1', { tokenAddr: '0xabc' }, false),
    );
    expect(turn.brainEvents).toHaveLength(2);
    const endEvent = turn.brainEvents![1]!;
    expect(endEvent.kind).toBe('tool-use-end');
    if (endEvent.kind === 'tool-use-end') {
      expect(endEvent.agent).toBe('brain');
      expect(endEvent.toolUseId).toBe('tu-1');
      expect(endEvent.output).toEqual({ tokenAddr: '0xabc' });
      expect(endEvent.isError).toBe(false);
    }
  });
});

describe('applyPersonaLog / applyPersonaArtifact — nested persona streams', () => {
  it('records a persona log event (agent=creator)', () => {
    const turn = buildAssistantTurn('a1');
    const after = applyPersonaLog(
      turn,
      logEvent('creator', 'onchain_deployer', 'submitting deploy tx'),
    );
    expect(after.brainEvents).toHaveLength(1);
    const event = after.brainEvents![0]!;
    expect(event.kind).toBe('persona-log');
    if (event.kind === 'persona-log') {
      expect(event.agent).toBe('creator');
      expect(event.tool).toBe('onchain_deployer');
      expect(event.message).toBe('submitting deploy tx');
      expect(event.level).toBe('info');
    }
  });

  it('records a persona artifact event (e.g. lore-cid)', () => {
    const turn = buildAssistantTurn('a1');
    const artifact: Artifact = {
      kind: 'lore-cid',
      cid: 'bafylore',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafylore',
      author: 'narrator',
      chapterNumber: 2,
    };
    const after = applyPersonaArtifact(turn, artifact, 'narrator');
    expect(after.brainEvents).toHaveLength(1);
    const event = after.brainEvents![0]!;
    expect(event.kind).toBe('persona-artifact');
    if (event.kind === 'persona-artifact') {
      expect(event.agent).toBe('narrator');
      expect(event.artifact).toBe(artifact);
    }
  });
});

describe('reset contract (scenario 4)', () => {
  it('EMPTY_BRAIN_CHAT_STATE is the canonical reset target', () => {
    // The hook's reset() pushes EMPTY_BRAIN_CHAT_STATE into setState; this
    // test pins the shape so a future change to the state surface either
    // updates the empty singleton consciously or breaks loudly.
    expect(EMPTY_BRAIN_CHAT_STATE).toEqual({
      turns: [],
      status: 'idle',
      errorMessage: null,
    });
  });
});
