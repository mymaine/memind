/**
 * Red tests for `<TweetPreviewCard />` (V4.7-P4 Task 3 / AC-P4.7-5).
 *
 * Used by OrderPanel's `posted` state and the Hero scene variant. Purely
 * visual — no data fetching. The card mimics an X tweet:
 *
 *   ┌─ avatar chip · display name · @handle ──────────┐
 *   │  body                                            │
 *   │  {postedAt relative} · View on X ↗               │
 *   └──────────────────────────────────────────────────┘
 *
 * Contract pinned here (spec demo-narrative-ui.md AC-P4.7-5):
 *   - Default handle `shiller_x` + default displayName `Shilling Market`
 *     when not overridden.
 *   - Custom handle / displayName props are surfaced verbatim.
 *   - `postedAt` ISO string renders relative time ("just now" / "5m
 *     ago" / "2h ago" / "3d ago") via an inline helper.
 *   - `tweetUrl` prop renders a `View on X ↗` anchor with external-link
 *     hygiene; omitted prop drops the entire footer anchor.
 *   - `animated={false}` (default) renders the body text verbatim in
 *     markup so static-render asserts can grep it. `animated={true}`
 *     wires TweetTypewriter — we do NOT test that path here because
 *     TweetTypewriter's SSR emits an empty span before the first rAF
 *     tick, which makes string asserts flaky.
 *   - `<article role="article" aria-label="Tweet preview">` wraps the
 *     card for SR landmark semantics; avatar is `aria-hidden`.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TweetPreviewCard } from './tweet-preview-card.js';

function render(props: Parameters<typeof TweetPreviewCard>[0]): string {
  return renderToStaticMarkup(<TweetPreviewCard {...props} />);
}

describe('<TweetPreviewCard /> static markup', () => {
  it('defaults to handle="shiller_x" and displayName="Shilling Market"', () => {
    const out = render({ body: 'Hello from the agent.' });
    expect(out).toContain('Hello from the agent.');
    expect(out).toContain('shiller_x');
    expect(out).toContain('Shilling Market');
  });

  it('overrides handle and displayName when props provided', () => {
    const out = render({
      body: 'Override test.',
      handle: 'custom_handle',
      displayName: 'Custom Display',
    });
    expect(out).toContain('custom_handle');
    expect(out).toContain('Custom Display');
    // Defaults should be absent so the override actually won.
    expect(out).not.toContain('>shiller_x');
    expect(out).not.toContain('>Shilling Market');
  });

  it('renders "just now" when postedAt is less than a minute ago', () => {
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    const out = render({ body: 'body', postedAt: thirtySecAgo });
    expect(out).toContain('just now');
  });

  it('renders "Nm ago" for minute-scale postedAt', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const out = render({ body: 'body', postedAt: fiveMinAgo });
    expect(out).toContain('5m ago');
  });

  it('wires "View on X" anchor when tweetUrl is provided', () => {
    const out = render({
      body: 'body',
      tweetUrl: 'https://twitter.com/shiller_x/status/12345',
    });
    expect(out).toContain('View on X');
    expect(out).toContain('href="https://twitter.com/shiller_x/status/12345"');
    expect(out).toContain('target="_blank"');
    expect(out).toMatch(/rel="noopener noreferrer"|rel="noreferrer noopener"/);
  });

  it('hides the footer link entirely when tweetUrl is omitted', () => {
    const out = render({ body: 'body' });
    expect(out).not.toContain('View on X');
  });

  it('wraps the card in an <article> landmark with aria-label', () => {
    const out = render({ body: 'body' });
    expect(out).toMatch(/<article[^>]+role="article"/);
    expect(out).toMatch(/aria-label="Tweet preview"/);
  });
});
