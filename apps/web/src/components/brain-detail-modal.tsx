'use client';

/**
 * BrainDetailModal — click-to-open dialog launched from <BrainIndicator />
 * (in the slim Header, post immersive-single-page P1 Task 3 / AC-ISP-6).
 * Pre-pivot, the trigger was the independent <BrainStatusBar /> strip that
 * was retired as part of the Header collapse.
 *
 * Renders (top → bottom):
 *   1. Brain identity block — title + brainSubtitle + one-line factual
 *      system-prompt summary. Copy is intentionally bland; the decision doc
 *      (docs/decisions/2026-04-19-brain-agent-positioning.md) forbids AGI /
 *      autonomous-AI language.
 *   2. Memory state counters — three boxes reading lore-cid / shill-order /
 *      heartbeat-tick artifact counts for the current run. Em-dashes when
 *      the counter source is not populated (runState = idle or the
 *      counter-kind has never been observed in the current session).
 *   3. Persona roster — four shipped personas at full opacity + three
 *      future slots at opacity-60 (mirrors the Vision SKU greyed style).
 *   4. Footer — points at the decision doc that locked Brain positioning.
 *
 * Split into <BrainDetailModalView /> (pure, props-only) and
 * <BrainDetailModal /> (client shell that wires Esc + outside-click close
 * handlers + focus-return). Tests drive the pure view and assert on the
 * contract hooks (`data-close-on-esc`, `data-focus-return`) the shell reads.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { Artifact } from '@hack-fourmeme/shared';
import { BRAIN_ARCHITECTURE } from '@/lib/narrative-copy';
import type { RunState } from '@/hooks/useRun-state';

export interface BrainDetailModalViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** `null` → render an em-dash placeholder. */
  readonly loreCount: number | null;
  readonly orderCount: number | null;
  readonly tickCount: number | null;
}

const SYSTEM_PROMPT_SUMMARY =
  'This Brain hosts four personas on one Anthropic SDK runtime, sharing one memory layer (LoreStore + AnchorLedger + ShillOrderStore). See docs/architecture.md for the full wiring.';

const DECISION_DOC = 'docs/decisions/2026-04-19-brain-agent-positioning.md';

function counterText(value: number | null): string {
  return value === null ? '—' : String(value);
}

function statusPillClass(status: 'shipped' | 'next' | 'roadmap'): string {
  if (status === 'shipped') {
    return 'border-accent text-accent-text';
  }
  // Next + roadmap both render muted; the status text ("next" vs "roadmap")
  // carries the distinction. Accessibility §10: never color-only.
  return 'border-border-default text-fg-tertiary';
}

/**
 * Pure presentational modal. Returns empty markup when closed so consumers
 * can mount it unconditionally without pulling weight into the DOM.
 */
export function BrainDetailModalView(props: BrainDetailModalViewProps): ReactElement | null {
  const { open, onClose, loreCount, orderCount, tickCount } = props;
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brain-detail-modal-heading"
      id="brain-detail-modal"
      data-close-on-esc="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      {/* Backdrop — clicking here fires onClose via the outer onClick.
          The inner card stopPropagation is unnecessary because the card
          sits inside the same container; we attach the handler on the
          backdrop explicitly via a second element below. */}
      <button
        type="button"
        aria-label="Close Token Brain detail (backdrop)"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-transparent"
        tabIndex={-1}
      />

      <div
        className="relative flex max-h-[85vh] w-full max-w-[560px] flex-col gap-5 overflow-y-auto rounded-[var(--radius-card)] border border-border-default bg-bg-elevated p-6 shadow-[rgba(0,0,0,0.7)_0px_20px_60px]"
        // A positioned child above the backdrop button.
      >
        {/* ── 1. Identity block ─────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="brain-detail-modal-heading"
              className="font-[family-name:var(--font-sans-display)] text-[20px] font-semibold uppercase tracking-[0.5px] text-fg-primary"
            >
              {BRAIN_ARCHITECTURE.brainLabel}
            </h2>
            <p className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
              {BRAIN_ARCHITECTURE.brainSubtitle}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Token Brain detail"
            data-focus-return="close-button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-default)] border border-border-default text-fg-tertiary transition-colors hover:border-accent hover:text-fg-primary focus:outline-none focus-visible:border-accent"
          >
            <span aria-hidden className="font-[family-name:var(--font-mono)] text-[14px]">
              ×
            </span>
          </button>
        </header>

        <p className="font-[family-name:var(--font-sans-body)] text-[13px] leading-[1.5] text-fg-secondary">
          {SYSTEM_PROMPT_SUMMARY}
        </p>

        {/* ── 2. Memory state counters ───────────────────────────────── */}
        <section aria-label="Brain memory counters" className="grid grid-cols-3 gap-2">
          <CounterBox label="lore chapters" value={counterText(loreCount)} />
          <CounterBox label="shill orders" value={counterText(orderCount)} />
          <CounterBox label="heartbeat ticks" value={counterText(tickCount)} />
        </section>

        {/* ── 3. Persona roster ──────────────────────────────────────── */}
        <section aria-label="Brain personas" className="flex flex-col gap-2">
          <h3 className="font-[family-name:var(--font-sans-display)] text-[13px] font-semibold uppercase tracking-[0.5px] text-fg-tertiary">
            Personas
          </h3>
          <ul className="flex flex-col gap-1.5">
            {BRAIN_ARCHITECTURE.shippedPersonas.map((p) => (
              <li
                key={p.name}
                className="flex items-center gap-3 rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2"
              >
                <span className="font-[family-name:var(--font-sans-body)] text-[13px] font-semibold text-fg-primary">
                  {p.name}
                </span>
                <span className="flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
                  {p.role}
                </span>
                <span
                  className={`rounded-[var(--radius-card)] border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] ${statusPillClass(p.status)}`}
                >
                  {p.status}
                </span>
              </li>
            ))}
            {BRAIN_ARCHITECTURE.futureSlots.map((p) => (
              <li
                key={p.name}
                className="flex items-center gap-3 rounded-[var(--radius-default)] border border-dashed border-border-default bg-bg-surface px-3 py-2 opacity-60"
              >
                <span className="font-[family-name:var(--font-sans-body)] text-[13px] font-semibold text-fg-primary">
                  {p.name}
                </span>
                <span className="flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
                  {p.role}
                </span>
                <span
                  className={`rounded-[var(--radius-card)] border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] ${statusPillClass(p.status)}`}
                >
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── 4. Open full chat CTA (BRAIN-P5 Task 5) ────────────────────
            The anchor jumps the scroll surface to the chat-driven Launch
            demo so the user lands at the primary conversational surface.
            Closing the modal is delegated to onClose so Esc + outside-click
            behaviour stays symmetrical with the rest of the dialog. */}
        <a
          href="#launch-demo"
          onClick={onClose}
          data-testid="brain-detail-open-full-chat"
          className="inline-flex items-center justify-center rounded-[var(--radius-default)] border border-accent bg-accent px-4 py-2 font-[family-name:var(--font-sans-body)] text-[13px] font-medium text-bg-primary transition-opacity hover:opacity-90"
        >
          Open full chat
        </a>

        {/* ── 5. Footer ──────────────────────────────────────────────── */}
        <footer className="border-t border-border-default pt-3 font-[family-name:var(--font-mono)] text-[10px] text-fg-tertiary md:text-[11px]">
          Decision: {DECISION_DOC}
        </footer>
      </div>
    </div>
  );
}

