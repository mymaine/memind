/**
 * x402 route and pricing constants.
 *
 * spec.md (Phase 2 Task 6) requires all route paths, prices, and the network
 * identifier to live in this single module so handlers never hard-code pricing.
 * `index.ts` reads from here; tests read from here.
 */

/**
 * Shape of a single paid endpoint definition.
 *
 * - `method` + `path` are the Express route (used both for registering the
 *   handler and for building the x402 RoutesConfig key `"<METHOD> <path>"`).
 * - `price` is the human-readable amount string (e.g. `"$0.01"`); `@x402/evm`
 *   parses this into USDC wei for the configured network.
 * - `description` / `mimeType` surface in the 402 response body for clients.
 */
export interface PaidRoute {
  // `POST` was added in Phase 4.6 for `/shill/:tokenAddr` — creators submit an
  // optional brief in the JSON body, so GET-only is no longer sufficient.
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly price: `$${string}`;
  readonly description: string;
  readonly mimeType: string;
}

/**
 * The three paid endpoints exposed by the Agent-as-Creator server.
 */
export const PAID_ROUTES: readonly PaidRoute[] = [
  {
    method: 'GET',
    path: '/lore/:tokenAddr',
    price: '$0.01',
    description: 'IPFS lore chapter for a four.meme token (Agent-as-Creator, Phase 2)',
    mimeType: 'application/json',
  },
  {
    method: 'GET',
    path: '/alpha/:tokenAddr',
    price: '$0.01',
    description: 'Bonding curve progress + early-bird alpha hint (mock, Phase 2)',
    mimeType: 'application/json',
  },
  {
    method: 'GET',
    path: '/metadata/:tokenAddr',
    price: '$0.005',
    description: 'Token metadata bundle (name, symbol, image URL)',
    mimeType: 'application/json',
  },
  {
    method: 'POST',
    path: '/shill/:tokenAddr',
    price: '$0.01',
    description: 'Shill order: AI agent posts a promotional tweet for this token (Phase 4.6)',
    mimeType: 'application/json',
  },
] as const;

/**
 * Builds the x402 RoutesConfig key from a PaidRoute.
 *
 * `@x402/express`'s paymentMiddleware maps payment requirements by
 * `"<METHOD> <path>"` — this helper keeps that encoding in one place.
 */
export function routeKey(route: PaidRoute): string {
  return `${route.method} ${route.path}`;
}
