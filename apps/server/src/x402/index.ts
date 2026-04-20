import { randomUUID } from 'node:crypto';
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
 * Stub tx hash used when the handler enqueues before x402 settlement completes.
 *
 * The express paymentMiddleware runs settlement *after* the handler calls
 * `res.end()` (see @x402/express/dist/cjs/index.js — it buffers writeHead/write/end
 * and only settles once the handler finishes). That means the real
 * `PAYMENT-RESPONSE` header with the settled transaction hash is not available
 * at enqueue time. We still need `paidTxHash` to satisfy the ShillOrderStore
 * contract (non-empty string) so we write a zeroed sentinel.
 *
 * **MVP behaviour (Phase 4.6, shipped 2026-04-18)**: the sentinel is never
 * reconciled — store entries keep the all-zero hash for their entire lifetime
 * and the dashboard renders a `0x0000…pending` placeholder instead of a live
 * BaseScan link. The actual on-chain settlement DID happen (evident from the
 * 200 response with a valid `PAYMENT-RESPONSE` header); the client retains
 * that hash if it wants. This is an accepted MVP trade-off, not a bug.
 *
 * **Reconciliation path (post-hackathon)**: add `ShillOrderStore.recordSettlement(orderId, txHash)`
 * and wire it via `res.on('finish', …)` to decode `X-PAYMENT-RESPONSE` after
 * the middleware has finalised the response.
 */
const PENDING_PAID_TX_HASH = `0x${'0'.repeat(64)}`;

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
  // Phase 4.6 shilling market endpoint. Store-aware on enqueue; the Shiller
  // agent consumes from the same ShillOrderStore on its tick.
  app.post('/shill/:tokenAddr', createShillHandler({ shillOrderStore: opts.shillOrderStore }));
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
    void (async () => {
      const tokenAddr = req.params.tokenAddr;
      if (loreStore && typeof tokenAddr === 'string') {
        const entry = await loreStore.getLatest(tokenAddr);
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
      // Phase 2 fallback — wording kept byte-identical to the original
      // handler so any downstream assertion on the mock lore stays valid.
      //
      // Normalise tokenAddr to lowercase so this branch matches the
      // store-hit branch's shape (LoreStore keys are always lowercase).
      // Without this, two identical requests could return different
      // casings depending on whether the store was warm — a subtle source
      // of downstream drift.
      const normalisedAddr = typeof tokenAddr === 'string' ? tokenAddr.toLowerCase() : tokenAddr;
      res.json({
        tokenAddr: normalisedAddr,
        lore: `Mock lore chapter for token ${normalisedAddr ?? '<missing>'}. Real IPFS lore arrives in Phase 3 once the Narrator agent is wired.`,
        ipfsCid: 'bafybeigdyrztXXXXmockloreCIDplaceholderPhase2XXXXXXXXXXXXXXXX',
      });
    })();
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
 * Build the POST `/shill/:tokenAddr` handler (Phase 4.6).
 *
 * Single responsibility — turn a paid request into a queued ShillOrder and
 * return an orderId the caller can poll. LLM-driven tweet generation and
 * X-API posting are the Shiller agent's job on its tick, not this handler's.
 *
 * Behaviour:
 *   - Generates a UUID `orderId`.
 *   - Normalises `tokenAddr` to lowercase (ShillOrderStore does the same
 *     internally, but we echo the lowercased value in the 200 body so the
 *     dashboard/SSE client does not have to double-normalise).
 *   - Reads optional `creatorBrief` from the JSON body. Requires
 *     `express.json()` to be mounted upstream; when absent, `req.body` is
 *     `undefined` and `creatorBrief` stays undefined — the handler still
 *     enqueues successfully.
 *   - If `shillOrderStore` is provided, enqueues with a pending sentinel
 *     `paidTxHash` (see PENDING_PAID_TX_HASH for why real settlement hash is
 *     unavailable here) and `paidAmountUsdc: '0.01'` matching PAID_ROUTES.
 *   - Always returns 200 + `{ orderId, status: 'queued', targetTokenAddr,
 *     estimatedReadyMs }` so that callers have a deterministic response shape
 *     even when the store is not wired (demo / test scenarios).
 *
 * `estimatedReadyMs` is a UX hint for the dashboard: the Shiller agent ticks
 * every ~10s, so worst-case handoff latency is ~10s.
 */
export function createShillHandler(
  opts: { shillOrderStore?: ShillOrderStore } = {},
): RequestHandler {
  const { shillOrderStore } = opts;
  return (req: Request, res: Response): void => {
    void (async () => {
      const rawTokenAddr = typeof req.params.tokenAddr === 'string' ? req.params.tokenAddr : '';
      const targetTokenAddr = rawTokenAddr.toLowerCase();

      const body = (req.body ?? {}) as { creatorBrief?: unknown };
      const creatorBrief =
        typeof body.creatorBrief === 'string' && body.creatorBrief.length > 0
          ? body.creatorBrief
          : undefined;

      const orderId = randomUUID();

      if (shillOrderStore) {
        try {
          await shillOrderStore.enqueue({
            orderId,
            targetTokenAddr,
            ...(creatorBrief !== undefined ? { creatorBrief } : {}),
            paidTxHash: PENDING_PAID_TX_HASH,
            paidAmountUsdc: '0.01',
            ts: new Date().toISOString(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: `shill enqueue failed: ${message}` });
          return;
        }
      }

      res.status(200).json({
        orderId,
        status: 'queued',
        targetTokenAddr,
        estimatedReadyMs: 10_000,
      });
    })();
  };
}
