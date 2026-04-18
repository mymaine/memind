'use client';

/**
 * ArchitectureDiagram — top-of-page SVG schematic of the 3-agent swarm.
 *
 * Three nodes: Creator → Narrator (dashed; one-shot delegation), and
 * Narrator ⇄ Market-maker (solid bidirectional; the x402 service exchange).
 * Node strokes follow the per-agent `AgentStatus` (idle / running / done /
 * error) so the diagram tracks the live run.
 *
 * When the Market-maker emits a settled `x402-tx` artifact the bottom edge
 * plays a 3-loop golden flow (defined in globals.css `@keyframes x402-flow`).
 * The component owns the timer that strips the class after 3.6s so the
 * animation does not loop forever between runs.
 *
 * Implementation rules (per docs/features/dashboard-v2.md):
 *   - inline SVG only; no framer-motion / d3 / SMIL
 *   - height capped at 200px so the diagram does not push the page below
 *     the 1920x960 single-screen target
 */
import { useEffect, useRef, useState } from 'react';
import type { AgentId, AgentStatus, Artifact } from '@hack-fourmeme/shared';
import {
  X402_FLOW_DURATION_MS,
  nodeVisualTokensFor,
  pickLatestX402TxHash,
} from './architecture-diagram-utils';

export interface ArchitectureDiagramProps {
  statuses: Record<AgentId, AgentStatus>;
  artifacts: Artifact[];
}

interface NodeSpec {
  id: Exclude<AgentId, 'heartbeat'>;
  label: string;
  cx: number;
  cy: number;
}

// Geometry chosen so the three nodes line up horizontally inside a 600x180
// viewBox. The component scales to fit its container width while keeping
// the height bounded by viewBox height + Tailwind max-height clamp.
const VIEWBOX_W = 600;
const VIEWBOX_H = 180;
const NODE_W = 140;
const NODE_H = 56;

// Tuple typing keeps `NODES[i]` non-undefined under noUncheckedIndexedAccess
// so the SVG geometry expressions stay clean.
const NODES = [
  { id: 'creator', label: 'Creator', cx: 90, cy: 90 },
  { id: 'narrator', label: 'Narrator', cx: 300, cy: 90 },
  { id: 'market-maker', label: 'Market-maker', cx: 510, cy: 90 },
] as const satisfies readonly NodeSpec[];

const [CREATOR_NODE, NARRATOR_NODE, MARKET_MAKER_NODE] = NODES;

export function ArchitectureDiagram({
  statuses,
  artifacts,
}: ArchitectureDiagramProps): React.ReactElement {
  // The latest x402 txHash we have already animated. When `pickLatestX402TxHash`
  // returns something different we (a) flip the animate flag on, (b) set a
  // 3.6s timer that flips it back off and remembers the new hash so we don't
  // re-trigger on every re-render.
  const [animating, setAnimating] = useState(false);
  const lastAnimatedTxRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const latest = pickLatestX402TxHash(artifacts);
    if (latest === null) return;
    if (latest === lastAnimatedTxRef.current) return;

    // New x402 settlement — start the golden flow.
    lastAnimatedTxRef.current = latest;
    setAnimating(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAnimating(false);
      timerRef.current = null;
    }, X402_FLOW_DURATION_MS);

    return () => {
      // Component-unmount cleanup. Re-trigger on the next x402-tx is fine.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [artifacts]);

  return (
    <section
      aria-label="Agent swarm architecture"
      className="w-full rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-3"
    >
      <svg
        role="img"
        aria-label="Creator delegates to Narrator; Market-maker pays Narrator via x402"
        viewBox={`0 0 ${VIEWBOX_W.toString()} ${VIEWBOX_H.toString()}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-[150px] w-full"
      >
        {/* Edge 1: Creator → Narrator (one-shot delegation, dashed) */}
        <line
          x1={CREATOR_NODE.cx + NODE_W / 2}
          y1={CREATOR_NODE.cy}
          x2={NARRATOR_NODE.cx - NODE_W / 2}
          y2={NARRATOR_NODE.cy}
          stroke="var(--color-border-default)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          markerEnd="url(#arrow-grey)"
        />
        <text
          x={(CREATOR_NODE.cx + NARRATOR_NODE.cx) / 2}
          y={CREATOR_NODE.cy - 10}
          textAnchor="middle"
          fontSize={10}
          fill="var(--color-fg-tertiary)"
          fontFamily="var(--font-mono)"
        >
          delegate
        </text>

        {/* Edge 2: Narrator ⇄ Market-maker (x402 service exchange, solid).
            The bottom line carries the animation class; the top arrow is
            the static return path showing the lore handoff direction. */}
        <line
          data-testid="x402-edge"
          x1={NARRATOR_NODE.cx + NODE_W / 2}
          y1={NARRATOR_NODE.cy + 6}
          x2={MARKET_MAKER_NODE.cx - NODE_W / 2}
          y2={MARKET_MAKER_NODE.cy + 6}
          strokeWidth={2}
          strokeDasharray="6 6"
          markerEnd="url(#arrow-gold)"
          className={animating ? 'x402-edge-animate' : ''}
          stroke={animating ? 'var(--color-chain-bnb)' : 'var(--color-border-default)'}
        />
        <line
          x1={MARKET_MAKER_NODE.cx - NODE_W / 2}
          y1={NARRATOR_NODE.cy - 6}
          x2={NARRATOR_NODE.cx + NODE_W / 2}
          y2={NARRATOR_NODE.cy - 6}
          stroke="var(--color-border-default)"
          strokeWidth={1.5}
          markerEnd="url(#arrow-grey-back)"
        />
        <text
          x={(NARRATOR_NODE.cx + MARKET_MAKER_NODE.cx) / 2}
          y={NARRATOR_NODE.cy - 14}
          textAnchor="middle"
          fontSize={10}
          fill="var(--color-fg-tertiary)"
          fontFamily="var(--font-mono)"
        >
          x402 · USDC
        </text>

        {/* Marker definitions (one per stroke colour). */}
        <defs>
          <marker
            id="arrow-grey"
            viewBox="0 0 10 10"
            refX={10}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-border-default)" />
          </marker>
          <marker
            id="arrow-grey-back"
            viewBox="0 0 10 10"
            refX={10}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-border-default)" />
          </marker>
          <marker
            id="arrow-gold"
            viewBox="0 0 10 10"
            refX={10}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-chain-bnb)" />
          </marker>
        </defs>

        {/* Nodes (rendered after edges so they paint on top of arrow tails). */}
        {NODES.map((n) => {
          const status = statuses[n.id];
          const tokens = nodeVisualTokensFor(status);
          return (
            <g key={n.id} data-testid={`arch-node-${n.id}`} data-status={status}>
              <rect
                x={n.cx - NODE_W / 2}
                y={n.cy - NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                fill={tokens.fillVar}
                stroke={tokens.strokeVar}
                strokeWidth={tokens.pulse ? 2 : 1.5}
                style={
                  tokens.pulse
                    ? { animation: 'signal-pulse 1500ms ease-in-out infinite' }
                    : undefined
                }
              />
              <text
                x={n.cx}
                y={n.cy - 2}
                textAnchor="middle"
                fontSize={13}
                fill="var(--color-fg-primary)"
                fontFamily="var(--font-sans-display)"
                fontWeight={600}
              >
                {n.label}
              </text>
              <text
                x={n.cx}
                y={n.cy + 14}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-fg-tertiary)"
                fontFamily="var(--font-mono)"
              >
                {status}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
