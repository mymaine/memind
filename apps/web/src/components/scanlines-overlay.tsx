/**
 * ScanlinesOverlay — optional CRT scanlines layer
 * (memind-scrollytelling-rebuild AC-MSR-13).
 *
 * The `.scanlines-overlay` CSS class (globals.css) paints a fixed
 * `repeating-linear-gradient` on top of the page at z-index 200. This
 * component is a thin gate: when `enabled=false` nothing is rendered so
 * the overlay can be toggled via the Tweaks panel or disabled under
 * `prefers-reduced-motion: reduce` without leaving a hidden DOM node
 * behind.
 *
 * `aria-hidden` is set because the overlay is purely decorative — the
 * scanline texture is irrelevant to assistive tech.
 *
 * Port reference: design-handoff `app.jsx` line 352.
 */
import type { ReactElement } from 'react';

export interface ScanlinesOverlayProps {
  readonly enabled: boolean;
}

export function ScanlinesOverlay({ enabled }: ScanlinesOverlayProps): ReactElement | null {
  if (!enabled) return null;
  return <div className="scanlines-overlay" aria-hidden="true" />;
}
