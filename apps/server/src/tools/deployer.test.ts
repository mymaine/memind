import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Hash, type Log } from 'viem';
import {
  createOnchainDeployerTool,
  deployerInputSchema,
  extractTokenAddressFromLogs,
  parseInstantStdout,
  type ReceiptFetcher,
} from './deployer.js';

/**
 * Unit tests for onchain_deployer. The real flow touches BSC mainnet and
 * burns gas; tests therefore inject a fake `spawn` and a fake receipt
 * fetcher. No network, no private keys, no tx.
 */

const VALID_PK = '0x' + 'a'.repeat(64);
const TOKEN_MANAGER2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
const DEPLOYED_TOKEN = '0x1234567890abcdef1234567890abcdef12345678';
const FAKE_TX_HASH = ('0x' + 'f'.repeat(64)) as Hash;

/**
 * Fake child process: inherits EventEmitter and exposes stdout/stderr streams
 * that the caller can write to. `close` + exit code drive the spawnFn promise.
 */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function completeChild(child: FakeChild, stdout: string, exitCode = 0, stderr = ''): void {
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
}

function createInstantStdout(): string {
  return JSON.stringify({ txHash: FAKE_TX_HASH }, null, 2);
}

const TOKEN_CREATE_ABI = parseAbiItem(
  'event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)',
);

function tokenCreateLog(token: string = DEPLOYED_TOKEN): Log {
  const topics = encodeEventTopics({
    abi: [TOKEN_CREATE_ABI],
    eventName: 'TokenCreate',
  });
  const data = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'string' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    [
      ('0x' + '11'.repeat(20)) as `0x${string}`,
      token as `0x${string}`,
      1n,
      'HBNB2026-Test',
      'HBNB2026-TST',
      1_000_000_000n,
      0n,
      0n,
    ],
  );
  return {
    address: TOKEN_MANAGER2,
    topics,
    data,
    blockHash: '0x' + '0'.repeat(64),
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: FAKE_TX_HASH,
    transactionIndex: 0,
    removed: false,
  } as unknown as Log;
}

function fakeReceiptFetcher(logs: Log[]): ReceiptFetcher {
  return {
    waitForTransactionReceipt: async ({ hash: _hash }) => ({
      status: 'success',
      logs,
      blockNumber: 1n,
    }),
  };
}

describe('deployerInputSchema', () => {
  it('rejects names without HBNB2026- prefix', () => {
    const res = deployerInputSchema.safeParse({
      name: 'CoolToken',
      symbol: 'HBNB2026-CT',
      description: 'x',
      imageLocalPath: '/tmp/a.png',
    });
    expect(res.success).toBe(false);
  });

  it('rejects symbols without HBNB2026- prefix', () => {
    const res = deployerInputSchema.safeParse({
      name: 'HBNB2026-Cool',
      symbol: 'COOL',
      description: 'x',
      imageLocalPath: '/tmp/a.png',
    });
    expect(res.success).toBe(false);
  });

  it('rejects lowercase-symbol variants (symbols are uppercase)', () => {
    const res = deployerInputSchema.safeParse({
      name: 'HBNB2026-Cool',
      symbol: 'HBNB2026-cool',
      description: 'x',
      imageLocalPath: '/tmp/a.png',
    });
    expect(res.success).toBe(false);
  });

  it('accepts a well-formed metadata payload', () => {
    const res = deployerInputSchema.safeParse({
      name: 'HBNB2026-Cool',
      symbol: 'HBNB2026-CT',
      description: 'a demo token',
      imageLocalPath: '/tmp/a.png',
      imageIpfsCid: 'bafkreigh2akiscaildc...',
      label: 'AI',
    });
    expect(res.success).toBe(true);
  });

  it('rejects unsupported labels', () => {
    const res = deployerInputSchema.safeParse({
      name: 'HBNB2026-Cool',
      symbol: 'HBNB2026-CT',
      description: 'x',
      imageLocalPath: '/tmp/a.png',
      label: 'NotALabel',
    });
    expect(res.success).toBe(false);
  });
});

describe('parseInstantStdout', () => {
  it('parses JSON { txHash }', () => {
    const hash = parseInstantStdout(JSON.stringify({ txHash: FAKE_TX_HASH }));
    expect(hash).toBe(FAKE_TX_HASH);
  });

  it('falls back to regex when stdout is plain text', () => {
    const hash = parseInstantStdout(`sent tx ${FAKE_TX_HASH} to mainnet\n`);
    expect(hash).toBe(FAKE_TX_HASH);
  });

  it('throws when no hash is present', () => {
    expect(() => parseInstantStdout('nothing here')).toThrowError(/did not contain a tx hash/);
  });
});

describe('extractTokenAddressFromLogs', () => {
  it('returns the token address from a TokenCreate log', () => {
    const addr = extractTokenAddressFromLogs([tokenCreateLog()]);
    expect(addr?.toLowerCase()).toBe(DEPLOYED_TOKEN.toLowerCase());
  });

  it('skips logs from unrelated addresses', () => {
    const unrelated = { ...tokenCreateLog(), address: '0x' + '1'.repeat(40) } as Log;
    const addr = extractTokenAddressFromLogs([unrelated]);
    expect(addr).toBeNull();
  });

  it('returns null when no matching log is present', () => {
    expect(extractTokenAddressFromLogs([])).toBeNull();
  });
});

