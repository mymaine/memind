'use client';

/**
 * BrainChat — main conversational surface component (BRAIN-P4 Task 3).
 *
 * Composes:
 *   - `useBrainChat(scope)` for state + send/reset (injectable via the
 *     optional `controller` prop for deterministic tests, same pattern
 *     LaunchPanel / OrderPanel use).
 *   - `<BrainChatSuggestions />` when the transcript is empty (AC-BRAIN-9).
 *   - `<BrainChatMessage />` per turn (user + assistant bubbles + nested
 *     persona events).
 *   - Bottom input row: textarea + Send button; textarea is disabled while
 *     the hook is in `sending` or `streaming` status to prevent double-send
 *     while SSE is still open.
 *   - Error banner with `role="alert"` when `status === 'error'`.
 *
 * This component owns its own input-value state (local `useState`), not the
 * hook. The hook's transcript is the source of truth for the conversation;
 * the textarea is an ephemeral draft.
 */
import {
  useCallback,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { BrainChatMessage } from './brain-chat-message.js';
import { BrainChatSuggestions } from './brain-chat-suggestions.js';
import { useBrainChat, type BrainChatScope, type UseBrainChatResult } from '@/hooks/useBrainChat';

export interface BrainChatProps {
  readonly scope: BrainChatScope;
  /**
   * Test / page-level injection. Omit in production so the component
   * manages its own `useBrainChat` instance.
   */
  readonly controller?: UseBrainChatResult;
  readonly className?: string;
}

const SECTION_CLASS =
  'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4';

const PRIMARY_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-default)] border border-accent bg-accent px-4 py-2 font-[family-name:var(--font-sans-body)] text-[13px] font-medium text-bg-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-60';

const TEXTAREA_CLASS =
  'min-h-[44px] flex-1 resize-none rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2 font-[family-name:var(--font-sans-body)] text-[13px] text-fg-primary outline-none transition-colors placeholder:text-fg-tertiary focus:border-accent disabled:cursor-not-allowed disabled:opacity-60';

export function BrainChat({ scope, controller, className }: BrainChatProps): ReactElement {
  // Always call the hook so the "no controller" branch works without a
  // conditional hook call (React's rules of hooks). When `controller` is
  // supplied, we ignore the hook's state.
  const fallback = useBrainChat(scope);
  const active = controller ?? fallback;

  const [draft, setDraft] = useState<string>('');

  const canSubmit =
    draft.trim() !== '' && active.status !== 'sending' && active.status !== 'streaming';

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!canSubmit) return;
      const value = draft;
      setDraft('');
      void active.send(value);
    },
    [active, canSubmit, draft],
  );

  const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
  }, []);

  // Enter submits; Shift+Enter inserts a newline (standard Slack / Linear).
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (canSubmit) {
          const form = e.currentTarget.form;
          form?.requestSubmit();
        }
      }
    },
    [canSubmit],
  );

  const isStreaming = active.status === 'sending' || active.status === 'streaming';
  const isEmpty = active.turns.length === 0;

  return (
    <section
      aria-label="Brain chat"
      className={className !== undefined ? `${SECTION_CLASS} ${className}` : SECTION_CLASS}
      data-scope={scope}
    >
      {/* Transcript — empty state vs populated */}
      <div
        aria-live="polite"
        className="flex max-h-[480px] min-h-[180px] flex-col gap-3 overflow-y-auto"
      >
        {isEmpty ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
              Ask the Memind
            </p>
            <BrainChatSuggestions scope={scope} onPick={(text) => setDraft(text)} />
          </div>
        ) : (
          active.turns.map((turn) => <BrainChatMessage key={turn.id} turn={turn} />)
        )}
      </div>

      {/* Error banner */}
      {active.status === 'error' && active.errorMessage !== null ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] px-3 py-2 font-[family-name:var(--font-mono)] text-[12px] text-[color:var(--color-danger)]"
        >
          {active.errorMessage}
        </div>
      ) : null}

      {/* Input row */}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          name="brain-chat-draft"
          aria-label="Message the Memind"
          placeholder={
            isStreaming ? 'Memind is responding…' : 'Talk to the Memind, or pick a suggestion'
          }
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={isStreaming}
          rows={2}
          className={TEXTAREA_CLASS}
        />
        <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON_CLASS}>
          {isStreaming ? 'Streaming…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
