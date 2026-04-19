/**
 * Tests for `<ConsoleTab />` (P0-14 / FooterDrawer Brain Console tab).
 *
 * Verifies the terminal-style summary derived from runState:
 *   - idle state → status=idle, persona=—, logs.count=0, runId=—
 *   - running state with recent logs → status=online, persona label,
 *     logs.count reflects length, runId shown verbatim
 *   - totalToolCalls sums per-agent counts
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import type { RunState, ToolCallsByAgent } from '@/hooks/useRun-state';
import { EMPTY_ASSISTANT_TEXT, EMPTY_TOOL_CALLS, IDLE_STATE } from '@/hooks/useRun-state';
import { ConsoleTab, totalToolCalls } from '../console-tab.js';

const RUN_ID = 'run_console_test';

function toolCallsWith(partial: Partial<ToolCallsByAgent>): ToolCallsByAgent {
  return { ...EMPTY_TOOL_CALLS, ...partial };
}

function runningState(opts: {
  logs?: LogEvent[];
  toolCalls?: Partial<ToolCallsByAgent>;
}): RunState {
  return {
    phase: 'running',
    runId: RUN_ID,
    logs: opts.logs ?? [],
    artifacts: [],
    toolCalls: toolCallsWith(opts.toolCalls ?? {}),
    assistantText: EMPTY_ASSISTANT_TEXT,
    error: null,
  };
}

describe('<ConsoleTab />', () => {
  it('renders the idle summary when runState is IDLE', () => {
    const out = renderToStaticMarkup(<ConsoleTab runState={IDLE_STATE} />);
    // status line is `idle`
    expect(out).toMatch(/status[^<]*<\/span>\s*<span[^>]*>idle</);
    // persona.active falls back to em-dash placeholder
    expect(out).toContain('persona.active');
    expect(out).toContain('\u2014');
    // logs.count is 0
    expect(out).toMatch(/logs\.count[^<]*<\/span>\s*<span[^>]*>0</);
    // phase is idle
    expect(out).toMatch(/phase[^<]*<\/span>\s*<span[^>]*>idle</);
  });

  it('renders status=online and a persona label when runState.phase=running', () => {
    const logs: LogEvent[] = [
      {
        ts: '2026-04-20T14:52:08.212Z',
        agent: 'creator',
        tool: 'meme_image',
        level: 'info',
        message: 'hello',
      },
    ];
    const out = renderToStaticMarkup(<ConsoleTab runState={runningState({ logs })} />);
    expect(out).toMatch(/status[^<]*<\/span>\s*<span[^>]*>online</);
    // deriveActivePersonaLabel maps `creator` agent to the `Creator` persona.
    expect(out).toContain('Creator');
    expect(out).toMatch(/logs\.count[^<]*<\/span>\s*<span[^>]*>1</);
  });

  it('shows the runId when running', () => {
    const out = renderToStaticMarkup(<ConsoleTab runState={runningState({})} />);
    expect(out).toContain(RUN_ID);
  });

  it('totalToolCalls sums per-agent tool-call counts', () => {
    const state = runningState({
      toolCalls: {
        creator: [
          { id: 't1', toolName: 'foo', input: {}, status: 'done' },
          { id: 't2', toolName: 'bar', input: {}, status: 'done' },
        ],
        narrator: [{ id: 't3', toolName: 'baz', input: {}, status: 'running' }],
      },
    });
    expect(totalToolCalls(state)).toBe(3);
    const out = renderToStaticMarkup(<ConsoleTab runState={state} />);
    // Row for tool-calls shows the sum.
    expect(out).toMatch(/tool-calls[^<]*<\/span>\s*<span[^>]*>3</);
  });

  it('renders the brain@memind prompt lines', () => {
    const out = renderToStaticMarkup(<ConsoleTab runState={IDLE_STATE} />);
    // Two prompt rows: top (status command) + bottom (blinking cursor).
    const matches = out.match(/brain@memind:~\$/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
