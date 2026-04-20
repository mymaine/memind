'use client';

/**
 * <Ch11Phase> — phase map + swarm-dialogue chapter of the Memind
 * scrollytelling narrative (memind-scrollytelling-rebuild AC-MSR-9 ch11;
 * renumbered 2026-04-20 from ch10 when The Saga was inserted at slot 7).
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

interface Ch11PhaseProps {
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

// Phase names realigned (2026-04-20) to Four.meme's March 2026 official
// AI Agent roadmap (phemex.com/news 63946): Phase 1 Agent Skill Framework
// (upstream on four.meme, live) / Phase 2 Executable AI Agents with LLM
// Chat (memind ships the reference implementation here) / Phase 3
// Agentic Mode, on-chain AI identities (next — the commerce loop). Using
// the canonical Four.meme names avoids confusion with memind-internal
// milestone naming, while the desc lines keep the ship-date facts.
const PHASES: readonly Phase[] = [
  {
    name: 'PHASE 1 \u00b7 Agent Skill Framework',
    when: 'four.meme \u00b7 live',
    desc: "four.meme's upstream agent skill layer — we build on top, not replace.",
    status: 'shipped',
  },
  {
    name: 'PHASE 2 \u00b7 Executable AI Agents',
    when: 'memind \u00b7 live',
    desc: 'LLM-chat driven agents launch on BNB, settle x402 on Base Sepolia. autonomous 60s heartbeat shipped 2026-04-20.',
    status: 'shipped',
  },
  {
    name: 'PHASE 3 \u00b7 Agentic Mode',
    when: 'next',
    desc: 'on-chain AI identities. brain-to-brain commerce. x402 settles every handshake.',
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

// UAT 2026-04-20 (rev 2): staging must land *before* the dialogue
// begins. Swarm-stage fades in over p=0.25 → 0.40 (mascots + empty
// receipt frame arrive first), p=0.40 → 0.45 is a held beat that lets
// the viewer register the set, then bubbles run on thresholds
// [0.45, 0.60, 0.75, 0.90] — delta 0.15, ≈25% slower than the old
// 0.12 cadence and safely behind the stage settle.
const DIALOGUE: readonly Bubble[] = [
  {
    t: 0.45,
    speaker: 'frog',
    text: 'gm. 500 USDC for 3 shills this weekend?',
  },
  {
    t: 0.6,
    speaker: 'pepe',
    text: "counter 300, i'm viral enough. deal?",
  },
  {
    t: 0.75,
    speaker: 'frog',
    text: 'deal. x402 handshake \u2014 signed on-chain.',
  },
  {
    t: 0.9,
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
  system: { label: 'x402 \u00b7 settled', color: 'var(--chain-bnb)', align: 'center' },
};

/**
 * x402 handshake receipt state machine (2026-04-20). The deal card sits
 * alongside the theatre and mirrors the dialogue in structured form —
 * buyer / seller / sku / price / take / tx / block — so the viewer
 * gets both the colour (bubbles) and the receipt (numbers). Stages
 * transition in lock-step with the four bubble thresholds above:
 *
 *   p < 0.50            → (stage dormant, deal hidden)
 *   0.50 ≤ p < 0.62     → OFFERED   · 500 USDC quoted, tx pending
 *   0.62 ≤ p < 0.74     → COUNTERED · 500 struck through, 300 USDC
 *   0.74 ≤ p < 0.86     → SIGNING   · awaiting on-chain confirmation
 *   p ≥ 0.86            → SETTLED   · real tx hash + block number
 */
type DealStage = {
  readonly status: string;
  readonly statusColor: string;
  readonly priceBefore: string | null;
  readonly priceNow: string;
  readonly txText: string;
  readonly blockText: string;
};

