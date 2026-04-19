'use client';

/**
 * <ConsoleTab /> — Brain Console tab of the FooterDrawer (P0-14).
 *
 * Presents a fake shell transcript derived from `runState`. Each row uses
 * the `.console-row` class; the prompt cells use the accent color while
 * the fields (label/value) use the standard mono token.
 *
 * Derived fields:
 *   - `status`          → `deriveBrainStatus(runState)` (online / idle)
 *   - `persona.active`  → `deriveActivePersonaLabel(runState) ?? '—'`
 *   - `logs.count`      → `runState.logs.length`
 *   - `artifacts.count` → `runState.artifacts.length`
 *   - `tool-calls`      → sum of runState.toolCalls[<agent>].length
 *   - `phase`           → `runState.phase`
 *   - `runId`           → `runState.runId ?? '—'`
 */
import type { ReactElement } from 'react';
import type { AgentId } from '@hack-fourmeme/shared';
import type { RunState } from '@/hooks/useRun-state';
import { deriveActivePersonaLabel, deriveBrainStatus } from '@/components/brain-status-bar-utils';

export interface ConsoleTabProps {
  readonly runState: RunState;
}

const AGENT_IDS: readonly AgentId[] = [
  'creator',
  'narrator',
  'market-maker',
  'heartbeat',
  'brain',
  'shiller',
];

export function totalToolCalls(runState: RunState): number {
  let total = 0;
  for (const id of AGENT_IDS) {
    total += runState.toolCalls[id].length;
  }
  return total;
}

const PROMPT_STYLE = { color: 'var(--accent)' } as const;
const LABEL_STYLE = { color: 'var(--fg-tertiary)' } as const;

function Row(props: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="console-row">
      <span className="mono" style={LABEL_STYLE}>
        {`  ${props.label}`}
      </span>
      <span className="mono">{props.value}</span>
    </div>
  );
}

export function ConsoleTab(props: ConsoleTabProps): ReactElement {
  const { runState } = props;
  const status = deriveBrainStatus(runState);
  const persona = deriveActivePersonaLabel(runState) ?? '\u2014';
  const runId = runState.runId ?? '\u2014';

  return (
    <div className="console-pane">
      <div className="console-row">
        <span className="mono" style={PROMPT_STYLE}>
          brain@memind:~$
        </span>
        <span className="mono">status</span>
      </div>
      <Row label="status" value={status} />
      <Row label="persona.active" value={persona} />
      <Row label="logs.count" value={runState.logs.length.toString()} />
      <Row label="artifacts.count" value={runState.artifacts.length.toString()} />
      <Row label="tool-calls" value={totalToolCalls(runState).toString()} />
      <Row label="phase" value={runState.phase} />
      <Row label="runId" value={runId} />
      <div className="console-row">
        <span className="mono" style={PROMPT_STYLE}>
          brain@memind:~$
        </span>
        <span className="mono">▌</span>
      </div>
    </div>
  );
}
