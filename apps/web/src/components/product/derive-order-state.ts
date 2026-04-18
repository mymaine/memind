/**
 * Pure reducer that maps `useRun()` state into the OrderPanel's visual
 * discriminated union (AC-P4.7-5).
 *
 * Input contract — the three signal sources the spec calls out:
 *   1. `artifacts`     — milestone markers (x402-tx / shill-order / shill-
 *                        tweet) drive the 4-step processing progression.
 *   2. `toolCalls`     — tool_use:end for post_shill_for on market-maker is
 *                        the strongest "drafting done" signal.
 *   3. `assistantText` — market-maker streaming text is the earlier, softer
 *                        "drafting started" signal (keeps the step at
 *                        'running'; terminal advancement waits for the tool).
 *
 * Step advancement rule: a step is 'done' the moment its milestone signal is
 * present; it is 'running' when phase='running', its own signal has not
 * arrived, and the preceding step is 'done' (paying is 'running' the moment
 * phase flips to 'running'); otherwise 'idle'.
 *
 * Terminal phase='done' branches:
 *   - shill-tweet present   → kind='posted'
 *   - shill-order(failed)   → kind='failed' (skip path, no tweet ever lands)
 *   - neither               → kind='error' (should not happen — orchestrator
 *                             emits one or the other before `status: done`)
 *
 * The 4-step ordering is locked to apps/server/src/runs/shill-market.ts:
 *   Paying   ← x402-tx
 *   Queued   ← shill-order status='queued'
 *   Drafting ← market-maker assistantText OR tool_use:end post_shill_for
 *   Posted   ← shill-tweet
 *
 * `lore-cid` is *not* emitted in the shill-market flow and must not be
 * referenced here. Same for `x-tweet`, which is not a schema kind.
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

const POST_SHILL_TOOL = 'post_shill_for';

// Agent traversal order mirrors the shill-market flow — creator / narrator
// entries should never appear for this run kind, but we include them so a
// stray tool call surfaces rather than disappearing.
const AGENT_FLOW_ORDER: readonly (keyof ToolCallsByAgent)[] = [
  'creator',
  'narrator',
  'market-maker',
  'heartbeat',
];

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

function hasMarketMakerDraftingSignal(
  toolCalls: ToolCallsByAgent,
  assistantText: AssistantTextByAgent,
): { started: boolean; finished: boolean } {
  const mmText = assistantText['market-maker'] ?? '';
  const startedFromText = mmText.length > 0;

  const mmCalls = toolCalls['market-maker'];
  const finished = mmCalls.some((c) => c.toolName === POST_SHILL_TOOL && c.status === 'done');
  // A running tool_use (status='running') also counts as drafting-started
  // even before any assistant text shows up, though in practice the stream
  // order puts assistantText first.
  const startedFromTool = mmCalls.some((c) => c.toolName === POST_SHILL_TOOL);

  return { started: startedFromText || startedFromTool, finished };
}

export function deriveOrderState(input: DeriveOrderInput): OrderPanelState {
  if (input.phase === 'idle') {
    return { kind: 'idle' };
  }

  if (input.phase === 'error') {
    return { kind: 'error', message: input.error ?? 'run failed' };
  }

  const x402Tx = findArtifact(input.artifacts, 'x402-tx');
  const queuedOrder = findArtifact(input.artifacts, 'shill-order', (a) => a.status === 'queued');
  const shillTweet = findArtifact(input.artifacts, 'shill-tweet');
  const failedOrder = findArtifact(input.artifacts, 'shill-order', (a) => a.status === 'failed');

  if (input.phase === 'done') {
    if (shillTweet !== null) {
      return {
        kind: 'posted',
        shillTweetArtifact: shillTweet,
        x402TxArtifact: x402Tx,
      };
    }
    if (failedOrder !== null) {
      return {
        kind: 'failed',
        message: 'Shiller skipped this order',
        shillOrderFailed: failedOrder,
      };
    }
    // Orchestrator contract says one of the two terminals always fires before
    // phase='done'; surfacing this branch as an error rather than a wedged
    // "processing" keeps malformed runs visible to the user.
    return { kind: 'error', message: 'incomplete run' };
  }

  // phase === 'running'
  const { finished: draftingFinished } = hasMarketMakerDraftingSignal(
    input.toolCalls,
    input.assistantText,
  );

  const payingDone = x402Tx !== null;
  const queuedDone = queuedOrder !== null;
  // drafting is 'done' once the market-maker tool_use:end post_shill_for
  // fires. assistantText alone only keeps the step 'running' — drafting isn't
  // complete until the tool finishes.
  const draftingDone = draftingFinished;
  const postedDone = shillTweet !== null;

  const paying: StepStatus = payingDone ? 'done' : 'running';
  const queued: StepStatus = queuedDone ? 'done' : payingDone ? 'running' : 'idle';
  const drafting: StepStatus = draftingDone ? 'done' : queuedDone ? 'running' : 'idle';
  const posted: StepStatus = postedDone ? 'done' : draftingDone ? 'running' : 'idle';

  return {
    kind: 'processing',
    steps: { paying, queued, drafting, posted },
    latestToolUse: findLatestToolUse(input.toolCalls),
  };
}
