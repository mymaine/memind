import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Hash,
  type Log,
  type PublicClient,
} from 'viem';
import { bsc } from 'viem/chains';
import type { AgentTool } from '@hack-fourmeme/shared';

/**
 * onchain_deployer tool
 * ---------------------
 * Wraps the `four-meme-ai` CLI (route A) to deploy a four.meme token on
 * BSC mainnet. The CLI owns the off-chain API flow (login → upload → build
 * createArg + signature) and the on-chain submit (TokenManager2.createToken).
 * We spawn its two subcommands and parse their stdout JSON:
 *
 *   1. `create-api <img> <name> <symbol> <desc> <label>`
 *      -> stdout `{ "createArg": "0x…", "signature": "0x…" }`
 *   2. `create-chain <createArg> <signature>`
 *      -> stdout `{ "txHash": "0x…" }`
 *
 * Tool behaviour after the two CLI calls:
 *   - await the BSC mainnet receipt via a `viem` public client
 *   - decode the `TokenCreate` event to recover the deployed token address
 *
 * Why mainnet: the four-meme TokenManager2 contract has no testnet deployment
 * (see docs/decisions/2026-04-18-bsc-mainnet-pivot.md). The hackathon accepts
 * the ~$0.05 gas per deploy in exchange for a real tx hash.
 *
 * Why HBNB2026- prefix: hard-discipline #4b in AGENTS.md — any real token on
 * a public launchpad must be clearly flagged as hackathon demo so it does not
 * mislead humans browsing bscscan or dexscreener.
 *
 * Secret hygiene: the deployer private key is received by the factory and
 * forwarded to the child process via the `PRIVATE_KEY` env var only. It is
 * never logged, never echoed into CLI args, and never returned to callers.
 */

// TokenManager2 on BSC mainnet (chainId 56).
const TOKEN_MANAGER2_BSC = '0x5c952063c7fc8610FFDB798152D69F0B9550762b' as const;
const DEFAULT_BSC_RPC_URL = 'https://bsc-dataseed.binance.org';
const DEFAULT_CLI_COMMAND = 'npx';
// Official Four.meme CLI (scoped, maintained by lol@four.meme). The old
// unscoped `four-meme-ai@1.0.0` is deprecated and its bundled tsx loader
// fails to resolve modules on Node 20+; the scoped package ships a plain
// CJS entrypoint instead.
const DEFAULT_CLI_BASE_ARGS: readonly string[] = ['-y', '@four-meme/four-meme-ai@1.0.8'];

// Canonical four.meme label set (CLI validates against the same list).
const FOURMEME_LABELS = [
  'Meme',
  'AI',
  'Defi',
  'Games',
  'Infra',
  'De-Sci',
  'Social',
  'Depin',
  'Charity',
  'Others',
] as const;

// Parsed `TokenCreate` event. Other fields exist but only `token` is needed
// to fulfil the tool contract.
const TOKEN_CREATE_EVENT = parseAbiItem(
  'event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)',
);

// HBNB2026- prefix is mandatory for both name and symbol. The suffix after the
// prefix must be at least 1 character and may only contain printable ASCII
// (letters, digits, dash, underscore). Symbols are additionally kept <= 12
// chars post-prefix to stay under bscscan's symbol display budget.
const HBNB_NAME_REGEX = /^HBNB2026-[A-Za-z0-9][A-Za-z0-9_\-\s]{0,47}$/;
const HBNB_SYMBOL_REGEX = /^HBNB2026-[A-Z0-9][A-Z0-9]{0,11}$/;

export const deployerInputSchema = z.object({
  name: z
    .string()
    .regex(
      HBNB_NAME_REGEX,
      'name must start with "HBNB2026-" prefix (hackathon demo guard, AGENTS.md #4b)',
    ),
  symbol: z
    .string()
    .regex(
      HBNB_SYMBOL_REGEX,
      'symbol must start with "HBNB2026-" prefix and be uppercase (hackathon demo guard, AGENTS.md #4b)',
    ),
  description: z.string().min(1).max(280),
  imageLocalPath: z.string().min(1),
  // Optional — present if the caller already uploaded the image to IPFS. The
  // four-meme CLI still wants a local file (it re-uploads through its own
  // signed endpoint), so we keep this around purely as metadata for callers.
  imageIpfsCid: z.string().optional(),
  // four.meme category. Defaults to 'AI' to fit the "Agent-as-Creator" theme.
  label: z.enum(FOURMEME_LABELS).optional(),
});

export const deployerOutputSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  bscscanUrl: z.string().url(),
});

export type DeployerInput = z.infer<typeof deployerInputSchema>;
export type DeployerOutput = z.infer<typeof deployerOutputSchema>;

