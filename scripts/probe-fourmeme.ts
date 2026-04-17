/**
 * Day 1 Phase 1 Task 3 — four-meme token deployment probe (BSC testnet).
 * Verifies route A (four-meme-ai CLI) and route B (direct TokenManager2 call).
 * Both are mainnet-only as of 2026-04-18:
 *   A. `four-meme-ai@1.0.0` hard-codes `networkCode: 'BSC'` upstream and
 *      submits via `viem/chains#bsc` (chainId 56). No `--testnet` switch.
 *   B. TokenManager2 `0x5c95...762b` has no bytecode on BSC testnet (chainId 97).
 * Outcome: BLOCKED for testnet. The probe is read-only (no signing, no gas,
 * no tx); it re-confirms findings on every run. Details + next steps in
 * docs/spec.md Phase 1 Task 3.
 * Deps note: `scripts/` runs from repo root where `viem`/`zod` are not hoisted
 * (they live only under `apps/server/node_modules/`). To stay within the
 * "no new deps" constraint this probe uses `fetch` + hand-rolled env checks;
 * Phase 2 will move deploy logic into `apps/server/` where viem/zod resolve.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

// TokenManager2 mainnet address per four-meme-ai@1.0.0
// skills/four-meme-integration/references/contract-addresses.md
const TOKEN_MANAGER2_MAINNET = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

// Default public RPC endpoints; overridable via env.
const DEFAULT_BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org';
const DEFAULT_BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545';
const BSC_MAINNET_CHAIN_ID = 56;
const BSC_TESTNET_CHAIN_ID = 97;

interface ProbeEnv {
  bscDeployerPrivateKey: string;
  bscTestnetRpcUrl: string;
  bscMainnetRpcUrl: string;
}

// Minimal dotenv loader: supports `KEY=value`, skips comments/blanks, strips
// surrounding quotes. Avoids adding `dotenv` just for a probe script.
function loadDotEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // .env.local is optional; env validation below flags what is missing.
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Hand-rolled env validation — equivalent to a zod schema but with zero deps.
// Returns a typed config or exits with a friendly error listing every issue.
function readEnv(): ProbeEnv {
  loadDotEnvLocal();
  const issues: string[] = [];
  const pk = process.env['BSC_DEPLOYER_PRIVATE_KEY'] ?? '';
  if (!pk) {
    issues.push('BSC_DEPLOYER_PRIVATE_KEY: missing (set in .env.local, see docs/dev-commands.md)');
  } else if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    issues.push('BSC_DEPLOYER_PRIVATE_KEY: must be 0x-prefixed 32-byte hex');
  }
  const testnetRpc = process.env['BSC_TESTNET_RPC_URL'] ?? DEFAULT_BSC_TESTNET_RPC;
  const mainnetRpc = process.env['BSC_MAINNET_RPC_URL'] ?? DEFAULT_BSC_MAINNET_RPC;
  for (const [label, url] of [
    ['BSC_TESTNET_RPC_URL', testnetRpc],
    ['BSC_MAINNET_RPC_URL', mainnetRpc],
  ] as const) {
    try {
      new URL(url);
    } catch {
      issues.push(`${label}: invalid URL (${url})`);
    }
  }
  if (issues.length > 0) {
    console.error(
      '[probe-fourmeme] .env.local invalid:\n' +
        issues.map((i) => '  - ' + i).join('\n') +
        '\n\nSee docs/dev-commands.md for required variables.',
    );
    process.exit(1);
  }
  return {
    bscDeployerPrivateKey: pk,
    bscTestnetRpcUrl: testnetRpc,
    bscMainnetRpcUrl: mainnetRpc,
  };
}

interface CliResult {
  ok: boolean;
  networkCode: string | null;
  stderrTail: string;
}

// Invoke `npx -y four-meme-ai@1.0.0 config` read-only to confirm CLI is
// reachable. The command returns the public raisedToken config from the
// mainnet API; we inspect networkCode only — no signing, no tx.
async function probeCli(): Promise<CliResult> {
  return await new Promise<CliResult>((resolveCli) => {
    const child = spawn('npx', ['-y', 'four-meme-ai@1.0.0', 'config'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunksOut.push(c));
    child.stderr.on('data', (c: Buffer) => chunksErr.push(c));
    child.on('error', (err: Error) => {
      resolveCli({ ok: false, networkCode: null, stderrTail: String(err) });
    });
    child.on('close', (code: number | null) => {
      const stdout = Buffer.concat(chunksOut).toString('utf8');
      const stderr = Buffer.concat(chunksErr).toString('utf8');
      if (code !== 0) {
        resolveCli({ ok: false, networkCode: null, stderrTail: stderr.slice(-400) });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        const first =
          Array.isArray(parsed) && parsed.length > 0
            ? (parsed[0] as Record<string, unknown>)
            : null;
        const networkCode =
          first && typeof first['networkCode'] === 'string'
            ? (first['networkCode'] as string)
            : null;
        resolveCli({ ok: true, networkCode, stderrTail: stderr.slice(-400) });
      } catch {
        resolveCli({ ok: false, networkCode: null, stderrTail: stderr.slice(-400) });
      }
    });
  });
}

// JSON-RPC `eth_getCode` via fetch. Returns raw hex string or '0x' if empty.
async function ethGetCode(rpcUrl: string, address: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getCode',
      params: [address, 'latest'],
    }),
  });
  if (!res.ok) {
    throw new Error(`eth_getCode ${rpcUrl} -> HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error) {
    throw new Error(`eth_getCode ${rpcUrl} -> RPC error: ${body.error.message ?? 'unknown'}`);
  }
  return body.result ?? '0x';
}

interface CodeCheck {
  chainId: number;
  rpcUrl: string;
  bytecodeLen: number;
  hasCode: boolean;
}

async function checkCodePresence(chainId: number, rpcUrl: string): Promise<CodeCheck> {
  const hex = await ethGetCode(rpcUrl, TOKEN_MANAGER2_MAINNET);
  const bytecodeLen = hex === '0x' ? 0 : (hex.length - 2) / 2;
  return { chainId, rpcUrl, bytecodeLen, hasCode: bytecodeLen > 0 };
}

async function main(): Promise<void> {
  const env = readEnv();
  console.info('[probe-fourmeme] env ok (BSC_DEPLOYER_PRIVATE_KEY present)');

  // Route A — CLI reachability
  console.info('[probe-fourmeme] step 1/3: four-meme-ai CLI `config` (read-only)...');
  const cli = await probeCli();
  if (cli.ok) {
    console.info(
      `[probe-fourmeme]   CLI reachable; raisedToken[0].networkCode=${cli.networkCode ?? 'unknown'}`,
    );
  } else {
    console.warn('[probe-fourmeme]   CLI unreachable or non-zero:\n' + cli.stderrTail);
  }
  const cliSupportsTestnet = cli.ok && cli.networkCode !== null && cli.networkCode !== 'BSC';

  // Route B — TokenManager2 bytecode on both chains
  console.info('[probe-fourmeme] step 2/3: BSC mainnet TokenManager2 bytecode check...');
  const mainnetCheck = await checkCodePresence(BSC_MAINNET_CHAIN_ID, env.bscMainnetRpcUrl);
  console.info(
    `[probe-fourmeme]   mainnet(${mainnetCheck.chainId}) ${TOKEN_MANAGER2_MAINNET} bytecodeLen=${mainnetCheck.bytecodeLen} hasCode=${mainnetCheck.hasCode}`,
  );

  console.info('[probe-fourmeme] step 3/3: BSC testnet TokenManager2 bytecode check...');
  const testnetCheck = await checkCodePresence(BSC_TESTNET_CHAIN_ID, env.bscTestnetRpcUrl);
  console.info(
    `[probe-fourmeme]   testnet(${testnetCheck.chainId}) ${TOKEN_MANAGER2_MAINNET} bytecodeLen=${testnetCheck.bytecodeLen} hasCode=${testnetCheck.hasCode}`,
  );

  const testnetDeploymentKnown = testnetCheck.hasCode;

  // Decision
  if (cliSupportsTestnet && testnetDeploymentKnown) {
    console.info(
      '[probe-fourmeme] UNEXPECTED: both routes look testnet-capable — re-check assumptions.',
    );
    process.exitCode = 1;
    return;
  }

  const report = [
    '',
    '[probe-fourmeme] RESULT: BLOCKED for BSC testnet',
    '  reason A (CLI route): four-meme-ai CLI v1.0.0 is mainnet-only',
    `    evidence: \`fourmeme config\` networkCode=${cli.networkCode ?? '(unavailable)'}; ` +
      'upstream API + create-token-chain.ts submit to viem/chains#bsc (chainId 56)',
    '  reason B (direct contract route): TokenManager2 not deployed on BSC testnet',
    `    evidence: eth_getCode(${TOKEN_MANAGER2_MAINNET}) testnet=${testnetCheck.bytecodeLen}B, mainnet=${mainnetCheck.bytecodeLen}B`,
    '',
    '  next steps for the lead:',
    '    1. ask sponsor for a BSC testnet TokenManager2 address, or',
    '    2. switch this probe to BSC mainnet (config shows deployCost=0), or',
    '    3. downgrade AC1 to "createArg/signature + tx simulation only"; update docs/spec.md.',
    '',
    '  references:',
    `    mainnet  https://bscscan.com/address/${TOKEN_MANAGER2_MAINNET}`,
    `    testnet  https://testnet.bscscan.com/address/${TOKEN_MANAGER2_MAINNET}`,
  ].join('\n');
  console.error(report);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('[probe-fourmeme] unexpected error:\n' + msg);
  process.exitCode = 1;
});
