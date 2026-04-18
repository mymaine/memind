'use client';

// Minimalist pixel mascot: a single rectangular head block + 4 floating
// pixel dots — hands tucked against the head's lower sides, feet directly
// under the head. Intentionally no torso and no cheek blush — the sparsity
// is the personality. Each <rect> is a 1x1 pixel so CSS transforms stay
// crisp at any display size.
import type { ReactElement } from 'react';

// Head block — a solid 6x5 rectangle spanning x=7..12, y=2..6, with two
// 1x1 negative-space eyes at (9,4) and (11,4).
const HEAD_PIXELS: ReadonlyArray<readonly [number, number]> = [
  // row 2
  [7, 2],
  [8, 2],
  [9, 2],
  [10, 2],
  [11, 2],
  [12, 2],
  // row 3
  [7, 3],
  [8, 3],
  [9, 3],
  [10, 3],
  [11, 3],
  [12, 3],
  // row 4 — cols 9 and 11 blank for eyes
  [7, 4],
  [8, 4],
  /* eye */ [10, 4],
  /* eye */ [12, 4],
  // row 5
  [7, 5],
  [8, 5],
  [9, 5],
  [10, 5],
  [11, 5],
  [12, 5],
  // row 6
  [7, 6],
  [8, 6],
  [9, 6],
  [10, 6],
  [11, 6],
  [12, 6],
];

// Floating "hand" dots — tucked against the lower half of the head on either
// side (y=5, aligned with the head's 4th row) so they read as shoulders
// rather than floating far below. These replace the deleted arm limbs.
const LEFT_HAND_PIXELS: ReadonlyArray<readonly [number, number]> = [[6, 5]];
const RIGHT_HAND_PIXELS: ReadonlyArray<readonly [number, number]> = [[13, 5]];

// Floating "foot" dots — one row directly below the head's bottom edge
// (y=7), with a narrower stance. Keeps the whole figure a compact 6-row
// silhouette from head top to feet.
const LEFT_FOOT_PIXELS: ReadonlyArray<readonly [number, number]> = [[8, 7]];
const RIGHT_FOOT_PIXELS: ReadonlyArray<readonly [number, number]> = [[11, 7]];

function Pixels({
  pixels,
  fill,
}: {
  pixels: ReadonlyArray<readonly [number, number]>;
  fill: string;
}): ReactElement {
  return (
    <>
      {pixels.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </>
  );
}

export function PixelFigure(): ReactElement {
  // data-part groups let CSS animate head + each floating dot independently
  // (walk alternates hands/feet, clap squeezes hands inward, etc.).
  return (
    <g data-layer="figure" className="pixel-figure">
      <g data-part="head" className="pixel-figure__head">
        <Pixels pixels={HEAD_PIXELS} fill="var(--pixel-primary)" />
      </g>
      <g data-part="hand-left" className="pixel-figure__hand pixel-figure__hand--left">
        <Pixels pixels={LEFT_HAND_PIXELS} fill="var(--pixel-primary)" />
      </g>
      <g data-part="hand-right" className="pixel-figure__hand pixel-figure__hand--right">
        <Pixels pixels={RIGHT_HAND_PIXELS} fill="var(--pixel-primary)" />
      </g>
      <g data-part="foot-left" className="pixel-figure__foot pixel-figure__foot--left">
        <Pixels pixels={LEFT_FOOT_PIXELS} fill="var(--pixel-primary)" />
      </g>
      <g data-part="foot-right" className="pixel-figure__foot pixel-figure__foot--right">
        <Pixels pixels={RIGHT_FOOT_PIXELS} fill="var(--pixel-primary)" />
      </g>
    </g>
  );
}
