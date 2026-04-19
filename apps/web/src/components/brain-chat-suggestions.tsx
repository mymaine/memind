/**
 * BrainChatSuggestions — scope-aware suggestion chips shown when the chat
 * transcript is empty (BRAIN-P4 Task 4 / AC-BRAIN-9).
 *
 * The chip copy lives in a pure `chipsForScope(scope)` helper so tests can
 * pin the mapping without mounting the component. Production caller passes
 * `onPick(text)` which pre-fills the input with the chip text; clicking the
 * chip does NOT auto-submit — the user still taps Send. This matches Slack /
 * Linear quick-prompt behaviour and keeps the demo honest (users can see
 * the chip text before sending).
 */
import type { ReactElement } from 'react';
import type { BrainChatScope } from '@/hooks/useBrainChat';

// Suggestion chip copy. Keep each ≤ ~60 chars so the chip row does not wrap
// on a typical demo laptop. Launch prompts lean towards BNB Chain themes
// because users evaluate the four.meme integration; order / heartbeat
// prompts use an illustrative tokenAddr placeholder so the user can see the
// expected shape and replace it with a real address.
const LAUNCH_CHIPS: readonly string[] = [
  'Launch a meme about BNB Chain 2026 growth',
  'Deploy a token themed on AI agents vs meme traders',
  'Launch $FOURMEME tribute honouring the hackathon',
];

const ORDER_CHIPS: readonly string[] = [
  'Order a shill for 0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
  'Pitch my token to the BNB community on X',
  'Shill it with a lore snippet that rhymes',
];

const HEARTBEAT_CHIPS: readonly string[] = [
  'Start heartbeat ticking for 0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
  'Run one autonomous tick and tell me what it decides',
  'Set heartbeat interval to 30 seconds',
];

const GLOBAL_CHIPS: readonly string[] = [
  'Launch a meme about BNB Chain 2026 growth',
  'Order a shill for a token I already deployed',
  'Start heartbeat ticking for my latest token',
  'What tokens have you deployed so far?',
];

export function chipsForScope(scope: BrainChatScope): readonly string[] {
  switch (scope) {
    case 'launch':
      return LAUNCH_CHIPS;
    case 'order':
      return ORDER_CHIPS;
    case 'heartbeat':
      return HEARTBEAT_CHIPS;
    case 'global':
      return GLOBAL_CHIPS;
  }
}

export interface BrainChatSuggestionsProps {
  readonly scope: BrainChatScope;
  readonly onPick: (text: string) => void;
}

export function BrainChatSuggestions({ scope, onPick }: BrainChatSuggestionsProps): ReactElement {
  const chips = chipsForScope(scope);
  return (
    <div
      aria-label="Suggestion prompts"
      className="flex flex-wrap gap-2"
      data-testid="brain-chat-suggestions"
    >
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onPick(chip)}
          className="rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-1.5 text-left font-[family-name:var(--font-mono)] text-[11px] text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
