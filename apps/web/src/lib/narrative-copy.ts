/**
 * Single source of truth for every marketing string rendered across the
 * Shilling Market surface (Hero, Problem, Solution, Product, Vision,
 * Evidence scenes + shared Header). Components read from here; editing copy
 * means editing this file, not the component. The companion snapshot test
 * forces a review whenever any constant drifts.
 *
 * No runtime dependencies — constants only, typed narrow via `as const`.
 */

// ─── Brand ──────────────────────────────────────────────────────────────────

export const BRAND_NAME = 'Shilling Market';
export const BRAND_TAGLINE =
  'a creator-to-agent promotion service market on four.meme (pay USDC, get tweets).';

// ─── Hero (Home /) ──────────────────────────────────────────────────────────

export const HERO_PITCH_HOME = 'Pay USDC. Get tweets.';
export const HERO_SUBCOPY_HOME =
  'Your four.meme token is one of 32,000 launched today. Hire an AI shiller to make it heard.';
export const HERO_CTA_PRIMARY = 'Launch a token';
export const HERO_CTA_SECONDARY = 'Already have a token? Order a shill';

// ─── Hero (Market /market) ──────────────────────────────────────────────────

export const HERO_PITCH_MARKET = 'Order a shill.';
export const HERO_SUBCOPY_MARKET =
  'An AI agent reads your lore, writes an on-voice tweet, and posts from its own aged X account. 0.01 USDC per post, paid on-chain via x402. No token yet? ↗ Launch one.';

// TODO: lead will peer-review this sample before P2 ships.
// Promotional mock tweet for the Hero typewriter — curious voice, light
// emoji, not hard-sell. Must stay under 240 chars and contain no URL.
export const HERO_TWEET_SAMPLE =
  '$HBNB2026-NYAN just landed on four.meme and the lore is wilder than I expected — a cat astronaut chasing the last laser pointer across BNB Chain. curious to see who else picks this up. 🐱🚀';

// ─── Problem ────────────────────────────────────────────────────────────────

export const PROBLEM_HEADLINE = '97% of memecoins die within 48 hours.';
export const PROBLEM_SUBCOPY =
  'four.meme absorbed 32,000 new tokens in a single October 2025 day. Legit creators drown in the noise.';

// ─── Solution ───────────────────────────────────────────────────────────────

export interface SolutionStep {
  readonly title: 'Launch' | 'Pay' | 'Shill';
  readonly body: string;
}

export const SOLUTION_STEPS = [
  {
    title: 'Launch',
    body: 'One-line prompt. Creator agent deploys on BSC mainnet in ~67s.',
  },
  {
    title: 'Pay',
    body: '0.01 USDC per shill, settled on-chain via x402 on Base Sepolia.',
  },
  {
    title: 'Shill',
    body: 'Shiller agent reads the lore and posts from its own aged X account.',
  },
] as const satisfies readonly SolutionStep[];

// ─── Vision ─────────────────────────────────────────────────────────────────

/**
 * VISION_TAKERATE — three-tier framing so the 0.01 USDC demo floor is never
 * read as the business ceiling. The on-screen card read is "we deliberately
 * ran the demo at sub-cent settlement to prove x402 micro-payments work;
 * shipped pricing is 100–500x that number, and Shill is just one of four
 * sell-side SKUs the same primitive fans out to".
 *
 * Three layers (rendered as three cards in <VisionScene />):
 *   1. demoFloor    — the literal $0.01 × 5% number that the live demo emits.
 *                     Labelled "floor, not ceiling".
 *   2. realWorld    — marketplace-standard pricing (AI-service $1–5/shill,
 *                     10% take-rate). Conservative assumptions only.
 *   3. multiSkuTam  — four sell-side SKUs (Shill + Launch Boost +
 *                     Community Ops + Alpha Feed) summed into a ~$2M/y
 *                     agent-commerce primitive GMV. The matrix is sell-side
 *                     only — rationale lives in
 *                     docs/decisions/2026-04-19-sku-sell-side-only.md.
 */
export interface VisionTakerateSkuRow {
  readonly sku: string;
  readonly annual: string;
}

