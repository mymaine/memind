import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, LogEvent } from '@hack-fourmeme/shared';
import type { AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { RunStore } from './store.js';
import { runBrainChat, type RunBrainChatDeps } from './brain-chat.js';
import type { AgentLoopResult } from '../agents/runtime.js';
import type { RunBrainAgentParams } from '../agents/brain.js';

/**
 * runBrainChat orchestrator unit tests — exercise the Brain meta-agent driver
 * without touching Anthropic / live persona runners. Each test injects a fake
 * `runBrainAgentImpl` so the orchestrator behaviour (tool construction,
 * RunStore event bubbling, terminal status) is isolated from LLM infra.
 */

function makeConfigStub(): AppConfig {
  return {
    port: 0,
    anthropic: { apiKey: undefined },
    openrouter: { apiKey: 'dummy' },
    pinata: { jwt: 'dummy' },
    wallets: {
      agent: { privateKey: undefined, address: undefined },
      bscDeployer: { privateKey: undefined, address: undefined },
    },
    x402: { facilitatorUrl: 'https://x402.org/facilitator', network: 'eip155:84532' },
    bsc: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    heartbeat: { intervalMs: 60_000 },
    x: {
      apiKey: undefined,
      apiKeySecret: undefined,
      accessToken: undefined,
      accessTokenSecret: undefined,
      bearerToken: undefined,
      handle: undefined,
    },
  };
}

function fakeLoopResult(): AgentLoopResult {
  return {
    finalText: 'done',
    toolCalls: [],
    trace: [],
    stopReason: 'end_turn',
  };
}

describe('runBrainChat', () => {
  let runStore: RunStore;
  let loreStore: LoreStore;
  let shillOrderStore: ShillOrderStore;
  const anthropic = {} as Anthropic;

  beforeEach(() => {
    runStore = new RunStore();
    loreStore = new LoreStore();
    shillOrderStore = new ShillOrderStore();
  });

  afterEach(() => {
    runStore.clear();
    loreStore.clear();
    shillOrderStore.clear();
  });

  function buildDeps(
    runId: string,
    messages: ChatMessage[],
    runBrainAgentImpl: (params: RunBrainAgentParams) => Promise<AgentLoopResult>,
  ): RunBrainChatDeps {
    return {
      config: makeConfigStub(),
      anthropic,
      store: runStore,
      runId,
      messages,
      loreStore,
      shillOrderStore,
      runBrainAgentImpl,
    };
  }

  it('drives runBrainAgent with the provided messages and emits status=done', async () => {
    const record = runStore.create('brain-chat');
    const messages: ChatMessage[] = [{ role: 'user', content: 'launch a meme about BNB 2026' }];

    const spy = vi.fn(async (_params: RunBrainAgentParams): Promise<AgentLoopResult> => {
      return fakeLoopResult();
    });

    await runBrainChat(buildDeps(record.runId, messages, spy));

    // runBrainAgent called exactly once with the same messages + the Brain
    // systemPrompt defaults + the four persona-invoke tools.
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.messages).toEqual(messages);
    // All four persona-invoke tools wired through.
    expect(call!.tools.length).toBe(4);
    const toolNames = call!.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'invoke_creator',
      'invoke_heartbeat_tick',
      'invoke_narrator',
      'invoke_shiller',
    ]);

    // Terminal status reported to RunStore.
    const snapshot = runStore.get(record.runId);
    expect(snapshot?.status).toBe('done');
  });

  it('bubbles persona-side logs under the persona agentId (AC-BRAIN-2)', async () => {
    const record = runStore.create('brain-chat');
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    const runBrainAgentImpl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
      // Simulate the Brain loop calling `invoke_creator`; the persona emits an
      // onLog event with agent='creator' that the orchestrator must forward to
      // the RunStore under the same agent attribution.
      const creatorLog: LogEvent = {
        ts: '2026-04-19T00:00:00.000Z',
        agent: 'creator',
        tool: 'narrative_generator',
        level: 'info',
        message: 'creator inner log',
      };
      params.onLog?.(creatorLog);
      // Also simulate an assistant:delta coming from the Brain itself so we
      // can assert the orchestrator threads those through too.
      params.onAssistantDelta?.({
        agent: 'brain',
        delta: 'thinking...',
        ts: '2026-04-19T00:00:01.000Z',
      });
      return fakeLoopResult();
    };

    await runBrainChat(buildDeps(record.runId, messages, runBrainAgentImpl));

    const snapshot = runStore.get(record.runId);
    expect(snapshot).toBeDefined();
    // The orchestrator must have forwarded the creator log verbatim.
    const creatorLogs = snapshot!.logs.filter((l) => l.agent === 'creator');
    expect(creatorLogs.length).toBeGreaterThanOrEqual(1);
    expect(creatorLogs.some((l) => l.message === 'creator inner log')).toBe(true);

    // Terminal status still done.
    expect(snapshot!.status).toBe('done');
  });

  it('emits status=error when messages array is empty (schema rejection)', async () => {
    const record = runStore.create('brain-chat');
    const messages: ChatMessage[] = [];

    // The orchestrator must not call runBrainAgent for invalid messages.
    const spy = vi.fn(async (_params: RunBrainAgentParams): Promise<AgentLoopResult> => {
      return fakeLoopResult();
    });

    await expect(runBrainChat(buildDeps(record.runId, messages, spy))).rejects.toThrow();

    expect(spy).not.toHaveBeenCalled();
  });
});
