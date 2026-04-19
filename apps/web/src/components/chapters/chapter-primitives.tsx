/**
 * Chapter primitives — shared building blocks for Ch1-11 components
 * (memind-scrollytelling-rebuild P0 Task 3, AC-MSR-9).
 *
 * Ported verbatim from the design handoff and rewritten in TypeScript. These
 * four components + three math helpers render against the CSS classes
 * already ported into `app/globals.css`:
 *
 *   - `<Label n={N}>`   → `.ch-label` / `.ch-label-num` / `.ch-label-bar`
 *                         / `.ch-label-text`
 *   - `<BigHeadline>`   → `.ch-headline`
 *   - `<Mono dim?>`     → `.mono` (+ `color: var(--fg-tertiary)` when dim)
 *   - `<Pill color>`    → `.pill` / `.pill-dot`
 *   - `<AnimatedLabel>` → `.demo-side-label` + auto-cycling `.`/`..`/`...`
 *                         suffix (UAT issue #8). Client-only; SSR emits
 *                         the base string with an empty dot span.
 *   - `clamp` / `lerp` / `fmt` — pure math helpers used by several chapters
 *
 * Kept free of `PixelHumanGlyph` and chapter-specific state so every ch*
 * module can import from one place without pulling in unrelated deps.
 */
'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

export function Label({ n, children }: { n: number; children: ReactNode }): ReactElement {
  return (
    <div className="ch-label">
      <span className="ch-label-num">CH.{String(n).padStart(2, '0')}</span>
      <span className="ch-label-bar" />
      <span className="ch-label-text">{children}</span>
    </div>
  );
}

export function BigHeadline({
  children,
  size = 120,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}): ReactElement {
  return (
    <h1 className="ch-headline" style={{ fontSize: size, ...style }}>
      {children}
    </h1>
  );
}

export function Mono({ children, dim }: { children: ReactNode; dim?: boolean }): ReactElement {
  return (
    <span className="mono" style={dim ? { color: 'var(--fg-tertiary)' } : undefined}>
      {children}
    </span>
  );
}

export function Pill({
  color,
  children,
  dot = true,
}: {
  color: string;
  children: ReactNode;
  dot?: boolean;
}): ReactElement {
  return (
    <span className="pill">
      {dot && <span className="pill-dot" style={{ background: color }} />}
      <span>{children}</span>
    </span>
  );
}

/** Clamp `v` into [lo, hi]. Default range is [0, 1]. */
export const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));

/** Linearly interpolate between `a` and `b` by `t`. `t` is NOT clamped. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Format a number to fixed decimals (default 2). */
export const fmt = (n: number, d = 2): string => Number(n).toFixed(d);

/**
 * <AnimatedLabel> — `.demo-side-label` with a client-side looping dot
 * suffix. Used by Ch5 ("brain is typing") and Ch6 ("broadcasting") to
 * telegraph that the brain is doing work even when the scroll is paused
 * on a hold tick (UAT issue #8).
 *
 * SSR renders the base string + an empty `.demo-side-dots` span so the
 * initial HTML is deterministic and hydration-safe. On mount, setInterval
 * cycles the dot count 0 → 1 → 2 → 3 → 0 every 350ms. Cleanup is handled
 * so the interval does not leak if the parent unmounts.
 */
export function AnimatedLabel({ base }: { base: string }): ReactElement {
  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setDotCount((d) => (d + 1) % 4);
    }, 350);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="demo-side-label">
      {base}
      <span className="demo-side-dots" aria-hidden>
        {'.'.repeat(dotCount)}
      </span>
    </div>
  );
}
