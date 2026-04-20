import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentTool, AnyAgentTool } from '@hack-fourmeme/shared';
import { ToolRegistry } from '../tools/registry.js';
import { BRAIN_SYSTEM_PROMPT, runBrainAgent, type RunBrainAgentParams } from './brain.js';
import {
  INVOKE_CREATOR_TOOL_NAME,
  INVOKE_NARRATOR_TOOL_NAME,
  INVOKE_SHILLER_TOOL_NAME,
  INVOKE_HEARTBEAT_TICK_TOOL_NAME,
} from '../tools/invoke-persona.js';
import type { AgentLoopResult, RunAgentLoopParams } from './runtime.js';

/**
 * Brain meta-agent (BRAIN-P2 Task 2). The Brain does not own a persona; it
 * is an LLM agent whose *tools* are invocations of the other four personas.
 * These tests lock in:
 *   1. Prompt guarantees — the systemPrompt advertises the four tool names
 *      and the slash-command handling rules.
 *   2. Runtime wiring — `runBrainAgent` threads `agentId='brain'`, the four
 *      persona-invoke tools, and the BRAIN_SYSTEM_PROMPT into the injected
 *      `runAgentLoop` exactly once.
 */

// ─── Shape helpers ──────────────────────────────────────────────────────────

function fakeAgentTool(name: string): AnyAgentTool {
  return {
    name,
    description: `stub ${name}`,
    inputSchema: {
      parse: (v: unknown) => v,
    } as unknown as AgentTool<unknown, unknown>['inputSchema'],
    outputSchema: {
      parse: (v: unknown) => v,
    } as unknown as AgentTool<unknown, unknown>['outputSchema'],
    execute: async () => ({}),
  };
}

function makeFakeLoopResult(): AgentLoopResult {
  return {
    finalText: 'ok',
    toolCalls: [],
    trace: [],
    stopReason: 'end_turn',
  };
}

function baseParams(
  runAgentLoopImpl: (params: RunAgentLoopParams) => Promise<AgentLoopResult>,
): RunBrainAgentParams {
  return {
    client: {} as unknown as Anthropic,
    registry: new ToolRegistry(),
    messages: [{ role: 'user', content: 'launch a meme about BNB 2026' }],
    tools: [
      fakeAgentTool(INVOKE_CREATOR_TOOL_NAME),
      fakeAgentTool(INVOKE_NARRATOR_TOOL_NAME),
      fakeAgentTool(INVOKE_SHILLER_TOOL_NAME),
      fakeAgentTool(INVOKE_HEARTBEAT_TICK_TOOL_NAME),
    ],
    runAgentLoopImpl: runAgentLoopImpl as unknown as RunBrainAgentParams['runAgentLoopImpl'],
  };
}

// ─── BRAIN_SYSTEM_PROMPT assertions ─────────────────────────────────────────

