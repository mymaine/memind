'use client';

/**
 * BrainChat — main conversational surface component (BRAIN-P4 Task 3 +
 * BRAIN-P6 Task 4 slash integration).
 *
 * Composes:
 *   - `useBrainChat(scope)` for state + send/reset + appendLocalAssistant.
 *   - `useSlashPalette(draft, scope)` for the slash command palette.
 *   - `<BrainChatSuggestions />` when the transcript is empty (AC-BRAIN-9).
 *   - `<BrainChatSlashPalette />` floating above the textarea when the draft
 *     begins with `/` (AC-BRAIN-13).
 *   - `<BrainChatMessage />` per turn.
 *   - Bottom input row: textarea + Send button; both disabled while the hook
 *     is `sending` or `streaming`.
 *   - Inline red error line when the last slash submission failed validation.
 *   - Error banner with `role="alert"` when `status === 'error'`.
 *
 * Slash dispatch path on submit:
 *   - Delegate to the pure `dispatchSlashSubmission` helper.
 *     - `ignore` → do nothing.
 *     - `client-handled` → helper already pushed the local reply via
 *       appendLocalAssistant / reset. Clear draft.
 *     - `invalid` → surface the error inline; keep draft so the user fixes.
 *     - `server-send` → controller.send(raw) (the Brain's server-side slash
 *       rule in BRAIN_SYSTEM_PROMPT handles the actual tool dispatch).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { BrainChatMessage } from './brain-chat-message';
import { BrainChatSuggestions } from './brain-chat-suggestions';
import { BrainChatSlashPalette } from './brain-chat-slash-palette';
import { dispatchSlashSubmission } from './brain-chat-slash-dispatch';
import { useBrainChat, type BrainChatScope, type UseBrainChatResult } from '@/hooks/useBrainChat';
import { useSlashPalette } from '@/hooks/useSlashPalette';

export interface BrainChatProps {
  readonly scope: BrainChatScope;
  /**
   * Test / page-level injection. Omit in production so the component
   * manages its own `useBrainChat` instance.
   */
  readonly controller?: UseBrainChatResult;
  readonly className?: string;
  /**
   * Mount-time initial composer draft. Used by BrainPanel so Hero CTAs
   * (or any future deep-link) can pre-fill the textarea with a slash
   * command like `/launch ` before the user starts typing. Only honoured
   * on first mount — subsequent prop changes do NOT overwrite the user's
   * in-progress edit. Callers that want to reset the draft should remount
   * the component via a `key` prop.
   */
  readonly initialDraft?: string;
}

const SECTION_CLASS =
  'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4';

const PRIMARY_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-default)] border border-accent bg-accent px-4 py-2 font-[family-name:var(--font-sans-body)] text-[13px] font-medium text-bg-primary transition-opacity disabled:cursor-not-allowed disabled:opacity-60';

const TEXTAREA_CLASS =
  'min-h-[44px] flex-1 resize-none rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2 font-[family-name:var(--font-sans-body)] text-[13px] text-fg-primary outline-none transition-colors placeholder:text-fg-tertiary focus:border-accent disabled:cursor-not-allowed disabled:opacity-60';

