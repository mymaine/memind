'use client';

/**
 * Mood-specific symbol overlays. Each `<GlyphSymbols />` returns the correct
 * SVG text set for a given mood; if the mood has no symbols (idle / walk /
 * clap / glitch / jump) the component returns `null` and contributes zero
 * extra DOM.
 *
 * Symbol characters are rendered via inline SVG `<text>` to keep the bundle
 * small — inline-SVG `<path>` for each glyph would balloon the CSS size.
 */
import type { ReactElement } from 'react';
import type { ShillingMood } from './mood-registry';

interface Props {
  mood: ShillingMood;
}

export function GlyphSymbols({ mood }: Props): ReactElement | null {
  switch (mood) {
    case 'sleep':
      return (
        <g data-layer="sleep-zs" className="glyph-symbols glyph-symbols--sleep">
          <text
            x={96}
            y={18}
            fontSize={12}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__z glyph-symbols__z--a"
          >
            z
          </text>
          <text
            x={110}
            y={12}
            fontSize={15}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__z glyph-symbols__z--b"
          >
            Z
          </text>
          <text
            x={126}
            y={8}
            fontSize={18}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__z glyph-symbols__z--c"
          >
            Zz
          </text>
        </g>
      );

    case 'work':
      return (
        <g data-layer="work-dots" className="glyph-symbols glyph-symbols--work">
          {/* Three dots sweeping left→right above the head — typing indicator. */}
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={72 + i * 12}
              cy={10}
              r={2.5}
              fill="var(--glyph-primary)"
              className={`glyph-symbols__dot glyph-symbols__dot--${i}`}
            />
          ))}
        </g>
      );

    case 'think':
      return (
        <g data-layer="think-dots" className="glyph-symbols glyph-symbols--think">
          {[0, 1, 2].map((i) => (
            <text
              key={i}
              x={72 + i * 10}
              y={14}
              fontSize={14}
              fontFamily="var(--font-mono, monospace)"
              fill="var(--glyph-primary)"
              textAnchor="middle"
              className={`glyph-symbols__dot glyph-symbols__dot--${i}`}
            >
              .
            </text>
          ))}
        </g>
      );

    case 'surprise':
      return (
        <g data-layer="surprise-bang" className="glyph-symbols glyph-symbols--surprise">
          <text
            x={80}
            y={18}
            fontSize={20}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__bang"
          >
            !
          </text>
        </g>
      );

    case 'celebrate':
      return (
        <g data-layer="celebrate-sparkles" className="glyph-symbols glyph-symbols--celebrate">
          <text
            x={24}
            y={26}
            fontSize={14}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__sparkle glyph-symbols__sparkle--a"
          >
            ✦
          </text>
          <text
            x={140}
            y={30}
            fontSize={12}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__sparkle glyph-symbols__sparkle--b"
          >
            ✧
          </text>
          <text
            x={32}
            y={60}
            fontSize={10}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__sparkle glyph-symbols__sparkle--c"
          >
            ✧
          </text>
          <text
            x={148}
            y={62}
            fontSize={14}
            fontFamily="var(--font-mono, monospace)"
            fill="var(--glyph-primary)"
            textAnchor="middle"
            className="glyph-symbols__sparkle glyph-symbols__sparkle--d"
          >
            ✦
          </text>
        </g>
      );

    default:
      return null;
  }
}
