/**
 * Pure selector + merge for the Shilling Market panel (AC-P4.6-4).
 *
 * The SSE artifact stream appends `shill-order` entries (queued → processing →
 * done/failed) and at most one `shill-tweet` per orderId. The panel wants a
 * single row per orderId reflecting the latest known status, with the tweet
 * (when posted) merged in. Keeping this logic outside React lets us test it
 * without a DOM and lets the timeline / tx surfaces reuse it later.
 */
import type { Artifact } from '@hack-fourmeme/shared';

export type ShillOrderStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface ShillOrderRowView {
  orderId: string;
  targetTokenAddr: string;
  status: ShillOrderStatus;
  paidTxHash: string;
  paidAmountUsdc: string;
  creatorBrief?: string;
  /** Latest shill-order artifact ts (when multiple for same orderId). */
  ts: string;
  /** Populated when a matching shill-tweet artifact exists. */
  tweet?: { tweetId: string; tweetUrl: string; tweetText: string; ts: string };
}

type ShillOrderArtifact = Extract<Artifact, { kind: 'shill-order' }>;
type ShillTweetArtifact = Extract<Artifact, { kind: 'shill-tweet' }>;

/**
 * Collect + dedupe + merge.
 *
 * Algorithm: single pass indexes the latest `shill-order` per orderId and the
 * latest `shill-tweet` per orderId; a second pass builds `ShillOrderRowView`
 * rows from the order map and attaches the tweet when available. Output is
 * sorted by order ts ascending so the panel reads "earliest order first" —
 * which is what the mockup in docs/features/shilling-market.md shows.
 */
export function collectShillOrderRows(artifacts: readonly Artifact[]): ShillOrderRowView[] {
  const latestOrder = new Map<string, ShillOrderArtifact>();
  const latestTweet = new Map<string, ShillTweetArtifact>();

  for (const a of artifacts) {
    if (a.kind === 'shill-order') {
      // Last write wins — status transitions queued → processing → done/failed
      // arrive in emission order so the newest entry is the truth.
      latestOrder.set(a.orderId, a);
    } else if (a.kind === 'shill-tweet') {
      latestTweet.set(a.orderId, a);
    }
  }

  const rows: ShillOrderRowView[] = [];
  for (const order of latestOrder.values()) {
    const row: ShillOrderRowView = {
      orderId: order.orderId,
      targetTokenAddr: order.targetTokenAddr,
      status: order.status,
      paidTxHash: order.paidTxHash,
      paidAmountUsdc: order.paidAmountUsdc,
      ts: order.ts,
    };
    if (order.creatorBrief !== undefined) row.creatorBrief = order.creatorBrief;
    const tweet = latestTweet.get(order.orderId);
    if (tweet !== undefined) {
      row.tweet = {
        tweetId: tweet.tweetId,
        tweetUrl: tweet.tweetUrl,
        tweetText: tweet.tweetText,
        ts: tweet.ts,
      };
    }
    rows.push(row);
  }

  // Stable ascending by order ts — ISO-8601 strings compare lexicographically
  // in the same order as timestamps, so string compare is enough here.
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return rows;
}
