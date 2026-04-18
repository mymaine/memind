'use client';

/**
 * PresetButtons — three one-click theme fill-ins surfaced next to the
 * ThemeInput. Clicking a preset ONLY writes the text into the input state;
 * the user still has to press Run to kick off the swarm. This avoids the
 * per-tokenAddress concurrency lock from tripping when the demo viewer
 * clicks quickly (AC-V2-7).
 *
 * Kept deliberately slim: no dropdown, no keyboard nav, no hover animation —
 * the recorded demo viewer clicks once and moves on.
 */
import { PRESET_THEMES } from './preset-texts';

export interface PresetButtonsProps {
  /** Called with the chosen preset string so the parent can fill ThemeInput. */
  onSelect: (text: string) => void;
  /** Locks the buttons while a run is live. */
  disabled?: boolean;
}

export function PresetButtons({ onSelect, disabled = false }: PresetButtonsProps) {
  return (
    <div role="group" aria-label="theme presets" className="flex flex-wrap items-center gap-2">
      <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.5px] text-fg-tertiary">
        presets
      </span>
      {PRESET_THEMES.map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(text)}
          title={text}
          className="rounded-full border border-border-default bg-bg-surface px-3 py-1 font-[family-name:var(--font-mono)] text-[11px] text-fg-secondary transition-colors hover:border-accent hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {/* Short label = first 3 words so the pill fits on a single line on
              1920x960; the full text lives in the title tooltip + fills the
              input when clicked. */}
          {text.split(' ').slice(0, 3).join(' ')}…
        </button>
      ))}
    </div>
  );
}
