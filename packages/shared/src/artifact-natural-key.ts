/**
 * `deriveNaturalKey` — single source of truth for the artifact dedupe key,
 * shared by the server's `ArtifactLogStore` (DB partial unique index) and
 * the web client's `mergeRunState` helper (Ch12 hydration).
 *
 * Design rules:
 *   - Every key is prefixed with the artifact kind so two different kinds
 *     can never collide on the same identifier.
 *   - `null` means "let this row through untouched" — heartbeat-tick and
 *     heartbeat-decision are intentionally ephemeral and allowed to
 *     duplicate.
 *   - Immutable kinds (tokens, tx hashes, CIDs, tweet ids) are deterministic
 *     so an upsert from a retry never creates a duplicate row.
 *   - Mutable kinds (shill-order status machine, lore-anchor's optional
 *     layer-2 trio, meme-image's cid stamp) share the same key across
 *     updates so the DB can do `ON CONFLICT DO UPDATE`.
 *
 * Any drift between this function on the server and its web-side counterpart
 * becomes a correctness bug (SSE events and fetched history would dedupe
 * differently). Publishing it from `@hack-fourmeme/shared` is the cheapest
 * way to keep both sides honest.
 */
import type { Artifact } from './schema.js';

/**
 * Compute the natural dedupe key for an artifact. Returns `null` when the
 * artifact kind is explicitly keyless (heartbeat ticks / decisions) or when
 * the optional identifier needed to form a key is absent (meme-image in the
 * `upload-failed` state has no cid).
 */
export function deriveNaturalKey(artifact: Artifact): string | null {
  switch (artifact.kind) {
    case 'bsc-token':
      return `bsc-token:${artifact.address.toLowerCase()}`;
    case 'token-deploy-tx':
      return `token-deploy-tx:${artifact.txHash.toLowerCase()}`;
    case 'x402-tx':
      return `x402-tx:${artifact.txHash.toLowerCase()}`;
    case 'lore-cid':
      return `lore-cid:${artifact.cid}:${artifact.author}`;
    case 'shill-tweet':
      return `shill-tweet:${artifact.tweetId}`;
    case 'tweet-url':
      return `tweet-url:${artifact.tweetId}`;
    case 'shill-order':
      return `shill-order:${artifact.orderId}`;
    case 'lore-anchor':
      return `lore-anchor:${artifact.anchorId}`;
    case 'meme-image':
      return artifact.cid !== null ? `meme-image:${artifact.cid}` : null;
    case 'heartbeat-tick':
    case 'heartbeat-decision':
      return null;
  }
}

/**
 * Conflict policy associated with each natural-key shape. Drives which SQL
 * branch `ArtifactLogStore.append` should run:
 *   - `DO NOTHING` keeps the first writer's payload (immutable kinds).
 *   - `DO UPDATE` overwrites the payload so the latest state wins (status
 *     transitions, layer-2 anchor stamping).
 *   - `null`-keyed rows use raw INSERT with no conflict clause.
 */
export type ArtifactConflictStrategy = 'do-nothing' | 'do-update' | 'no-key';

export function artifactConflictStrategy(artifact: Artifact): ArtifactConflictStrategy {
  switch (artifact.kind) {
    case 'bsc-token':
    case 'token-deploy-tx':
    case 'x402-tx':
    case 'lore-cid':
    case 'shill-tweet':
    case 'tweet-url':
      return 'do-nothing';
    case 'shill-order':
    case 'lore-anchor':
      return 'do-update';
    case 'meme-image':
      // Only `ok` uploads have a cid; `upload-failed` falls back to raw
      // INSERT via the null-key path so retried failures stack up rather
      // than trampling each other.
      return artifact.cid !== null ? 'do-update' : 'no-key';
    case 'heartbeat-tick':
    case 'heartbeat-decision':
      return 'no-key';
  }
}
