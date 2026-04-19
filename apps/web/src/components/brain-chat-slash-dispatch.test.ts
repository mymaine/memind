/**
 * Red tests for `dispatchSlashSubmission` — the pure submit-path helper
 * covering BRAIN-P6 Task 4 (slash integration) + Task 6 (client commands).
 *
 * Shape: the helper takes the raw textarea value + the current scope + the
 * transcript + a shim that stubs `send` / `reset` / `appendLocalAssistant`,
 * and returns one of:
 *   - { kind: 'server-send' } — parent component calls controller.send(raw)
 *   - { kind: 'client-handled' } — the helper already dispatched side
 *     effects against the shim (reset / appendLocalAssistant)
 *   - { kind: 'invalid', error: string } — validation failed; parent shows
 *     an inline red hint and does not clear the draft
 *   - { kind: 'ignore' } — nothing to do (empty input, etc.)
 *
 * Three bundled cases:
 *   1. `/status` client branch → appendLocalAssistant called with transcript
 *      summary; returns `client-handled`.
 *   2. `/help` client branch → appendLocalAssistant called with the command
 *      listing; returns `client-handled`.
 *   3. `/reset` client branch → reset() called; returns `client-handled`.
 *   4. `/launch <theme>` server branch with valid theme → `server-send`.
 *   5. `/order 0xBAD...` server branch with invalid tokenAddr → `invalid`.
 */
import { describe, it, expect, vi } from 'vitest';
import { dispatchSlashSubmission } from './brain-chat-slash-dispatch';
import type { BrainChatTurn } from '@/hooks/useBrainChat-state';

function shim() {
  return {
    reset: vi.fn(),
    appendLocalAssistant: vi.fn(),
  };
}

function userTurn(id: string, content: string): BrainChatTurn {
  return { id, role: 'user', content };
}

describe('dispatchSlashSubmission — /status', () => {
  it('reports turn count + last activity and returns client-handled', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: '/status',
      scope: 'launch',
      turns: [userTurn('u1', 'hi'), userTurn('u2', 'launch it')],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res).toEqual({ kind: 'client-handled' });
    expect(sh.appendLocalAssistant).toHaveBeenCalledTimes(1);
    const msg = sh.appendLocalAssistant.mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/2/);
    expect(sh.reset).not.toHaveBeenCalled();
  });
});

describe('dispatchSlashSubmission — /help', () => {
  it('lists every scope-visible command name and returns client-handled', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: '/help',
      scope: 'launch',
      turns: [],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res).toEqual({ kind: 'client-handled' });
    const msg = sh.appendLocalAssistant.mock.calls[0]?.[0] as string;
    // Launch scope sees launch + lore (scoped) + help / reset / status (global).
    expect(msg).toMatch(/\/launch/);
    expect(msg).toMatch(/\/lore/);
    expect(msg).toMatch(/\/help/);
  });
});

describe('dispatchSlashSubmission — /reset', () => {
  it('invokes reset() and returns client-handled', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: '/reset',
      scope: 'launch',
      turns: [userTurn('u1', 'hi')],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res).toEqual({ kind: 'client-handled' });
    expect(sh.reset).toHaveBeenCalledTimes(1);
    expect(sh.appendLocalAssistant).not.toHaveBeenCalled();
  });
});

describe('dispatchSlashSubmission — /clear (alias of /reset, UAT 2026-04-20)', () => {
  it('invokes reset() just like /reset so users with ChatGPT muscle memory can clear the transcript', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: '/clear',
      scope: 'launch',
      turns: [userTurn('u1', 'hi')],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res).toEqual({ kind: 'client-handled' });
    expect(sh.reset).toHaveBeenCalledTimes(1);
    expect(sh.appendLocalAssistant).not.toHaveBeenCalled();
  });
});

describe('dispatchSlashSubmission — server-side valid /launch', () => {
  it('returns server-send so the parent routes the raw message through controller.send', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: '/launch a meme about BNB 2026',
      scope: 'launch',
      turns: [],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res).toEqual({ kind: 'server-send' });
    expect(sh.reset).not.toHaveBeenCalled();
    expect(sh.appendLocalAssistant).not.toHaveBeenCalled();
  });
});

describe('dispatchSlashSubmission — invalid tokenAddr', () => {
  it('returns invalid with an inline error when /order receives a non-hex addr', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: '/order 0xNOT_A_HEX brief text',
      scope: 'order',
      turns: [],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') {
      expect(res.error).toMatch(/tokenAddr/);
    }
  });
});

describe('dispatchSlashSubmission — non-slash passthrough', () => {
  it('returns server-send for free-form chat input', () => {
    const sh = shim();
    const res = dispatchSlashSubmission({
      raw: 'hey brain deploy me a token',
      scope: 'launch',
      turns: [],
      reset: sh.reset,
      appendLocalAssistant: sh.appendLocalAssistant,
    });
    expect(res).toEqual({ kind: 'server-send' });
  });
});