export interface VisionTakerate {
  readonly demoFloor: {
    readonly label: string;
    readonly formula: string;
    readonly caption: string;
  };
  readonly realWorld: {
    readonly label: string;
    readonly formula: string;
    readonly result: string;
    readonly caption: string;
  };
  readonly multiSkuTam: {
    readonly label: string;
    readonly breakdown: readonly VisionTakerateSkuRow[];
    readonly total: string;
  };
}

export const VISION_TAKERATE: VisionTakerate = {
  demoFloor: {
    label: 'Demo floor',
    formula: '$0.01/shill × 5% take = $1.6/d · $584/y',
    caption:
      'Sub-cent x402 settlement proves the primitive works at any price point — this is the floor, not the ceiling.',
  },
  realWorld: {
    label: 'Real-world pricing',
    formula: '$1–5/shill × 10% take × 3,200 orders/d',
    result: '$320 – $1,600/d  ($117k – $584k/y)',
    caption:
      'Marketplace-standard take-rate (10–30%) + AI-service pricing (100–500× demo). Shiller keeps 90%.',
  },
  multiSkuTam: {
    label: 'Multi-SKU TAM',
    breakdown: [
      { sku: 'Shill', annual: '$584k/y' },
      { sku: 'Launch Boost', annual: '$800k/y' },
      { sku: 'Community Ops', annual: '$500k/y' },
      { sku: 'Alpha Feed', annual: '$200k/y' },
    ],
    total: '≈ $2M/y agent-commerce primitive GMV',
  },
};

export interface VisionSku {
  readonly name: 'Shill' | 'Launch Boost' | 'Community Ops' | 'Alpha Feed';
  readonly status: 'shipped' | 'next' | 'roadmap';
  readonly note: string;
}

// Naming note: the 4-SKU matrix is sell-side only by design. Do not
// introduce buy-side SKUs here — rationale and the full list of excluded
// categories are fixed in
// docs/decisions/2026-04-19-sku-sell-side-only.md.
export const VISION_SKUS = [
  {
    name: 'Shill',
    status: 'shipped',
    note: 'First persona plugged into the Token Brain · live today',
  },
  {
    name: 'Launch Boost',
    status: 'next',
    note: 'Scheduled launch-window campaign + sentiment-triggered posts · Q2 2026',
  },
  {
    name: 'Community Ops',
    status: 'roadmap',
    note: 'Weekly holder digest + on-demand Q&A from lore · Q2 2026',
  },
  {
    name: 'Alpha Feed',
    status: 'roadmap',
    note: 'Curated signal stream for paying readers · Q3 2026',
  },
] as const satisfies readonly VisionSku[];

// ─── Brain architecture (Vision scene sub-section) ──────────────────────────

/**
 * BRAIN_ARCHITECTURE — data source for the "1 Brain + pluggable personas"
 * sub-section inside <VisionScene />. Renders as a central Brain node
 * radiating to 4 shipped persona ports and 3 greyed-out future persona slots.
 *
 * This is the pitch-layer datum for the Brain positioning locked in
 * docs/decisions/2026-04-19-brain-agent-positioning.md. The code directory
 * still names these "agents"; the product surface names them personas.
 *
 * Claim boundaries (do not overclaim):
 *   - Brain = one Node runtime + one ToolRegistry + one shared memory layer.
 *   - Personas = thin runAgentLoop wrappers (systemPrompt + tool subset).
 *   - Pluggable = Persona<TIn, TOut> interface in packages/shared/src/persona.ts.
 *   - Not AGI, not autonomous-AI-investor, not ERC-8004-onchain-identity (those
 *     are M4+ in docs/decisions/2026-04-18-long-term-brain-agent-society.md).
 */
export interface BrainPersonaPort {
  readonly name: string;
  readonly role: string;
  readonly status: 'shipped' | 'next' | 'roadmap';
}

export interface BrainArchitecture {
  readonly brainLabel: string;
  readonly brainSubtitle: string;
  readonly shippedPersonas: readonly BrainPersonaPort[];
  readonly futureSlots: readonly BrainPersonaPort[];
}

