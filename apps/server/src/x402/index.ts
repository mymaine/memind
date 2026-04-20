import { randomUUID } from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import type { RouteConfig } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { decodePaymentResponseHeader } from '@x402/core/http';
import type { AppConfig } from '../config.js';
import type { LoreStore } from '../state/lore-store.js';
import { PENDING_PAID_TX_HASH, type ShillOrderStore } from '../state/shill-order-store.js';
import { PAID_ROUTES, routeKey, type PaidRoute } from './config.js';
import { createLocalFacilitator, toFacilitatorClient } from './local-facilitator.js';

/**
 * Stub tx hash used when the handler enqueues *before* x402 settlement
 * completes. Defined in `state/shill-order-store.ts` and re-imported here so
 * the handler, the store, and every consumer use the same literal.
 *
 * Root cause: the express paymentMiddleware buffers `writeHead / write / end`
 * and only settles once the handler finishes (see
 * `@x402/express/dist/cjs/index.js`). The real `PAYMENT-RESPONSE` header with
 * the on-chain tx hash is not available at enqueue time, and the
 * ShillOrderStore contract requires a non-empty `paidTxHash`, so we write a
 * zeroed sentinel and reconcile later.
 *
 * Reconciliation (shipped 2026-04-21 — bug fix for /shill `0x0000…pending`):
 * `createShillHandler` subscribes to `res.on('finish', …)` so after the
 * middleware has finalised the response it decodes `PAYMENT-RESPONSE` (or its
 * `X-` prefix) and calls `ShillOrderStore.recordSettlement(orderId, txHash)`.
 * The store's SQL guard `WHERE payload->>'paidTxHash' = <sentinel>` makes the
 * update idempotent — duplicate finish fires and retries are silent no-ops.
 *
 * The sentinel is **not** a dead constant: it still backs the enqueue write
 * and doubles as the SQL guard inside `recordSettlement`, so deleting it
 * would silently regress idempotency.
 */

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
 * Wiring (2026-04-21):
 *   1. Facilitator is chosen by `config.x402.mode`:
 *      - `local` (default): in-process `x402Facilitator` signs settle txs with
 *        the agent EOA. Needs Base Sepolia ETH for gas. Shipped because the
 *        public facilitator's /settle returned `invalid_exact_evm_transaction_failed`
 *        on 2026-04-21.
 *      - `http`: delegates to `config.x402.facilitatorUrl` (x402.org, CDP,
 *        self-hosted x402.rs, etc). Flip via `X402_FACILITATOR_MODE=http`.
 *   2. x402ResourceServer registers the server-side ExactEvmScheme (the one
 *      from `@x402/evm/exact/server` — do not confuse with the facilitator
 *      class of the same name) for config.x402.network.
 *   3. paymentMiddleware guards the four routes from x402/config.ts.
 *   4. Express handlers serve agent output (when a LoreStore is wired) or
 *      mock payloads (Phase 2 fallback — keeps every paid route returning a
 *      non-empty body even before the Narrator has published).
 *
 * Wallet configuration:
 *   - payTo address is resolved via resolvePayTo(config): env-provided address
 *     wins; otherwise we derive it from the agent private key.
 *   - `AGENT_WALLET_PRIVATE_KEY` is load-bearing in `local` mode (facilitator
 *     signer); optional in `http` mode if AGENT_WALLET_ADDRESS is provided.
 */
export function registerX402Routes(
  app: Express,
  config: AppConfig,
  opts: RegisterX402RoutesOpts = {},
): void {
  const payTo = resolvePayTo(config);
  const network = config.x402.network as Network;

  // No auto-failover between local and http — pick one per deployment via env.
  // Auto-failover would double the test surface and hide the real x402.org
  // outage mode (200 with success:false, not a network error).
  let facilitatorClient;
  if (config.x402.mode === 'local') {
    const agentPrivateKey = config.wallets.agent.privateKey;
    if (agentPrivateKey === undefined) {
      throw new Error(
        '[x402] AGENT_WALLET_PRIVATE_KEY must be set in .env.local when ' +
          'X402_FACILITATOR_MODE=local — the in-process facilitator needs the ' +
          'agent EOA to sign settle txs. Set MODE=http to delegate instead.',
      );
    }
    // Wrap in the FacilitatorClient interface x402ResourceServer expects.
    // x402Facilitator.getSupported() is synchronous in @x402/core@2.10.0 while
    // FacilitatorClient.getSupported() returns a Promise — runtime the resource
    // server just `await`s the value, but the TS adapter is explicit here so
    // the type contract stays honest. See toFacilitatorClient for details.
    facilitatorClient = toFacilitatorClient(
      createLocalFacilitator({
        agentPrivateKey: agentPrivateKey as `0x${string}`,
        network,
      }),
    );
  } else {
    facilitatorClient = new HTTPFacilitatorClient({ url: config.x402.facilitatorUrl });
  }
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
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

        // Reconcile the sentinel paidTxHash with the real x402 settlement
        // hash once the paymentMiddleware has flushed `PAYMENT-RESPONSE`.
        // `finish` fires after `res.end()` returns — by that point the
        // middleware has written the header onto the response object, so
        // `res.getHeader` can read it back. Any failure is logged and
        // swallowed: the sentinel stays, which matches pre-fix behaviour
        // and keeps the 200 response intact for the caller.
        res.on('finish', () => {
          void reconcileSettlement(res, shillOrderStore, orderId);
        });
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

/**
 * Decode the x402 `PAYMENT-RESPONSE` header from the finished response and
 * upgrade the corresponding shill-order's `paidTxHash` from the sentinel to
 * the real tx hash. Header name precedence mirrors `x-fetch-lore.ts` and
 * `runs/shill-market.ts`: canonical `PAYMENT-RESPONSE` first, `X-` prefix as
 * a fallback for intermediaries that still add it.
 *
 * Every failure path (missing header, malformed header, store rejection)
 * logs via `console.warn` and returns — never throws. The handler already
 * responded 200; any error here must not crash the process.
 */
async function reconcileSettlement(
  res: Response,
  shillOrderStore: ShillOrderStore,
  orderId: string,
): Promise<void> {
  try {
    const raw = res.getHeader('PAYMENT-RESPONSE') ?? res.getHeader('X-PAYMENT-RESPONSE');
    if (typeof raw !== 'string' || raw.length === 0) return;
    const settlement = decodePaymentResponseHeader(raw);
    // Settle can report `success: false` with an empty `transaction` when the
    // facilitator failed to submit on-chain (e.g. out of gas, RPC down). In
    // that case leave the sentinel — the client's 402/500 handling surfaces
    // the failure elsewhere, and we must not pass "" to recordSettlement
    // (which validates a 0x-prefixed 32-byte hex and throws otherwise).
    if (!settlement.transaction || settlement.transaction === '') {
      console.warn(
        `[x402] settle did not return a tx hash for order ${orderId}` +
          (settlement.errorReason ? ` (errorReason=${settlement.errorReason})` : '') +
          ' — sentinel paidTxHash preserved.',
      );
      return;
    }
    await shillOrderStore.recordSettlement(orderId, settlement.transaction);
  } catch (err) {
    console.warn('[x402] recordSettlement failed:', err);
  }
}