function CounterBox(props: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-3 py-2">
      <span className="font-[family-name:var(--font-sans-display)] text-[18px] font-semibold text-fg-primary">
        {props.value}
      </span>
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.5px] text-fg-tertiary">
        {props.label}
      </span>
    </div>
  );
}

export interface BrainDetailModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Current run snapshot — optional. When provided, the counters reflect
   * the artifact counts in the live run. When absent or idle, all three
   * counters render as em-dashes.
   */
  readonly runState?: RunState;
}

/**
 * Client shell — wires Esc-to-close (document-level keydown scoped to the
 * open state) and focus-management (send focus to the close button on open,
 * restore it to the previously focused element — typically the <BrainIndicator />
 * button — on close).
 *
 * Outside-click / backdrop-click is handled inside the view via an invisible
 * <button> covering the backdrop that forwards onClick to onClose; we do
 * not add a separate document-level mousedown listener to avoid fighting
 * event ordering with Next.js's Link behaviours.
 */
export function BrainDetailModal(props: BrainDetailModalProps): ReactElement | null {
  const { open, onClose, runState } = props;
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember the element that opened the modal so we can restore focus
    // on close — typically the <BrainIndicator /> button, but any external
    // invoker is supported automatically.
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;

    // Focus the element marked with data-focus-return="close-button".
    const dialog = document.getElementById('brain-detail-modal');
    const focusTarget = dialog?.querySelector<HTMLElement>('[data-focus-return="close-button"]');
    focusTarget?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to whoever had it before the modal opened.
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  const counts = deriveArtifactCounts(runState);
  return (
    <BrainDetailModalView
      open={open}
      onClose={onClose}
      loreCount={counts.lore}
      orderCount={counts.order}
      tickCount={counts.tick}
    />
  );
}

/**
 * Map a RunState to the three counters the modal displays. Returns `null`
 * for any counter whose kind never appeared in the current artifact stream
 * (so the modal can render em-dashes instead of a misleading "0").
 *
 * Idle / null run state → every counter is null.
 */
function deriveArtifactCounts(runState: RunState | undefined): {
  lore: number | null;
  order: number | null;
  tick: number | null;
} {
  if (!runState || runState.phase === 'idle') {
    return { lore: null, order: null, tick: null };
  }
  const artifacts: Artifact[] = runState.artifacts;
  let lore = 0;
  let order = 0;
  let tick = 0;
  let seenLore = false;
  let seenOrder = false;
  let seenTick = false;
  for (const a of artifacts) {
    if (a.kind === 'lore-cid') {
      lore += 1;
      seenLore = true;
    } else if (a.kind === 'shill-order') {
      order += 1;
      seenOrder = true;
    } else if (a.kind === 'heartbeat-tick') {
      tick += 1;
      seenTick = true;
    }
  }
  return {
    lore: seenLore ? lore : null,
    order: seenOrder ? order : null,
    tick: seenTick ? tick : null,
  };
}
