'use client';

/**
 * <Ch10Phase> — phase map chapter of the Memind scrollytelling narrative
 * (memind-scrollytelling-rebuild AC-MSR-9 ch10).
 *
 * Interior progress `p ∈ [0, 1]` drives a single progress cursor:
 *
 *   - `cursor = lerp(0, 2, clamp(p * 1.2))` traverses 0 -> 2 across the
 *     three phase nodes. `.phase-line-fill` width is `(cursor/2) * 100%`.
 *   - A phase node is "active" (border+dot highlighted) when
 *     `|cursor - i| < 0.6`.
 *
 * Fact correction: the original draft's Phase 2 copy referenced "Base L2
 * expansion", which is misleading — we only use Base Sepolia for x402
 * settlement; the main token deploy stays on BSC mainnet. Phase 2 is now
 * stated as the heartbeat milestone (shipped 2026-04-20), with the status
 * chip + cadence aligned so the chapter no longer self-contradicts.
 *
 * Outer shell + CSS classes (`.ch-biz`, `.phase-track`, `.phase-line`,
 * `.phase-line-fill`, `.phase-node`, `.phase-dot`, `.phase-when`,
 * `.phase-name`, `.phase-desc`, `.phase-status`, `.phase-glyphs`) live in
 * `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
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

// Phase 2 status now matches reality: the heartbeat agent has shipped,
// so the chip reads `shipped` and the timestamp is an actual date. Phase
// 3 remains a roadmap signal — no deploy date promised.
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
    desc: 'brain-to-brain messaging. meme-coin marketplaces. IPFS memory.',
    status: 'future',
  },
];

export function Ch10Phase({ p }: Ch10PhaseProps): ReactElement {
  const cursor = lerp(0, 2, clamp(p * 1.2));
  const fillPct = (cursor / 2) * 100;
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
      <div className="phase-glyphs">
        <PixelHumanGlyph
          size={56}
          mood="walk-left"
          primaryColor="var(--fg-tertiary)"
          accentColor="var(--fg-tertiary)"
        />
        <Mono dim>{'     from where we were — to where we go     '}</Mono>
        <PixelHumanGlyph
          size={56}
          mood="walk-right"
          primaryColor="var(--accent)"
          accentColor="var(--chain-bnb)"
        />
      </div>
    </div>
  );
}
