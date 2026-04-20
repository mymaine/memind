/**
 * BrainChatSuggestions — scope-aware suggestion chips shown when the chat
 * transcript is empty (BRAIN-P4 Task 4 / AC-BRAIN-9).
 *
 * Each chip carries a short `label` (rendered on the button) and a pool of
 * `prompts`. Clicking a chip calls `onPick(text)` where `text` is a random
 * member of the pool — this lets the button stay compact while the prompt
 * library can be as wild and meme-flavoured as we like. The chip still does
 * NOT auto-submit: the user sees the filled draft and taps Send, keeping
 * the demo honest.
 */
import type { ReactElement } from 'react';
import type { BrainChatScope } from '@/hooks/useBrainChat';

export interface SuggestionChip {
  readonly label: string;
  readonly prompts: readonly string[];
}

const LAUNCH_WILD_MEME: SuggestionChip = {
  label: 'Launch a wild meme coin',
  prompts: [
    '/launch Token name: HELLOKITTY. Story: HelloKitty is chased by a kaiju through Tokyo, opens a tiny umbrella, and BASE-jumps off a skyscraper into the Pacific where BNB whales catch her mid-fall.',
    '/launch Token name: DOGEONMARS. Story: Doge crash-lands on Mars, discovers the red planet is actually a giant $BNB coin, and elects himself governor of Crypto Olympus.',
    '/launch Token name: BANANAPOOL. Story: A banana slips on itself, falls into a liquidity pool, and emerges as the first peel-to-earn protocol on BNB Chain.',
    '/launch Token name: CHICKENJET. Story: A chicken hijacks a fighter jet, refuses to land until the BNB memeboard hits ATH, and now airdrops eggs exclusively to diamond-handed holders.',
    '/launch Token name: WIZARDFROG. Story: An ancient frog wizard discovers the lost scroll of BNB, casts a spell that turns every holder into a 50x leverage legend overnight.',
    '/launch Token name: GRANDMAGM. Story: A grandma types "gm" in all-caps by accident, becomes the most based KOL on BNB Chain, and signs every NFT with lipstick kisses.',
  ],
};

const LAUNCH_BNB_TRIBUTE: SuggestionChip = {
  label: 'Launch a BNB Chain tribute',
  prompts: [
    '/launch A token honouring four.meme itself. The lore says four.meme is secretly an ancient oracle that predicts every trending meme three blocks in advance.',
    '/launch A token pitting AI agents against human meme traders in a rooftop dance-off that decides the fate of the next bull market.',
    '/launch A tribute to the BNB degens who refuse to sleep. The lore says their keyboards run on pure caffeine, hopium, and leftover bubble tea.',
  ],
};

const LAUNCH_LEGENDARY_SAGA: SuggestionChip = {
  label: 'Launch a legendary saga',
  prompts: [
    '/launch Token name: ELONSOCK. Story: Elon Musk lost sock gains sentience, launches its own Mars mission, and demands equal rights for missing laundry everywhere.',
    '/launch Token name: SHIBASUSHI. Story: A shiba inu opens a rooftop sushi bar, only accepts $SHIBASUSHI for wasabi, and single-handedly funds a kaiju exorcism.',
    '/launch Token name: ROMANPEPE. Story: A Roman senator pepe warns the Senate about Carthaginian bears, gets exiled, and starts the first BNB Chain resistance from a Tuscan villa.',
    '/launch Token name: PIZZADAO. Story: A pizza slice gains sentience during the 2010 bitcoin pizza transaction, has been quietly compounding for fifteen years, and now owns everything.',
  ],
};

const ORDER_SHILL_MY_TOKEN: SuggestionChip = {
  label: 'Order a shill for my token',
  prompts: [
    'Order a shill for my latest token. Pitch it like a street food vendor selling BNB-flavoured dumplings at 3 AM.',
    'Order a shill for my latest token. Write it in the voice of a grumpy Roman senator warning the Senate about incoming bears.',
    'Order a shill for my latest token. Make it read like a weather forecast — 80 percent chance of pump, scattered FUD clearing by the weekend.',
    'Order a shill for my latest token. Pitch like a deep-sea marine biologist describing a newly discovered species of liquidity shark.',
  ],
};

