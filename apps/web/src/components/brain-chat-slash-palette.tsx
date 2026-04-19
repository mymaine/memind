/**
 * BrainChatSlashPalette — floating dropdown that renders the slash-command
 * candidate list above the BrainChat textarea (BRAIN-P6 Task 3 / AC-BRAIN-13).
 *
 * The component is deliberately dumb:
 *   - `open=false` → returns `null` (the parent BrainChat mounts the palette
 *     unconditionally but passes `open` derived from the hook).
 *   - `candidates=[]` while `open=true` → renders a "No matching commands"
 *     row so the user does not see a silently empty floater.
 *   - Every row is a `<button type="button">` so both mouse click and keyboard
 *     Enter activate cleanly. `aria-activedescendant` surfaces the highlighted
 *     row to assistive tech; `data-active="true"` is the visual highlight
 *     hook tests pin.
 *
 * Keyboard navigation (↑↓ / Tab / Enter / Esc) is NOT owned here. The parent
 * BrainChat's textarea handler drives the `useSlashPalette` hook; this
 * component only renders the current view.
 */
import type { ReactElement } from 'react';
import type { SlashCommand } from '@/lib/slash-commands';

export interface BrainChatSlashPaletteProps {
  readonly open: boolean;
  readonly candidates: readonly SlashCommand[];
  readonly activeIndex: number;
  readonly onPick: (cmd: SlashCommand) => void;
}

const PALETTE_CLASS =
  'absolute bottom-full left-0 right-0 z-10 mb-2 flex max-h-[280px] flex-col gap-0.5 overflow-y-auto rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-1 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)]';

const ROW_BASE =
  'flex w-full items-center gap-3 rounded-[var(--radius-default)] border border-transparent px-3 py-2 text-left font-[family-name:var(--font-sans-body)] text-[12px] text-fg-secondary transition-colors hover:border-accent';

const ROW_ACTIVE = 'border-accent bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)]';

export function BrainChatSlashPalette(props: BrainChatSlashPaletteProps): ReactElement | null {
  const { open, candidates, activeIndex, onPick } = props;
  if (!open) return null;

  if (candidates.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="Slash commands"
        data-testid="brain-chat-slash-palette"
        className={PALETTE_CLASS}
      >
        <div className="px-3 py-2 font-[family-name:var(--font-mono)] text-[11px] text-fg-tertiary">
          No matching commands
        </div>
      </div>
    );
  }

  const activeId = `slash-opt-${activeIndex.toString()}`;

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      aria-activedescendant={activeId}
      data-testid="brain-chat-slash-palette"
      className={PALETTE_CLASS}
    >
      {candidates.map((cmd, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            id={`slash-opt-${i.toString()}`}
            aria-selected={isActive}
            data-slash-name={cmd.name}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onPick(cmd)}
            className={`${ROW_BASE} ${isActive ? ROW_ACTIVE : ''}`}
          >
            <span className="shrink-0 font-[family-name:var(--font-mono)] text-[13px] text-fg-primary">
              /{cmd.name}
            </span>
            <span className="flex-1 text-fg-secondary">{cmd.description}</span>
            <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10px] text-fg-tertiary">
              {cmd.usage}
            </span>
          </button>
        );
      })}
    </div>
  );
}
