/**
 * Slash-command registry + pure parser (BRAIN-P6 Task 1).
 *
 * Implements AC-BRAIN-12 (registry metadata) and AC-BRAIN-16 (client-side
 * argument validation before dispatch). The registry is the single source of
 * truth consulted by:
 *   - `useSlashPalette` (candidate filtering + highlight navigation)
 *   - `<BrainChatSlashPalette />` (UI rendering)
 *   - `<BrainChat />` submit path (kind=server → POST to Brain;
 *     kind=client → local handler for `/status` / `/help` / `/reset`)
 *
 * Design notes:
 *   - `parseSlashInput` is the raw split pass: it tells the caller "this is
 *     command X with raw-args string Y" so command-specific positional
 *     parsing can happen on a stable substring. It returns an error discriminant
 *     for non-slash input and for unknown-command cases so UI code can give a
 *     precise inline hint.
 *   - `validateSlashArgs` is the typed pass: it runs the command's own
 *     positional parser (hard-coded per command because the slash layout is
 *     not uniform — `/launch <theme>` is "all the rest", `/order <addr> [brief]`
 *     is "first token + rest") then zod-validates the structured shape.
 *
 * EVM_ADDRESS_REGEX mirrors the one defined on the server
 * (apps/server/src/config.ts). We intentionally duplicate rather than import
 * `@hack-fourmeme/shared` because the web lib layer should not take a
 * transitive dependency on the server's address validation just to recognise
 * a tokenAddr regex.
 */
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SlashCommandKind = 'server' | 'client';

/**
 * Scopes a slash command is visible under. `global` commands appear in every
 * `<BrainChat scope="..." />` instance; scoped commands only appear in the
 * matching scope's palette so the live-demo sections stay focused.
 */
export type SlashScope = 'launch' | 'order' | 'heartbeat' | 'global';

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly usage: string;
  readonly kind: SlashCommandKind;
  readonly scopes: readonly SlashScope[];
  readonly argsSchema: z.ZodType;
}

// ─── EVM address regex (duplicated from server config by design) ────────────

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// ─── Registry ───────────────────────────────────────────────────────────────

const launchArgsSchema = z.object({
  theme: z.string().min(3).max(280),
});

const orderArgsSchema = z.object({
  tokenAddr: z.string().regex(EVM_ADDRESS_REGEX),
  brief: z.string().optional(),
});

const loreArgsSchema = z.object({
  tokenAddr: z.string().regex(EVM_ADDRESS_REGEX),
});

const heartbeatArgsSchema = z.object({
  tokenAddr: z.string().regex(EVM_ADDRESS_REGEX),
  intervalMs: z.coerce.number().int().positive().optional(),
});

const emptyArgsSchema = z.object({});

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'launch',
    description: 'Deploy a new four.meme token via the Creator persona',
    usage: '/launch <theme>',
    kind: 'server',
    scopes: ['launch', 'global'],
    argsSchema: launchArgsSchema,
  },
  {
    name: 'order',
    description: 'Order a promotional tweet via the Pitch persona',
    usage: '/order <tokenAddr> [brief]',
    kind: 'server',
    scopes: ['order', 'global'],
    argsSchema: orderArgsSchema,
  },
  {
    name: 'lore',
    description: 'Extend the next lore chapter for a deployed token',
    usage: '/lore <tokenAddr>',
    kind: 'server',
    scopes: ['launch', 'global'],
    argsSchema: loreArgsSchema,
  },
  {
    name: 'heartbeat',
    description: 'Run one Heartbeat tick, optionally setting the interval',
    usage: '/heartbeat <tokenAddr> [intervalMs]',
    kind: 'server',
    scopes: ['heartbeat', 'global'],
    argsSchema: heartbeatArgsSchema,
  },
  {
    name: 'status',
    description: 'Show the current chat session status',
    usage: '/status',
    kind: 'client',
    scopes: ['launch', 'order', 'heartbeat', 'global'],
    argsSchema: emptyArgsSchema,
  },
  {
    name: 'help',
    description: 'List all available slash commands',
    usage: '/help',
    kind: 'client',
    scopes: ['launch', 'order', 'heartbeat', 'global'],
    argsSchema: emptyArgsSchema,
  },
  {
    name: 'reset',
    description: 'Clear this chat scope and start over',
    usage: '/reset',
    kind: 'client',
    scopes: ['launch', 'order', 'heartbeat', 'global'],
    argsSchema: emptyArgsSchema,
  },
  // UAT fix (2026-04-20): `/clear` is the more common muscle-memory verb
  // (OpenAI ChatGPT, Discord, Slack). We alias it onto the same client-side
  // reset handler so either command empties the transcript and forgets the
  // prior turns. The help listing shows both so judges typing either form
  // get the expected behaviour.
  {
    name: 'clear',
    description: 'Clear this chat scope and start over (alias of /reset)',
    usage: '/clear',
    kind: 'client',
    scopes: ['launch', 'order', 'heartbeat', 'global'],
    argsSchema: emptyArgsSchema,
  },
];

