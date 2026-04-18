/**
 * Pure helpers for ArchitectureDiagram (V2-P4 Tasks 1-2).
 *
 * Two responsibilities, kept here so the SVG component stays declarative:
 *   1. Map an `AgentStatus` to the visual tokens used by the SVG node
 *      (fill / stroke / text colour, plus a "pulsing" flag the component
 *      uses to attach the signal-pulse keyframe).
 *   2. Decide when the Market-maker → Narrator x402 edge should play its
 *      golden flow animation. The trigger fires once per *new* `x402-tx`
 *      artifact observed; the component runs the animation for 3 loops
 *      (3 × 1.2s = 3.6s) and then drops the class.
 *
 * Both helpers are framework-agnostic. The component handles the
 * setTimeout-driven class toggle separately (it owns the side effects).
 */
import type { AgentStatus, Artifact } from '@hack-fourmeme/shared';

export interface NodeVisualTokens {
  /** CSS variable expression used for the node fill colour. */
  fillVar: string;
  /** CSS variable expression used for the node stroke colour. */
  strokeVar: string;
  /** When true the SVG component attaches the signal-pulse keyframe. */
  pulse: boolean;
}

/**
 * Status -> visual tokens.
 *
 *   idle    grey  (border-default)        no pulse
 *   running amber (warning)               pulse
 *   done    cyan  (accent)                no pulse
 *   error   red   (danger)                no pulse
 *
 * The fill is always the surface colour so the diagram reads like an
 * architecture sketch, not a heat-map; the stroke carries the status
 * signal. Components consume the variable names directly so the design
 * tokens stay in globals.css.
 */
export function nodeVisualTokensFor(status: AgentStatus): NodeVisualTokens {
  switch (status) {
    case 'running':
      return {
        fillVar: 'var(--color-bg-surface)',
        strokeVar: 'var(--color-warning)',
        pulse: true,
      };
    case 'done':
      return {
        fillVar: 'var(--color-bg-surface)',
        strokeVar: 'var(--color-accent)',
        pulse: false,
      };
    case 'error':
      return {
        fillVar: 'var(--color-bg-surface)',
        strokeVar: 'var(--color-danger)',
        pulse: false,
      };
    case 'idle':
    default:
      return {
        fillVar: 'var(--color-bg-surface)',
        strokeVar: 'var(--color-border-default)',
        pulse: false,
      };
  }
}

/**
 * Detect a *new* x402 settlement that should trigger the edge animation.
 *
 * The component remembers the last seen `x402-tx` txHash; when the latest
 * artifact in the run carries a different txHash, this returns it so the
 * component can flip the animate class on. Returns `null` when there is no
 * new x402-tx since the last call.
 *
 * Pure: no React, no setTimeout. The component owns the side-effect loop.
 */
export function pickLatestX402TxHash(artifacts: Artifact[]): string | null {
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const a = artifacts[i];
    if (a && a.kind === 'x402-tx') return a.txHash;
  }
  return null;
}

/**
 * Total duration the edge animation runs for, in milliseconds.
 *
 * AC-V2-5 requires 3 loops of a 1.2s linear keyframe — 3.6s total. Exposed
 * as a constant so the component and the tests agree on the timing without
 * either side hard-coding the literal.
 */
export const X402_FLOW_DURATION_MS = 3600;

/** Keyframe loop length in ms; matches the @keyframes x402-flow declaration. */
export const X402_FLOW_LOOP_MS = 1200;

/** Keyframe iteration count for one trigger of the edge animation. */
export const X402_FLOW_ITERATIONS = 3;
