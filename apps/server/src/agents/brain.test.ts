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
});
