/**
 * Pure selectors for the HeartbeatPanel — given an append-only `Artifact[]`
 * stream from `useRun`, pull out the three time-ordered projections the panel
 * renders:
 *   - `ticks`        every `heartbeat-tick` artifact (1-indexed, latest last)
 *   - `decisions`    every `heartbeat-decision` artifact
 *   - `tweets`       every `tweet-url` artifact (capped at `maxTweets` latest)
 *
 * Selectors return fresh arrays each call (cheap: the panel only runs 1-3
 * ticks). Kept as pure functions so tests don't need to spin up React state.
 */
import type { Artifact } from '@hack-fourmeme/shared';

export type HeartbeatTickArtifact = Extract<Artifact, { kind: 'heartbeat-tick' }>;
export type HeartbeatDecisionArtifact = Extract<Artifact, { kind: 'heartbeat-decision' }>;
export type TweetUrlArtifact = Extract<Artifact, { kind: 'tweet-url' }>;

export interface HeartbeatView {
  ticks: HeartbeatTickArtifact[];
  decisions: HeartbeatDecisionArtifact[];
  tweets: TweetUrlArtifact[];
  /** The highest `tickNumber` observed so far. 0 when no tick has fired. */
  currentTick: number;
  /** Pulled from the most recent tick artifact. 0 when no tick has fired. */
  totalTicks: number;
}

/** Formats a tick number with a leading zero so the counter reads `01 / 03`. */
export function formatTickCounter(current: number, total: number): string {
  return `${String(current).padStart(2, '0')} / ${String(total).padStart(2, '0')} ticks`;
}

/**
 * Detect the dry-run tweet shape emitted by `runHeartbeatDemo` when the X
 * API credentials are absent. The dashboard dims these so reviewers know the
 * tweet is not live on x.com.
 */
export function isDryRunTweet(t: TweetUrlArtifact): boolean {
  return t.tweetId === 'dry-run' || t.url === 'about:blank';
}

export function selectHeartbeatView(artifacts: Artifact[], maxTweets = 5): HeartbeatView {
  const ticks: HeartbeatTickArtifact[] = [];
  const decisions: HeartbeatDecisionArtifact[] = [];
  const tweets: TweetUrlArtifact[] = [];

  for (const a of artifacts) {
    if (a.kind === 'heartbeat-tick') ticks.push(a);
    else if (a.kind === 'heartbeat-decision') decisions.push(a);
    else if (a.kind === 'tweet-url') tweets.push(a);
  }

  // Keep only the latest `maxTweets` entries. Order preserved (oldest first
  // within the kept window) so the panel can render top-to-bottom naturally.
  const cappedTweets = tweets.length > maxTweets ? tweets.slice(tweets.length - maxTweets) : tweets;

  const latestTick = ticks.length > 0 ? ticks[ticks.length - 1] : undefined;
  const currentTick = latestTick?.tickNumber ?? 0;
  const totalTicks = latestTick?.totalTicks ?? 0;

  return {
    ticks,
    decisions,
    tweets: cappedTweets,
    currentTick,
    totalTicks,
  };
}

/**
 * Return the single decision artifact (if any) associated with the given
 * `tickNumber`. The runner emits at most one decision per tick; if we ever
 * see more than one we pick the latest so a late retry visibly supersedes
 * an earlier choice.
 */
export function decisionForTick(
  decisions: HeartbeatDecisionArtifact[],
  tickNumber: number,
): HeartbeatDecisionArtifact | undefined {
  for (let i = decisions.length - 1; i >= 0; i -= 1) {
    const d = decisions[i];
    if (d && d.tickNumber === tickNumber) return d;
  }
  return undefined;
}