describe('BRAIN_SYSTEM_PROMPT', () => {
  it('names all four persona-invoke tools', () => {
    expect(BRAIN_SYSTEM_PROMPT).toContain(INVOKE_CREATOR_TOOL_NAME);
    expect(BRAIN_SYSTEM_PROMPT).toContain(INVOKE_NARRATOR_TOOL_NAME);
    expect(BRAIN_SYSTEM_PROMPT).toContain(INVOKE_SHILLER_TOOL_NAME);
    expect(BRAIN_SYSTEM_PROMPT).toContain(INVOKE_HEARTBEAT_TICK_TOOL_NAME);
  });

  it('includes a SLASH COMMAND HANDLING section', () => {
    expect(BRAIN_SYSTEM_PROMPT).toContain('SLASH COMMAND HANDLING');
  });

  it('documents the four user-facing slash commands', () => {
    expect(BRAIN_SYSTEM_PROMPT).toContain('/launch');
    expect(BRAIN_SYSTEM_PROMPT).toContain('/order');
    expect(BRAIN_SYSTEM_PROMPT).toContain('/lore');
    expect(BRAIN_SYSTEM_PROMPT).toContain('/heartbeat');
  });

  // BRAIN-P6 Task 5: verify (not rewrite) the slash-rule wiring that
  // AC-BRAIN-14 relies on. These assertions are deliberately redundant with
  // the cases above — their point is to pin the *slash → tool* mapping so a
  // future refactor of the prompt cannot silently break the client-side
  // slash dispatch that already hard-codes this contract.

  it('instructs the agent that a leading-slash message is an explicit command', () => {
    // The client-side dispatcher and the server prompt must agree that `/`
    // is a sigil the agent has to honour without asking clarifying questions.
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/If the user message starts with\s+`\//);
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/without asking|dispatch immediately/i);
  });

  it('wires each slash command to the correct persona-invoke tool', () => {
    // The exact wiring lines appear inside SLASH COMMAND HANDLING. We pin
    // each line explicitly so a prompt refactor keeps the mapping intact.
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/\/launch[^\n]*invoke_creator/);
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/\/order[^\n]*invoke_shiller/);
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/\/lore[^\n]*invoke_narrator/);
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/\/heartbeat[^\n]*invoke_heartbeat_tick/);
  });

  // HARD NO-FABRICATION RULES — added after the "Brain skipped tool call and
  // fabricated Chapter 3/4 CIDs" bug. These rules are the primary defence
  // against the "LLM sees prior tool output in context and generates a
  // plausible next one without calling the tool" failure mode. Pin them
  // here so a future prompt cleanup cannot silently drop the guardrails.
  it('contains the HARD NO-FABRICATION RULES section', () => {
    expect(BRAIN_SYSTEM_PROMPT).toContain('HARD NO-FABRICATION RULES');
  });

  it('forbids reusing prior tool outputs to satisfy a new slash command', () => {
    expect(BRAIN_SYSTEM_PROMPT).toMatch(
      /EVERY slash command requires a FRESH tool call in the CURRENT turn/,
    );
    expect(BRAIN_SYSTEM_PROMPT).toMatch(
      /Prior tool outputs[^\n]*NEVER satisfy a new slash command/,
    );
  });

  it('explicitly forbids fabricating CIDs, addresses, tx hashes, tweet URLs', () => {
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/NEVER invent IPFS CIDs/);
    // Coverage of the typical fabrication markers we've actually seen in
    // regressions: chapter pin announcements + "CID: Qm..." + tweet URLs.
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/Chapter N pinned to IPFS/);
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/CID: Qm/);
    expect(BRAIN_SYSTEM_PROMPT).toMatch(/Tweet posted/);
  });
});

// ─── runBrainAgent wiring ───────────────────────────────────────────────────

describe('runBrainAgent', () => {
  it('invokes runAgentLoop with agentId="brain"', async () => {
    const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
    await runBrainAgent(baseParams(spy));
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call?.agentId).toBe('brain');
  });

  it('registers exactly the four persona-invoke tools into the runtime registry', async () => {
    const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
    await runBrainAgent(baseParams(spy));
    const call = spy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const toolNames = call!.registry.list().map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        INVOKE_CREATOR_TOOL_NAME,
        INVOKE_NARRATOR_TOOL_NAME,
        INVOKE_SHILLER_TOOL_NAME,
        INVOKE_HEARTBEAT_TICK_TOOL_NAME,
      ]),
    );
    expect(toolNames).toHaveLength(4);
  });

  it('passes BRAIN_SYSTEM_PROMPT to runAgentLoop verbatim', async () => {
    const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
    await runBrainAgent(baseParams(spy));
    const call = spy.mock.calls[0]?.[0];
    expect(call?.systemPrompt).toBe(BRAIN_SYSTEM_PROMPT);
  });

  // ─── Multi-turn context regression (UAT 2026-04-20) ──────────────────────
  //
  // Before the fix `runBrainAgent` flattened the transcript into a single
  // `userInput` string ("[user] foo\n[assistant] bar\n[user] baz") which
  // Anthropic treated as one quoted block. The model often lost the prior
  // assistant's factual output (deployed addresses, CIDs) on the follow-up
  // turn — the reported "brain forgets the token I just launched" bug.
  //
  // These tests pin that the loop now receives the transcript through
  // Anthropic's native `initialMessages` path AND that `userInput` is never
  // set simultaneously (the runtime rejects that combo).
  // -------------------------------------------------------------------------
  describe('multi-turn context regression', () => {
    it('forwards a multi-turn transcript as initialMessages (not userInput)', async () => {
      const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
      const params = baseParams(spy);
      params.messages = [
        { role: 'user', content: '/launch a BNB 2026 meme' },
        {
          role: 'assistant',
          content: 'Deployed HBNB2026-CHAIN at 0xabcdef0123456789abcdef0123456789abcdef01.',
        },
        { role: 'user', content: 'what was the tokenAddr you just gave me?' },
      ];
      await runBrainAgent(params);

      const call = spy.mock.calls[0]?.[0];
      expect(call).toBeDefined();
      // The runtime sees the full multi-turn chain, not a folded string.
      expect(call!.userInput).toBeUndefined();
      expect(call!.initialMessages).toBeDefined();
      expect(call!.initialMessages!.length).toBe(3);
      expect(call!.initialMessages![0]).toEqual({
        role: 'user',
        content: '/launch a BNB 2026 meme',
      });
      // The assistant's prior turn is preserved verbatim so the LLM can read
      // the deployed token address from its OWN earlier reply — the bug this
      // regression guards against.
      expect(call!.initialMessages![1]).toEqual({
        role: 'assistant',
        content: 'Deployed HBNB2026-CHAIN at 0xabcdef0123456789abcdef0123456789abcdef01.',
      });
      expect(call!.initialMessages![2]).toEqual({
        role: 'user',
        content: 'what was the tokenAddr you just gave me?',
      });
    });

    it('rejects a transcript whose final turn is not role="user"', async () => {
      const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
      const params = baseParams(spy);
      params.messages = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];
      await expect(runBrainAgent(params)).rejects.toThrow(/final chat message/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects an empty messages array', async () => {
      const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
      const params = baseParams(spy);
      params.messages = [];
      await expect(runBrainAgent(params)).rejects.toThrow(/must not be empty/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('forwards a single-turn transcript as a 1-entry initialMessages', async () => {
      // The Brain should treat a first-turn send exactly like the multi-turn
      // path — one user message in `initialMessages`, `userInput` unset. This
      // keeps the runtime's input-shape contract stable across turn counts.
      const spy = vi.fn(async (_p: RunAgentLoopParams) => makeFakeLoopResult());
      await runBrainAgent(baseParams(spy));
      const call = spy.mock.calls[0]?.[0];
      expect(call?.userInput).toBeUndefined();
      expect(call?.initialMessages).toEqual([
        { role: 'user', content: 'launch a meme about BNB 2026' },
      ]);
    });
  });
});
