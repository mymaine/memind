'use client';

/**
 * /demo/glyph — visual QA surface for the <PixelHumanGlyph> component.
 *
 * Renders all 10 moods in a grid on a near-black terminal canvas so a
 * designer / developer can eyeball whether each mood reads distinctly.
 *
 * Not part of the main nav on purpose — it is an internal QA route only.
 */
import { useCallback, useState } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { MOODS, getMoodConfig } from '@/components/pixel-human-glyph/mood-registry';

// Derived from the registry so new one-shot moods participate in the
// "Trigger all non-loop" retrigger automatically.
const ONE_SHOT = new Set(MOODS.filter((m) => !getMoodConfig(m).loop));

export default function GlyphDemoPage(): React.ReactElement {
  const [size, setSize] = useState(150);
  // Force remount token for each one-shot mood so we can retrigger them.
  const [oneShotKey, setOneShotKey] = useState(0);

  const triggerAllNonLoop = useCallback(() => {
    setOneShotKey((k) => k + 1);
  }, []);

  return (
    <main className="min-h-screen bg-bg-primary px-8 py-10 text-fg-primary">
      <header className="mx-auto flex max-w-[1400px] flex-col gap-6 pb-8">
        <div>
          <h1 className="font-[family-name:var(--font-sans-display)] text-3xl font-semibold">
            PixelHumanGlyph — visual QA
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

          <button
            type="button"
            onClick={triggerAllNonLoop}
            className="rounded border border-accent px-3 py-1 text-xs uppercase tracking-wide text-accent-text hover:bg-bg-elevated"
          >
            Trigger all non-loop
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1400px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {MOODS.map((mood) => {
          const isOneShot = ONE_SHOT.has(mood);
          return (
            <div
              key={mood}
              className="flex flex-col items-center justify-center gap-3 border border-border-default bg-[#0a0a0a] py-8"
              style={{ minHeight: size + 120 }}
            >
              <PixelHumanGlyph
                key={isOneShot ? `${mood}-${oneShotKey}` : mood}
                mood={mood}
                size={size}
              />
              <div className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-fg-tertiary">
                {mood}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