/**
 * Minimal spawn contract so tests can inject a fake without pulling in the
 * real `node:child_process`. Matches the subset of `ChildProcess` behaviour we
 * actually consume.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/**
 * Minimal receipt-fetching contract. The real implementation is a viem
 * `PublicClient`; tests pass a stub returning a pre-baked log set.
 */
export interface ReceiptFetcher {
  waitForTransactionReceipt(args: { hash: Hash }): Promise<{
    status: 'success' | 'reverted';
    logs: Log[];
    blockNumber: bigint;
  }>;
}

export interface OnchainDeployerToolConfig {
  /** Deployer EOA private key (0x-prefixed 32-byte hex). Never logged. */
  privateKey: string;
  /** BSC mainnet JSON-RPC URL. Defaults to the public dataseed endpoint. */
  rpcUrl?: string;
  /** Override CLI command (default `npx`). Exists for tests. */
  cliCommand?: string;
  /** Override CLI base args (default `['-y', 'four-meme-ai@1.0.0']`). */
  cliBaseArgs?: readonly string[];
  /**
   * Optional directory to prepend to the CLI subprocess PATH. Use this to
   * force the four-meme-ai CLI onto a specific Node version — e.g. Node 22
   * on a host whose default Node is 25 (the CLI's bundled tsx loader
   * doesn't resolve modules on Node 25). Example:
   *   nodeBinPath: '/opt/homebrew/opt/node@22/bin'
   */
  nodeBinPath?: string;
  /** Inject a custom spawn implementation (tests). */
  spawnImpl?: SpawnFn;
  /** Inject a receipt fetcher (tests). Defaults to a viem PublicClient. */
  receiptFetcher?: ReceiptFetcher;
}

/**
 * Factory: returns an `AgentTool` whose `execute` runs the full deploy flow.
 * The private key is captured in closure — callers should not inspect the
 * returned tool for secrets.
 */
export function createOnchainDeployerTool(
  config: OnchainDeployerToolConfig,
): AgentTool<DeployerInput, DeployerOutput> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.privateKey)) {
    throw new Error(
      'createOnchainDeployerTool: privateKey must be a 0x-prefixed 32-byte hex string',
    );
  }

  const rpcUrl = config.rpcUrl ?? DEFAULT_BSC_RPC_URL;
  const spawnFn: SpawnFn = config.spawnImpl ?? (nodeSpawn as SpawnFn);
  const cliCommand = config.cliCommand ?? DEFAULT_CLI_COMMAND;
  const cliBaseArgs = config.cliBaseArgs ?? DEFAULT_CLI_BASE_ARGS;
  const receiptFetcher: ReceiptFetcher =
    config.receiptFetcher ??
    (createPublicClient({
      chain: bsc,
      transport: http(rpcUrl),
    }) as unknown as PublicClient as unknown as ReceiptFetcher);

  return {
    name: 'onchain_deployer',
    description:
      'Deploys a four.meme token on BSC mainnet via the four-meme-ai CLI. ' +
      'Returns the deployed token address, deploy tx hash, and a bscscan URL. ' +
      'Input name and symbol MUST start with HBNB2026- (hackathon demo prefix).',
    inputSchema: deployerInputSchema,
    outputSchema: deployerOutputSchema,
    async execute(input: DeployerInput): Promise<DeployerOutput> {
      // Defence-in-depth: re-parse even though the registry parses upstream.
      const parsed = deployerInputSchema.parse(input);
      if (!existsSync(parsed.imageLocalPath)) {
        throw new Error(`onchain_deployer: image file not found at ${parsed.imageLocalPath}`);
      }
      const label = parsed.label ?? 'AI';

      // If nodeBinPath is set, prepend it to PATH so the CLI subprocess picks
      // up a specific Node binary (useful if the default Node has a broken
      // library dependency on the host).
      const pathOverride: Record<string, string> =
        config.nodeBinPath !== undefined
          ? { PATH: `${config.nodeBinPath}:${process.env.PATH ?? ''}` }
          : {};

      // create-instant: one-shot flow that uploads metadata through four.meme's
      // private API, signs createArg locally, and submits TokenManager2.createToken.
      // stdout is {"txHash":"0x..."} on success.
      const createArgs = [
        ...cliBaseArgs,
        'create-instant',
        `--image=${parsed.imageLocalPath}`,
        `--name=${parsed.name}`,
        `--short-name=${parsed.symbol}`,
        `--desc=${parsed.description}`,
        `--label=${label}`,
      ];
      const createRes = await runCli(spawnFn, cliCommand, createArgs, config.privateKey, {
        BSC_RPC_URL: rpcUrl,
        ...pathOverride,
      });
      const txHash = parseInstantStdout(createRes.stdout);

      // Resolve token address from the TokenCreate event log.
      const receipt = await receiptFetcher.waitForTransactionReceipt({
        hash: txHash,
      });
      if (receipt.status !== 'success') {
        throw new Error(`onchain_deployer: deploy tx ${txHash} reverted on BSC mainnet`);
      }
      const tokenAddr = extractTokenAddressFromLogs(receipt.logs);
      if (!tokenAddr) {
        throw new Error(
          `onchain_deployer: could not find TokenCreate event in receipt for ${txHash}`,
        );
      }
      return {
        tokenAddr,
        txHash,
        bscscanUrl: `https://bscscan.com/tx/${txHash}`,
      };
    },
  };
}