describe('createOnchainDeployerTool — CLI arg assembly and stdout parsing', () => {
  let tmpDir: string;
  let imagePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'deployer-test-'));
    imagePath = join(tmpDir, 'logo.png');
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when privateKey is malformed', () => {
    expect(() => createOnchainDeployerTool({ privateKey: 'not-hex' })).toThrowError(
      /privateKey must be/,
    );
  });

  it('invokes `@four-meme/four-meme-ai create-instant` with named flags and never leaks PK in argv', async () => {
    const spawnFn = vi.fn((_command: string, args: readonly string[], options: SpawnOptions) => {
      const child = new FakeChild();
      // Argv must never contain the private key.
      for (const arg of args) {
        expect(arg).not.toContain(VALID_PK);
        expect(arg).not.toContain(VALID_PK.slice(2));
      }
      const env = (options.env ?? {}) as Record<string, string>;
      expect(env['PRIVATE_KEY']).toBe(VALID_PK);
      expect(env['BSC_RPC_URL']).toBe('https://custom.rpc');
      completeChild(child, createInstantStdout());
      return child as unknown as ChildProcess;
    });

    const tool = createOnchainDeployerTool({
      privateKey: VALID_PK,
      rpcUrl: 'https://custom.rpc',
      spawnImpl: spawnFn as unknown as (
        command: string,
        args: readonly string[],
        options: SpawnOptions,
      ) => ChildProcess,
      receiptFetcher: fakeReceiptFetcher([tokenCreateLog()]),
    });

    const result = await tool.execute({
      name: 'HBNB2026-Cool',
      symbol: 'HBNB2026-CT',
      description: 'a friendly demo token',
      imageLocalPath: imagePath,
      label: 'AI',
    });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const callArgs = spawnFn.mock.calls[0]![1];
    expect(callArgs).toEqual([
      '-y',
      '@four-meme/four-meme-ai@1.0.8',
      'create-instant',
      `--image=${imagePath}`,
      '--name=HBNB2026-Cool',
      '--short-name=HBNB2026-CT',
      '--desc=a friendly demo token',
      '--label=AI',
    ]);

    expect(result.txHash).toBe(FAKE_TX_HASH);
    expect(result.tokenAddr.toLowerCase()).toBe(DEPLOYED_TOKEN.toLowerCase());
    expect(result.bscscanUrl).toBe(`https://bscscan.com/tx/${FAKE_TX_HASH}`);
  });

  it('defaults the label to "AI" when the caller does not provide one', async () => {
    const spawnFn = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => {
      const child = new FakeChild();
      completeChild(child, createInstantStdout());
      return child as unknown as ChildProcess;
    });
    const tool = createOnchainDeployerTool({
      privateKey: VALID_PK,
      spawnImpl: spawnFn as unknown as (
        command: string,
        args: readonly string[],
        options: SpawnOptions,
      ) => ChildProcess,
      receiptFetcher: fakeReceiptFetcher([tokenCreateLog()]),
    });
    await tool.execute({
      name: 'HBNB2026-Cool',
      symbol: 'HBNB2026-CT',
      description: 'demo',
      imageLocalPath: imagePath,
    });
    const callArgs = spawnFn.mock.calls[0]![1];
    expect(callArgs[callArgs.length - 1]).toBe('--label=AI');
  });

  it('surfaces CLI exit code and stderr tail when create-instant fails', async () => {
    const spawnFn = vi.fn(() => {
      const child = new FakeChild();
      completeChild(child, '', 1, 'boom: upstream rejected login');
      return child as unknown as ChildProcess;
    });
    const tool = createOnchainDeployerTool({
      privateKey: VALID_PK,
      spawnImpl: spawnFn as unknown as (
        command: string,
        args: readonly string[],
        options: SpawnOptions,
      ) => ChildProcess,
      receiptFetcher: fakeReceiptFetcher([]),
    });
    await expect(
      tool.execute({
        name: 'HBNB2026-Cool',
        symbol: 'HBNB2026-CT',
        description: 'demo',
        imageLocalPath: imagePath,
      }),
    ).rejects.toThrow(/CLI exited with code 1[\s\S]*boom: upstream rejected login/);
  });

  it('throws if the imageLocalPath does not exist', async () => {
    const spawnFn = vi.fn(() => {
      throw new Error('spawn should not be called when image is missing');
    });
    const tool = createOnchainDeployerTool({
      privateKey: VALID_PK,
      spawnImpl: spawnFn as unknown as (
        command: string,
        args: readonly string[],
        options: SpawnOptions,
      ) => ChildProcess,
      receiptFetcher: fakeReceiptFetcher([]),
    });
    await expect(
      tool.execute({
        name: 'HBNB2026-Cool',
        symbol: 'HBNB2026-CT',
        description: 'demo',
        imageLocalPath: '/nope/does-not-exist.png',
      }),
    ).rejects.toThrow(/image file not found/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('throws if the tx reverted', async () => {
    const spawnFn = vi.fn(() => {
      const child = new FakeChild();
      completeChild(child, createInstantStdout());
      return child as unknown as ChildProcess;
    });
    const revertingFetcher: ReceiptFetcher = {
      waitForTransactionReceipt: async () => ({
        status: 'reverted',
        logs: [],
        blockNumber: 1n,
      }),
    };
    const tool = createOnchainDeployerTool({
      privateKey: VALID_PK,
      spawnImpl: spawnFn as unknown as (
        command: string,
        args: readonly string[],
        options: SpawnOptions,
      ) => ChildProcess,
      receiptFetcher: revertingFetcher,
    });
    await expect(
      tool.execute({
        name: 'HBNB2026-Cool',
        symbol: 'HBNB2026-CT',
        description: 'demo',
        imageLocalPath: imagePath,
      }),
    ).rejects.toThrow(/reverted on BSC mainnet/);
  });
});
