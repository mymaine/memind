'use client';

/**
 * RunProgress — pure prop-driven step indicator shared by LaunchPanel (3
 * steps) and OrderPanel (4 steps). Renders a horizontal strip of
 * dot + label cells with a thin connector line between them, plus an
 * optional secondary line showing the most recent `tool_use` in the form
 * `{agent} · {toolName}`.
 *
 * Intentionally ignorant of the panel state machines — callers pre-shape
 * their derive-*-state output into the `{ key, label, status }[]` prop so
 * this component can be reused across LaunchPanel / OrderPanel / any
 * future progress surface without importing them.
 *
 * A11y: `role="progressbar"` + `aria-valuenow` (count of done steps) /
 * `aria-valuemax` (total). Dots are visual-only (`aria-hidden`); labels
 * convey real progress to screen readers.
 *
 * Motion: running-step dot carries the existing `signal-pulse` class from
 * globals.css — no new keyframes here. `prefers-reduced-motion` support
 * lives in globals.css (global `@media` rule); we don't duplicate it here.
 *
 * See demo-narrative-ui.md AC-P4.7-5 for the full visual contract.
 */
import type { ReactElement } from 'react';

export type RunProgressStepStatus = 'idle' | 'running' | 'done';

export interface RunProgressStep {
  readonly key: string;
  readonly label: string;
  readonly status: RunProgressStepStatus;
}

export interface RunProgressProps {
  readonly steps: readonly RunProgressStep[];
  /**
   * Secondary detail line: `{agent} · {toolName}` rendered below the
   * dot row. `null` / `undefined` hides the line entirely so panels in
   * `idle` / `success` / `posted` states stay quiet.
   */
  readonly latestToolUse?: { readonly agent: string; readonly toolName: string } | null;
  readonly className?: string;
}

/** 8px dot; colour + animation vary by status. Always aria-hidden because
 *  the label next to it carries the real semantic. */
function Dot({ status }: { status: RunProgressStepStatus }): ReactElement {
  // `running` adds the existing `signal-pulse` class (globals.css) so the
  // dot breathes its drop-shadow. `done` stays solid accent; `idle` is
  // a muted fg-tertiary circle at 30% opacity.
  const base = 'inline-block h-2 w-2 rounded-full';
  let variant: string;
  if (status === 'running') {
    variant = 'bg-accent signal-pulse';
  } else if (status === 'done') {
    variant = 'bg-accent';
  } else {
    variant = 'bg-fg-tertiary/30';
  }
  return <span aria-hidden="true" className={`${base} ${variant}`} />;
}

/** Thin horizontal rule between adjacent step cells — purely decorative. */
function Connector(): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-px w-6 bg-border-default"
      data-testid="run-progress-connector"
    />
  );
}

export function RunProgress({ steps, latestToolUse, className }: RunProgressProps): ReactElement {
  // Count of done steps feeds aria-valuenow so SRs announce progress
  // without needing to parse individual dot colours.
  const doneCount = steps.reduce((acc, s) => (s.status === 'done' ? acc + 1 : acc), 0);

  return (
    <div
      role="progressbar"
      aria-label="Run progress"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={doneCount}
      className={`flex min-h-[48px] flex-col gap-2 ${className ?? ''}`.trim()}
    >
      <div className="flex items-center gap-3">
        {steps.map((step, i) => {
          // Label colour: `done` promotes to fg-primary so the eye catches
          // completed milestones; `idle` / `running` stay on fg-tertiary.
          const labelColour = step.status === 'done' ? 'text-fg-primary' : 'text-fg-tertiary';
          return (
            <div key={step.key} data-status={step.status} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Dot status={step.status} />
                <span
                  className={`font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] ${labelColour}`}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 ? <Connector /> : null}
            </div>
          );
        })}
      </div>
      {latestToolUse ? (
        <p
          data-testid="run-progress-tool-use"
          className="font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary opacity-70"
        >
          {latestToolUse.agent} · {latestToolUse.toolName}
        </p>
      ) : null}
    </div>
  );
}
