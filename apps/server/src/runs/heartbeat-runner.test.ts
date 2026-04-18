/**
 * Unit coverage for `runHeartbeatDemo` — the Dashboard V2-P3 orchestrator
 * that drives the Heartbeat agent for exactly N ticks and pipes every tick
 * event into the RunStore.
 *
 * Key contracts exercised here (no live LLM / X API / viem):
 *   - exactly `tickCount` heartbeat-tick artifacts, 1-indexed
 *   - tick interval respected (a2a runs never share a run: tokenAddress mutex
 *     is enforced upstream by POST /api/runs, not by this function)
 *   - post/extend/skip decisions translated to `heartbeat-decision` artifacts
 *   - a successful post_to_x tool call produces a `tweet-url` artifact
 *   - per-tick failures are isolated (agent already swallows them); the
 *     runner completes the remaining ticks.
 */
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ArtifactEventPayload,
  LogEvent,
  ToolUseEndEventPayload,
  ToolUseStartEventPayload,
} from '@hack-fourmeme/shared';
import type { AgentLoopResult, runAgentLoop } from '../agents/runtime.js';
import { RunStore } from './store.js';
import { runHeartbeatDemo } from './heartbeat-runner.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function okLoop(finalText: string, toolCalls: AgentLoopResult['toolCalls'] = []): AgentLoopResult {
  return {
    finalText,
    toolCalls,
    trace: [],
    stopReason: 'end_turn',
  };
}

interface Collected {
  artifacts: ArtifactEventPayload[];
  logs: LogEvent[];
  toolStarts: ToolUseStartEventPayload[];
  toolEnds: ToolUseEndEventPayload[];
}

function attachRecorder(store: RunStore, runId: string): Collected {
  const collected: Collected = { artifacts: [], logs: [], toolStarts: [], toolEnds: [] };
  store.subscribe(runId, (event) => {
    if (event.type === 'artifact') collected.artifacts.push(event.data);
    else if (event.type === 'log') collected.logs.push(event.data);
    else if (event.type === 'tool_use:start') collected.toolStarts.push(event.data);
    else if (event.type === 'tool_use:end') collected.toolEnds.push(event.data);
  });
  return collected;
}

const TOKEN_ADDR = '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444';
const FAKE_ANTHROPIC = {} as Anthropic;

