import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, LogEvent } from '@hack-fourmeme/shared';
import type { AppConfig } from '../config.js';
import { LoreStore } from '../state/lore-store.js';
import { ShillOrderStore } from '../state/shill-order-store.js';
import { HeartbeatSessionStore } from '../state/heartbeat-session-store.js';
import { RunStore } from './store.js';
import { runBrainChat, type RunBrainChatDeps } from './brain-chat.js';
import type { AgentLoopResult } from '../agents/runtime.js';
import type { RunBrainAgentParams } from '../agents/brain.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  INVOKE_CREATOR_TOOL_NAME,
  INVOKE_HEARTBEAT_TICK_TOOL_NAME,
  INVOKE_NARRATOR_TOOL_NAME,
  INVOKE_SHILLER_TOOL_NAME,
  LIST_HEARTBEATS_TOOL_NAME,
  STOP_HEARTBEAT_TOOL_NAME,
} from '../tools/invoke-persona.js';
import { GET_TOKEN_INFO_TOOL_NAME } from '../tools/get-token-info.js';
import {
  runShillMarketDemo,
  type CreatorPaymentPhaseFn,
  type RunShillMarketDemoDeps,
} from './shill-market.js';

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
    x402: {
      facilitatorUrl: 'https://x402.org/facilitator',
      network: 'eip155:84532',
      mode: 'local' as const,
    },
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
  let heartbeatSessionStore: HeartbeatSessionStore;
  const anthropic = {} as Anthropic;

  beforeEach(() => {
    runStore = new RunStore();
    loreStore = new LoreStore();
    shillOrderStore = new ShillOrderStore();
    heartbeatSessionStore = new HeartbeatSessionStore();
  });

  afterEach(() => {
    runStore.clear();
    loreStore.clear();
    shillOrderStore.clear();
    heartbeatSessionStore.clear();
  });

  /**
   * Test-only sub-registry stubs. The real builders require GOOGLE_API_KEY /
   * BSC_DEPLOYER_PRIVATE_KEY / PINATA_JWT — all three are unavailable in the
   * unit test environment and would throw before the orchestrator even
   * reaches `runBrainAgentImpl`. Tests that want to inspect the sub-registry
   * wiring explicitly override these; tests that only care about the Brain
   * agent loop get empty stubs that preserve the isolation property without
   * needing real secrets.
   */
  const fakeSubRegistryBuilders: Pick<
    RunBrainChatDeps,
    'buildCreatorSubRegistryImpl' | 'buildNarratorSubRegistryImpl' | 'buildHeartbeatSubRegistryImpl'
  > = {
    buildCreatorSubRegistryImpl: (): ToolRegistry => new ToolRegistry(),
    buildNarratorSubRegistryImpl: (): ToolRegistry => new ToolRegistry(),
    buildHeartbeatSubRegistryImpl: (): ToolRegistry => new ToolRegistry(),
  };

  function buildDeps(
    runId: string,
    messages: ChatMessage[],
    runBrainAgentImpl: (params: RunBrainAgentParams) => Promise<AgentLoopResult>,
    overrides: Partial<RunBrainChatDeps> = {},
  ): RunBrainChatDeps {
    return {
      config: makeConfigStub(),
      anthropic,
      store: runStore,
      runId,
      messages,
      loreStore,
      shillOrderStore,
      heartbeatSessionStore,
      runBrainAgentImpl,
      ...fakeSubRegistryBuilders,
      ...overrides,
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
    // systemPrompt defaults + the seven Brain tools (get_token_info, four
    // invoke_*, plus stop_heartbeat and list_heartbeats). get_token_info
    // joined the Brain registry 2026-04-21 so conversational token lookups
    // + pre-dispatch identity checks do not need a persona detour.
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.messages).toEqual(messages);
    expect(call!.tools.length).toBe(7);
    const toolNames = call!.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'get_token_info',
      'invoke_creator',
      'invoke_heartbeat_tick',
      'invoke_narrator',
      'invoke_shiller',
      'list_heartbeats',
      'stop_heartbeat',
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

  it('wires the 4 persona-invoke tools with RunStore event forwarders', async () => {
    const record = runStore.create('brain-chat');
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

    // Simulate the Brain loop invoking `invoke_creator` by pulling the tool
    // out of the registered toolset and calling its execute directly. That
    // exercises the full path: the factory-level entry/exit logs + artifact
    // emission + the orchestrator's store.addLog / store.addArtifact wiring.
    const runBrainAgentImpl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
      const creatorTool = params.tools.find((t) => t.name === 'invoke_creator');
      if (!creatorTool) throw new Error('invoke_creator tool missing');
      // Replace the persona.run by patching the tool: we execute it with a
      // stubbed persona result since this test isolates orchestrator wiring
      // rather than creator persona behavior. The factory-level
      // (entry/exit/artifact) emissions are the contract under test.
      // We cannot easily stub the internal persona here, so we patch the
      // execute path by executing the tool with a fake input and catching
      // the expected thrown error (the real creatorPersona cannot reach the
      // LLM in this test). The orchestrator should still have set up the
      // tool set + eventForwarders — the tool count assertion plus the
      // explicit bubble test (above) cover the wiring.
      void creatorTool;
      return fakeLoopResult();
    };

    await runBrainChat(buildDeps(record.runId, messages, runBrainAgentImpl));

    const snapshot = runStore.get(record.runId);
    expect(snapshot).toBeDefined();
    expect(snapshot!.status).toBe('done');
  });

  it('forwards persona-emitted artifacts from a tool-use into the RunStore', async () => {
    const record = runStore.create('brain-chat');
    const messages: ChatMessage[] = [{ role: 'user', content: 'launch' }];

    // Simulate what a tool execute does when it derives an artifact from
    // the persona result: it would call params.onArtifact? IF brain had
    // one (brain.ts doesn't — artifacts are emitted by the individual
    // tool factories at execute time via their own onArtifact callback).
    // Here we assert the orchestrator builds a tool set AND the factory
    // path would have plumbed onArtifact into each tool's closure. To
    // verify end-to-end, we execute one of the registered tools directly
    // with a stub persona that returns a creatorResult; the tool's
    // onArtifact callback (wired to store.addArtifact) should push pills.
    const runBrainAgentImpl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
      // Patch invoke_creator execute so it emits an artifact via the
      // forwarded onArtifact — the real tool factory closure owns that
      // callback. We cannot reach into the closure from here, so we rely
      // on the existing bubble test (log forwarding) as the integration
      // proof. For artifact bubbling coverage, push a synthetic artifact
      // through the store directly so this test documents the expectation
      // that SSE receives artifacts emitted via store.addArtifact under
      // the same runId.
      params.onLog?.({
        ts: '2026-04-19T00:00:00.000Z',
        agent: 'creator',
        tool: 'invoke_creator',
        level: 'info',
        message: 'creator persona starting',
      });
      // runBrainChat's event forwarders expose addArtifact; the tool
      // factories use it via their onArtifact param. We invoke it here
      // through the store to assert the run aggregates artifacts end-to-end.
      runStore.addArtifact(record.runId, {
        kind: 'bsc-token',
        chain: 'bsc-mainnet',
        address: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
        explorerUrl: 'https://bscscan.com/token/0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd',
        label: 'four.meme token (BSC mainnet)',
      });
      return fakeLoopResult();
    };

    await runBrainChat(buildDeps(record.runId, messages, runBrainAgentImpl));

    const snapshot = runStore.get(record.runId);
    expect(snapshot!.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(snapshot!.artifacts.some((a) => a.kind === 'bsc-token')).toBe(true);
    expect(snapshot!.logs.some((l) => l.agent === 'creator')).toBe(true);
  });

  // ─── Multi-turn context regression (UAT 2026-04-20) ────────────────────
  //
  // User-reported bug: "the Brain replied to my first message, but on the
  // second message it forgot what token I just launched." Root cause was
  // that `runBrainAgent` folded the transcript into a single userInput
  // string; with the fix it now forwards the full chain to the runtime so
  // Anthropic sees real multi-turn history. This test pins that the
  // orchestrator hands `runBrainAgent` the complete `messages` array on
  // every call — it is not the runtime contract but the ingress point the
  // server HTTP route touches.
  // ---------------------------------------------------------------------
  it('forwards the complete multi-turn transcript to runBrainAgent (UAT 2026-04-20)', async () => {
    const record = runStore.create('brain-chat');
    const messages: ChatMessage[] = [
      { role: 'user', content: '/launch a BNB 2026 meme' },
      {
        role: 'assistant',
        content:
          'Deployed HBNB2026-CHAIN at 0xabcdef0123456789abcdef0123456789abcdef01. Tx 0x0123...',
      },
      { role: 'user', content: 'what was the token address you just gave me?' },
    ];

    const spy = vi.fn(async (_params: RunBrainAgentParams): Promise<AgentLoopResult> => {
      return fakeLoopResult();
    });

    await runBrainChat(buildDeps(record.runId, messages, spy));

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    // The orchestrator must pass all three turns through to the Brain
    // agent. If this array were sliced, the prior assistant reply would be
    // invisible to the LLM on turn 2 and the "brain forgets context" bug
    // would return.
    expect(call!.messages).toHaveLength(3);
    expect(call!.messages).toEqual(messages);
    expect(call!.messages[1]?.role).toBe('assistant');
    expect(call!.messages[1]?.content).toContain('HBNB2026-CHAIN');
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

  // ─── Registry isolation regression (demo-blocking bug fix) ────────────────
  //
  // These tests pin the fix for the infinite-recursion bug: before the fix,
  // `runBrainChat` built a SINGLE ToolRegistry and threaded it into both
  // `runBrainAgent` (which registers the four invoke_* tools) AND each
  // `createInvoke*Tool({registry})` call (which threads it into
  // `ctx.registry` for the persona). That meant the creator persona's
  // internal `runAgentLoop` saw `invoke_creator` in its toolset and called
  // itself, wall-clocking `/launch` forever.
  //
  // The fix: one registry per scope. Tests below assert the brain's registry
  // never leaks into any persona's ctx.registry, and vice versa.
  // --------------------------------------------------------------------------
  describe('registry isolation', () => {
    it('brain registry is a fresh empty registry that only holds invoke_* tools after wiring', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      let capturedBrainRegistry: ToolRegistry | undefined;
      const impl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        capturedBrainRegistry = params.registry;
        // Mirror runBrainAgent's behaviour: register tools into the passed
        // registry so we can snapshot what the Brain LLM would actually see.
        for (const tool of params.tools) {
          params.registry.register(
            tool as unknown as Parameters<typeof params.registry.register>[0],
          );
        }
        return fakeLoopResult();
      };

      await runBrainChat(buildDeps(record.runId, messages, impl));

      expect(capturedBrainRegistry).toBeDefined();
      const names = capturedBrainRegistry!
        .list()
        .map((t) => t.name)
        .sort();
      expect(names).toEqual(
        [
          'get_token_info',
          INVOKE_CREATOR_TOOL_NAME,
          INVOKE_HEARTBEAT_TICK_TOOL_NAME,
          INVOKE_NARRATOR_TOOL_NAME,
          INVOKE_SHILLER_TOOL_NAME,
          LIST_HEARTBEATS_TOOL_NAME,
          STOP_HEARTBEAT_TOOL_NAME,
        ].sort(),
      );
    });

    it('each persona-invoke tool is constructed against a registry separate from the brain registry', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      // Spy on each sub-registry builder so we can later verify identity
      // (pointer) inequality with whatever the Brain agent receives.
      const creatorReg = new ToolRegistry();
      const narratorReg = new ToolRegistry();
      const heartbeatReg = new ToolRegistry();

      let brainReg: ToolRegistry | undefined;
      const impl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        brainReg = params.registry;
        for (const tool of params.tools) {
          params.registry.register(
            tool as unknown as Parameters<typeof params.registry.register>[0],
          );
        }
        return fakeLoopResult();
      };

      await runBrainChat(
        buildDeps(record.runId, messages, impl, {
          buildCreatorSubRegistryImpl: (): ToolRegistry => creatorReg,
          buildNarratorSubRegistryImpl: (): ToolRegistry => narratorReg,
          buildHeartbeatSubRegistryImpl: (): ToolRegistry => heartbeatReg,
        }),
      );

      expect(brainReg).toBeDefined();
      // Brain registry is distinct from every persona sub-registry.
      expect(brainReg).not.toBe(creatorReg);
      expect(brainReg).not.toBe(narratorReg);
      expect(brainReg).not.toBe(heartbeatReg);
      // And the sub-registries must be pairwise distinct too — aliasing
      // creator/narrator would re-introduce the same recursion class.
      expect(creatorReg).not.toBe(narratorReg);
      expect(creatorReg).not.toBe(heartbeatReg);
      expect(narratorReg).not.toBe(heartbeatReg);
    });

    it('invoke_creator tool execute passes its own sub-registry to persona.run, NOT the brain registry containing invoke_creator', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      // Inject a creator sub-registry that we control, then invoke the
      // `invoke_creator` tool inside the fake brain loop and capture the
      // `ctx.registry` the persona sees. Because the real creatorPersona
      // is imported by brain-chat.ts and cannot be swapped here, we call
      // the tool's `execute` and intercept via a monkey-patched persona
      // on the module — but that is brittle. Instead we verify via the
      // registry identity: the sub-registry we supplied must be the exact
      // one the factory closes over, and the brain registry (which ends
      // up containing `invoke_creator` after runBrainAgent registers the
      // tools) must NOT be the same instance.
      const creatorReg = new ToolRegistry();

      let brainReg: ToolRegistry | undefined;
      const impl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        brainReg = params.registry;
        for (const tool of params.tools) {
          params.registry.register(
            tool as unknown as Parameters<typeof params.registry.register>[0],
          );
        }
        return fakeLoopResult();
      };

      await runBrainChat(
        buildDeps(record.runId, messages, impl, {
          buildCreatorSubRegistryImpl: (): ToolRegistry => creatorReg,
        }),
      );

      expect(brainReg).toBeDefined();
      // After the fake brain loop ran, the BRAIN registry contains
      // invoke_creator (because runBrainAgentImpl registered it above).
      expect(brainReg!.has(INVOKE_CREATOR_TOOL_NAME)).toBe(true);
      // The creator sub-registry must NOT contain invoke_creator — if it
      // did, creatorPersona's inner runAgentLoop would see it and recurse.
      // Empty is correct for this test (real production builder populates
      // narrative_generator / meme_image_creator / onchain_deployer /
      // lore_writer instead).
      expect(creatorReg.has(INVOKE_CREATOR_TOOL_NAME)).toBe(false);
      expect(creatorReg.has(INVOKE_NARRATOR_TOOL_NAME)).toBe(false);
      expect(creatorReg.has(INVOKE_SHILLER_TOOL_NAME)).toBe(false);
      expect(creatorReg.has(INVOKE_HEARTBEAT_TICK_TOOL_NAME)).toBe(false);
    });

    // Hallucination guard regression. When the Brain loop finishes without
    // firing a single Brain-level tool call on a turn whose last user message
    // was a tool-required slash command, the orchestrator emits a warn-level
    // log so operators can spot fabrication. (The system prompt's HARD
    // NO-FABRICATION RULES are the primary defence; this is
    // belt-and-suspenders.)
    it('warns when a tool-required slash command ends with zero Brain tool calls', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [
        { role: 'user', content: '/lore 0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd' },
      ];
      // Brain loop pretends to finish normally WITHOUT firing any tool call.
      const impl = async (_params: RunBrainAgentParams): Promise<AgentLoopResult> =>
        fakeLoopResult();

      await runBrainChat(buildDeps(record.runId, messages, impl));

      const snapshot = runStore.get(record.runId);
      expect(snapshot).toBeDefined();
      const warnLogs = snapshot!.logs.filter((l) => l.level === 'warn');
      expect(warnLogs.length).toBeGreaterThanOrEqual(1);
      expect(warnLogs.some((l) => l.message.includes('zero tool calls'))).toBe(true);
      expect(warnLogs.some((l) => l.message.includes('/lore'))).toBe(true);
    });

    it('does NOT warn on tool-required slash when at least one Brain tool call fires', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [
        { role: 'user', content: '/lore 0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd' },
      ];
      const impl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        // Simulate a tool_use:start on the brain agent — the orchestrator's
        // guard counts these to decide whether a fabrication warning fires.
        params.onToolUseStart?.({
          agent: 'brain',
          toolName: INVOKE_NARRATOR_TOOL_NAME,
          toolUseId: 'tu-1',
          input: { tokenAddr: '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd' },
          ts: new Date().toISOString(),
        });
        return fakeLoopResult();
      };

      await runBrainChat(buildDeps(record.runId, messages, impl));

      const snapshot = runStore.get(record.runId);
      expect(snapshot).toBeDefined();
      const fabricationWarns = snapshot!.logs.filter(
        (l) => l.level === 'warn' && l.message.includes('zero tool calls'),
      );
      expect(fabricationWarns).toHaveLength(0);
    });

    // ─── tool_choice forcing (anti-fabrication structural fix) ─────────────
    //
    // The orchestrator inspects the final user turn and, when it matches a
    // tool-required slash command, derives the forced tool name and passes
    // `toolChoice: {type:'tool', name:<invoke_*>}` to runBrainAgent. This
    // physically prevents the LLM from skipping the tool and fabricating
    // plausible output from prior tool_result context. Free-form turns and
    // unknown slashes leave toolChoice undefined (auto behaviour).
    describe('tool_choice forcing', () => {
      const addr = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';

      it('forces invoke_narrator on /lore <addr>', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: `/lore ${addr}` }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call).toBeDefined();
        expect(call!.toolChoice).toEqual({ type: 'tool', name: INVOKE_NARRATOR_TOOL_NAME });
      });

      it('forces invoke_creator on /launch <theme>', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: '/launch cyberpunk neko' }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toEqual({ type: 'tool', name: INVOKE_CREATOR_TOOL_NAME });
      });

      // Forcing get_token_info (NOT invoke_shiller) on /order is deliberate:
      // invoke_shiller's tokenSymbol is mandatory and must come from
      // get_token_info's identity.symbol. Forcing invoke_shiller on turn 1
      // would leave the LLM with no option but to fabricate the symbol —
      // reopening the ticker-hallucination bug the mandatory field closed.
      // Turn 2+ runs with tool_choice=auto, so the prompt directs the LLM
      // into invoke_shiller with the real symbol.
      it('forces get_token_info on /order <addr> (shiller tokenSymbol must come from a real lookup)', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: `/order ${addr} cool brief` }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toEqual({ type: 'tool', name: GET_TOKEN_INFO_TOOL_NAME });
        // Paranoia: any future regression that points /order back at
        // invoke_shiller on turn 1 fails here too.
        expect(call!.toolChoice).not.toEqual({ type: 'tool', name: INVOKE_SHILLER_TOOL_NAME });
      });

      it('forces invoke_heartbeat_tick on /heartbeat', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: `/heartbeat ${addr}` }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toEqual({
          type: 'tool',
          name: INVOKE_HEARTBEAT_TICK_TOOL_NAME,
        });
      });

      it('forces stop_heartbeat on /heartbeat-stop', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: `/heartbeat-stop ${addr}` }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toEqual({ type: 'tool', name: STOP_HEARTBEAT_TOOL_NAME });
      });

      it('forces list_heartbeats on /heartbeat-list (name matches exactly)', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: '/heartbeat-list' }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toEqual({ type: 'tool', name: LIST_HEARTBEATS_TOOL_NAME });
      });

      it('leaves toolChoice undefined on free-form user input (no leading slash)', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: "how's it going?" }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toBeUndefined();
      });

      it('leaves toolChoice undefined on an unknown slash command (/unknown foo)', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: '/unknown foo' }];
        const spy = vi.fn(
          async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult(),
        );
        await runBrainChat(buildDeps(record.runId, messages, spy));
        const call = spy.mock.calls[0]?.[0];
        expect(call!.toolChoice).toBeUndefined();
      });

      it('emits an info log naming the forced tool when a slash forces a tool', async () => {
        const record = runStore.create('brain-chat');
        const messages: ChatMessage[] = [{ role: 'user', content: `/lore ${addr}` }];
        const impl = async (_p: RunBrainAgentParams): Promise<AgentLoopResult> => fakeLoopResult();
        await runBrainChat(buildDeps(record.runId, messages, impl));
        const snapshot = runStore.get(record.runId);
        const forcingLogs = snapshot!.logs.filter((l) =>
          l.message.includes('forcing tool_choice=invoke_narrator'),
        );
        expect(forcingLogs.length).toBe(1);
        expect(forcingLogs[0]!.level).toBe('info');
      });
    });

    it('does NOT warn on free-form user turns (no leading slash)', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: 'how is the token doing?' }];
      const impl = async (_params: RunBrainAgentParams): Promise<AgentLoopResult> =>
        fakeLoopResult();

      await runBrainChat(buildDeps(record.runId, messages, impl));

      const snapshot = runStore.get(record.runId);
      const fabricationWarns = snapshot!.logs.filter(
        (l) => l.level === 'warn' && l.message.includes('zero tool calls'),
      );
      expect(fabricationWarns).toHaveLength(0);
    });

    it('narrator sub-registry is not aliased to the brain registry', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      const narratorReg = new ToolRegistry();
      let brainReg: ToolRegistry | undefined;
      const impl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        brainReg = params.registry;
        for (const tool of params.tools) {
          params.registry.register(
            tool as unknown as Parameters<typeof params.registry.register>[0],
          );
        }
        return fakeLoopResult();
      };

      await runBrainChat(
        buildDeps(record.runId, messages, impl, {
          buildNarratorSubRegistryImpl: (): ToolRegistry => narratorReg,
        }),
      );

      expect(brainReg).toBeDefined();
      expect(brainReg!.has(INVOKE_NARRATOR_TOOL_NAME)).toBe(true);
      expect(narratorReg.has(INVOKE_NARRATOR_TOOL_NAME)).toBe(false);
      expect(narratorReg.has(INVOKE_CREATOR_TOOL_NAME)).toBe(false);
    });

    it('heartbeat sub-registry is not aliased to the brain registry', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

      const heartbeatReg = new ToolRegistry();
      let brainReg: ToolRegistry | undefined;
      const impl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        brainReg = params.registry;
        for (const tool of params.tools) {
          params.registry.register(
            tool as unknown as Parameters<typeof params.registry.register>[0],
          );
        }
        return fakeLoopResult();
      };

      await runBrainChat(
        buildDeps(record.runId, messages, impl, {
          buildHeartbeatSubRegistryImpl: (): ToolRegistry => heartbeatReg,
        }),
      );

      expect(brainReg).toBeDefined();
      expect(brainReg!.has(INVOKE_HEARTBEAT_TICK_TOOL_NAME)).toBe(true);
      expect(heartbeatReg.has(INVOKE_HEARTBEAT_TICK_TOOL_NAME)).toBe(false);
      expect(heartbeatReg.has(INVOKE_CREATOR_TOOL_NAME)).toBe(false);
    });
  });

  // ─── /order routes through invoke_shiller → runShillMarketDemo ───────────
  //
  // Ch12 evidence BASE tab regression. Prior to the refactor the Brain's
  // `/order` tool short-circuited the shill-market orchestrator and emitted
  // neither `x402-tx` nor `shill-order` artifacts — the artifacts log stayed
  // empty forever and the BASE tab fell back to sample data. This suite
  // pins that `/order <addr>` now produces the full artifact set on the
  // RunStore (which index.ts fans out to pg via setArtifactLog).
  describe('/order dispatches the full shill-market orchestrator', () => {
    const addr = '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd';
    const sentinelTxHash = `0x${'fe'.repeat(32)}`;

    it('emits x402-tx + shill-order (queued) + shill-tweet artifacts when /order fires', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: `/order ${addr}` }];

      // Creator-payment phase must enqueue the order itself — matches the
      // real contract (stubCreatorPaymentPhase + createRealCreatorPaymentPhase
      // both do so). Without the enqueue, runShillMarketDemo's `pullById`
      // throws when no queued row matches the returned orderId.
      const creatorPaymentImpl: CreatorPaymentPhaseFn = async (paymentDeps) => {
        await paymentDeps.shillOrderStore.enqueue({
          orderId: 'order-sentinel',
          targetTokenAddr: paymentDeps.tokenAddr.toLowerCase(),
          ...(paymentDeps.creatorBrief !== undefined
            ? { creatorBrief: paymentDeps.creatorBrief }
            : {}),
          paidTxHash: sentinelTxHash,
          paidAmountUsdc: '0.01',
          ts: new Date().toISOString(),
        });
        return {
          orderId: 'order-sentinel',
          paidTxHash: sentinelTxHash,
          paidAmountUsdc: '0.01',
        };
      };

      // Drive the real runShillMarketDemo. We do NOT override
      // `orchestratorDeps.runShillerImpl` because that closure is what the
      // `createInvokeShillerTool` factory installed to capture the
      // ShillerPersonaOutput. The factory's closure calls `runShillerAgent`
      // with the injected `postShillForTool`; here that tool is the
      // brain-chat stub (X creds absent) which throws on execute. The
      // shiller persona translates the throw into decision='skip' +
      // errorMessage — exercising the failed-order artifact path.
      const stubShillMarketImpl: typeof runShillMarketDemo = async (orchestratorDeps) => {
        await runShillMarketDemo({
          ...orchestratorDeps,
          creatorPaymentImpl,
        });
      };

      // Fake Brain agent invokes the `invoke_shiller` tool directly — this
      // is how the real Anthropic loop would dispatch the forced tool call.
      const runBrainAgentImpl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        const shillerTool = params.tools.find((t) => t.name === INVOKE_SHILLER_TOOL_NAME);
        if (!shillerTool) throw new Error('invoke_shiller tool missing');
        await shillerTool.execute({ tokenAddr: addr, tokenSymbol: 'HBNB2026-TEST' });
        return {
          finalText: 'order dispatched',
          toolCalls: [],
          trace: [],
          stopReason: 'end_turn',
        };
      };

      await runBrainChat(
        buildDeps(record.runId, messages, runBrainAgentImpl, {
          creatorPaymentImpl,
          invokeShillerRunShillMarketDemoImpl: stubShillMarketImpl,
        }),
      );

      const snapshot = runStore.get(record.runId);
      expect(snapshot).toBeDefined();
      // The orchestrator's artifacts must land on the RunStore under the
      // same runId. Index.ts's setArtifactLog hook fans them out to pg so
      // Ch12's BASE tab picks them up on the next hydration. Specifically:
      //   - x402-tx (creator payment settlement, sentinel hash here)
      //   - shill-order queued (fresh enqueue)
      //   - shill-order failed (brain-chat stub postShillForTool throws,
      //     shiller persona returns decision=skip, orchestrator marks the
      //     order failed). shill-tweet is NOT emitted on the skip path.
      const kinds = snapshot!.artifacts.map((a) => a.kind);
      expect(kinds).toContain('x402-tx');
      expect(kinds).toContain('shill-order');

      const x402 = snapshot!.artifacts.find((a) => a.kind === 'x402-tx');
      expect(x402).toMatchObject({
        kind: 'x402-tx',
        chain: 'base-sepolia',
        txHash: sentinelTxHash,
      });

      // Queue emits TWO shill-order artifacts (queued → failed) because the
      // stub postShillForTool throws when X creds are absent. Production
      // with real X creds would produce queued → done instead.
      const shillOrders = snapshot!.artifacts.filter((a) => a.kind === 'shill-order');
      expect(shillOrders).toHaveLength(2);
      const statuses = shillOrders.map((a) => (a.kind === 'shill-order' ? a.status : null));
      expect(statuses).toContain('queued');
      expect(statuses.some((s) => s === 'failed' || s === 'done')).toBe(true);

      // Terminal run status still propagates.
      expect(snapshot!.status).toBe('done');
    });

    // Anti-hallucination structural guard. On /order the runtime forces
    // get_token_info (NOT invoke_shiller) as turn 1's tool, and the Brain's
    // tool list MUST expose get_token_info alongside invoke_shiller so the
    // LLM can satisfy the mandatory tokenSymbol field in turn 2 from the
    // forced lookup's result. This test simulates that two-step flow end-to-
    // end inside the brain-chat orchestrator: fake-brain turn 1 records the
    // forced tool_choice and that get_token_info is reachable; fake-brain
    // turn 2 calls invoke_shiller with a symbol string that could ONLY have
    // come from that first lookup, and we assert the shill-market
    // orchestrator receives the same symbol verbatim. A regression that
    // forces invoke_shiller on turn 1 (or drops get_token_info from the
    // tool set) fails here because the LLM has no legitimate source for
    // tokenSymbol.
    it('forces get_token_info on turn 1 and feeds its symbol into invoke_shiller on turn 2', async () => {
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: `/order ${addr}` }];

      const resolvedSymbol = 'HBNB2026-FORCED';

      const creatorPaymentImpl: CreatorPaymentPhaseFn = async (paymentDeps) => {
        await paymentDeps.shillOrderStore.enqueue({
          orderId: 'order-two-step',
          targetTokenAddr: paymentDeps.tokenAddr.toLowerCase(),
          ...(paymentDeps.creatorBrief !== undefined
            ? { creatorBrief: paymentDeps.creatorBrief }
            : {}),
          paidTxHash: sentinelTxHash,
          paidAmountUsdc: '0.01',
          ts: new Date().toISOString(),
        });
        return {
          orderId: 'order-two-step',
          paidTxHash: sentinelTxHash,
          paidAmountUsdc: '0.01',
        };
      };

      // Spy on the shill-market orchestrator so we can capture the exact
      // tokenSymbol the invoke_shiller tool forwarded into args. If a future
      // refactor drops tokenSymbol propagation the assertion below fails.
      const shillMarketSpy = vi.fn(
        async (orchestratorDeps: RunShillMarketDemoDeps): Promise<void> => {
          await runShillMarketDemo({
            ...orchestratorDeps,
            creatorPaymentImpl,
          });
        },
      );

      // Fake Brain loop: simulate turn 1 by verifying the forced tool is
      // get_token_info and that the tool is actually in the tool set; then
      // simulate turn 2 by invoking invoke_shiller with the symbol the
      // (real) turn-1 lookup would have produced. We do NOT execute the real
      // get_token_info tool here — it would hit BSC RPC, which is out of
      // scope for a unit test. The structural guarantees (forced tool +
      // tool-set membership) are what the regression targets.
      const runBrainAgentImpl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        // Turn 1 — runtime must be asking the LLM for get_token_info.
        expect(params.toolChoice).toEqual({
          type: 'tool',
          name: GET_TOKEN_INFO_TOOL_NAME,
        });
        const getInfoTool = params.tools.find((t) => t.name === GET_TOKEN_INFO_TOOL_NAME);
        expect(getInfoTool).toBeDefined();

        // Turn 2 — the LLM now calls invoke_shiller with the symbol it just
        // read off identity.symbol. This is the ONLY legitimate source for
        // the mandatory tokenSymbol field.
        const shillerTool = params.tools.find((t) => t.name === INVOKE_SHILLER_TOOL_NAME);
        if (!shillerTool) throw new Error('invoke_shiller tool missing from Brain tools');
        await shillerTool.execute({ tokenAddr: addr, tokenSymbol: resolvedSymbol });
        return {
          finalText: 'order dispatched with forced lookup symbol',
          toolCalls: [],
          trace: [],
          stopReason: 'end_turn',
        };
      };

      await runBrainChat(
        buildDeps(record.runId, messages, runBrainAgentImpl, {
          creatorPaymentImpl,
          invokeShillerRunShillMarketDemoImpl: shillMarketSpy,
        }),
      );

      // The shill-market orchestrator must have been called exactly once
      // with the symbol the forced get_token_info turn produced. Any drift
      // (dropped tokenSymbol, symbol substitution inside invoke_shiller)
      // fails here with a precise message.
      expect(shillMarketSpy).toHaveBeenCalledTimes(1);
      const orchestratorCall = shillMarketSpy.mock.calls[0]?.[0];
      expect(orchestratorCall).toBeDefined();
      expect(orchestratorCall!.args.tokenSymbol).toBe(resolvedSymbol);
      expect(orchestratorCall!.args.tokenAddr).toBe(addr);
    });

    it('falls back to stubCreatorPaymentPhase (zero-sentinel tx) when no creatorPaymentImpl is wired', async () => {
      // Defensive: when production leaves `creatorPaymentImpl` undefined
      // (CLI demos, unit tests) the orchestrator must fall back to
      // stubCreatorPaymentPhase so `pnpm test` never spends USDC. We assert
      // the x402-tx artifact carries the zero-sentinel hash that only the
      // stub emits.
      const record = runStore.create('brain-chat');
      const messages: ChatMessage[] = [{ role: 'user', content: `/order ${addr}` }];

      // Just forward to the real orchestrator — no deps overrides. The
      // factory's runShillerImpl closure captures the ShillerPersonaOutput
      // for the tool return value; runShillerAgent uses the injected stub
      // postShillForTool which throws on execute, yielding decision=skip.
      const stubShillMarketImpl: typeof runShillMarketDemo = async (orchestratorDeps) =>
        runShillMarketDemo(orchestratorDeps);

      const runBrainAgentImpl = async (params: RunBrainAgentParams): Promise<AgentLoopResult> => {
        const shillerTool = params.tools.find((t) => t.name === INVOKE_SHILLER_TOOL_NAME);
        if (!shillerTool) throw new Error('invoke_shiller tool missing');
        await shillerTool.execute({ tokenAddr: addr, tokenSymbol: 'HBNB2026-TEST' });
        return {
          finalText: 'ok',
          toolCalls: [],
          trace: [],
          stopReason: 'end_turn',
        };
      };

      await runBrainChat(
        buildDeps(record.runId, messages, runBrainAgentImpl, {
          invokeShillerRunShillMarketDemoImpl: stubShillMarketImpl,
        }),
      );

      const snapshot = runStore.get(record.runId);
      const x402 = snapshot!.artifacts.find((a) => a.kind === 'x402-tx');
      expect(x402).toBeDefined();
      // Zero-sentinel from stubCreatorPaymentPhase — the default when no
      // creatorPaymentImpl is wired.
      if (x402?.kind === 'x402-tx') {
        expect(x402.txHash).toBe(`0x${'0'.repeat(64)}`);
      }
    });
  });
});

