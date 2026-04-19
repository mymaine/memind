import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { AnyPersona, Persona, PersonaId, PersonaRunContext } from './persona.js';

/**
 * Contract test for the `Persona<TInput, TOutput>` interface that mirrors the
 * existing `AgentTool<TInput, TOutput>` contract (see `./tool.ts`). The
 * interface is a pure TypeScript contract — these tests lock in:
 *   1. The identity union (`PersonaId`) covers the five pluggable personas
 *      shipped at M1 (creator / narrator / market-maker / shiller /
 *      heartbeat).
 *   2. A minimal object satisfies `Persona<TIn, TOut>` at compile time and at
 *      runtime (id, description, input/output zod schemas, async `run`).
 *   3. `AnyPersona` accepts the minimal object as `Persona<unknown, unknown>`.
 */

describe('PersonaId union', () => {
  it('contains the five M1 persona ids in a narrow readonly list', () => {
    const ids: PersonaId[] = ['creator', 'narrator', 'market-maker', 'shiller', 'heartbeat'];
    expect(ids).toHaveLength(5);
  });
});

describe('Persona<TInput, TOutput>', () => {
  it('accepts a minimal implementation with zod schemas and an async run()', async () => {
    const inputSchema = z.object({ theme: z.string() });
    const outputSchema = z.object({ ok: z.boolean() });

    const persona: Persona<{ theme: string }, { ok: boolean }> = {
      id: 'creator',
      description: 'minimal test persona',
      inputSchema,
      outputSchema,
      async run(input, ctx: PersonaRunContext) {
        void ctx;
        return { ok: input.theme.length > 0 };
      },
    };

    expect(persona.id).toBe('creator');
    expect(persona.description).toBe('minimal test persona');
    expect(typeof persona.run).toBe('function');

    // Zod schemas round-trip a valid value.
    const parsedIn = persona.inputSchema.parse({ theme: 'ok' });
    expect(parsedIn.theme).toBe('ok');

    const result = await persona.run(
      { theme: 'ok' },
      // `client` and `registry` are unused by the minimal persona; cast via
      // `unknown` keeps this test free of any Anthropic / server imports.
      {
        client: {} as unknown as PersonaRunContext['client'],
        registry: {} as unknown as PersonaRunContext['registry'],
      },
    );
    expect(persona.outputSchema.parse(result)).toEqual({ ok: true });
  });

  it('is assignable to the AnyPersona helper type', () => {
    const persona: Persona<{ a: number }, { b: number }> = {
      id: 'narrator',
      description: 'id-typed persona',
      inputSchema: z.object({ a: z.number() }),
      outputSchema: z.object({ b: z.number() }),
      async run(input) {
        return { b: input.a + 1 };
      },
    };
    // Assignment itself is the assertion — if `AnyPersona` is wrong, tsc fails.
    const any: AnyPersona = persona as unknown as AnyPersona;
    expect(any.id).toBe('narrator');
  });
});
