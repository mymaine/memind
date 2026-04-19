/**
 * Pure helpers behind the Brain surface (<BrainIndicator /> today; was
 * <BrainStatusBar /> pre-immersive pivot). Kept free of React so they are
 * node-testable without a DOM and can be reused by any future surface that
 * wants to derive "who is the Brain currently acting as".
 *
 * Policy:
 *   - Status is `online` only while `runState.phase === 'running'`; done /
 *     error / idle all collapse to `idle` on the bar (the detail modal
 *     still surfaces the exact terminal state through artifact counts).
 *   - Active persona is the agent of the most recent log entry while a run
 *     is in flight. If the run is not running, there is no active persona
 *     (returns null so the bar omits that segment entirely rather than
 *     flashing stale state after a run ends).
 *   - Agent ids are the code-side names (creator / narrator / market-maker
 *     / heartbeat) — the pitch-layer persona labels come from
 *     BRAIN_ARCHITECTURE.shippedPersonas in narrative-copy. We keep that
 *     one-way map local so the decision doc's "code keeps agent, UI uses
 *     persona" rule is honoured without leaking it across the repo.
 */
import type { AgentId } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';

export type BrainStatus = 'online' | 'idle';

/**
 * One-way code-agent → pitch-persona label map. Kept in one place (here)
 * so renames only touch a single file. These labels match the Name field
 * in `BRAIN_ARCHITECTURE.shippedPersonas` in narrative-copy.
 */
const AGENT_TO_PERSONA_LABEL: Record<AgentId, string> = {
  creator: 'Creator',
  narrator: 'Narrator',
  'market-maker': 'Market-maker / Shiller',
  heartbeat: 'Heartbeat',
  brain: 'Brain',
  shiller: 'Shiller',
};

export function deriveBrainStatus(runState: RunState): BrainStatus {
  return runState.phase === 'running' ? 'online' : 'idle';
}

/**
 * Returns the pitch-layer label of the most recent acting persona while a
 * run is in flight, or null when the bar should omit that segment. The last
 * log's `agent` field is the cheapest source — `useRun()` appends every log
 * to the end of `runState.logs`, so `logs[logs.length - 1]` is the latest.
 */
export function deriveActivePersonaLabel(runState: RunState): string | null {
  if (runState.phase !== 'running') return null;
  const { logs } = runState;
  if (logs.length === 0) return null;
  const latest = logs[logs.length - 1];
  if (latest === undefined) return null;
  return AGENT_TO_PERSONA_LABEL[latest.agent];
}