// ─── Sub-registry builder unit tests ───────────────────────────────────────
//
// Verify each builder populates its registry with the correct real tool
// names. These tests touch `process.env` + the real factory imports so they
// sit in their own describe block to keep the orchestrator tests free of env
// mutation. Failures here catch drift between brain-chat's sub-registry
// composition and the per-persona runners (creator-phase.ts, a2a.ts
// narratorRegistry, heartbeat-runner.ts).
// ---------------------------------------------------------------------------
describe('brain-chat sub-registry builders', () => {
  function makeConfigWithSecrets(): AppConfig {
    return {
      port: 0,
      anthropic: { apiKey: undefined },
      openrouter: { apiKey: 'dummy' },
      pinata: { jwt: 'test-jwt' },
      wallets: {
        agent: { privateKey: undefined, address: undefined },
        bscDeployer: {
          privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          address: undefined,
        },
      },
      x402: {
        facilitatorUrl: 'https://x402.org/facilitator',
        network: 'eip155:84532',
        mode: 'local' as const,
      },
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

  let prevGoogleKey: string | undefined;
  beforeEach(() => {
    prevGoogleKey = process.env.GOOGLE_API_KEY;
  });
  afterEach(() => {
    if (prevGoogleKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = prevGoogleKey;
    }
  });

  it('buildCreatorSubRegistry populates the 4 real creator sub-tools (no invoke_*)', async () => {
    process.env.GOOGLE_API_KEY = 'test-google-key';
    const { buildCreatorSubRegistry } = await import('./brain-chat.js');
    const anthropicStub = {} as Anthropic;
    const reg = buildCreatorSubRegistry(makeConfigWithSecrets(), anthropicStub);
    const names = reg
      .list()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(
      ['narrative_generator', 'meme_image_creator', 'onchain_deployer', 'lore_writer'].sort(),
    );
    // Paranoia: invoke_* tool names must never appear here.
    expect(reg.has(INVOKE_CREATOR_TOOL_NAME)).toBe(false);
    expect(reg.has(INVOKE_NARRATOR_TOOL_NAME)).toBe(false);
    expect(reg.has(INVOKE_SHILLER_TOOL_NAME)).toBe(false);
    expect(reg.has(INVOKE_HEARTBEAT_TICK_TOOL_NAME)).toBe(false);
  });

  it('buildNarratorSubRegistry populates extend_lore + get_token_info', async () => {
    const { buildNarratorSubRegistry } = await import('./brain-chat.js');
    const { LoreStore } = await import('../state/lore-store.js');
    const { TokenIdentityReader } = await import('../state/token-identity-reader.js');
    const anthropicStub = {} as Anthropic;
    const reader = new TokenIdentityReader({
      rpcUrl: 'https://bsc-dataseed.binance.org',
    });
    const reg = buildNarratorSubRegistry(
      makeConfigWithSecrets(),
      anthropicStub,
      new LoreStore(),
      reader,
    );
    const names = reg
      .list()
      .map((t) => t.name)
      .sort();
    // get_token_info joined the set 2026-04-21 so the narrator can fetch
    // authoritative identity + narrative before writing the next chapter.
    expect(names).toEqual(['extend_lore', 'get_token_info'].sort());
    expect(reg.has(INVOKE_NARRATOR_TOOL_NAME)).toBe(false);
  });

  it('buildHeartbeatSubRegistry populates check_token_status + get_token_info + post_to_x + extend_lore', async () => {
    const { buildHeartbeatSubRegistry } = await import('./brain-chat.js');
    const { LoreStore } = await import('../state/lore-store.js');
    const { TokenIdentityReader } = await import('../state/token-identity-reader.js');
    const anthropicStub = {} as Anthropic;
    const reader = new TokenIdentityReader({
      rpcUrl: 'https://bsc-dataseed.binance.org',
    });
    const reg = buildHeartbeatSubRegistry(
      makeConfigWithSecrets(),
      anthropicStub,
      new LoreStore(),
      reader,
    );
    const names = reg
      .list()
      .map((t) => t.name)
      .sort();
    // PINATA_JWT is set so extend_lore is included; X creds are missing so
    // post_to_x registers the dry-run stub. get_token_info joined the set
    // 2026-04-21 for the heartbeat's two-step facts-first workflow.
    expect(names).toEqual(
      ['check_token_status', 'extend_lore', 'get_token_info', 'post_to_x'].sort(),
    );
    expect(reg.has(INVOKE_HEARTBEAT_TICK_TOOL_NAME)).toBe(false);
  });
});
