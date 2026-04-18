import type { Express, Request, RequestHandler, Response } from 'express';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentMiddleware } from '@x402/express';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import type { RouteConfig } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import type { ShillOrderStore } from '../state/shill-order-store.js';
import { PAID_ROUTES, routeKey, type PaidRoute } from './config.js';

/**
 * Optional runtime wiring for the x402 routes.
 *
 * `loreStore` plugs the Narrator agent's output into the `/lore/:tokenAddr`
 * endpoint. When provided, hits with a stored chapter return the real lore;
 * misses (and callers that omit the store entirely) still get the Phase 2
 * mock payload so the x402 contract stays non-empty for the paid demo.
 */
export interface RegisterX402RoutesOpts {
  loreStore?: LoreStore;
  /**
   * Plugs the Shiller agent's order queue into the `/shill/:tokenAddr` endpoint
   * (Phase 4.6). When provided, paid shill requests are enqueued for the Shiller
   * agent to post; when omitted, the endpoint still returns 200 + orderId so the
   * x402 paywall contract stays intact in demos that stub out the Shiller.
   */
  shillOrderStore?: ShillOrderStore;
}

/**
 * Register the three paid x402 endpoints on the given Express app.
 *
 * Wiring (mirrors scripts/probe-x402.ts, which end-to-end proved the flow on
 * 2026-04-18 — tx 0x4331ff58…bff000a on Base Sepolia):
 *   1. HTTPFacilitatorClient talks to config.x402.facilitatorUrl.
 *   2. x402ResourceServer registers the ExactEvmScheme for config.x402.network.
 *   3. paymentMiddleware guards the three routes from x402/config.ts.
 *   4. Express handlers serve agent output (when a LoreStore is wired) or
 *      mock payloads (Phase 2 fallback — keeps every paid route returning a
 *      non-empty body even before the Narrator has published).
 *
 * Wallet configuration:
 *   - payTo address is resolved via resolvePayTo(config): env-provided address
 *     wins; otherwise we derive it from the agent private key.
 *   - If both are missing we throw before any middleware is mounted so the
 *     server fails fast instead of silently issuing unsigned 402s.
 */