// ─── parseSlashInput ────────────────────────────────────────────────────────

export type ParseSlashInputResult =
  | { readonly ok: true; readonly name: string; readonly args: string }
  | { readonly ok: false; readonly error: 'not-slash' | 'unknown-command' };

/**
 * Split a raw chat input line into a slash-command name + raw-args substring.
 *
 * Contract:
 *   - Input must start with a literal `/` (leading whitespace is NOT trimmed —
 *     the palette only opens when the user typed a leading slash anyway, and
 *     trimming would mask an accidental space at the start of an otherwise
 *     non-slash free-form message).
 *   - Token immediately after `/` (up to the first whitespace) is the name.
 *   - Everything after the first whitespace run is the raw args, trimmed of
 *     leading/trailing whitespace so command-specific parsers see a clean
 *     substring.
 *   - Returns `unknown-command` if the name is not in the registry, so the UI
 *     can inline-hint "no such command" without branching on the whole registry.
 */
export function parseSlashInput(raw: string): ParseSlashInputResult {
  if (!raw.startsWith('/')) {
    return { ok: false, error: 'not-slash' };
  }
  const body = raw.slice(1);
  const match = /^(\S+)\s*([\s\S]*)$/.exec(body);
  if (!match) {
    // Empty "/", no command name. Treat as unknown so UI can show "pick a command".
    return { ok: false, error: 'unknown-command' };
  }
  const name = match[1] ?? '';
  const rest = (match[2] ?? '').trim();
  const known = SLASH_COMMANDS.some((c) => c.name === name);
  if (!known) {
    return { ok: false, error: 'unknown-command' };
  }
  return { ok: true, name, args: rest };
}

// ─── Command-specific positional arg parsers ────────────────────────────────
//
// Each parser converts the raw-args substring into a shape the command's
// zod argsSchema can validate. Hard-coded per command because the slash
// layout is not uniform: `/launch <theme>` consumes the whole rest as a
// single free-form string; `/order <tokenAddr> [brief]` reserves the first
// whitespace-delimited token for tokenAddr and leaves the rest as brief.
// ----------------------------------------------------------------------------

type ArgBag = Record<string, unknown>;

function splitFirstToken(raw: string): { head: string; rest: string } {
  const match = /^(\S+)\s*([\s\S]*)$/.exec(raw);
  if (!match) return { head: '', rest: '' };
  return { head: match[1] ?? '', rest: (match[2] ?? '').trim() };
}

function parseArgsForCommand(cmd: SlashCommand, rawArgs: string): ArgBag {
  switch (cmd.name) {
    case 'launch': {
      // Whole rest is the theme. Empty string if the user sent `/launch` bare —
      // zod's `.min(3)` will reject it downstream with a stable error.
      return { theme: rawArgs };
    }
    case 'order': {
      const { head, rest } = splitFirstToken(rawArgs);
      const bag: ArgBag = { tokenAddr: head };
      if (rest !== '') {
        bag.brief = rest;
      }
      return bag;
    }
    case 'lore': {
      const { head } = splitFirstToken(rawArgs);
      return { tokenAddr: head };
    }
    case 'heartbeat': {
      const { head, rest } = splitFirstToken(rawArgs);
      const bag: ArgBag = { tokenAddr: head };
      if (rest !== '') {
        // intervalMs remains a string here; zod's `z.coerce.number()` does the
        // actual conversion during `validateSlashArgs`.
        bag.intervalMs = rest;
      }
      return bag;
    }
    case 'status':
    case 'help':
    case 'reset':
      return {};
    default:
      return {};
  }
}

// ─── validateSlashArgs ──────────────────────────────────────────────────────

export type ValidateSlashArgsResult =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/**
 * Validate and coerce raw args for a given command. The palette / submit code
 * calls this the moment the user presses Enter; the resulting typed args are
 * not wired to the server directly (the server receives the raw message line
 * verbatim) — instead the `ok` bit gates whether we let the send proceed. A
 * failure returns a human-readable reason suitable for an inline red error.
 */
export function validateSlashArgs(cmd: SlashCommand, rawArgs: string): ValidateSlashArgsResult {
  const bag = parseArgsForCommand(cmd, rawArgs);
  const parsed = cmd.argsSchema.safeParse(bag);
  if (!parsed.success) {
    // Surface the first zod issue — good enough for a one-line inline hint.
    const first = parsed.error.issues[0];
    const path = first?.path.join('.') ?? 'args';
    const message = first?.message ?? 'invalid arguments';
    return { ok: false, error: `${path}: ${message}` };
  }
  return { ok: true, args: parsed.data as Record<string, unknown> };
}
