import { describe, it, expect } from 'vitest';
import { formatToolPayload, toolBubbleTone } from './tool-call-bubble-utils';
import type { ToolCallState } from '@/hooks/useRun-state';

describe('toolBubbleTone', () => {
  it('returns running when the call is still open', () => {
    const call: ToolCallState = {
      id: 'tu_1',
      toolName: 'narrative_generator',
      input: {},
      status: 'running',
    };
    expect(toolBubbleTone(call)).toBe('running');
  });

  it('returns ok for done non-error', () => {
    const call: ToolCallState = {
      id: 'tu_1',
      toolName: 'narrative_generator',
      input: {},
      output: { ok: true },
      isError: false,
      status: 'done',
    };
    expect(toolBubbleTone(call)).toBe('ok');
  });

  it('returns error for done + isError=true', () => {
    const call: ToolCallState = {
      id: 'tu_1',
      toolName: 'narrative_generator',
      input: {},
      output: { error: 'boom' },
      isError: true,
      status: 'done',
    };
    expect(toolBubbleTone(call)).toBe('error');
  });
});

describe('formatToolPayload', () => {
  it('pretty-prints small payloads in full', () => {
    const out = formatToolPayload({ a: 1, b: 'two' });
    expect(out).toContain('"a": 1');
    expect(out).toContain('"b": "two"');
  });

  it('truncates payloads over the preview cap and reports the overflow', () => {
    const bigString = 'x'.repeat(2000);
    const out = formatToolPayload({ blob: bigString });
    expect(out.length).toBeLessThan(bigString.length + 200);
    expect(out).toMatch(/more chars truncated/);
  });

  it('survives payloads with circular references (falls back to String())', () => {
    const obj: Record<string, unknown> = { name: 'loop' };
    obj.self = obj;
    const out = formatToolPayload(obj);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
