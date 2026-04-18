'use client';

/**
 * Core face SVG — the pieces that are always on screen regardless of mood:
 *   - left square bracket `[`
 *   - left eye dot `·`
 *   - right eye `|-` (vertical stroke + horizontal hint)
 *   - smirk mouth `⌣` (cubic curve, right end lifts)
 *   - right cursor `|` with yellow tip cap
 *
 * Each part carries a stable `data-part` attribute so unit tests can verify
 * structural contracts without depending on CSS selectors.
 *
 * All geometry is pure SVG primitives on a 160×80 viewBox. No gradients, no
 * filters, no drop-shadows — the design brief demands terminal-clean lines.
 */
import type { ReactElement } from 'react';

export function GlyphFace(): ReactElement {
  return (
    <g data-layer="face">
      {/* Left square bracket [ — two short caps + a vertical stem. */}
      <g data-part="bracket" className="glyph-face__bracket">
        <path
          d="M 26 16 L 18 16 L 18 64 L 26 64"
          fill="none"
          stroke="var(--glyph-primary)"
          strokeWidth={5}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </g>

      {/* Left eye dot · — a single filled circle. Idle blink/wink squashes
          this vertically via scaleY animation on the parent <g>. */}
      <g data-part="eye-left" className="glyph-face__eye-left">
        <circle cx={46} cy={40} r={4} fill="var(--glyph-primary)" />
      </g>

      {/* Right eye |- — vertical stroke with a tiny horizontal hint on its
          left side. The horizontal hint gives the smirk its lopsided charm. */}
      <g data-part="eye-right" className="glyph-face__eye-right">
        <line
          x1={68}
          y1={40}
          x2={74}
          y2={40}
          stroke="var(--glyph-primary)"
          strokeWidth={5}
          strokeLinecap="square"
        />
        <line
          x1={76}
          y1={28}
          x2={76}
          y2={52}
          stroke="var(--glyph-primary)"
          strokeWidth={5}
          strokeLinecap="square"
        />
      </g>

      {/* Smirk mouth ⌣ — cubic curve. Left ends a touch low, right tip lifts
          ~2px to give the asymmetric smirk read. */}
      <g data-part="mouth" className="glyph-face__mouth">
        <path
          d="M 88 52 C 96 60, 106 60, 116 50"
          fill="none"
          stroke="var(--glyph-primary)"
          strokeWidth={5}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </g>

      {/* Right cursor | — vertical stroke with a yellow tip cap on its top
          ~18%. Idle mood blinks the stroke via opacity animation in CSS. */}
      <g data-part="cursor" className="glyph-face__cursor">
        <line
          x1={132}
          y1={18}
          x2={132}
          y2={22}
          stroke="var(--glyph-accent)"
          strokeWidth={7}
          strokeLinecap="square"
          data-cursor-tip
        />
        <line
          x1={132}
          y1={22}
          x2={132}
          y2={62}
          stroke="var(--glyph-primary)"
          strokeWidth={5}
          strokeLinecap="square"
          data-cursor-stem
        />
      </g>
    </g>
  );
}
