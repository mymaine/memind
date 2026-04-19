/**
 * Red tests for the slash-command registry + parser (BRAIN-P6 Task 1).
 *
 * AC-BRAIN-12 / AC-BRAIN-16 require:
 *   - A registry of 7 commands (4 server-side, 3 client-side) with name /
 *     description / usage / kind / scopes / argsSchema.
 *   - A `parseSlashInput` pure function that splits "/name rest" into a name
 *     + raw-args string, or flags malformed input.
 *   - A `validateSlashArgs` step that runs command-specific positional
 *     parsing then zod validation on the result.
 *
 * Tests mirror the exact 7 cases enumerated in the BRAIN-P6 brief.
 */
import { describe, it, expect } from 'vitest';
import {
  SLASH_COMMANDS,
  parseSlashInput,
  validateSlashArgs,
  type SlashCommand,
} from './slash-commands';

function findCommand(name: string): SlashCommand {
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  if (!cmd) throw new Error(`missing command ${name} in registry`);
  return cmd;
}

describe('SLASH_COMMANDS registry', () => {
  it('exposes all seven documented commands with correct kind mapping', () => {
    const names = SLASH_COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(['help', 'heartbeat', 'launch', 'lore', 'order', 'reset', 'status']);

    const serverCmds = SLASH_COMMANDS.filter((c) => c.kind === 'server')
      .map((c) => c.name)
      .sort();
    expect(serverCmds).toEqual(['heartbeat', 'launch', 'lore', 'order']);

    const clientCmds = SLASH_COMMANDS.filter((c) => c.kind === 'client')
      .map((c) => c.name)
      .sort();
    expect(clientCmds).toEqual(['help', 'reset', 'status']);
  });
});

describe('parseSlashInput', () => {
  // Case 1 — canonical slash splits into name + rest
  it('parses "/launch foo bar" into name=launch, args="foo bar"', () => {
    const res = parseSlashInput('/launch foo bar');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.name).toBe('launch');
      expect(res.args).toBe('foo bar');
    }
  });

  // Case 2 — non-slash input rejected
  it('returns not-slash for inputs lacking the leading /', () => {
    const res = parseSlashInput('not slash');
    expect(res).toEqual({ ok: false, error: 'not-slash' });
  });

  // Case 3 — unknown command is rejected with a distinct error
  it('returns unknown-command for "/unknown x"', () => {
    const res = parseSlashInput('/unknown x');
    expect(res).toEqual({ ok: false, error: 'unknown-command' });
  });
});

describe('validateSlashArgs', () => {
  // Case 4 — /launch with no theme is rejected by argsSchema min length
  it('rejects /launch with an empty theme', () => {
    const cmd = findCommand('launch');
    const res = validateSlashArgs(cmd, '');
    expect(res.ok).toBe(false);
  });

  // Case 5 — /order 0x... with trailing brief separates tokenAddr + brief
  it('parses /order into tokenAddr + brief separately', () => {
    const cmd = findCommand('order');
    const res = validateSlashArgs(
      cmd,
      '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444 some brief text',
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.args).toEqual({
        tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
        brief: 'some brief text',
      });
    }
  });

  // Case 6 — invalid tokenAddr is rejected by regex
  it('rejects /order with a non-hex tokenAddr', () => {
    const cmd = findCommand('order');
    const res = validateSlashArgs(cmd, '0xNOT_A_HEX_ADDRESS some brief');
    expect(res.ok).toBe(false);
  });

  // Case 7 — /heartbeat intervalMs coerces numeric string to number
  it('coerces the heartbeat intervalMs from string to number', () => {
    const cmd = findCommand('heartbeat');
    const res = validateSlashArgs(cmd, '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444 30000');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.args).toEqual({
        tokenAddr: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
        intervalMs: 30000,
      });
    }
  });
});