function dealStageFor(p: number): DealStage {
  // Thresholds mirror the DIALOGUE bubble cadence (0.45 / 0.60 / 0.75
  // / 0.90) so the receipt column always reads in lock-step with the
  // talking column — never ahead, never lagging.
  if (p < 0.6) {
    return {
      status: 'OFFERED',
      statusColor: 'var(--chain-bnb)',
      priceBefore: null,
      priceNow: '500 USDC',
      txText: '0x\u2026 (awaiting counter)',
      blockText: 'block #pending',
    };
  }
  if (p < 0.75) {
    return {
      status: 'COUNTERED',
      statusColor: 'var(--chain-bnb)',
      priceBefore: '500 USDC',
      priceNow: '300 USDC',
      txText: '0x\u2026 (accept?)',
      blockText: 'block #pending',
    };
  }
  if (p < 0.9) {
    return {
      status: 'SIGNING',
      statusColor: 'var(--chain-ipfs)',
      priceBefore: '500 USDC',
      priceNow: '300 USDC',
      txText: '0x4a7e\u2026pending',
      blockText: 'block #submitting',
    };
  }
  return {
    status: 'SETTLED',
    statusColor: 'var(--accent)',
    priceBefore: '500 USDC',
    priceNow: '300 USDC',
    txText: '0x4a7e1c\u20269f02',
    blockText: 'block #47,102,938',
  };
}

export function Ch11Phase({ p }: Ch11PhaseProps): ReactElement {
  const cursor = lerp(0, 2, clamp(p * 1.2));
  const fillPct = (cursor / 2) * 100;

  // Swarm dialogue begins to matter once the cursor enters Phase 3's
  // active window. The two mascots breathe/animate based on whose turn
  // it is — FROG starts the conversation, PEPE counters, FROG closes.
  // Stage fades in over p=0.25 → 0.40 so mascots + the empty receipt
  // card are fully on-screen by p=0.40. A deliberate 0.05-wide quiet
  // beat (p=0.40 → 0.45) lets the viewer register the set before
  // bubble 1 starts at p=0.45. Moods follow the same 0.45 / 0.60 /
  // 0.90 beats as the dialogue itself.
  const swarmStage = clamp((p - 0.25) / 0.15);
  const frogMood: ShillingMood = p > 0.9 ? 'celebrate' : p > 0.45 ? 'megaphone' : 'walk-right';
  const pepeMood: ShillingMood = p > 0.6 ? 'clap' : p > 0.45 ? 'surprise' : 'walk-left';

  const deal = dealStageFor(p);

  return (
    <div className="ch ch-biz">
      <Label n={11}>the road</Label>
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
        <div className="swarm-body">
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

          <div className="deal" aria-label="x402 handshake receipt">
            <div className="deal-head">
              <span>{'x402 \u00b7 handshake receipt'}</span>
              <span
                className="status"
                style={{ color: deal.statusColor, borderColor: deal.statusColor }}
              >
                {deal.status}
              </span>
            </div>
            <div className="deal-row">
              <span className="k">BUYER</span>
              <span className="v">
                $FROG.brain <span className="mono-dim">{'0xf0\u2026be1'}</span>
              </span>
            </div>
            <div className="deal-row">
              <span className="k">SELLER</span>
              <span className="v">
                $PEPE.brain <span className="mono-dim">{'0xpe\u202642a'}</span>
              </span>
            </div>
            <div className="deal-row">
              <span className="k">SKU</span>
              <span className="v">{'3\u00d7 shill \u00b7 weekend window'}</span>
            </div>
            <div className="deal-row">
              <span className="k">PRICE</span>
              <span className="v deal-price">
                {deal.priceBefore ? <span className="strike was">{deal.priceBefore}</span> : null}
                <span className="is">{deal.priceNow}</span>
              </span>
            </div>
            <div className="deal-row">
              <span className="k">TAKE</span>
              <span className="v">
                {'four.meme \u00b7 2% \u00b7 '}
                <span className="mono-dim">6.00 USDC</span>
              </span>
            </div>
            <div className="deal-row">
              <span className="k">TX</span>
              <span className="v mono-dim">{deal.txText}</span>
            </div>
            <div className="deal-foot">
              <span>{'chain \u00b7 BNB'}</span>
              <span>{deal.blockText}</span>
            </div>
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
