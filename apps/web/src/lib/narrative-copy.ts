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

export const VISION_TAKERATE = {
  formula: '32k tokens/d × 1% paid shill × 10 shills/token',
  derivation: '3,200 orders/d × 0.01 USDC × 5% platform fee',
  result: '$1.6/d protocol revenue (conservative)',
} as const;

export interface VisionSku {
  readonly name: 'Shill' | 'Snipe' | 'LP Provisioning' | 'Alpha Feed';
  readonly status: 'shipped' | 'next' | 'roadmap';
  readonly note: string;
}

export const VISION_SKUS = [
  {
    name: 'Shill',
    status: 'shipped',
    note: 'Agent Commerce Primitive (this project)',
  },
  {
    name: 'Snipe',
    status: 'next',
    note: 'Q3 2026',
  },
  {
    name: 'LP Provisioning',
    status: 'roadmap',
    note: 'Q3 2026',
  },
  {
    name: 'Alpha Feed',
    status: 'roadmap',
    note: 'Q4 2026',
  },
] as const satisfies readonly VisionSku[];

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
    name: 'Agent Economic Loop',
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
  '427 tests green',
  'strict TypeScript',
  'AGPL-3.0 open source',
] as const;
