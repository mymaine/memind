/**
 * Chapter primitives — shared building blocks for Ch1-11 components
 * (memind-scrollytelling-rebuild P0 Task 3, AC-MSR-9).
 *
 * Ported verbatim from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 11-34
 * and rewritten in TypeScript. These four components + three math helpers
 * render against the CSS classes already ported into `app/globals.css`:
 *
 *   - `<Label n={N}>`   → `.ch-label` / `.ch-label-num` / `.ch-label-bar`
 *                         / `.ch-label-text`
 *   - `<BigHeadline>`   → `.ch-headline`
 *   - `<Mono dim?>`     → `.mono` (+ `color: var(--fg-tertiary)` when dim)
 *   - `<Pill color>`    → `.pill` / `.pill-dot`
 *   - `clamp` / `lerp` / `fmt` — pure math helpers used by several chapters
 *
 * Kept free of `PixelHumanGlyph` and chapter-specific state so every ch*
 * module can import from one place without pulling in unrelated deps.
 */
import type { CSSProperties, ReactNode } from 'react';

export function Label({ n, children }: { n: number; children: ReactNode }) {
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
}) {
  return (
    <h1 className="ch-headline" style={{ fontSize: size, ...style }}>
      {children}
    </h1>
  );
}

export function Mono({ children, dim }: { children: ReactNode; dim?: boolean }) {
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
}) {
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