describe('runHeartbeatDemo', () => {
  it('emits one heartbeat-tick artifact per configured tick (default totalTicks=3)', async () => {
    const fakeLoop = vi.fn(async () => okLoop('{"action":"skip","reason":"quiet"}'));
    const store = new RunStore();
    const record = store.create('heartbeat');
    const collected = attachRecorder(store, record.runId);

    await runHeartbeatDemo({
      anthropic: FAKE_ANTHROPIC,
      store,
      runId: record.runId,
      tokenAddress: TOKEN_ADDR,
      tickCount: 3,
      intervalMs: 0,
      sleepImpl: vi.fn(async () => {}),
      runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
      tokenStatusImpl: async () => ({
        tokenAddr: TOKEN_ADDR,
        deployedOnChain: true,
        holderCount: 42,
        bondingCurveProgress: null,
        volume24hBnb: null,
        marketCapBnb: null,
        inspectedAtBlock: '1',
        warnings: [],
      }),
    });

    const tickArtifacts = collected.artifacts.filter((a) => a.kind === 'heartbeat-tick');
    expect(tickArtifacts).toHaveLength(3);
    expect(tickArtifacts.map((a) => (a as { tickNumber: number }).tickNumber)).toEqual([1, 2, 3]);
    for (const a of tickArtifacts) {
      expect((a as { totalTicks: number }).totalTicks).toBe(3);
    }
    expect(fakeLoop).toHaveBeenCalledTimes(3);
  });

  it('sleeps between ticks using the injected sleepImpl (not the last tick)', async () => {
    const fakeLoop = vi.fn(async () => okLoop('{"action":"skip","reason":"quiet"}'));
    const sleepImpl = vi.fn(async () => {});
    const store = new RunStore();
    const record = store.create('heartbeat');

    await runHeartbeatDemo({
      anthropic: FAKE_ANTHROPIC,
      store,
      runId: record.runId,
      tokenAddress: TOKEN_ADDR,
      tickCount: 3,
      intervalMs: 10,
      sleepImpl,
      runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
    });

    // Between tick 1→2 and tick 2→3: exactly 2 sleeps of 10ms.
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, 10);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 10);
  });

  it('emits a heartbeat-decision + tweet-url artifact when the agent picks post and post_to_x succeeds', async () => {
    const fakeLoop = vi.fn(async () =>
      okLoop('{"action":"post","reason":"bonding curve shifted"}', [
        {
          name: 'post_to_x',
          input: { text: 'hello $HBNB' },
          output: {
            tweetId: '1810000000000000001',
            text: 'hello $HBNB',
            postedAt: '2026-04-20T10:00:00.000Z',
            url: 'https://x.com/agent/status/1810000000000000001',
          },
          isError: false,
        },
      ]),
    );
    const store = new RunStore();
    const record = store.create('heartbeat');
    const collected = attachRecorder(store, record.runId);

    await runHeartbeatDemo({
      anthropic: FAKE_ANTHROPIC,
      store,
      runId: record.runId,
      tokenAddress: TOKEN_ADDR,
      tickCount: 1,
      intervalMs: 0,
      sleepImpl: vi.fn(async () => {}),
      runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
    });

    const decisions = collected.artifacts.filter((a) => a.kind === 'heartbeat-decision');
    expect(decisions).toHaveLength(1);
    expect((decisions[0] as { action: string }).action).toBe('post');

    const tweets = collected.artifacts.filter((a) => a.kind === 'tweet-url');
    expect(tweets).toHaveLength(1);
    expect((tweets[0] as { tweetId: string }).tweetId).toBe('1810000000000000001');
  });

  it('emits heartbeat-decision with action=skip when the agent declines to act', async () => {
    const fakeLoop = vi.fn(async () => okLoop('{"action":"skip","reason":"nothing new on chain"}'));
    const store = new RunStore();
    const record = store.create('heartbeat');
    const collected = attachRecorder(store, record.runId);

    await runHeartbeatDemo({
      anthropic: FAKE_ANTHROPIC,
      store,
      runId: record.runId,
      tokenAddress: TOKEN_ADDR,
      tickCount: 1,
      intervalMs: 0,
      sleepImpl: vi.fn(async () => {}),
      runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
    });

    const decisions = collected.artifacts.filter((a) => a.kind === 'heartbeat-decision');
    expect(decisions).toHaveLength(1);
    expect((decisions[0] as { action: string }).action).toBe('skip');
    const tweets = collected.artifacts.filter((a) => a.kind === 'tweet-url');
    expect(tweets).toHaveLength(0);
  });

  it('continues remaining ticks when one tick throws', async () => {
    const fakeLoop = vi
      .fn()
      .mockResolvedValueOnce(okLoop('{"action":"skip","reason":"ok"}'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okLoop('{"action":"skip","reason":"ok"}'));
    const store = new RunStore();
    const record = store.create('heartbeat');
    const collected = attachRecorder(store, record.runId);

    await runHeartbeatDemo({
      anthropic: FAKE_ANTHROPIC,
      store,
      runId: record.runId,
      tokenAddress: TOKEN_ADDR,
      tickCount: 3,
      intervalMs: 0,
      sleepImpl: vi.fn(async () => {}),
      runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
    });

    const tickArtifacts = collected.artifacts.filter((a) => a.kind === 'heartbeat-tick');
    expect(tickArtifacts).toHaveLength(3);
    expect(fakeLoop).toHaveBeenCalledTimes(3);
  });

  it('marks tweet-url as isDryRun label-less when post_to_x returns the about:blank stub', async () => {
    // The demo-heartbeat dry-run stub returns `url: 'about:blank'` + `tweetId:
    // 'dry-run'`. The runner must still surface a tweet-url artifact so the
    // dashboard TweetFeed shows *something*, but the label should mark it as
    // dry-run so the UI can dim it.
    const fakeLoop = vi.fn(async () =>
      okLoop('{"action":"post","reason":"x"}', [
        {
          name: 'post_to_x',
          input: { text: 'dry-run text' },
          output: {
            tweetId: 'dry-run',
            text: 'dry-run text',
            postedAt: '2026-04-20T10:00:00.000Z',
            url: 'about:blank',
          },
          isError: false,
        },
      ]),
    );
    const store = new RunStore();
    const record = store.create('heartbeat');
    const collected = attachRecorder(store, record.runId);

    await runHeartbeatDemo({
      anthropic: FAKE_ANTHROPIC,
      store,
      runId: record.runId,
      tokenAddress: TOKEN_ADDR,
      tickCount: 1,
      intervalMs: 0,
      sleepImpl: vi.fn(async () => {}),
      runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
    });

    const tweets = collected.artifacts.filter((a) => a.kind === 'tweet-url');
    expect(tweets).toHaveLength(1);
    const tweet = tweets[0] as { url: string; label?: string };
    expect(tweet.url).toBe('about:blank');
    expect(tweet.label).toMatch(/dry-run/i);
  });
});
