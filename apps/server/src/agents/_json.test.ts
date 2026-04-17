import { describe, it, expect } from 'vitest';
import { extractJsonObject } from './_json.js';

/**
 * Shared JSON extractor used by any agent whose final-text contract is "one
 * JSON object, optionally fenced". Covers the four variations observed from
 * live Claude output.
 */
describe('extractJsonObject', () => {
  it('parses plain JSON output', () => {
    const out = extractJsonObject('{"foo":"bar"}', 'test-agent');
    expect(out).toEqual({ foo: 'bar' });
  });

  it('parses JSON wrapped in a ```json fence', () => {
    const out = extractJsonObject('```json\n{"decision":"skip"}\n```', 'test-agent');
    expect(out).toEqual({ decision: 'skip' });
  });

  it('tolerates surrounding whitespace and a bare ``` fence without the json tag', () => {
    const fenced = '\n\n```\n{"ok":true}\n```\n\n';
    const out = extractJsonObject(fenced, 'test-agent');
    expect(out).toEqual({ ok: true });
  });

  it('throws with agentName in the message when text is not valid JSON', () => {
    expect(() => extractJsonObject('not json at all', 'runMarketMakerAgent')).toThrow(
      /runMarketMakerAgent/,
    );
  });

  it('throws with agentName in the message when the JSON root is an array, not an object', () => {
    // Every agent-final schema expects an object at the top level, so a
    // syntactically-valid JSON array must still fail loud — otherwise the
    // downstream zod parse would surface a noisier, less-actionable error.
    expect(() => extractJsonObject('[1,2,3]', 'runCreatorAgent')).toThrow(/runCreatorAgent/);
  });
});
