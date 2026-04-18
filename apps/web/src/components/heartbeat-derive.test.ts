import { describe, it, expect } from 'vitest';
import type { Artifact } from '@hack-fourmeme/shared';
import {
  decisionForTick,
  formatTickCounter,
  isDryRunTweet,
  selectHeartbeatView,
} from './heartbeat-derive';

function tick(n: number, total = 3, decisions: string[] = []): Artifact {
  return { kind: 'heartbeat-tick', tickNumber: n, totalTicks: total, decisions };
}

function decision(n: number, action: 'post' | 'extend_lore' | 'skip', reason = 'r'): Artifact {
  return { kind: 'heartbeat-decision', tickNumber: n, action, reason };
}

function tweet(id: string, url: string): Artifact {
  return { kind: 'tweet-url', tweetId: id, url };
}

describe('selectHeartbeatView', () => {
  it('returns zeroed counters for an empty artifact stream', () => {
    const v = selectHeartbeatView([]);
    expect(v.currentTick).toBe(0);
    expect(v.totalTicks).toBe(0);
    expect(v.ticks).toHaveLength(0);
    expect(v.decisions).toHaveLength(0);
    expect(v.tweets).toHaveLength(0);
  });

  it('picks up tickNumber + totalTicks from the latest tick artifact', () => {
    const v = selectHeartbeatView([tick(1), tick(2), tick(3)]);
    expect(v.currentTick).toBe(3);
    expect(v.totalTicks).toBe(3);
    expect(v.ticks).toHaveLength(3);
  });

  it('caps tweets to the 5 most recent entries', () => {
    const artifacts: Artifact[] = [];
    for (let i = 1; i <= 7; i += 1) {
      artifacts.push(tweet(String(1_000_000_000 + i), `https://x.com/a/status/${i}`));
    }
    const v = selectHeartbeatView(artifacts);
    expect(v.tweets).toHaveLength(5);
    // Oldest in window is i=3, newest is i=7.
    expect((v.tweets[0] as { tweetId: string }).tweetId.endsWith('003')).toBe(true);
    expect((v.tweets[4] as { tweetId: string }).tweetId.endsWith('007')).toBe(true);
  });

  it('isolates decisions + heartbeat artifacts from unrelated kinds', () => {
    const unrelated: Artifact = {
      kind: 'lore-cid',
      cid: 'bafk',
      gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafk',
      author: 'narrator',
    };
    const v = selectHeartbeatView([unrelated, tick(1), decision(1, 'skip')]);
    expect(v.decisions).toHaveLength(1);
    expect(v.ticks).toHaveLength(1);
  });
});

describe('formatTickCounter', () => {
  it('renders with leading zeros', () => {
    expect(formatTickCounter(1, 3)).toBe('01 / 03 ticks');
    expect(formatTickCounter(3, 3)).toBe('03 / 03 ticks');
  });
});

describe('isDryRunTweet', () => {
  it('flags about:blank + dry-run tweetIds', () => {
    expect(isDryRunTweet({ kind: 'tweet-url', tweetId: 'dry-run', url: 'about:blank' })).toBe(true);
    expect(isDryRunTweet({ kind: 'tweet-url', tweetId: '123', url: 'about:blank' })).toBe(true);
  });
  it('does not flag real tweets', () => {
    expect(
      isDryRunTweet({ kind: 'tweet-url', tweetId: '123', url: 'https://x.com/a/status/123' }),
    ).toBe(false);
  });
});

describe('decisionForTick', () => {
  it('returns the latest matching decision', () => {
    const decisions = [decision(1, 'skip'), decision(1, 'post'), decision(2, 'extend_lore')];
    const d = decisionForTick(
      decisions.filter((d) => d.kind === 'heartbeat-decision') as Extract<
        Artifact,
        { kind: 'heartbeat-decision' }
      >[],
      1,
    );
    expect(d?.action).toBe('post');
  });

  it('returns undefined when no decision matches', () => {
    const d = decisionForTick(
      [decision(2, 'post')].filter((d) => d.kind === 'heartbeat-decision') as Extract<
        Artifact,
        { kind: 'heartbeat-decision' }
      >[],
      1,
    );
    expect(d).toBeUndefined();
  });
});
