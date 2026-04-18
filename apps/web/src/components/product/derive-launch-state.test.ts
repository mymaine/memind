import { describe, it, expect } from 'vitest';
import type { Artifact, LogEvent } from '@hack-fourmeme/shared';
import type { ToolCallState, ToolCallsByAgent } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS } from '@/hooks/useRun-state';
import { deriveLaunchState, type DeriveLaunchInput } from './derive-launch-state';

/**
 * LaunchPanel (AC-P4.7-5) derive-function coverage. The happy-path artifact
 * sequence emitted by the a2a orchestrator (verified against apps/server/src/
 * runs/a2a.ts + creator-phase.ts) is:
 *
 *   1. meme-image (status=ok | upload-failed)   ← Creator
 *   2. bsc-token
 *   3. token-deploy-tx
 *   4. lore-cid (author=creator)
 *   5. lore-cid (author=narrator)                ← Narrator
 *   6. x402-tx                                   ← Market-maker
 *
 * 3-step panel mapping (spec AC-P4.7-5):
 *   ① Creator        ← meme-image
 *   ② Narrator       ← lore-cid (author='narrator')
 *   ③ Market-maker   ← x402-tx
 *
 * These tests pin every state transition + every null-safety edge of the
 * discriminated union the panel renders off.
 */

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const DEPLOY_TX = `0x${'a'.repeat(64)}`;
const X402_TX = `0x${'b'.repeat(64)}`;

function buildMemeImageOk(): Extract<Artifact, { kind: 'meme-image' }> {
  return {
    kind: 'meme-image',
    status: 'ok',
    cid: 'bafymeme',
    gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafymeme',
    prompt: 'ascii nyan cat with shades',
  };
}

function buildMemeImageFailed(): Extract<Artifact, { kind: 'meme-image' }> {
  return {
    kind: 'meme-image',
    status: 'upload-failed',
    cid: null,
    gatewayUrl: null,
    prompt: 'ascii nyan cat with shades',
    errorMessage: 'pinata 502',
  };
}

function buildBscToken(): Extract<Artifact, { kind: 'bsc-token' }> {
  return {
    kind: 'bsc-token',
    chain: 'bsc-mainnet',
    address: TOKEN_ADDR,
    explorerUrl: `https://bscscan.com/token/${TOKEN_ADDR}`,
  };
}

function buildDeployTx(): Extract<Artifact, { kind: 'token-deploy-tx' }> {
  return {
    kind: 'token-deploy-tx',
    chain: 'bsc-mainnet',
    txHash: DEPLOY_TX,
    explorerUrl: `https://bscscan.com/tx/${DEPLOY_TX}`,
  };
}

function buildLoreCid(author: 'creator' | 'narrator'): Extract<Artifact, { kind: 'lore-cid' }> {
  return {
    kind: 'lore-cid',
    cid: `bafylore-${author}`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/bafylore-${author}`,
    author,
  };
}

function buildX402Tx(): Extract<Artifact, { kind: 'x402-tx' }> {
  return {
    kind: 'x402-tx',
    chain: 'base-sepolia',
    txHash: X402_TX,
    explorerUrl: `https://sepolia.basescan.org/tx/${X402_TX}`,
    amountUsdc: '0.01',
  };
}

function buildToolCalls(
  patches: Array<{ agent: keyof ToolCallsByAgent; call: ToolCallState }>,
): ToolCallsByAgent {
  const base: ToolCallsByAgent = {
    creator: [],
    narrator: [],
    'market-maker': [],
    heartbeat: [],
  };
  for (const { agent, call } of patches) {
    base[agent] = [...base[agent], call];
  }
  return base;
}

function baseInput(overrides: Partial<DeriveLaunchInput> = {}): DeriveLaunchInput {
  return {
    phase: 'idle',
    artifacts: [] as Artifact[],
    toolCalls: EMPTY_TOOL_CALLS,
    assistantText: EMPTY_ASSISTANT_TEXT,
    logs: [] as LogEvent[],
    error: null,
    ...overrides,
  };
}

