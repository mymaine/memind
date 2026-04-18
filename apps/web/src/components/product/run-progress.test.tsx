/**
 * Red tests for `<RunProgress />` (V4.7-P4 Task 3 / AC-P4.7-5).
 *
 * RunProgress is a pure prop-driven indicator shared by LaunchPanel (3 steps)
 * and OrderPanel (4 steps). The component renders a horizontal strip of
 * dot + label cells plus an optional secondary line showing the latest
 * `tool_use` label in `{agent} · {toolName}` format.
 *
 * Visual contract pinned here (spec demo-narrative-ui.md AC-P4.7-5):
 *   - Outer element carries `role="progressbar"` with `aria-valuenow` equal to
 *     the count of `done` steps and `aria-valuemax` equal to the total step
 *     count. Screen readers announce "N of M complete" without the dots
 *     (dots are visual-only).
 *   - A `running` step's dot carries the `signal-pulse` class so globals.css
 *     drives its breathing glow; `idle`/`done` dots are static.
 *   - A `done` step's label is promoted to `text-fg-primary`; idle/running
 *     labels stay on `text-fg-tertiary`.
 *   - `latestToolUse` renders an extra line formatted `{agent} · {toolName}`
 *     when present; a null/undefined prop hides the line entirely (we grep
 *     the middot to assert absence).
 *   - Zero-step input still renders the container with `aria-valuemax=0`
 *     (defensive default; real callers always pass ≥1 step but we refuse
 *     to crash on an empty fixture).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunProgress, type RunProgressStep } from './run-progress.js';

function render(
  steps: readonly RunProgressStep[],
  latestToolUse?: { agent: string; toolName: string } | null,
): string {
  return renderToStaticMarkup(<RunProgress steps={steps} latestToolUse={latestToolUse} />);
}

describe('<RunProgress /> static markup', () => {
  it('three idle steps → aria-valuenow=0 aria-valuemax=3', () => {
    const out = render([
      { key: 'a', label: 'Creator', status: 'idle' },
      { key: 'b', label: 'Narrator', status: 'idle' },
      { key: 'c', label: 'Market-maker', status: 'idle' },
    ]);
    expect(out).toMatch(/role="progressbar"/);
    expect(out).toContain('aria-valuenow="0"');
    expect(out).toContain('aria-valuemax="3"');
  });

  it('counts only `done` steps toward aria-valuenow', () => {
    const out = render([
      { key: 'a', label: 'Creator', status: 'done' },
      { key: 'b', label: 'Narrator', status: 'done' },
      { key: 'c', label: 'Market-maker', status: 'running' },
    ]);
    expect(out).toContain('aria-valuenow="2"');
    expect(out).toContain('aria-valuemax="3"');
  });

  it('done label uses text-fg-primary; idle label uses text-fg-tertiary', () => {
    const out = render([
      { key: 'a', label: 'LabelDone', status: 'done' },
      { key: 'b', label: 'LabelIdle', status: 'idle' },
    ]);
    // Match the span carrying the done label and assert its class list
    // contains `text-fg-primary`.
    expect(out).toMatch(/class="[^"]*text-fg-primary[^"]*"[^>]*>LabelDone/);
    expect(out).toMatch(/class="[^"]*text-fg-tertiary[^"]*"[^>]*>LabelIdle/);
  });

  it('running step dot carries the signal-pulse class', () => {
    const out = render([{ key: 'a', label: 'RunningStep', status: 'running' }]);
    // The dot is the visual marker next to the label; assert the class
    // exists somewhere in the rendered markup for a running step.
    expect(out).toContain('signal-pulse');
  });

  it('latestToolUse renders `{agent} · {toolName}` line when provided', () => {
    const out = render([{ key: 'a', label: 'Creator', status: 'running' }], {
      agent: 'creator',
      toolName: 'meme_image_creator',
    });
    expect(out).toContain('creator · meme_image_creator');
  });

  it('latestToolUse null hides the secondary line entirely (no middot)', () => {
    const out = render([{ key: 'a', label: 'Creator', status: 'running' }], null);
    // Middot is the tell for the secondary tool-use line; if the line is
    // hidden we should not find the character anywhere in the markup.
    expect(out).not.toContain(' · ');
  });

  it('empty steps array still renders the progressbar container with aria-valuemax=0', () => {
    const out = render([]);
    expect(out).toMatch(/role="progressbar"/);
    expect(out).toContain('aria-valuemax="0"');
    expect(out).toContain('aria-valuenow="0"');
  });
});
