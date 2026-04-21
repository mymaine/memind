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
import { runHeartbeatDemo, HEARTBEAT_SYSTEM_PROMPT } from './heartbeat-runner.js';

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

  // ─── Recent tick history (LLM memory across ticks) ──────────────────────
  //
  // The dashboard runner accumulates a local buffer of the decisions made so
  // far and threads it into the NEXT tick's userInput. Without this, the LLM
  // has no cross-tick memory and happily picks the same action 3 ticks in a
  // row ("post, post, post"). The buffer is built from the parsed decision
  // JSON and degrades silently on errors.
  describe('recent tick history injection', () => {
    it('injects a "Recent tick history" block into tick 2 and tick 3, with the correct entry count each time', async () => {
      const fakeLoop = vi
        .fn<typeof runAgentLoop>()
        .mockResolvedValueOnce(okLoop('{"action":"post","reason":"first"}'))
        .mockResolvedValueOnce(okLoop('{"action":"extend_lore","reason":"second"}'))
        .mockResolvedValueOnce(okLoop('{"action":"skip","reason":"third"}'));
      const store = new RunStore();
      const record = store.create('heartbeat');

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

      expect(fakeLoop).toHaveBeenCalledTimes(3);
      const tick1Input = (fakeLoop.mock.calls[0]![0] as { userInput: string }).userInput;
      const tick2Input = (fakeLoop.mock.calls[1]![0] as { userInput: string }).userInput;
      const tick3Input = (fakeLoop.mock.calls[2]![0] as { userInput: string }).userInput;

      // Tick 1: no history yet.
      expect(tick1Input).not.toContain('Recent tick history');

      // Tick 2: exactly 1 history entry (tick 1's post).
      expect(tick2Input).toContain('Recent tick history');
      const tick2Matches = tick2Input.match(/action=/g) ?? [];
      expect(tick2Matches).toHaveLength(1);
      expect(tick2Input).toContain('action=post');

      // Tick 3: exactly 2 history entries (post + extend_lore), oldest first.
      expect(tick3Input).toContain('Recent tick history');
      const tick3Matches = tick3Input.match(/action=/g) ?? [];
      expect(tick3Matches).toHaveLength(2);
      const postIdx = tick3Input.indexOf('action=post');
      const loreIdx = tick3Input.indexOf('action=extend_lore');
      expect(postIdx).toBeGreaterThanOrEqual(0);
      expect(loreIdx).toBeGreaterThan(postIdx);
    });

    it('records error ticks as "error" in subsequent history entries', async () => {
      const fakeLoop = vi
        .fn<typeof runAgentLoop>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(okLoop('{"action":"skip","reason":"quiet"}'));
      const store = new RunStore();
      const record = store.create('heartbeat');

      await runHeartbeatDemo({
        anthropic: FAKE_ANTHROPIC,
        store,
        runId: record.runId,
        tokenAddress: TOKEN_ADDR,
        tickCount: 2,
        intervalMs: 0,
        sleepImpl: vi.fn(async () => {}),
        runAgentLoopImpl: fakeLoop as unknown as typeof runAgentLoop,
      });

      const tick2Input = (fakeLoop.mock.calls[1]![0] as { userInput: string }).userInput;
      expect(tick2Input).toContain('Recent tick history');
      expect(tick2Input).toContain('action=error');
    });
  });

  // ─── System prompt decision rules (hard rules) ───────────────────────────
  //
  // Without explicit rules the LLM improvises — it will post three ticks in
  // a row even when the token has no on-chain presence. The shared prompt
  // is the one source of truth for both the dashboard runner and the Brain
  // `/heartbeat` path; pinning the rule keywords here guarantees drift is
  // caught fast.
  describe('HEARTBEAT_SYSTEM_PROMPT decision rules', () => {
    it('contains a "Decision rules" section', () => {
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('Decision rules');
    });

    it('enforces each of the six hard rules via its keyword', () => {
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('deployedOnChain is false');
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('totalChapters < 3');
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('last 2 entries');
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('curveProgress');
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('prefer idle');
    });

    it('still terminates in the single-JSON action contract so downstream parsing is unchanged', () => {
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('Pick exactly ONE action');
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('"action"');
    });

    // Rule 1 is a hard gate — a non-deployed token has nothing on-chain to
    // act on, so extend_lore / post_to_x are never valid, regardless of any
    // later rule's "prefer X" guidance. The prompt must mark this with
    // unambiguous language so the LLM does not down-weight it against rule 2
    // ("totalChapters < 3 → prefer extend_lore"), which would otherwise fire
    // on any brand-new token whose chapters are still sparse.
    it('marks rule 1 (deployedOnChain=false) as a hard gate that overrides all later rules', () => {
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('HARD GATE');
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain('absolute, overrides ALL later rules');
    });

    // Rules 3 and 4 reference the "Recent tick history" block the runner and
    // the Brain path inject into each tick's userInput. The injected lines
    // use the action words `post`, `extend_lore`, `idle`, `skip`, `error`
    // (see heartbeat-runner.ts recentTicks formatting and invoke-persona.ts).
    // The prompt must reference those same tokens or the rules fire against
    // strings that never appear. The regex pins that "post" is followed by a
    // non-underscore character (i.e. not the tool name `post_to_x`) so a
    // regression that reverts the alignment gets caught.
    it('references history actions using the words the runner injects', () => {
      expect(HEARTBEAT_SYSTEM_PROMPT).toContain(
        'History actions are recorded as: post, extend_lore, idle, skip, error',
      );
      expect(HEARTBEAT_SYSTEM_PROMPT).toMatch(/last 2 entries.*both post[^_]/);
      expect(HEARTBEAT_SYSTEM_PROMPT).toMatch(/last 2 entries.*both extend_lore/);
    });
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