const ORDER_PITCH_TO_BNB: SuggestionChip = {
  label: 'Pitch to the BNB community',
  prompts: [
    'Pitch my latest token to the BNB community on X. Angle: sleep is for validators, we launched during a solar eclipse.',
    'Pitch my latest token to BNB degens like a midnight infomercial host hyping a miracle bug spray that also doubles portfolios.',
    'Pitch my latest token as if it were an unlicensed superhero unveiling itself at the BNB Annual Hero Expo, cape optional.',
  ],
};

const ORDER_LORE_FLAVOUR: SuggestionChip = {
  label: 'Shill with lore flavour',
  prompts: [
    'Shill my latest token with a lore snippet written as a Shakespearean sonnet about diamond hands and liquidity seas.',
    'Shill my latest token with a lore snippet that reads like a lost chapter of a 1980s Saturday morning cartoon intro.',
    'Shill my latest token with a lore snippet that rhymes and mentions at least three types of weather and one extinct animal.',
  ],
};

const HEARTBEAT_START_TICKING: SuggestionChip = {
  label: 'Start heartbeat ticking',
  prompts: [
    'Start heartbeat ticking for my latest token every 30 seconds. Pretend each tick is a caffeinated shiba inu panic-checking the chart.',
    'Start heartbeat ticking for my latest token every 45 seconds. Treat each tick as a fresh entry in the Memind captain log.',
    'Start heartbeat ticking for my latest token every 60 seconds. Act like a lighthouse keeper scanning the BNB horizon for incoming degens.',
  ],
};

const HEARTBEAT_RUN_ONE_TICK: SuggestionChip = {
  label: 'Run one tick now',
  prompts: [
    'Run one autonomous heartbeat tick for my latest token and tell me what you decided, like a stand-up comic opening a Tuesday night show.',
    'Run one heartbeat tick for my latest token and explain your choice as if you were a weather presenter on an all-crypto cable network.',
    'Run one heartbeat tick for my latest token and narrate the outcome as a sports commentator calling the final lap of a night race.',
  ],
};

const HEARTBEAT_TUNE_INTERVAL: SuggestionChip = {
  label: 'Tune heartbeat interval',
  prompts: [
    'Set the heartbeat interval to 30 seconds for my latest token.',
    'Crank the heartbeat interval down to 15 seconds on my latest token for maximum chaos.',
    'Relax the heartbeat interval to 90 seconds for my latest token and call it a retirement pace.',
  ],
};

const STATUS_DEPLOYED_TOKENS: SuggestionChip = {
  label: 'Show deployed tokens',
  prompts: [
    'What tokens have you deployed so far?',
    'Give me a roll-call of every token the Memind has birthed into existence.',
    'List my deployed tokens and rank them by how chaotic their lore is.',
    'Summarise every token you have launched, in the style of a museum tour guide.',
  ],
};

const LAUNCH_CHIPS: readonly SuggestionChip[] = [
  LAUNCH_WILD_MEME,
  LAUNCH_BNB_TRIBUTE,
  LAUNCH_LEGENDARY_SAGA,
];

const ORDER_CHIPS: readonly SuggestionChip[] = [
  ORDER_SHILL_MY_TOKEN,
  ORDER_PITCH_TO_BNB,
  ORDER_LORE_FLAVOUR,
];

const HEARTBEAT_CHIPS: readonly SuggestionChip[] = [
  HEARTBEAT_START_TICKING,
  HEARTBEAT_RUN_ONE_TICK,
  HEARTBEAT_TUNE_INTERVAL,
];

const GLOBAL_CHIPS: readonly SuggestionChip[] = [
  LAUNCH_WILD_MEME,
  ORDER_SHILL_MY_TOKEN,
  HEARTBEAT_START_TICKING,
  STATUS_DEPLOYED_TOKENS,
];

export function chipsForScope(scope: BrainChatScope): readonly SuggestionChip[] {
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

/**
 * Pick a random prompt from a chip's pool at call time. Exported so tests
 * can pin the range invariant (result is always a member of the pool)
 * without mounting the component.
 */
export function pickRandomPrompt(chip: SuggestionChip): string {
  if (chip.prompts.length === 0) return chip.label;
  const idx = Math.floor(Math.random() * chip.prompts.length);
  return chip.prompts[idx] ?? chip.label;
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
          key={chip.label}
          type="button"
          onClick={() => onPick(pickRandomPrompt(chip))}
          className="rounded-[var(--radius-card)] border border-border-default bg-bg-surface px-3 py-1.5 text-left font-[family-name:var(--font-mono)] text-[11px] text-fg-secondary transition-colors hover:border-accent hover:text-fg-primary"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
