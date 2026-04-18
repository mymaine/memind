'use client';

import { useState } from 'react';
import type { CreateRunRequest } from '@hack-fourmeme/shared';
import { PresetButtons } from './preset-buttons';

export interface ThemeInputProps {
  /** Kick off a run. For Step C we only invoke the `a2a` kind. */
  onRun: (input: CreateRunRequest) => Promise<void>;
  /** True while a run is live — used to lock the form & relabel the CTA. */
  disabled: boolean;
}

export function ThemeInput({ onRun, disabled }: ThemeInputProps) {
  const [theme, setTheme] = useState('');

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (disabled) return;
    const trimmed = theme.trim();
    // V2-P5 Task 1: the server now forwards `params.theme` into the Creator
    // phase (runs/a2a.ts). Blank string → orchestrator default kicks in.
    await onRun({
      kind: 'a2a',
      params: trimmed ? { theme: trimmed } : {},
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[720px] flex-col gap-2">
      <div className="flex items-stretch gap-3">
        <input
          id="theme"
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          disabled={disabled}
          placeholder="Theme — e.g. a meme for BNB Chain 2026 growth"
          className="flex-1 rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-4 py-2 font-[family-name:var(--font-sans-body)] text-[14px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-[var(--radius-default)] border-2 border-accent bg-bg-surface px-4 py-2 font-[family-name:var(--font-sans-body)] text-[14px] font-semibold text-accent-text transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disabled ? 'Running…' : 'Run swarm'}
        </button>
      </div>
      {/* V2-P5 Task 2: preset fill-ins. Clicking only writes into state; the
          user still has to press Run so two rapid clicks do not trip the
          per-tokenAddress concurrency mutex. */}
      <PresetButtons onSelect={setTheme} disabled={disabled} />
    </form>
  );
}
