'use client';

import { useState } from 'react';
import type { CreateRunRequest } from '@hack-fourmeme/shared';

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
    // Theme is currently ignored server-side for `a2a` (pre-seeded token), but
    // we still forward it so switching to the `creator` kind later needs no
    // UI changes.
    await onRun({
      kind: 'a2a',
      params: trimmed ? { theme: trimmed } : {},
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[640px] flex-col gap-3">
      <label htmlFor="theme" className="text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">
        Theme
      </label>
      <div className="flex items-stretch gap-3">
        <input
          id="theme"
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          disabled={disabled}
          placeholder="e.g. a meme for BNB Chain 2026 growth"
          className="flex-1 rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-4 py-3 font-[family-name:var(--font-sans-body)] text-[16px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-[var(--radius-default)] border-2 border-accent bg-bg-surface px-5 py-3 font-[family-name:var(--font-sans-body)] text-[16px] font-semibold text-accent-text transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disabled ? 'Running…' : 'Run swarm'}
        </button>
      </div>
    </form>
  );
}
