'use client';

/**
 * /demo/glyph — visual QA surface for the <ShillingGlyph> component.
 *
 * Renders all 10 moods in a grid on a near-black terminal canvas so a
 * designer / reviewer can eyeball whether each mood reads distinctly and
 * matches the spec table in `docs/features/demo-narrative-ui.md`.
 *
 * Not part of the main nav on purpose — it is an internal QA route only.
 */
import { useCallback, useState } from 'react';
import { ShillingGlyph } from '@/components/shilling-glyph';
import { MOODS } from '@/components/shilling-glyph/mood-registry';

const ONE_SHOT = new Set(['jump', 'surprise', 'celebrate'] as const);

type OneShotMood = 'jump' | 'surprise' | 'celebrate';

export default function GlyphDemoPage(): React.ReactElement {
  const [size, setSize] = useState(150);
  const [disableIdleMicro, setDisableIdleMicro] = useState(false);
  // Force remount token for each one-shot mood so we can retrigger them.
  const [oneShotKey, setOneShotKey] = useState(0);
  const [hoverKey, setHoverKey] = useState(0);

  const triggerAllNonLoop = useCallback(() => {
    setOneShotKey((k) => k + 1);
  }, []);

  const pingHoverTease = useCallback(() => {
    // Forces the hover-tease card to remount + dispatch its own mouseenter.
    setHoverKey((k) => k + 1);
  }, []);

  return (
    <main className="min-h-screen bg-bg-primary px-8 py-10 text-fg-primary">
      <header className="mx-auto flex max-w-[1400px] flex-col gap-6 pb-8">
        <div>
          <h1 className="font-[family-name:var(--font-sans-display)] text-3xl font-semibold">
            ShillingGlyph — visual QA
          </h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            All 10 moods on the brand canvas. Use DevTools rendering panel to emulate{' '}
            <code>prefers-reduced-motion</code> and verify the fallback.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 border border-border-default bg-bg-surface px-5 py-4 text-sm">
          <label className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-fg-tertiary">
              size
            </span>
            <input
              type="range"
              min={16}
              max={200}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
            <span className="w-10 text-right font-[family-name:var(--font-mono)] text-xs">
              {size}px
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={disableIdleMicro}
              onChange={(e) => setDisableIdleMicro(e.target.checked)}
            />
            <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-fg-tertiary">
              disableIdleMicro
            </span>
          </label>

          <button
            type="button"
            onClick={triggerAllNonLoop}
            className="rounded border border-accent px-3 py-1 text-xs uppercase tracking-wide text-accent-text hover:bg-bg-elevated"
          >
            Trigger all non-loop
          </button>

          <button
            type="button"
            onClick={pingHoverTease}
            className="rounded border border-border-default px-3 py-1 text-xs uppercase tracking-wide text-fg-tertiary hover:text-fg-primary"
          >
            Ping hover tease
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1400px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {MOODS.map((mood) => {
          // One-shot moods auto-terminate; remount via `key` so clicking
          // "Trigger all non-loop" restarts their animation cleanly.
          const isOneShot = ONE_SHOT.has(mood as OneShotMood);
          return (
            <div
              key={mood}
              className="flex flex-col items-center justify-center gap-3 border border-border-default bg-[#0a0a0a] py-8"
              style={{ minHeight: size + 120 }}
            >
              <ShillingGlyph
                key={isOneShot ? `${mood}-${oneShotKey}` : mood}
                mood={mood}
                size={size}
                disableIdleMicro={disableIdleMicro}
              />
              <div className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-fg-tertiary">
                {mood}
              </div>
            </div>
          );
        })}
      </section>

      <section className="mx-auto mt-12 max-w-[1400px] border border-border-default bg-[#0a0a0a] p-6">
        <div className="mb-4 font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-fg-tertiary">
          Hover tease demo — hover the glyph or click &quot;ping hover tease&quot;
        </div>
        <div className="flex items-center justify-center py-6" key={`hover-${hoverKey}`}>
          <ShillingGlyph mood="idle" size={Math.max(80, size)} />
        </div>
      </section>
    </main>
  );
}
