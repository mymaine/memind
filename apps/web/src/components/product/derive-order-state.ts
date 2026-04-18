/**
 * Pure reducer that maps `useRun()` state into the OrderPanel's visual
 * discriminated union (AC-P4.7-5).
 *
 * Stub first — the tests in derive-order-state.test.ts intentionally run red
 * against this no-op so we can commit the red step before writing the real
 * reducer (TDD rule of the task brief).
 */
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { AssistantTextByAgent, ToolCallsByAgent } from '@/hooks/useRun-state';

import type { StepStatus } from './derive-launch-state';

export type OrderPanelState =
  | { kind: 'idle' }
  | {
      kind: 'processing';
      steps: {
        paying: StepStatus;
        queued: StepStatus;
        drafting: StepStatus;
        posted: StepStatus;
      };
      latestToolUse: { agent: string; toolName: string } | null;
    }
  | {
      kind: 'posted';
      shillTweetArtifact: Extract<Artifact, { kind: 'shill-tweet' }>;
      x402TxArtifact: Extract<Artifact, { kind: 'x402-tx' }> | null;
    }
  | {
      kind: 'failed';
      message: string;
      shillOrderFailed: Extract<Artifact, { kind: 'shill-order' }> | null;
    }
  | { kind: 'error'; message: string };

export interface DeriveOrderInput {
  readonly phase: 'idle' | 'running' | 'done' | 'error';
  readonly artifacts: readonly Artifact[];
  readonly toolCalls: ToolCallsByAgent;
  readonly assistantText: AssistantTextByAgent;
  readonly logs: readonly LogEvent[];
  readonly error: string | null;
}

export function deriveOrderState(_input: DeriveOrderInput): OrderPanelState {
  // Stub for the red step of TDD. Real implementation lands in the follow-up
  // commit once the red assertions in the sibling test file are in.
  return { kind: 'idle' };
}
