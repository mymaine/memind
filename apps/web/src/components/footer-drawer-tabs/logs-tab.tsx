'use client';

/**
 * <LogsTab /> — Developer Logs tab of the FooterDrawer (P0-14).
 *
 * Binds directly to `runState.logs: LogEvent[]`. Each row is a four-column
 * mono grid: ts (90px) / lvl (60px) / source (150px) / message (rest).
 * The CSS host `.logs-head` / `.logs-body` / `.log-row` lives in globals.css
 * and handles level-based coloring through the `log-<level>` sibling class.
 *
 * Format rules:
 *   - `ts` is the shared `LogEvent.ts` (ISO datetime string). We slice the
 *     `HH:MM:SS.mmm` portion when it is an ISO; otherwise we fall back to
 *     the raw value so non-conformant shapes still render.
 *   - `lvl` is `log.level.toUpperCase()`.
 *   - `source` is `${log.agent}.${log.tool}`; when `tool` is missing we
 *     render just the agent.
 *   - `msg` is the free-form `log.message`.
 *
 * Empty state (no logs): centred mono hint `awaiting run · press D to hide`.
 */
import type { ReactElement } from 'react';
import type { LogEvent } from '@hack-fourmeme/shared';

export interface LogsTabProps {
  readonly logs: readonly LogEvent[];
}

const KNOWN_LEVEL_CLASSES = new Set(['info', 'warn', 'error', 'debug', 'chain', 'ok']);

/**
 * Format the `LogEvent.ts` ISO datetime into a compact `HH:MM:SS.mmm`
 * column value. Non-ISO inputs (just in case a future event shape slips
 * through) are returned verbatim.
 */
export function formatLogTs(ts: string): string {
  // Fast path: match ISO `YYYY-MM-DDTHH:MM:SS(.mmm)?Z`.
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(ts);
  if (iso !== null && iso[1] !== undefined) {
    const time = iso[1];
    // Pad/truncate to HH:MM:SS.mmm (12 chars).
    if (time.includes('.')) {
      return time.length >= 12 ? time.slice(0, 12) : time.padEnd(12, '0');
    }
    return `${time}.000`;
  }
  return ts;
}

function levelClass(level: string): string {
  const lower = level.toLowerCase();
  return KNOWN_LEVEL_CLASSES.has(lower) ? `log-${lower}` : 'log-info';
}

function formatSource(log: LogEvent): string {
  const tool = log.tool;
  if (tool === undefined || tool === null || tool === '') {
    return log.agent;
  }
  return `${log.agent}.${tool}`;
}

export function LogsTab(props: LogsTabProps): ReactElement {
  const { logs } = props;

  if (logs.length === 0) {
    return (
      <div className="logs-pane">
        <div
          className="mono"
          style={{
            padding: '24px 0',
            textAlign: 'center',
            color: 'var(--fg-tertiary)',
          }}
        >
          awaiting run · press D to hide
        </div>
      </div>
    );
  }

  return (
    <div className="logs-pane">
      <div className="logs-head mono">
        <span style={{ width: 90 }}>ts</span>
        <span style={{ width: 60 }}>lvl</span>
        <span style={{ width: 150 }}>source</span>
        <span>message</span>
      </div>
      <div className="logs-body">
        {logs.map((log, idx) => (
          <div key={`${log.ts}-${idx.toString()}`} className={`log-row ${levelClass(log.level)}`}>
            <span className="mono" style={{ width: 90, color: 'var(--fg-tertiary)' }}>
              {formatLogTs(log.ts)}
            </span>
            <span className="mono" style={{ width: 60 }}>
              {log.level.toUpperCase()}
            </span>
            <span className="mono" style={{ width: 150, color: 'var(--fg-secondary)' }}>
              {formatSource(log)}
            </span>
            <span className="mono">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
