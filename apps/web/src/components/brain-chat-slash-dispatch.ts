/**
 * Pure submit-path dispatcher for the BrainChat textarea (BRAIN-P6 Task 4/6).
 *
 * Handles the decision tree the parent component would otherwise inline:
 *
 *   1. Empty / whitespace-only input → `{ kind: 'ignore' }`.
 *   2. Free-form text (no leading `/`) → `{ kind: 'server-send' }`; parent
 *      routes through `controller.send(raw)` verbatim.
 *   3. `/status` / `/help` / `/reset` client command → side effects via the
 *      `reset` / `appendLocalAssistant` shims, then `{ kind: 'client-handled' }`.
 *   4. `/launch` / `/order` / `/lore` / `/heartbeat` server command →
 *      validate argsSchema client-side; on success `{ kind: 'server-send' }`
 *      (the server's own slash rule in BRAIN_SYSTEM_PROMPT handles the
 *      dispatch). On failure `{ kind: 'invalid', error }` so the parent can
 *      surface an inline red hint and keep the draft intact.
 *   5. Unknown slash (`/foo`) → `{ kind: 'invalid', error: 'unknown command' }`.
 *
 * Extracted into its own file so unit tests can pin the decision tree
 * without React or a textarea. The parent component (`<BrainChat />`) is a
 * thin consumer: read value → call this helper → act on the result.
 */
import {
  SLASH_COMMANDS,
  parseSlashInput,
  validateSlashArgs,
  type SlashCommand,
  type SlashScope,
} from '@/lib/slash-commands';
import type { BrainChatTurn } from '@/hooks/useBrainChat-state';

export type DispatchResult =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'server-send' }
  | { readonly kind: 'client-handled' }
  | { readonly kind: 'invalid'; readonly error: string };

export interface DispatchSlashSubmissionArgs {
  readonly raw: string;
  readonly scope: SlashScope;
  readonly turns: readonly BrainChatTurn[];
  readonly reset: () => void;
  readonly appendLocalAssistant: (content: string) => void;
}

/**
 * Compose the `/help` response body for a given scope. Lists every
 * registry command whose scopes include the current chat scope, so judges
 * typing `/help` in the launch scene see launch + lore + global shortcuts.
 */
function formatHelpMessage(scope: SlashScope): string {
  const visible = SLASH_COMMANDS.filter((c) => c.scopes.includes(scope));
  const lines = visible.map((c) => `${c.usage} — ${c.description}`);
  return ['Available slash commands:', ...lines].join('\n');
}

/**
 * Compose the `/status` response body: session turn count + last assistant
 * timestamp if available (we pin wall-clock time in the turn id via
 * `makeTurnId` → includes `Date.now()` when crypto.randomUUID is absent, so
 * we cannot rely on it). For now report turn counts only — enough for judges
 * to verify the memory grew across turns, and avoids a fake timestamp.
 */
function formatStatusMessage(turns: readonly BrainChatTurn[]): string {
  const userCount = turns.filter((t) => t.role === 'user').length;
  const assistantCount = turns.filter((t) => t.role === 'assistant').length;
  return `Session status: ${userCount.toString()} user turn${userCount === 1 ? '' : 's'}, ${assistantCount.toString()} assistant turn${assistantCount === 1 ? '' : 's'}.`;
}

export function dispatchSlashSubmission(args: DispatchSlashSubmissionArgs): DispatchResult {
  const { raw, scope, turns, reset, appendLocalAssistant } = args;
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'ignore' };

  // Non-slash input is routed straight to the Brain; the server's own slash
  // rule is not consulted for free-form text.
  if (!trimmed.startsWith('/')) {
    return { kind: 'server-send' };
  }

  const parsed = parseSlashInput(trimmed);
  if (!parsed.ok) {
    if (parsed.error === 'unknown-command') {
      return { kind: 'invalid', error: 'Unknown command. Type / to see available commands.' };
    }
    // not-slash is impossible here (startsWith('/') already passed) but
    // treat it as ignore defensively.
    return { kind: 'ignore' };
  }

  const cmd: SlashCommand | undefined = SLASH_COMMANDS.find((c) => c.name === parsed.name);
  if (!cmd) {
    return { kind: 'invalid', error: 'Unknown command.' };
  }

  // Scope check — a command must be visible in the current scope to run.
  if (!cmd.scopes.includes(scope)) {
    return {
      kind: 'invalid',
      error: `/${cmd.name} is not available in the ${scope} scope.`,
    };
  }

  if (cmd.kind === 'client') {
    switch (cmd.name) {
      case 'reset':
      case 'clear':
        // `/clear` is a UAT alias for `/reset` — both drop the transcript.
        reset();
        return { kind: 'client-handled' };
      case 'help':
        appendLocalAssistant(formatHelpMessage(scope));
        return { kind: 'client-handled' };
      case 'status':
        appendLocalAssistant(formatStatusMessage(turns));
        return { kind: 'client-handled' };
      default:
        return { kind: 'ignore' };
    }
  }

  // Server-bound command — validate args client-side before firing the POST.
  const validated = validateSlashArgs(cmd, parsed.args);
  if (!validated.ok) {
    return { kind: 'invalid', error: validated.error };
  }
  return { kind: 'server-send' };
}
