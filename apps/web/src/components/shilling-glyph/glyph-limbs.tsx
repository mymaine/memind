'use client';

/**
 * Walk / clap limb overlays — rendered only for the relevant moods. Kept as
 * a separate component so the idle render stays lean (zero extra DOM nodes
 * when no limbs are needed).
 *
 * Walk limbs   : two slanted stroke characters `/` and `\` beneath the face,
 *                alternating in a 0.35s CSS cycle (see glyph-animations.css).
 * Clap hands   : `<` and `>` siblings just outside the face bounds; the
 *                alternation is driven by the `glyph--clap` keyframes.
 */
import type { ReactElement } from 'react';

export type LimbMode = 'walk' | 'clap';

export function GlyphLimbs({ mode }: { mode: LimbMode }): ReactElement {
  if (mode === 'clap') {
    return (
      <g data-layer="claps" className="glyph-limbs glyph-limbs--clap">
        <text
          x={6}
          y={46}
          fontSize={22}
          fontFamily="var(--font-mono, monospace)"
          fill="var(--glyph-primary)"
          textAnchor="middle"
          dominantBaseline="middle"
          className="glyph-limbs__hand glyph-limbs__hand--left"
        >
          {'<'}
        </text>
        <text
          x={154}
          y={46}
          fontSize={22}
          fontFamily="var(--font-mono, monospace)"
          fill="var(--glyph-primary)"
          textAnchor="middle"
          dominantBaseline="middle"
          className="glyph-limbs__hand glyph-limbs__hand--right"
        >
          {'>'}
        </text>
      </g>
    );
  }

  // walk
  return (
    <g data-layer="limbs" className="glyph-limbs glyph-limbs--walk">
      <text
        x={66}
        y={76}
        fontSize={18}
        fontFamily="var(--font-mono, monospace)"
        fill="var(--glyph-primary)"
        textAnchor="middle"
        dominantBaseline="middle"
        className="glyph-limbs__leg glyph-limbs__leg--a"
      >
        {'/'}
      </text>
      <text
        x={90}
        y={76}
        fontSize={18}
        fontFamily="var(--font-mono, monospace)"
        fill="var(--glyph-primary)"
        textAnchor="middle"
        dominantBaseline="middle"
        className="glyph-limbs__leg glyph-limbs__leg--b"
      >
        {'\\'}
      </text>
    </g>
  );
}