describe('deriveLaunchState', () => {
  it('returns idle when phase is idle and no artifacts exist', () => {
    const result = deriveLaunchState(baseInput());
    expect(result).toEqual({ kind: 'idle' });
  });

  it('returns running with creator step active when phase=running and no artifacts arrived yet', () => {
    const result = deriveLaunchState(baseInput({ phase: 'running' }));
    expect(result.kind).toBe('running');
    if (result.kind !== 'running') throw new Error('expected running');
    expect(result.steps).toEqual({ creator: 'running', narrator: 'idle', marketMaker: 'idle' });
    expect(result.latestToolUse).toBeNull();
    expect(result.memeImageArtifact).toBeNull();
  });

  it('marks creator done + narrator running once meme-image artifact arrives', () => {
    const meme = buildMemeImageOk();
    const result = deriveLaunchState(baseInput({ phase: 'running', artifacts: [meme] }));
    expect(result.kind).toBe('running');
    if (result.kind !== 'running') throw new Error('expected running');
    expect(result.steps).toEqual({ creator: 'done', narrator: 'running', marketMaker: 'idle' });
    expect(result.memeImageArtifact).toEqual(meme);
  });

  it('marks creator done even when meme-image status is upload-failed (AC-V2-2 signal)', () => {
    const meme = buildMemeImageFailed();
    const result = deriveLaunchState(baseInput({ phase: 'running', artifacts: [meme] }));
    expect(result.kind).toBe('running');
    if (result.kind !== 'running') throw new Error('expected running');
    expect(result.steps.creator).toBe('done');
    expect(result.steps.narrator).toBe('running');
    expect(result.memeImageArtifact).toEqual(meme);
  });

  it('marks narrator done + market-maker running once narrator lore-cid arrives', () => {
    const artifacts = [
      buildMemeImageOk(),
      buildBscToken(),
      buildDeployTx(),
      buildLoreCid('creator'),
      buildLoreCid('narrator'),
    ];
    const result = deriveLaunchState(baseInput({ phase: 'running', artifacts }));
    expect(result.kind).toBe('running');
    if (result.kind !== 'running') throw new Error('expected running');
    expect(result.steps).toEqual({
      creator: 'done',
      narrator: 'done',
      marketMaker: 'running',
    });
  });

  it('returns success with every artifact populated once phase=done and full artifact set arrived', () => {
    const meme = buildMemeImageOk();
    const bscToken = buildBscToken();
    const deployTx = buildDeployTx();
    const creatorLore = buildLoreCid('creator');
    const narratorLore = buildLoreCid('narrator');
    const x402 = buildX402Tx();
    const result = deriveLaunchState(
      baseInput({
        phase: 'done',
        artifacts: [meme, bscToken, deployTx, creatorLore, narratorLore, x402],
      }),
    );
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.memeImageArtifact).toEqual(meme);
    expect(result.bscTokenArtifact).toEqual(bscToken);
    expect(result.deployTxArtifact).toEqual(deployTx);
    expect(result.creatorLoreArtifact).toEqual(creatorLore);
    expect(result.narratorLoreArtifact).toEqual(narratorLore);
    expect(result.x402TxArtifact).toEqual(x402);
  });

  it('returns success with nulls for missing artifacts when phase=done but set incomplete', () => {
    const meme = buildMemeImageOk();
    const x402 = buildX402Tx();
    const result = deriveLaunchState(baseInput({ phase: 'done', artifacts: [meme, x402] }));
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.memeImageArtifact).toEqual(meme);
    expect(result.x402TxArtifact).toEqual(x402);
    expect(result.bscTokenArtifact).toBeNull();
    expect(result.deployTxArtifact).toBeNull();
    expect(result.creatorLoreArtifact).toBeNull();
    expect(result.narratorLoreArtifact).toBeNull();
  });

  it('returns error when phase=error, surfacing the server error message verbatim', () => {
    const result = deriveLaunchState(
      baseInput({ phase: 'error', error: 'creator failed: pinata 502' }),
    );
    expect(result).toEqual({ kind: 'error', message: 'creator failed: pinata 502' });
  });

  it('falls back to a generic error message when phase=error but error string is null', () => {
    const result = deriveLaunchState(baseInput({ phase: 'error', error: null }));
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('picks the most recent tool_use across agents as latestToolUse (sorted by ts)', () => {
    const toolCalls = buildToolCalls([
      {
        agent: 'creator',
        call: {
          id: 'tu_1',
          toolName: 'meme_image_creator',
          input: {},
          status: 'done',
        },
      },
      {
        agent: 'narrator',
        call: {
          id: 'tu_2',
          toolName: 'write_lore',
          input: {},
          status: 'running',
        },
      },
    ]);
    const result = deriveLaunchState(baseInput({ phase: 'running', toolCalls }));
    expect(result.kind).toBe('running');
    if (result.kind !== 'running') throw new Error('expected running');
    // The newest entry wins; both share the same storage order, so the
    // narrator call (inserted last) should be the latest tool_use.
    expect(result.latestToolUse).toEqual({ agent: 'narrator', toolName: 'write_lore' });
  });

  it('returns latestToolUse null when toolCalls is entirely empty during running', () => {
    const result = deriveLaunchState(baseInput({ phase: 'running' }));
    expect(result.kind).toBe('running');
    if (result.kind !== 'running') throw new Error('expected running');
    expect(result.latestToolUse).toBeNull();
  });

  it('keeps steps idle after reset (phase back to idle + every collection cleared)', () => {
    // Simulates the state right after useRun().resetRun() was fired mid-run.
    const result = deriveLaunchState(baseInput());
    expect(result).toEqual({ kind: 'idle' });
  });
});