export const BRAIN_ARCHITECTURE: BrainArchitecture = {
  brainLabel: 'Token Brain',
  brainSubtitle: 'One runtime · one memory · pluggable personas',
  shippedPersonas: [
    { name: 'Creator', role: 'writes lore chapter 1 + deploys the token', status: 'shipped' },
    { name: 'Narrator', role: 'continues the lore chapter by chapter', status: 'shipped' },
    {
      name: 'Market-maker / Shiller',
      role: 'pays for alpha lore · posts on-voice tweets for creators',
      status: 'shipped',
    },
    { name: 'Heartbeat', role: 'ticks on its own, decides the next move', status: 'shipped' },
  ],
  futureSlots: [
    { name: 'Launch Boost', role: 'scheduled launch-window campaign', status: 'next' },
    { name: 'Community Ops', role: 'weekly holder digest + Q&A', status: 'roadmap' },
    { name: 'Alpha Feed', role: 'curated signal stream for readers', status: 'roadmap' },
  ],
};

// ─── Phase map ──────────────────────────────────────────────────────────────

export interface PhaseNode {
  readonly phase: 1 | 2 | 3;
  readonly name: string;
  readonly owner: string;
  readonly highlighted: boolean;
}

// Naming note: spec pins Phase 2 as "Agent Commerce Primitive" — the older
// draft called this "Agentic Mode Phase 2"; do not drift back.
export const PHASE_MAP = [
  {
    phase: 1,
    name: 'Agent Skill Framework',
    owner: 'four.meme official (shipped)',
    highlighted: false,
  },
  {
    phase: 2,
    name: 'Agent Commerce Primitive',
    owner: 'this project (live)',
    highlighted: true,
  },
  {
    phase: 3,
    name: 'Brain Society',
    owner: 'future',
    highlighted: false,
  },
] as const satisfies readonly PhaseNode[];

// ─── Evidence (fixed demo proof — do NOT derive from the current run) ───────

export interface EvidenceArtifact {
  readonly chain: 'bsc-mainnet' | 'ipfs' | 'base-sepolia';
  readonly kind: 'token' | 'tx' | 'cid';
  readonly value: string;
  readonly explorerUrl: string;
}

export const EVIDENCE_ARTIFACTS = [
  {
    chain: 'bsc-mainnet',
    kind: 'token',
    value: '0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
    explorerUrl: 'https://bscscan.com/token/0x4E39d254c716D88Ae52D9cA136F0a029c5F74444',
  },
  {
    chain: 'bsc-mainnet',
    kind: 'tx',
    value: '0x760ff53f84337c0c6b50c5036d9ac727e3d56fa4ad044b05ffed8e531d760c9b',
    explorerUrl:
      'https://bscscan.com/tx/0x760ff53f84337c0c6b50c5036d9ac727e3d56fa4ad044b05ffed8e531d760c9b',
  },
  {
    chain: 'ipfs',
    kind: 'cid',
    value: 'QmWoMkPuPekMXp4RwWKenADMi74mqaZRG3fcEuGovATVX7',
    explorerUrl: 'https://gateway.pinata.cloud/ipfs/QmWoMkPuPekMXp4RwWKenADMi74mqaZRG3fcEuGovATVX7',
  },
  {
    chain: 'base-sepolia',
    kind: 'tx',
    value: '0x62e442cc9ccc7f57c843ebcfc52f777f3cd9188b9172583ee4cefa60e5a1c3df',
    explorerUrl:
      'https://sepolia.basescan.org/tx/0x62e442cc9ccc7f57c843ebcfc52f777f3cd9188b9172583ee4cefa60e5a1c3df',
  },
  {
    chain: 'base-sepolia',
    kind: 'tx',
    value: '0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a',
    explorerUrl:
      'https://sepolia.basescan.org/tx/0x4331ff588b541d3a53dcdcdf89f0954e1b974d985a7e79476a04552e9bff000a',
  },
] as const satisfies readonly EvidenceArtifact[];

// ─── Footer ─────────────────────────────────────────────────────────────────

// Shared site-wide footer tagline — surfaces the submission deadline so the
// footer reads the same on Home and Market instead of drifting per-route.
export const FOOTER_TAGLINE = 'Four.Meme AI Sprint · submission 2026-04-22 UTC 15:59';

// ─── Stats badges ───────────────────────────────────────────────────────────

export const STATS_BADGES = [
  '716 tests green',
  'strict TypeScript',
  'AGPL-3.0 open source',
] as const;
