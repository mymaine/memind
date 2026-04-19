'use client';

/**
 * <Ch6Shill> — shilling-by-chat chapter of the Memind scrollytelling
 * narrative (memind-scrollytelling-rebuild AC-MSR-9 ch6).
 *
 * Ported from
 * `docs/design/memind-handoff/project/components/chapters.jsx` lines 307-366.
 *
 * Like Ch5, Ch6 does NOT embed a real `<BrainChat />`. It is a scripted
 * playback:
 *   - Two static top lines (`/shill ...` + `scheduling 3 drops`) whose
 *     opacity is driven directly by `clamp(p * 10)` and `clamp((p-0.08) * 10)`.
 *   - Three `tweet-card` elements at `t = 0.15 / 0.40 / 0.68`. Each becomes
 *     visible once `p > t` and fades via `fresh = clamp((p - t) * 12)` with
 *     a small inbound translateY.
 *
 * Layout classes (`.ch-demo`, `.demo-two-col`, `.demo-chat`,
 * `.demo-chat-head`, `.demo-chat-body`, `.demo-line`, `.demo-who`,
 * `.demo-text`, `.tweet-card`, `.tweet-head`, `.tweet-body`,
 * `.tweet-meta`, `.demo-side`, `.demo-side-label`, `.demo-side-spec`,
 * `.spec-row`) already live in `app/globals.css`.
 */
import type { ReactElement } from 'react';
import { PixelHumanGlyph } from '@/components/pixel-human-glyph';
import { AnimatedLabel, Label, Mono, clamp } from './chapter-primitives';

interface Ch6ShillProps {
  /** Interior progress 0..1 emitted by <StickyStage /> for this chapter. */
  readonly p: number;
}

type ScriptedTweet = {
  readonly t: number;
  readonly text: string;
  readonly likes: number;
  readonly rt: number;
};

// Ported verbatim from chapters.jsx lines 309-313.
const TWEETS: readonly ScriptedTweet[] = [
  {
    t: 0.15,
    text: 'gm degens. $PEPESUPREME is the only truth in a world of lies. glitchy and unemployed, just like you \u{1fae1}',
    likes: 142,
    rt: 38,
  },
  {
    t: 0.4,
    text: 'i dont shill. i AM shilled. $PEPESUPREME ticker /// error 404 sanity not found ///',
    likes: 890,
    rt: 201,
  },
  {
    t: 0.68,
    text: 'they said AI would replace artists. it replaced shillers instead. $PEPESUPREME to the moon, autonomously.',
    likes: 2104,
    rt: 612,
  },
];

export function Ch6Shill({ p }: Ch6ShillProps): ReactElement {
  return (
    <div className="ch ch-demo">
      <Label n={6}>shilling, by chat</Label>
      <div className="demo-two-col">
        <div className="demo-chat">
          <div className="demo-chat-head">
            <span className="mono">chat://brain/glitchy</span>
            <span className="mono" style={{ color: 'var(--chain-bnb)' }}>
              {'\u25cf'} posting
            </span>
          </div>
          <div className="demo-chat-body">
            <div className="demo-line demo-line-user" style={{ opacity: clamp(p * 10) }}>
              <span className="demo-who">YOU</span>
              <span className="demo-text">/shill 3 tweets, 4 hours apart</span>
            </div>
            <div className="demo-line demo-line-brain" style={{ opacity: clamp((p - 0.08) * 10) }}>
              <span className="demo-who">BRAIN</span>
              <span className="demo-text">{'scheduling 3 drops \u2014 cost 0.24 USDC.'}</span>
            </div>
            {TWEETS.map((tw, i) => {
              const visible = p > tw.t;
              if (!visible) return null;
              const fresh = clamp((p - tw.t) * 12);
              return (
                <div
                  key={i}
                  className="tweet-card"
                  style={{
                    opacity: fresh,
                    transform: `translateY(${(1 - fresh) * 8}px)`,
                  }}
                >
                  <div className="tweet-head">
                    <span className="mono" style={{ color: 'var(--accent)' }}>
                      @pepesupreme_ai
                    </span>
                    <span className="mono" style={{ color: 'var(--fg-tertiary)' }}>
                      {`\u00b7 ${i * 4 + 2}h`}
                    </span>
                  </div>
                  <div className="tweet-body">{tw.text}</div>
                  <div className="tweet-meta">
                    <Mono dim>{`\u2661 ${tw.likes}`}</Mono>
                    <Mono dim>{`\u21bb ${tw.rt}`}</Mono>
                    <Mono dim>{'\u25c9 signed by brain'}</Mono>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="demo-side">
          <PixelHumanGlyph
            size={92}
            mood="megaphone"
            primaryColor="var(--accent)"
            accentColor="var(--chain-bnb)"
          />
          <AnimatedLabel base="broadcasting" />
          <div className="demo-side-spec">
            <div className="spec-row">
              <Mono dim>tweets</Mono>
              <Mono>3</Mono>
            </div>
            <div className="spec-row">
              <Mono dim>cadence</Mono>
              <Mono>4h</Mono>
            </div>
            <div className="spec-row">
              <Mono dim>persona</Mono>
              <span className="mono" style={{ color: 'var(--accent)' }}>
                glitchy
              </span>
            </div>
            <div className="spec-row">
              <Mono dim>proof</Mono>
              <Mono>sig + tx</Mono>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
