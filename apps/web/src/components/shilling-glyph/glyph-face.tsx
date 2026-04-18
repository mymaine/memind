'use client';

/**
 * Core face SVG — the pieces that are always on screen regardless of mood:
 *   - left square bracket `[`
 *   - two symmetric round eyes at (46, 40) and (76, 40)
 *   - cheerful mouth — cubic curve with deep mid-sag for a clear upturned smile
 *   - right cursor `|` with yellow tip cap
 *
 * Mouth path endpoints stay at y=52 so `sleep` / `think` moods can swap in a
 * flat `M 88 52 L 116 52` without visual misalignment; only the control points
 * differ for the idle smile.
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

      {/* Right eye — matches the left eye for a symmetric, readable face.
          Moods that need the right eye closed (sleep) or widened (surprise)
          transform this circle at the container level in glyph-animations.css. */}
      <g data-part="eye-right" className="glyph-face__eye-right">
        <circle cx={76} cy={40} r={4} fill="var(--glyph-primary)" />
      </g>

      {/* Cheerful smile — cubic with deep mid-sag so the upturn reads even at
          32px. Endpoints stay at y=52 so sleep / think moods can flatten it
          to a straight line (`M 88 52 L 116 52`) without offset. */}
      <g data-part="mouth" className="glyph-face__mouth">
        <path
          d="M 88 52 C 96 66, 106 66, 116 52"
          fill="none"
          stroke="var(--glyph-primary)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
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
