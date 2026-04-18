/**
 * Pure rendering helpers: map an Artifact discriminated union to display
 * primitives the TxList pill renders. Kept free of React so it is trivially
 * unit-testable and reusable if we ever need a non-pill artifact surface.
 *
 * Chain color CSS vars match apps/web/src/app/globals.css:
 *   --color-chain-bnb  (#F0B90B)
 *   --color-chain-base (#0052FF)
 *   --color-chain-ipfs (#818cf8)
 *   --color-accent     (#00d992)  — fallback for chains with no dedicated token
 */
import type { Artifact } from '@hack-fourmeme/shared';

export interface ArtifactDisplay {
  /** Short chain / network label shown inline (e.g. 'BSC', 'BASE', 'IPFS', 'X'). */
  chainLabel: string;
  /** CSS custom property name to use for the border / chain label color. */
  chainColorVar: string;
  /** Main text shown after the chain label (short hash / handle / tweet id). */
  primaryText: string;
  /** Destination URL opened when the pill is clicked. */
  href: string;
  /** Human description of the artifact kind for the hover tooltip. */
  kindLabel: string;
}

/** Truncate a hash-like string to `head…tail` while preserving readability. */
function shortHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}..${value.slice(-tail)}`;
}

export function describeArtifact(a: Artifact): ArtifactDisplay {
  switch (a.kind) {
    case 'bsc-token':
      return {
        chainLabel: 'BSC',
        chainColorVar: '--color-chain-bnb',
        primaryText: `BSC ${shortHash(a.address)}`,
        href: a.explorerUrl,
        kindLabel: a.label ?? 'four.meme token',
      };
    case 'token-deploy-tx':
      return {
        chainLabel: 'BSC',
        chainColorVar: '--color-chain-bnb',
        primaryText: `BSC ${shortHash(a.txHash)}`,
        href: a.explorerUrl,
        kindLabel: a.label ?? 'deploy tx',
      };
    case 'lore-cid': {
      const chapter = a.chapterNumber ? ` #${a.chapterNumber}` : '';
      const kindLabel =
        a.label ?? (a.author === 'narrator' ? `narrator chapter${chapter}` : 'creator lore');
      return {
        chainLabel: 'IPFS',
        chainColorVar: '--color-chain-ipfs',
        primaryText: `IPFS ${shortHash(a.cid, 6, 4)}`,
        href: a.gatewayUrl,
        kindLabel,
      };
    }
    case 'x402-tx':
      return {
        chainLabel: 'BASE',
        chainColorVar: '--color-chain-base',
        primaryText: `BASE ${shortHash(a.txHash)}`,
        href: a.explorerUrl,
        kindLabel: a.label ?? `x402 · ${a.amountUsdc} USDC`,
      };
    case 'tweet-url': {
      // No dedicated chain color token for X; the emerald accent reads as a
      // "signal" rather than a chain, which matches "tweet fired off" semantics
      // better than repurposing an unrelated chain hue.
      const tail = a.tweetId.slice(-6);
      return {
        chainLabel: 'X',
        chainColorVar: '--color-accent',
        primaryText: `X #${tail}`,
        href: a.url,
        kindLabel: a.label ?? 'tweet',
      };
    }
  }
}
