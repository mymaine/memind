'use client';

// Mood-specific overlay symbols for the pixel human. Coords fit the 12x10
// viewBox window starting at (4, 0) — head spans x=7..12, y=2..6. Each
// overlay is only rendered for the mood that needs it so idle/walk/jump
// stay DOM-lean.
import type { ReactElement } from 'react';
import type { ShillingMood } from './mood-registry';

interface Props {
  mood: ShillingMood;
}

// Helper: render a block of 1x1 rects using the shared primary color.
function PixelBlock({
  pixels,
  fill = 'var(--pixel-primary)',
  className,
}: {
  pixels: ReadonlyArray<readonly [number, number]>;
  fill?: string;
  className?: string;
}): ReactElement {
  return (
    <g className={className}>
      {pixels.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </g>
  );
}

export function PixelSymbols({ mood }: Props): ReactElement | null {
  switch (mood) {
    case 'sleep':
      // Two tiny pixel Zs drifting up-right of the tipped-over head.
      return (
        <g data-layer="sleep-zs" className="pixel-symbols pixel-symbols--sleep">
          <PixelBlock
            className="pixel-symbols__z pixel-symbols__z--a"
            pixels={[
              [14, 3],
              [15, 3],
              [15, 4],
              [14, 5],
              [15, 5],
            ]}
            fill="var(--pixel-accent)"
          />
          <PixelBlock
            className="pixel-symbols__z pixel-symbols__z--b"
            pixels={[
              [16, 0],
              [17, 0],
              [17, 1],
              [16, 2],
              [17, 2],
            ]}
            fill="var(--pixel-accent)"
          />
        </g>
      );

    case 'work':
      // Three tick marks floating above the head.
      return (
        <g data-layer="work-dots" className="pixel-symbols pixel-symbols--work">
          <PixelBlock className="pixel-symbols__dot pixel-symbols__dot--0" pixels={[[8, 0]]} />
          <PixelBlock className="pixel-symbols__dot pixel-symbols__dot--1" pixels={[[10, 0]]} />
          <PixelBlock className="pixel-symbols__dot pixel-symbols__dot--2" pixels={[[12, 0]]} />
        </g>
      );

    case 'think':
      // "..." pixels to the upper-right of the head.
      return (
        <g data-layer="think-dots" className="pixel-symbols pixel-symbols--think">
          <PixelBlock className="pixel-symbols__dot pixel-symbols__dot--0" pixels={[[14, 1]]} />
          <PixelBlock className="pixel-symbols__dot pixel-symbols__dot--1" pixels={[[16, 1]]} />
          <PixelBlock className="pixel-symbols__dot pixel-symbols__dot--2" pixels={[[18, 1]]} />
        </g>
      );

    case 'surprise':
      // Pixel exclamation mark bursting above the head.
      return (
        <g data-layer="surprise-bang" className="pixel-symbols pixel-symbols--surprise">
          <PixelBlock
            className="pixel-symbols__bang"
            pixels={[
              [15, 0],
              [15, 1],
              // dot gap, tail below
              [15, 3],
            ]}
            fill="var(--pixel-accent)"
          />
        </g>
      );

    case 'celebrate':
      // Four pixel-plus sparkles scattered around the figure.
      return (
        <g data-layer="celebrate-sparkles" className="pixel-symbols pixel-symbols--celebrate">
          <PixelBlock
            className="pixel-symbols__sparkle pixel-symbols__sparkle--a"
            pixels={[
              [2, 2],
              [1, 3],
              [2, 3],
              [3, 3],
              [2, 4],
            ]}
            fill="var(--pixel-accent)"
          />
          <PixelBlock
            className="pixel-symbols__sparkle pixel-symbols__sparkle--b"
            pixels={[
              [17, 3],
              [16, 4],
              [17, 4],
              [18, 4],
              [17, 5],
            ]}
            fill="var(--pixel-accent)"
          />
          <PixelBlock
            className="pixel-symbols__sparkle pixel-symbols__sparkle--c"
            pixels={[
              [3, 10],
              [2, 11],
              [3, 11],
              [4, 11],
              [3, 12],
            ]}
            fill="var(--pixel-accent)"
          />
          <PixelBlock
            className="pixel-symbols__sparkle pixel-symbols__sparkle--d"
            pixels={[
              [16, 10],
              [15, 11],
              [16, 11],
              [17, 11],
              [16, 12],
            ]}
            fill="var(--pixel-accent)"
          />
        </g>
      );

    default:
      return null;
  }
}
