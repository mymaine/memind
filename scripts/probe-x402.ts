/**
 * Day 1 Phase 1 Task 2 — x402 hello world probe.
 *
 * Goal: server returns 402 → client pays USDC → resource delivered (Base Sepolia).
 * After this passes, update docs/spec.md Roadmap Phase 1 Task 2 = [x].
 *
 * Protocol version: x402 v2 (npm scope `@x402/*`, not `@coinbase/x402-*`).
 * The original idea.md mentioned `@coinbase/x402-express` v1.2.0 but that package
 * does not exist on npm — the real base package is `x402` v1.2.0 and the runtime
 * libraries are `@x402/core`, `@x402/express`, `@x402/fetch`, `@x402/evm` at v2.10.0+.
 *
 * v2 server API:
 *   paymentMiddleware({...routes}, resourceServer)
 *   + x402ResourceServer(new HTTPFacilitatorClient({ url }))
 *       .register('eip155:84532', new ExactEvmScheme())
 */

async function main(): Promise<void> {
  console.warn('[probe-x402] not yet implemented — Phase 1 Task 2');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
