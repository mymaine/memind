'use client';

/**
 * ToolCallBubble — renders one entry from useRun().toolCalls.
 *
 * Three visual states:
 *   - running: spinner + toolName chip
 *   - done (ok): toolName chip + "ok" pill; clicking header toggles the
 *     input/output JSON panel (default collapsed).
 *   - done (error): red-bordered toolName chip + error message preview;
 *     panel default EXPANDED so the user sees the error without clicking.
 *
 * The component is deliberately simple markup — no headless-ui / animation
 * libraries, to match the project's "Tailwind tokens + hand-written" rule
 * (docs/features/dashboard-v2.md).
 */
import { useState } from 'react';
import type { ToolCallState } from '@/hooks/useRun-state';
import { formatToolPayload, toolBubbleTone } from './tool-call-bubble-utils';

export interface ToolCallBubbleProps {
  call: ToolCallState;
}

export function ToolCallBubble({ call }: ToolCallBubbleProps): React.ReactElement {
  const tone = toolBubbleTone(call);
  const [open, setOpen] = useState<boolean>(tone === 'error');

  return (
    <div
      role="group"
      aria-label={`tool call ${call.toolName} ${call.status}`}
      className={`flex flex-col gap-1 rounded-[var(--radius-card)] border px-3 py-2 text-[12px] ${
        tone === 'error'
          ? 'border-[color:var(--color-danger)] bg-[color-mix(in_oklab,var(--color-danger)_8%,transparent)]'
          : tone === 'running'
            ? 'border-border-default bg-bg-surface'
            : 'border-border-default bg-bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-[family-name:var(--font-mono)] text-accent-text">
            {call.toolName}
          </span>
          {tone === 'running' ? (
            <span
              aria-hidden
              className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
              data-testid="tool-bubble-spinner"
            />
          ) : tone === 'error' ? (
            <span className="rounded-sm bg-[color:var(--color-danger)] px-1 py-0.5 text-[10px] font-medium uppercase text-bg-primary">
              error
            </span>
          ) : (
            <span className="rounded-sm bg-accent px-1 py-0.5 text-[10px] font-medium uppercase text-bg-primary">
              ok
            </span>
          )}
        </span>
        <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 pt-1 font-[family-name:var(--font-mono)]">
          <pre className="whitespace-pre-wrap break-words text-fg-secondary">
            <span className="text-fg-tertiary">input · </span>
            {formatToolPayload(call.input)}
          </pre>
          {call.output !== undefined ? (
            <pre className="whitespace-pre-wrap break-words text-fg-secondary">
              <span className="text-fg-tertiary">{call.isError ? 'error · ' : 'output · '}</span>
              {formatToolPayload(call.output)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
