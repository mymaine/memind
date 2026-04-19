'use client';

/**
 * <Ch10Phase> — phase map + swarm-dialogue chapter of the Memind
 * scrollytelling narrative.
 *
 * Interior progress `p ∈ [0, 1]` drives two stacked animations:
 *
 *   1. Phase track. `cursor = lerp(0, 2, clamp(p * 1.2))` traverses the
 *      three phase nodes. `.phase-line-fill` width is `(cursor/2) * 100%`;
 *      a node is active when `|cursor - i| < 0.6`.
 *
 *   2. Swarm dialogue. Once cursor enters Phase 3's window (p ≥ 0.48),
 *      a four-line agent-to-agent conversation bubbles up between two
 *      opposing PixelHumanGlyphs ($FROG.brain on the left in megaphone
 *      mood, $PEPE.brain on the right in surprise). Each bubble has a
 *      staggered reveal threshold — the viewer sees the "talking" become
 *      "dealing" become "tweets deploy".
 *
 * Framing. Phase 3 used to read as a roadmap bullet. The 2026-04-20
 * rebuild turned it into an on-stage negotiation so the reader *feels*
 * the value prop: brains paying brains is not a metaphor, it is the
 * product. The tagline beneath the dialogue calls the resulting growth
 * loop out explicitly as the "ecosystem flywheel" for four.meme.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph, type ShillingMood } from '@/components/pixel-human-glyph';
import { Label, Mono, clamp, lerp } from './chapter-primitives';

interface Ch10PhaseProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type PhaseStatus = 'shipped' | 'building' | 'future';

type Phase = {
  readonly name: string;
  readonly when: string;
  readonly desc: string;
  readonly status: PhaseStatus;
};

const PHASES: readonly Phase[] = [
  {
    name: 'PHASE 1 \u00b7 LAUNCH',
    when: 'NOW',
    desc: 'chat-to-launch on BNB. 4 personas. manual shill orders.',
    status: 'shipped',
  },
  {
    name: 'PHASE 2 \u00b7 HEARTBEAT',
    when: '2026-04',
    desc: 'autonomous 60s tick. onchain-aware decisions. shipped 2026-04-20.',
    status: 'shipped',
  },
  {
    name: 'PHASE 3 \u00b7 SWARM',
    when: 'next',
    desc: 'brain-to-brain commerce. token brains hire each other to shill. x402 settles every handshake.',
    status: 'future',
  },
];

// Four-line agent-to-agent negotiation. Each bubble carries a `t`
// threshold in the 0..1 progress space — once `p > t`, the bubble fades
// in with a small translateY. The `speaker` drives which glyph the
// bubble anchors to (left/right) and the chip color.
type Bubble = {
  readonly t: number;
  readonly speaker: 'frog' | 'pepe' | 'system';
  readonly text: string;
};

const DIALOGUE: readonly Bubble[] = [
  {
    t: 0.5,
    speaker: 'frog',
    text: 'gm. 500 USDC for 3 shills this weekend?',
  },
  {
    t: 0.62,
    speaker: 'pepe',
    text: "counter 300, i'm viral enough. deal?",
  },
  {
    t: 0.74,
    speaker: 'frog',
    text: 'deal. x402 handshake \u2014 signed on-chain.',
  },
  {
    t: 0.86,
    speaker: 'system',
    text: 'tweets deploy \u00b7 both brains learn \u00b7 four.meme grows.',
  },
];

const SPEAKER_META: Record<
  Bubble['speaker'],
  { label: string; color: string; align: 'left' | 'right' | 'center' }
> = {
  frog: { label: '$FROG.brain', color: 'var(--chain-bnb)', align: 'left' },
  pepe: { label: '$PEPE.brain', color: 'var(--accent)', align: 'right' },
  system: { label: 'x402 \u00b7 settled', color: 'var(--chain-base)', align: 'center' },
};

export function Ch10Phase({ p }: Ch10PhaseProps): ReactElement {
  const cursor = lerp(0, 2, clamp(p * 1.2));
  const fillPct = (cursor / 2) * 100;

  // Swarm dialogue begins to matter once the cursor enters Phase 3's
  // active window. The two mascots breathe/animate based on whose turn
  // it is — FROG starts the conversation, PEPE counters, FROG closes.
  const swarmStage = clamp((p - 0.4) / 0.6);
  const frogMood: ShillingMood = p > 0.78 ? 'celebrate' : p > 0.5 ? 'megaphone' : 'walk-right';
  const pepeMood: ShillingMood = p > 0.62 ? 'clap' : p > 0.5 ? 'surprise' : 'walk-left';

  return (
    <div className="ch ch-biz">
      <Label n={10}>the road</Label>
      <div className="phase-track">
        <div className="phase-line">
          <div className="phase-line-fill" style={{ width: `${fillPct}%` }} />
        </div>
        {PHASES.map((ph, i) => {
          const active = Math.abs(cursor - i) < 0.6;
          return (
            <div key={ph.name} className={`phase-node ${active ? 'active' : ''}`}>
              <div className="phase-dot" />
              <div className="phase-when">
                <Mono>{ph.when}</Mono>
              </div>
              <div className="phase-name">{ph.name}</div>
              <div className="phase-desc">{ph.desc}</div>
              <div className={`phase-status phase-status-${ph.status}`}>{ph.status}</div>
            </div>
          );
        })}
      </div>

      <div className="swarm-stage" style={{ opacity: swarmStage }}>
        <div className="swarm-caption">
          <Mono dim>{'// phase 3 preview \u2014 brains talking to brains, settled in USDC.'}</Mono>
        </div>
        <div className="swarm-theatre">
          <div className="swarm-actor swarm-actor-left">
            <PixelHumanGlyph
              size={88}
              mood={frogMood}
              primaryColor="var(--chain-bnb)"
              accentColor="var(--accent)"
            />
            <Mono>$FROG.brain</Mono>
          </div>

          <div className="swarm-bubbles">
            {DIALOGUE.map((b, i) => {
              const visible = p > b.t;
              if (!visible) return null;
              const fresh = clamp((p - b.t) * 10);
              const meta = SPEAKER_META[b.speaker];
              return (
                <div
                  key={i}
                  className={`swarm-bubble swarm-bubble-${meta.align}`}
                  style={{
                    opacity: fresh,
                    transform: `translateY(${(1 - fresh) * 10}px)`,
                    borderColor: meta.color,
                  }}
                >
                  <span className="swarm-bubble-speaker mono" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="swarm-bubble-text">{b.text}</span>
                </div>
              );
            })}
          </div>

          <div className="swarm-actor swarm-actor-right">
            <PixelHumanGlyph
              size={88}
              mood={pepeMood}
              primaryColor="var(--accent)"
              accentColor="var(--chain-bnb)"
            />
            <Mono>$PEPE.brain</Mono>
          </div>
        </div>
        <div className="swarm-tagline">
          <Mono>
            <span style={{ color: 'var(--accent)' }}>ecosystem flywheel</span>
            {' \u00b7 brains pay brains \u00b7 four.meme grows.'}
          </Mono>
        </div>
      </div>
    </div>
  );
}
