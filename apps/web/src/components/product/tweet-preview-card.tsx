'use client';

/**
 * TweetPreviewCard — mock X tweet card rendered by OrderPanel's `posted`
 * state (AC-P4.7-5). Not a real X embed (X embeds require a runtime
 * script + rate-limited API) — this is a pixel-accurate visual mock so
 * demo judges see "a tweet was posted" without the overhead of a real
 * embed.
 *
 * Layout:
 *
 *   ┌─ avatar · Display Name · @handle ──────────────┐
 *   │                                                  │
 *   │  body                                            │
 *   │                                                  │
 *   │  {postedAt relative} · View on X ↗               │
 *   └──────────────────────────────────────────────────┘
 *
 * `animated=true` routes the body through `<TweetTypewriter />` so the
 * post can type in when OrderPanel transitions posted → visible. The
 * default is static (no animation) so static-render asserts stay stable.
 *
 * A11y: `<article role="article" aria-label="Tweet preview">` wraps the
 * card; avatar chip is `aria-hidden` (decorative). The `View on X`
 * anchor uses `target="_blank" rel="noopener noreferrer"` for external-
 * link hygiene.
 */
import type { ReactElement } from 'react';
import { TweetTypewriter } from '@/components/animations/tweet-typewriter';

export interface TweetPreviewCardProps {
  /** X handle without the leading "@". Default: "shiller_x". */
  readonly handle?: string;
  /** Display name shown above the handle. Default: "Shilling Market". */
  readonly displayName?: string;
  /** Tweet body text. */
  readonly body: string;
  /** Optional ISO timestamp. Renders relative time ("just now" / "5m ago"). */
  readonly postedAt?: string;
  /** When set, the "View on X" anchor opens this URL in a new tab. */
  readonly tweetUrl?: string;
  /**
   * When `true`, the body types in via `<TweetTypewriter />` (autoplay).
   * Default: `false` (static body). Kept opt-in so static-render asserts
   * stay deterministic.
   */
  readonly animated?: boolean;
  readonly className?: string;
}

const DEFAULT_HANDLE = 'shiller_x';
const DEFAULT_DISPLAY_NAME = 'Shilling Market';

/**
 * Minimal relative-time helper — covers the four buckets we need for the
 * demo (just now / Nm / Nh / Nd). Kept inline rather than pulling a
 * formatting library so the component stays dependency-free.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const ms = now.getTime() - t;
  if (Number.isNaN(t)) return '';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/** First-letter avatar chip — intentionally minimal (no icon SVG). The
 *  chip is aria-hidden so screen readers skip it; the handle conveys
 *  identity. */
function Avatar({ handle }: { handle: string }): ReactElement {
  const letter = (handle.charAt(0) || '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      data-testid="tweet-preview-avatar"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-accent bg-accent/10 font-[family-name:var(--font-sans-body)] text-[13px] font-semibold text-accent-text"
    >
      {letter}
    </span>
  );
}

export function TweetPreviewCard({
  handle = DEFAULT_HANDLE,
  displayName = DEFAULT_DISPLAY_NAME,
  body,
  postedAt,
  tweetUrl,
  animated = false,
  className,
}: TweetPreviewCardProps): ReactElement {
  const rel = postedAt ? relativeTime(postedAt) : null;
  const showFooter = rel !== null || typeof tweetUrl === 'string';

  return (
    <article
      role="article"
      aria-label="Tweet preview"
      className={`max-w-[520px] rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-4 ${className ?? ''}`.trim()}
    >
      <header className="flex items-center gap-3">
        <Avatar handle={handle} />
        <div className="flex flex-col">
          <span className="font-[family-name:var(--font-sans-body)] text-[14px] font-medium text-fg-primary">
            {displayName}
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[13px] text-fg-tertiary">
            @{handle}
          </span>
        </div>
      </header>

      {animated ? (
        // Controlled-free autoplay: the typewriter mounts and runs its
        // own rAF until the body fully types out. Reduced-motion users
        // see the full text from frame 1 (typewriter handles it).
        <TweetTypewriter
          autoplay
          caret={false}
          text={body}
          className="mt-3 font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-primary"
        />
      ) : (
        <p className="mt-3 font-[family-name:var(--font-sans-body)] text-[14px] leading-[1.5] text-fg-primary">
          {body}
        </p>
      )}

      {showFooter ? (
        <footer className="mt-3 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          {rel !== null ? <span>{rel}</span> : null}
          {rel !== null && typeof tweetUrl === 'string' ? <span aria-hidden="true">·</span> : null}
          {typeof tweetUrl === 'string' ? (
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text transition-opacity duration-150 hover:opacity-80"
            >
              View on X ↗
            </a>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
