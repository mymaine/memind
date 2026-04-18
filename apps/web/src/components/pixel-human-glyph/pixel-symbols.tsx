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

    case 'sunglasses':
      // Black shades spanning the eye row (y=4). The main bar covers both eye
      // slots and one pixel of frame on each side; the two accent pixels on
      // y=3 suggest the top rim so the shape reads as glasses, not a mask.
      return (
        <g data-layer="sunglasses" className="pixel-symbols pixel-symbols--sunglasses">
          <PixelBlock
            className="pixel-symbols__shades"
            pixels={[
              // main bar
              [8, 4],
              [9, 4],
              [10, 4],
              [11, 4],
              [12, 4],
              // top frame accents above each lens
              [8, 3],
              [12, 3],
            ]}
            fill="#111"
          />
        </g>
      );

    case 'type-keyboard':
      // Tiny pixel keyboard floated in front of the figure. Base row on y=9
      // and three key pips on y=8 keep clear of the feet at y=7. The 3-key
      // silhouette with underbar is the most legible keyboard within 6 px.
      return (
        <g data-layer="keyboard" className="pixel-symbols pixel-symbols--keyboard">
          <PixelBlock
            className="pixel-symbols__keyboard"
            pixels={[
              // top row: three key caps
              [8, 8],
              [10, 8],
              [12, 8],
              // base row: full chassis
              [7, 9],
              [8, 9],
              [9, 9],
              [10, 9],
              [11, 9],
              [12, 9],
            ]}
            fill="var(--pixel-accent)"
          />
        </g>
      );

    case 'megaphone':
      // Pixel megaphone aimed to the right of the figure with three staggered
      // sound-wave pips further right. Shape: narrow grip on x=14, a slanted
      // body on x=15, a vertical 5-pixel bell on x=16. Waves sit on x=17..18.
      return (
        <g data-layer="megaphone" className="pixel-symbols pixel-symbols--megaphone">
          <PixelBlock
            className="pixel-symbols__horn"
            pixels={[
              // grip
              [14, 4],
              [14, 5],
              // slanted body pixels hint at a widening cone
              [15, 3],
              [15, 6],
              // bell mouth (tall vertical)
              [16, 2],
              [16, 3],
              [16, 4],
              [16, 5],
              [16, 6],
            ]}
            fill="var(--pixel-primary)"
          />
          {/* Each wave pip animates independently via stagger delays. */}
          <PixelBlock
            className="pixel-symbols__wave pixel-symbols__wave--0"
            pixels={[[17, 2]]}
            fill="var(--pixel-accent)"
          />
          <PixelBlock
            className="pixel-symbols__wave pixel-symbols__wave--1"
            pixels={[[18, 4]]}
            fill="var(--pixel-accent)"
          />
          <PixelBlock
            className="pixel-symbols__wave pixel-symbols__wave--2"
            pixels={[[17, 6]]}
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