export function BrainChat({
  scope,
  controller,
  className,
  initialDraft,
}: BrainChatProps): ReactElement {
  // Always call the hook so the "no controller" branch works without a
  // conditional hook call (React's rules of hooks). When `controller` is
  // supplied, we ignore the hook's state.
  const fallback = useBrainChat(scope);
  const active = controller ?? fallback;

  const [draft, setDraft] = useState<string>(() => initialDraft ?? '');
  const [slashError, setSlashError] = useState<string | null>(null);

  const palette = useSlashPalette(draft, scope);

  // UAT fix #3: auto-scroll the transcript to the bottom on every new event
  // so the final Markdown answer is always visible without the reader having
  // to scroll past the (now-compact) tool-use log. We re-run on the serialised
  // event-count signature so a streaming delta into an existing assistant
  // turn also triggers the scroll (turns.length alone would miss those).
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const scrollSignature = active.turns
    .map((t) => `${t.id}:${t.content.length.toString()}:${(t.brainEvents ?? []).length.toString()}`)
    .join('|');
  useEffect(() => {
    const node = transcriptRef.current;
    if (node === null) return;
    // `scrollTop = scrollHeight` snaps to the bottom; smooth behaviour looks
    // better during long streams but browsers that disable smooth scroll
    // (reduce-motion, tests) still land on the correct position.
    node.scrollTop = node.scrollHeight;
  }, [scrollSignature]);

  const canSubmit =
    draft.trim() !== '' && active.status !== 'sending' && active.status !== 'streaming';

  const runSubmission = useCallback(
    (raw: string): void => {
      const result = dispatchSlashSubmission({
        raw,
        scope,
        turns: active.turns,
        reset: active.reset,
        appendLocalAssistant: active.appendLocalAssistant,
      });
      switch (result.kind) {
        case 'ignore':
          return;
        case 'invalid':
          setSlashError(result.error);
          return;
        case 'client-handled':
          setSlashError(null);
          setDraft('');
          return;
        case 'server-send':
          setSlashError(null);
          setDraft('');
          void active.send(raw);
          return;
      }
    },
    [active, scope],
  );

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!canSubmit) return;
      runSubmission(draft);
    },
    [canSubmit, draft, runSubmission],
  );

  const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    // Any edit clears a stale inline slash error so the user is not stuck
    // with an error row after fixing their input.
    setSlashError(null);
    setDraft(e.target.value);
  }, []);

  // Keyboard handler:
  //   - Enter (no Shift) while palette open AND candidates present → pick
  //     the highlighted command and rewrite the draft to `/<name> ` (space
  //     suffix so the user can immediately type args). Do NOT submit.
  //   - Tab while palette open → same as Enter (Slack-style autocomplete).
  //   - ↑ / ↓ while palette open → navigate candidates.
  //   - Escape while palette open → close palette (we clear the rawActiveIndex
  //     by resetting it through the hook; the easiest way is to set the
  //     draft's leading slash out — but we'd eat content. Instead, we do a
  //     lightweight close: set an overrideClosed flag via state). Simpler:
  //     we let the palette re-render closed by letting the user delete the
  //     slash or submit. Escape here simply blurs (browser default).
  //   - Enter (no Shift) while palette closed → submit form.
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Palette-driven shortcuts take priority over submit semantics when
      // the palette is open.
      if (palette.open) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          palette.moveDown();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          palette.moveUp();
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          // If candidates is empty the Enter still submits the raw line
          // (user typed `/xyz` — the dispatcher will surface an unknown
          // error inline).
          if (palette.candidates.length > 0) {
            e.preventDefault();
            const picked = palette.pick();
            if (picked) {
              setDraft(`/${picked.name} `);
              palette.close();
            }
            return;
          }
        }
        if (e.key === 'Escape') {
          // Drop the leading slash to close the palette.
          e.preventDefault();
          setDraft('');
          palette.close();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (canSubmit) {
          const form = e.currentTarget.form;
          form?.requestSubmit();
        }
      }
    },
    [canSubmit, palette],
  );

  const isStreaming = active.status === 'sending' || active.status === 'streaming';
  const isEmpty = active.turns.length === 0;

  const onPickFromPalette = useCallback(
    (picked: { name: string }) => {
      setDraft(`/${picked.name} `);
      palette.close();
    },
    [palette],
  );

  const onHintClick = useCallback(() => {
    setDraft('/');
  }, []);

  return (
    <section
      aria-label="Brain chat"
      className={className !== undefined ? `${SECTION_CLASS} ${className}` : SECTION_CLASS}
      data-scope={scope}
    >
      {/* Transcript — empty state vs populated */}
      <div
        ref={transcriptRef}
        data-testid="brain-chat-transcript"
        aria-live="polite"
        className="flex max-h-[480px] min-h-[180px] flex-col gap-3 overflow-y-auto"
      >
        {isEmpty ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
              Ask the Memind
            </p>
            <BrainChatSuggestions scope={scope} onPick={(text) => setDraft(text)} />
            <button
              type="button"
              onClick={onHintClick}
              className="self-start font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary hover:text-accent-text"
            >
              Type / for commands
            </button>
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

      {/* Inline slash validation error */}
      {slashError !== null ? (
        <div
          role="alert"
          data-testid="brain-chat-slash-error"
          className="rounded-[var(--radius-card)] border border-[color:var(--color-danger)] bg-[color-mix(in_oklab,var(--color-danger)_8%,transparent)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-danger)]"
        >
          {slashError}
        </div>
      ) : null}

      {/* Input row with floating palette */}
      <form onSubmit={onSubmit} className="relative flex items-end gap-2">
        <BrainChatSlashPalette
          open={palette.open}
          candidates={palette.candidates}
          activeIndex={palette.activeIndex}
          onPick={onPickFromPalette}
        />
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