interface CliResult {
  stdout: string;
  stderr: string;
}

/**
 * Spawn a CLI subcommand. Forwards `PRIVATE_KEY` via env (never via argv) and
 * collects stdout/stderr. On non-zero exit we throw a friendly error that
 * includes the exit code and a trimmed stderr tail — crucially, we redact the
 * private key if it ever accidentally appears in the output.
 */
async function runCli(
  spawnFn: SpawnFn,
  command: string,
  args: readonly string[],
  privateKey: string,
  extraEnv: Record<string, string> = {},
): Promise<CliResult> {
  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawnFn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PRIVATE_KEY: privateKey,
        ...extraEnv,
      },
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => outChunks.push(Buffer.from(c)));
    child.stderr?.on('data', (c: Buffer) => errChunks.push(Buffer.from(c)));
    child.on('error', (err: Error) => {
      reject(new Error(`onchain_deployer: failed to spawn CLI: ${err.message}`));
    });
    child.on('close', (code: number | null) => {
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (code !== 0) {
        const redactedTail = redactSecrets(stderr, privateKey).slice(-600);
        reject(
          new Error(
            `onchain_deployer: CLI exited with code ${code} (args: ${describeArgs(
              args,
            )})\nstderr tail:\n${redactedTail}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Summarise args for error messages without leaking the image path.
 * Keeps the subcommand name + placeholder for user-provided values.
 */
function describeArgs(args: readonly string[]): string {
  // e.g. ['-y', '@four-meme/four-meme-ai@1.0.8', 'create-instant', '--image=...', ...]
  const subcommandIdx = args.findIndex(
    (a) => a === 'create-instant' || a === 'create-api' || a === 'create-chain',
  );
  if (subcommandIdx === -1) return args.slice(0, 3).join(' ');
  return args.slice(0, subcommandIdx + 1).join(' ');
}

/**
 * Best-effort redaction of the private key from any captured output. A
 * defence-in-depth measure — the CLI should never print it, but if it ever
 * did (or a future version does) we refuse to bubble it up.
 */
function redactSecrets(text: string, privateKey: string): string {
  if (!privateKey) return text;
  const bare = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  return text.split(privateKey).join('[REDACTED]').split(bare).join('[REDACTED]');
}

const TX_HASH_RE = /0x[0-9a-fA-F]{64}/;

/**
 * Parse stdout of `create-instant`. CLI contract (scripts/create-token-instant.ts):
 *   console.log(JSON.stringify({ txHash: hash }, null, 2));
 * Fallback: any 0x-prefixed 64-hex substring, in case a future CLI version
 * adds extra stderr/log lines before the JSON.
 */
export function parseInstantStdout(stdout: string): Hash {
  const obj = extractLastJsonObject(stdout);
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const txHash = record['txHash'];
    if (typeof txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return txHash as Hash;
    }
  }
  const match = TX_HASH_RE.exec(stdout);
  if (match) return match[0] as Hash;
  throw new Error(
    `onchain_deployer: create-instant stdout did not contain a tx hash. Got: ${truncate(stdout)}`,
  );
}

/**
 * Decode TokenManager2 logs and return the `token` arg of the first
 * TokenCreate event we find. Logs unrelated to TokenManager2 (or events we
 * don't model) are silently skipped.
 */
export function extractTokenAddressFromLogs(logs: readonly Log[]): string | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== TOKEN_MANAGER2_BSC.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [TOKEN_CREATE_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'TokenCreate') {
        const args = decoded.args as unknown as { token?: string };
        if (args.token && /^0x[a-fA-F0-9]{40}$/.test(args.token)) {
          return args.token;
        }
      }
    } catch {
      // Not a TokenCreate log; keep scanning.
      continue;
    }
  }
  return null;
}

/**
 * Walk the string looking for the last balanced `{ … }` block and JSON.parse
 * it. Returns `null` on any failure — callers provide richer diagnostics.
 */
function extractLastJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Fast path: entire trimmed output is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to brace-scan.
  }
  let depth = 0;
  let start = -1;
  let lastCandidate: string | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        lastCandidate = trimmed.slice(start, i + 1);
        start = -1;
      }
    }
  }
  if (!lastCandidate) return null;
  try {
    return JSON.parse(lastCandidate);
  } catch {
    return null;
  }
}

function truncate(s: string, max = 400): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
