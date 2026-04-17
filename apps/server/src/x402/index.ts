import type { Express } from 'express';
import type { AppConfig } from '../config.js';

/**
 * x402 paid endpoint registration entry point.
 *
 * Wired up in Day 1 Phase 1 Task 2 using `@x402/express` v2:
 *   paymentMiddleware({...routes}, resourceServer)
 *   + x402ResourceServer(new HTTPFacilitatorClient({ url }))
 *       .register('eip155:84532', new ExactEvmScheme())
 *
 * Current placeholder returns 501 Not Implemented so the skeleton can typecheck
 * and `pnpm dev` can boot without env secrets.
 */
export function registerX402Routes(app: Express, _config: AppConfig): void {
  const paid = ['/lore/:tokenAddr', '/alpha/:tokenAddr', '/metadata/:tokenAddr'];
  for (const route of paid) {
    app.get(route, (_req, res) => {
      res.status(501).json({
        error: 'x402 endpoint not yet wired — Phase 1 Task 2',
        route,
      });
    });
  }
}
