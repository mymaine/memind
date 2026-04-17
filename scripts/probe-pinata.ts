/**
 * Day 1 Phase 1 Task 4 — Pinata IPFS probe.
 *
 * Goal: pinFileToIPFS uploads a .md and returns an IPFS hash that can be
 * fetched back via gateway. After this passes, update spec.md Roadmap Phase 1 Task 4 = [x].
 *
 * Fallback: if Pinata is unreachable, use local filesystem + fake hash for demo
 * (see spec.md risk section).
 */

async function main(): Promise<void> {
  console.warn('[probe-pinata] not yet implemented — Phase 1 Task 4');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
