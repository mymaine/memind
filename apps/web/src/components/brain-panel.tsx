'use client';

/**
 * BrainPanel — right-side slide-in panel opened from the TopBar's
 * <BrainIndicator /> (memind-scrollytelling-rebuild AC-MSR-7).
 *
 * Replaces the old <BrainDetailModal /> centred dialog. Composition:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ header  ─ PixelHumanGlyph · TOKEN BRAIN · × │
 *   │ meta    ─ status · persona · tick · memory │
 *   │ chat    ─ <BrainChat scope="global" />     │
 *   └──────────────────────────────────────────┘
 *
 * The panel is always mounted (so the slide-in transform has something to
 * animate); `aria-hidden` toggles with `open` so assistive tech ignores
 * the panel while it sits off-screen. Close triggers:
 *   - Esc keydown (document-level, only active while open).
 *   - Mousedown outside the aside (delayed one frame after open so the
 *     same click that flipped open does not immediately re-close).
 *   - The × close button inside the header.
 *
 * BrainChat is mounted with `scope="global"` per AC-MSR-7; `initialDraft`
 * flows straight through to the composer so Hero CTAs (/launch / /order)
 * can pre-populate the textarea. The draft only seeds the composer on
 * first mount — a fresh open with a different draft needs the caller to
 * remount via a `key` prop. BrainPanel handles this by keying the nested
 * BrainChat on `initialDraft`, so re-opening the panel with a new draft
 * resets the composer but holding the same draft keeps in-progress text.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import type { RunState } from '@/hooks/useRun-state';
import { PixelHumanGlyph, type ShillingMood } from '@/components/pixel-human-glyph';
import { BrainChat } from '@/components/brain-chat';
import { deriveBrainStatus, deriveActivePersonaLabel } from '@/components/brain-status-bar-utils';

export interface BrainPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly runState: RunState;
  /**
   * Optional initial composer draft injected into BrainChat when the panel
   * first mounts with this value. Used by Hero CTAs (`/launch ` / `/order `)
   * or any future deep-link handler that wants to pre-fill a slash command.
   * Changing the draft across re-opens remounts BrainChat via the internal
   * key so the composer resets cleanly.
   */
  readonly initialDraft?: string;
}

export function BrainPanel({
  open,
  onClose,
  runState,
  initialDraft,
}: BrainPanelProps): ReactElement {
  const status = deriveBrainStatus(runState);
  const persona = deriveActivePersonaLabel(runState);
  const glyphMood: ShillingMood = status === 'online' ? 'think' : 'idle';
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      const node = asideRef.current;
      if (node !== null && !node.contains(e.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    // Delay the outside-click listener by one frame so the click that
    // opened the panel does not immediately close it. rAF is fine in the
    // browser; in test / SSR environments `requestAnimationFrame` is a
    // no-op so we fall back to a microtask via setTimeout(_, 0).
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(() => {
        document.addEventListener('mousedown', onClickOutside);
      });
    } else {
      timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', onClickOutside);
      }, 0);
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      if (timeoutId !== null) clearTimeout(timeoutId);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, onClose]);

  // UAT issue #6: hovering the open panel and scrolling the wheel must NOT
  // drive the page's StickyStage scroll. The panel is `position: fixed`, so
  // wheel events that no scrollable descendant consumes bubble straight to
  // `window` and useScrollY reacts — users saw the narrative advance while
  // they tried to read the brain transcript. React's synthetic `onWheel`
  // cannot `preventDefault()` (passive by default), so we attach a native
  // listener with `{ passive: false }` and swallow deltas that would leak
  // past the nearest scrollable child.
  useEffect(() => {
    const node = asideRef.current;
    if (node === null) return;
    const handleWheel = (e: WheelEvent): void => {
      // Walk up from the event target inside the panel; if we find a
      // scrollable element that still has room in the requested direction,
      // let it handle the wheel natively. If we hit a boundary or never
      // find one, preventDefault so `window` never sees this delta.
      const target = e.target as Element | null;
      if (target === null) return;
      let cursor: Element | null = target;
      while (cursor !== null && cursor !== node) {
        if (cursor instanceof HTMLElement) {
          const style = window.getComputedStyle(cursor);
          const overflowY = style.overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') {
            const { scrollTop, scrollHeight, clientHeight } = cursor;
            const hasRoom = scrollHeight > clientHeight + 0.5;
            if (hasRoom) {
              const atTop = scrollTop <= 0 && e.deltaY < 0;
              const atBottom = scrollTop + clientHeight >= scrollHeight - 0.5 && e.deltaY > 0;
              if (atTop || atBottom) {
                e.preventDefault();
              }
              return;
            }
          }
        }
        cursor = cursor.parentElement;
      }
      // No scrollable descendant absorbed the wheel — stop it at the panel
      // boundary so the page underneath stays still.
      e.preventDefault();
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Memory meta row: logs.length + artifacts.length both live on RunState
  // regardless of phase, so the empty / idle case falls out naturally.
  const logsCount = runState.logs.length;
  const artifactsCount = runState.artifacts.length;

  return (
    <aside
      ref={asideRef}
      className={`brain-panel ${open ? 'open' : ''}`}
      aria-hidden={!open}
      aria-label="Token Brain panel"
    >
      <header className="brain-panel-head">
        <PixelHumanGlyph
          size={28}
          mood={glyphMood}
          primaryColor="var(--accent)"
          accentColor="var(--chain-bnb)"
        />
        <h3 className="brain-panel-title">TOKEN BRAIN</h3>
        <button
          type="button"
          className="brain-panel-close"
          onClick={onClose}
          aria-label="Close brain panel"
        >
          ×
        </button>
      </header>
      <section className="brain-panel-meta" aria-label="Brain meta">
        <MetaRow label="status" value={status} />
        <MetaRow label="persona" value={persona ?? '—'} />
        <MetaRow label="tick" value="5s · autonomous" />
        <MetaRow
          label="memory"
          value={`${logsCount.toString()} logs · ${artifactsCount.toString()} artifacts`}
        />
      </section>
      <section className="brain-panel-chat" aria-label="Brain chat">
        <BrainChat
          key={initialDraft ?? ''}
          scope="global"
          initialDraft={initialDraft}
          className="brain-panel-chat-inner"
        />
      </section>
    </aside>
  );
}

function MetaRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="brain-panel-meta-row">
      <span className="brain-panel-meta-label mono">{label}</span>
      <span className="brain-panel-meta-value mono">{value}</span>
    </div>
  );
}
