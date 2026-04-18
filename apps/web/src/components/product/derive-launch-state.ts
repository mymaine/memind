/**
 * Pure reducer that maps `useRun()` state into the LaunchPanel's visual
 * discriminated union (AC-P4.7-5).
 *
 * Stub first — the tests in derive-launch-state.test.ts intentionally run red
 * against this no-op so we can commit the red step before writing the real
 * reducer (TDD rule of the task brief).
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

export function deriveLaunchState(_input: DeriveLaunchInput): LaunchPanelState {
  // Stub for the red step of TDD. Real implementation lands in the follow-up
  // commit once the red assertions in the sibling test file are in.
  return { kind: 'idle' };
}
