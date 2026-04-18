'use client';

import type { Artifact } from '@hack-fourmeme/shared';
import { isDryRunTweet } from './heartbeat-derive';

/**
 * TweetFeed — vertical stack of Twitter-style cards rendered below the
 * HeartbeatPanel. Each card shows the tweet id, a truncated "text" (when the
 * artifact carries the raw text in its label field) and a link to the real
 * URL. Dry-run tweets (produced when X credentials are absent) are tagged
 * and point at about:blank; the UI dims them so reviewers see "this would
 * have posted" instead of a broken link.
 *
 * We cap the list length upstream in selectHeartbeatView (5 entries).
 */

type TweetUrlArtifact = Extract<Artifact, { kind: 'tweet-url' }>;

export function TweetFeed({ tweets }: { tweets: TweetUrlArtifact[] }) {
  if (tweets.length === 0) {
    return (
      <p className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
        No tweets yet — ticks will post here.
      </p>
    );
  }
  return (
    <ul aria-label="Heartbeat tweet feed" className="flex flex-col gap-2">
      {tweets.map((t) => {
        const dryRun = isDryRunTweet(t);
        return (
          <li
            key={t.tweetId}
            className="rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-3"
            style={dryRun ? { opacity: 0.6 } : undefined}
          >
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="font-[family-name:var(--font-mono)] text-fg-tertiary">
                {dryRun ? 'X · dry-run' : 'X · live'}
              </span>
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-[family-name:var(--font-mono)] text-accent hover:underline"
              >
                {`#${t.tweetId.slice(-6)}`}
              </a>
            </div>
            {t.label !== undefined && t.label !== '' ? (
              <p className="mt-1 truncate text-[13px] text-fg-primary">{t.label}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
