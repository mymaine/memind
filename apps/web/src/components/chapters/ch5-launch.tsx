'use client';

/**
 * <Ch5Launch> — launch-by-chat chapter of the Memind scrollytelling
 * narrative (memind-scrollytelling-rebuild AC-MSR-9 ch5).
 *
 * Ch5 does NOT embed a real `<BrainChat />`. It is a scripted playback:
 * given 6 pre-authored lines with timestamps `t ∈ [0, 0.78]`, a line
 * becomes visible once `cutoff = p > l.t`. Each visible line fades in
 * via `fresh = clamp((cutoff - t) * 20)` — both opacity and a small
 * inbound translateX are driven by `fresh`.
 *
 * Layout classes (`.ch-demo`, `.demo-two-col`, `.demo-chat`,
 * `.demo-chat-head`, `.demo-chat-body`, `.demo-line`, `.demo-who`,
 * `.demo-text`, `.demo-prompt`, `.demo-side`, `.demo-side-label`,
 * `.demo-side-spec`, `.spec-row`) already live in `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { AnimatedLabel, Label, Mono, clamp } from './chapter-primitives';

interface Ch5LaunchProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type ScriptedLine = {
  readonly t: number;
  readonly who: 'user' | 'brain' | 'chain';
  readonly text: string;
  readonly color?: string;
};

// Ported verbatim from chapters.jsx lines 253-261.
const LINES: readonly ScriptedLine[] = [
  { t: 0.0, who: 'user', text: '/launch PEPESUPREME \u2014 1B supply, glitchy persona' },
  { t: 0.2, who: 'brain', text: 'drafting metadata...' },
  {
    t: 0.33,
    who: 'brain',
    text: 'uploading to IPFS \u00b7 bafybeigdy...',
    color: 'var(--chain-ipfs)',
  },
  { t: 0.48, who: 'brain', text: 'calling factory on BNB Chain...', color: 'var(--chain-bnb)' },
  {
    t: 0.62,
    who: 'chain',
    text: '0x4f2a..c8d1 \u00b7 block #42,803,214',
    color: 'var(--chain-bnb)',
  },
  { t: 0.78, who: 'brain', text: '\u2713 $PEPESUPREME is live. wallet funded w/ 0.05 BNB.' },
];

function whoLabel(who: ScriptedLine['who']): string {
  if (who === 'user') return 'YOU';
  if (who === 'brain') return 'BRAIN';
  return 'CHAIN';
}

export function Ch5Launch({ p }: Ch5LaunchProps): ReactElement {
  const cutoff = p;
  return (
    <div className="ch ch-demo">
      <Label n={5}>launch, by chat</Label>
      <div className="demo-two-col">
        <div className="demo-chat">
          <div className="demo-chat-head">
            <span className="mono">chat://brain/glitchy</span>
            <span className="mono" style={{ color: 'var(--accent)' }}>
              {'\u25cf'} live
            </span>
          </div>
          <div className="demo-chat-body">
            {LINES.map((l, i) => {
              const visible = cutoff > l.t;
              if (!visible) return null;
              const fresh = clamp((cutoff - l.t) * 20);
              return (
                <div
                  key={i}
                  className={`demo-line demo-line-${l.who}`}
                  style={{
                    opacity: fresh,
                    transform: `translateX(${(1 - fresh) * 6}px)`,
                  }}
                >
                  <span className="demo-who">{whoLabel(l.who)}</span>
                  <span className="demo-text" style={{ color: l.color ?? 'inherit' }}>
                    {l.text}
                  </span>
                </div>
              );
            })}
            <div className="demo-prompt">
              <span className="mono">&gt;_</span>
              <span className="caret">{'\u258c'}</span>
            </div>
          </div>
        </div>
        <div className="demo-side">
          <PixelHumanGlyph
            size={84}
            mood="type-keyboard"
            primaryColor="var(--accent)"
            accentColor="var(--chain-bnb)"
          />
          <AnimatedLabel base="brain is typing" />
          <div className="demo-side-spec">
            <div className="spec-row">
              <Mono dim>symbol</Mono>
              <Mono>PEPESUPREME</Mono>
            </div>
            <div className="spec-row">
              <Mono dim>supply</Mono>
              <Mono>1,000,000,000</Mono>
            </div>
            <div className="spec-row">
              <Mono dim>persona</Mono>
              <span className="mono" style={{ color: 'var(--accent)' }}>
                glitchy
              </span>
            </div>
            <div className="spec-row">
              <Mono dim>chain</Mono>
              <span className="mono" style={{ color: 'var(--chain-bnb)' }}>
                BNB
              </span>
            </div>
            <div className="spec-row">
              <Mono dim>cost</Mono>
              <Mono>0.87 USDC</Mono>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