export function registerX402Routes(
  app: Express,
  config: AppConfig,
  opts: RegisterX402RoutesOpts = {},
): void {
  const payTo = resolvePayTo(config);
  const network = config.x402.network as Network;

  const facilitator = new HTTPFacilitatorClient({ url: config.x402.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator).register(
    network,
    new ExactEvmScheme(),
  );

  const routes = buildRoutesConfig(PAID_ROUTES, network, payTo);
  app.use(paymentMiddleware(routes, resourceServer));

  // Handlers run only after paymentMiddleware has verified payment.
  // /lore is store-aware; /alpha and /metadata keep their Phase 2 mock shape.
  app.get('/lore/:tokenAddr', createLoreHandler({ loreStore: opts.loreStore }));
  app.get('/alpha/:tokenAddr', handleAlpha);
  app.get('/metadata/:tokenAddr', handleMetadata);
}

/**
 * Resolve the EVM address that will receive x402 USDC payments.
 *
 * Precedence:
 *   1. config.wallets.agent.address (explicit env override)
 *   2. derived from config.wallets.agent.privateKey via viem
 *
 * Throws if neither is present — the server should not start in that state
 * because the 402 flow cannot issue valid payment requirements.
 */
export function resolvePayTo(config: AppConfig): `0x${string}` {
  const { address, privateKey } = config.wallets.agent;
  if (address !== undefined) return address as `0x${string}`;
  if (privateKey !== undefined) {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  }
  throw new Error(
    '[x402] AGENT_WALLET_ADDRESS or AGENT_WALLET_PRIVATE_KEY must be set in .env.local ' +
      '— the paid endpoints cannot issue 402 payment requirements without a payTo address.',
  );
}

/**
 * Build the RoutesConfig object consumed by `paymentMiddleware`, keyed by
 * `"<METHOD> <path>"`. Each route shares the same network + payTo; only price
 * and description vary.
 */
function buildRoutesConfig(
  paidRoutes: readonly PaidRoute[],
  network: Network,
  payTo: `0x${string}`,
): Record<string, RouteConfig> {
  const entries: Record<string, RouteConfig> = {};
  for (const route of paidRoutes) {
    entries[routeKey(route)] = {
      accepts: {
        scheme: 'exact',
        network,
        price: route.price,
        payTo,
      },
      description: route.description,
      mimeType: route.mimeType,
    };
  }
  return entries;
}

// ─── Route handlers ────────────────────────────────────────────────────────

/**
 * Build the /lore handler. Exported so tests can mount it directly on a bare
 * express app without the paymentMiddleware stack — that split keeps the
 * paid integration test focused on x402 settlement while still giving us
 * fast unit coverage of the store-vs-mock payload selection.
 *
 * Behaviour:
 *   - If `loreStore` is supplied and has an entry for the requested token,
 *     return the Narrator-published chapter (normalised lowercase tokenAddr,
 *     chapterNumber, lore text, ipfsCid, ipfsUri, publishedAt).
 *   - Otherwise (no store, or store miss) return the Phase 2 mock shape so
 *     paying callers always get a non-empty body. The mock keeps the exact
 *     wording from the original Phase 2 handler so any consumer asserting
 *     on it remains green.
 */
export function createLoreHandler(opts: { loreStore?: LoreStore } = {}): RequestHandler {
  const { loreStore } = opts;
  return (req: Request, res: Response): void => {
    const tokenAddr = req.params.tokenAddr;
    if (loreStore && typeof tokenAddr === 'string') {
      const entry = loreStore.getLatest(tokenAddr);
      if (entry) {
        res.json({
          tokenAddr: entry.tokenAddr,
          chapterNumber: entry.chapterNumber,
          lore: entry.chapterText,
          ipfsCid: entry.ipfsHash,
          ipfsUri: entry.ipfsUri,
          publishedAt: entry.publishedAt,
        });
        return;
      }
    }
    // Phase 2 fallback — wording kept byte-identical to the original handler
    // so any downstream assertion on the mock lore stays valid.
    //
    // Normalise tokenAddr to lowercase so this branch matches the store-hit
    // branch's shape (LoreStore keys are always lowercase). Without this,
    // two identical requests could return different casings depending on
    // whether the store was warm — a subtle source of downstream drift.
    const normalisedAddr = typeof tokenAddr === 'string' ? tokenAddr.toLowerCase() : tokenAddr;
    res.json({
      tokenAddr: normalisedAddr,
      lore: `Mock lore chapter for token ${normalisedAddr ?? '<missing>'}. Real IPFS lore arrives in Phase 3 once the Narrator agent is wired.`,
      ipfsCid: 'bafybeigdyrztXXXXmockloreCIDplaceholderPhase2XXXXXXXXXXXXXXXX',
    });
  };
}

function handleAlpha(req: Request, res: Response): void {
  const tokenAddr = req.params.tokenAddr;
  res.json({
    tokenAddr,
    bondingCurveProgress: 42,
    alphaHint:
      'Mock early-bird alpha: bonding curve crossed 40% — Phase 3 will read live curve state from four.meme.',
  });
}

function handleMetadata(req: Request, res: Response): void {
  const tokenAddr = req.params.tokenAddr;
  res.json({
    tokenAddr,
    name: 'Mock Token',
    symbol: 'HBNB2026-MOCK',
    imageUrl: 'https://placeholder.example.com/mock-token.png',
  });
}

/**
 * Phase 4.6 stub for the `/shill/:tokenAddr` POST handler.
 *
 * The real implementation decodes the settled x402 payment, generates an
 * orderId, and enqueues a shill order into ShillOrderStore. Exported here
 * so the red tests in index.test.ts can import the symbol without an ESM
 * resolution error before the green commit fills in the behaviour.
 */
export function createShillHandler(
  _opts: { shillOrderStore?: ShillOrderStore } = {},
): RequestHandler {
  return (_req: Request, res: Response): void => {
    res.status(501).json({ error: 'createShillHandler not yet implemented' });
  };
}
