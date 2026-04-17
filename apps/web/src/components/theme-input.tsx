'use client';

import { useState } from 'react';

export function ThemeInput() {
  const [theme, setTheme] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!theme.trim() || submitting) return;
    setSubmitting(true);
    // TODO(Phase 2): POST /agents/creator/run with SSE subscription. Placeholder only.
    setTimeout(() => setSubmitting(false), 400);
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
          placeholder="e.g. a meme for BNB Chain 2026 growth"
          className="flex-1 rounded-[var(--radius-default)] border border-border-default bg-bg-surface px-4 py-3 font-[family-name:var(--font-sans-body)] text-[16px] text-fg-primary placeholder:text-fg-tertiary focus:border-2 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={submitting || !theme.trim()}
          className="rounded-[var(--radius-default)] border-2 border-accent bg-bg-surface px-5 py-3 font-[family-name:var(--font-sans-body)] text-[16px] font-semibold text-accent-text transition-opacity duration-150 hover:opacity-80 disabled:opacity-40"
        >
          {submitting ? 'Spawning…' : 'Run swarm'}
        </button>
      </div>
    </form>
  );
}
