/**
 * Pure reducer that maps `useRun()` state into the LaunchPanel's visual
 * discriminated union (AC-P4.7-5).
 *
 * Input contract — the three signal sources the spec calls out:
 *   1. `artifacts`   — milestone markers (meme-image / lore-cid[narrator] /
 *                      x402-tx) drive the 3-step progression.
 *   2. `toolCalls`   — live "latest tool_use" label on the running state.
 *   3. `phase/error` — terminal transitions (done → success, error → error).
 *
 * `assistantText` and `logs` are accepted for input parity with
 * `derive-order-state` (the panel state machine does not consume them today,
 * but the signature stays symmetric so the two panels can share plumbing).
 *
 * The 3-step mapping is locked to the a2a orchestrator's real emit order
 * verified against apps/server/src/runs/a2a.ts + creator-phase.ts:
 *   Creator      ← meme-image arrives
 *   Narrator     ← lore-cid (author='narrator') arrives
 *   Market-maker ← x402-tx arrives
 *
 * A step is `done` once its signal artifact is present; it is `running` when
 * phase === 'running', its own signal has not arrived, and the preceding
 * step is `done` (the first step is `running` whenever phase === 'running'
 * and its signal has not arrived yet); otherwise it is `idle`.
 */
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { AssistantTextByAgent, ToolCallsByAgent } from '@/hooks/useRun-state';

export type StepStatus = 'idle' | 'running' | 'done';

export type LaunchPanelState =
  | { kind: 'idle' }
  | {
      kind: 'running';
      steps: { creator: StepStatus; narrator: StepStatus; marketMaker: StepStatus };
      latestToolUse: { agent: string; toolName: string } | null;
      memeImageArtifact: Extract<Artifact, { kind: 'meme-image' }> | null;
    }
  | {
      kind: 'success';
      memeImageArtifact: Extract<Artifact, { kind: 'meme-image' }> | null;
      bscTokenArtifact: Extract<Artifact, { kind: 'bsc-token' }> | null;
      deployTxArtifact: Extract<Artifact, { kind: 'token-deploy-tx' }> | null;
      creatorLoreArtifact: Extract<Artifact, { kind: 'lore-cid' }> | null;
      narratorLoreArtifact: Extract<Artifact, { kind: 'lore-cid' }> | null;
      x402TxArtifact: Extract<Artifact, { kind: 'x402-tx' }> | null;
    }
  | { kind: 'error'; message: string };

export interface DeriveLaunchInput {
  readonly phase: 'idle' | 'running' | 'done' | 'error';
  readonly artifacts: readonly Artifact[];
  readonly toolCalls: ToolCallsByAgent;
  readonly assistantText: AssistantTextByAgent;
  readonly logs: readonly LogEvent[];
  readonly error: string | null;
}

// Iteration order matches the natural a2a flow (creator → narrator →
// market-maker → heartbeat). Since `ToolCallState` does not carry a ts
// field, we infer "latest" by walking agents in flow order and taking the
// last entry of the last non-empty list — this matches the real SSE order
// because the server drives one agent at a time and each agent appends in
// arrival order.
const AGENT_FLOW_ORDER: readonly (keyof ToolCallsByAgent)[] = [
  'creator',
  'narrator',
  'market-maker',
  'heartbeat',
];

function findLatestToolUse(
  toolCalls: ToolCallsByAgent,
): { agent: string; toolName: string } | null {
  let latest: { agent: string; toolName: string } | null = null;
  for (const agent of AGENT_FLOW_ORDER) {
    const list = toolCalls[agent];
    const last = list.length > 0 ? list[list.length - 1] : undefined;
    if (last !== undefined) {
      latest = { agent, toolName: last.toolName };
    }
  }
  return latest;
}

function findArtifact<K extends Artifact['kind']>(
  artifacts: readonly Artifact[],
  kind: K,
  predicate?: (a: Extract<Artifact, { kind: K }>) => boolean,
): Extract<Artifact, { kind: K }> | null {
  for (const a of artifacts) {
    if (a.kind === kind) {
      const narrowed = a as Extract<Artifact, { kind: K }>;
      if (!predicate || predicate(narrowed)) {
        return narrowed;
      }
    }
  }
  return null;
}

export function deriveLaunchState(input: DeriveLaunchInput): LaunchPanelState {
  if (input.phase === 'idle') {
    return { kind: 'idle' };
  }

  if (input.phase === 'error') {
    return { kind: 'error', message: input.error ?? 'run failed' };
  }

  const memeImage = findArtifact(input.artifacts, 'meme-image');
  const narratorLore = findArtifact(input.artifacts, 'lore-cid', (a) => a.author === 'narrator');
  const x402Tx = findArtifact(input.artifacts, 'x402-tx');

  if (input.phase === 'done') {
    // Full / partial artifact set — every field is nullable so the panel can
    // render "pending" for the missing pill rather than crashing on the happy
    // path. Allowing nulls here means we never get stuck in a wedged state.
    return {
      kind: 'success',
      memeImageArtifact: memeImage,
      bscTokenArtifact: findArtifact(input.artifacts, 'bsc-token'),
      deployTxArtifact: findArtifact(input.artifacts, 'token-deploy-tx'),
      creatorLoreArtifact: findArtifact(input.artifacts, 'lore-cid', (a) => a.author === 'creator'),
      narratorLoreArtifact: narratorLore,
      x402TxArtifact: x402Tx,
    };
  }

  // phase === 'running'
  const creatorDone = memeImage !== null;
  const narratorDone = narratorLore !== null;
  const marketMakerDone = x402Tx !== null;

  const creator: StepStatus = creatorDone ? 'done' : 'running';
  const narrator: StepStatus = narratorDone ? 'done' : creatorDone ? 'running' : 'idle';
  const marketMaker: StepStatus = marketMakerDone ? 'done' : narratorDone ? 'running' : 'idle';

  return {
    kind: 'running',
    steps: { creator, narrator, marketMaker },
    latestToolUse: findLatestToolUse(input.toolCalls),
    memeImageArtifact: memeImage,
  };
}
