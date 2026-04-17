import type { Express, Request, Response } from 'express';
import { privateKeyToAccount } from 'viem/accounts';
import { paymentMiddleware } from '@x402/express';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import type { RouteConfig } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { AppConfig } from '../config.js';
import { PAID_ROUTES, routeKey, type PaidRoute } from './config.js';

/**
 * Register the three paid x402 endpoints on the given Express app.
 *
 * Wiring (mirrors scripts/probe-x402.ts, which end-to-end proved the flow on
 * 2026-04-18 — tx 0x4331ff58…bff000a on Base Sepolia):
 *   1. HTTPFacilitatorClient talks to config.x402.facilitatorUrl.
 *   2. x402ResourceServer registers the ExactEvmScheme for config.x402.network.
 *   3. paymentMiddleware guards the three routes from x402/config.ts.
 *   4. Express handlers serve mock resources (real dynamic agent output lands
 *      in Phase 3; this wiring is Phase 2 Task 6 scope).
 *
 * Wallet configuration:
 *   - payTo address is resolved via resolvePayTo(config): env-provided address
 *     wins; otherwise we derive it from the agent private key.
 *   - If both are missing we throw before any middleware is mounted so the
 *     server fails fast instead of silently issuing unsigned 402s.
 */
export function registerX402Routes(app: Express, config: AppConfig): void {
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
  // Each returns mock data — Phase 3 will plug these into real agent output.
  app.get('/lore/:tokenAddr', handleLore);
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

// ─── Route handlers (mock payloads; Phase 3 swaps in real agent data) ──────

function handleLore(req: Request, res: Response): void {
  const tokenAddr = req.params.tokenAddr;
  res.json({
    tokenAddr,
    lore: `Mock lore chapter for token ${tokenAddr ?? '<missing>'}. Real IPFS lore arrives in Phase 3 once the Narrator agent is wired.`,
    ipfsCid: 'bafybeigdyrztXXXXmockloreCIDplaceholderPhase2XXXXXXXXXXXXXXXX',
  });
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
