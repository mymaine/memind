import { describe, it, expect } from 'vitest';
import {
  BRAND_NAME,
  BRAND_TAGLINE,
  HERO_PITCH_HOME,
  HERO_SUBCOPY_HOME,
  HERO_CTA_PRIMARY,
  HERO_CTA_SECONDARY,
  HERO_PITCH_MARKET,
  HERO_SUBCOPY_MARKET,
  HERO_TWEET_SAMPLE,
  PROBLEM_HEADLINE,
  PROBLEM_SUBCOPY,
  SOLUTION_STEPS,
  VISION_TAKERATE,
  VISION_SKUS,
  PHASE_MAP,
  EVIDENCE_ARTIFACTS,
  STATS_BADGES,
} from './narrative-copy';

/**
 * Snapshot + structural assertions for the marketing copy single source of
 * truth. Any copy edit must show up as a snapshot diff so a human reviewer
 * signs off before it ships; the structural assertions guard against silent
 * drift on the load-bearing artifact / phase / CTA shapes.
 */

describe('narrative-copy', () => {
  it('matches the committed snapshot (any copy change requires explicit review)', () => {
    expect({
      BRAND_NAME,
      BRAND_TAGLINE,
      HERO_PITCH_HOME,
      HERO_SUBCOPY_HOME,
      HERO_CTA_PRIMARY,
      HERO_CTA_SECONDARY,
      HERO_PITCH_MARKET,
      HERO_SUBCOPY_MARKET,
      HERO_TWEET_SAMPLE,
      PROBLEM_HEADLINE,
      PROBLEM_SUBCOPY,
      SOLUTION_STEPS,
      VISION_TAKERATE,
      VISION_SKUS,
      PHASE_MAP,
      EVIDENCE_ARTIFACTS,
      STATS_BADGES,
    }).toMatchSnapshot();
  });

  // ─── EVIDENCE_ARTIFACTS ────────────────────────────────────────────────────

  describe('EVIDENCE_ARTIFACTS', () => {
    it('contains exactly 5 fixed demo-proof artifacts', () => {
      expect(EVIDENCE_ARTIFACTS).toHaveLength(5);
    });

    it('generates explorerUrls that point at the matching chain gateway', () => {
      for (const a of EVIDENCE_ARTIFACTS) {
        if (a.chain === 'bsc-mainnet') {
          expect(a.explorerUrl.startsWith('https://bscscan.com/')).toBe(true);
        } else if (a.chain === 'ipfs') {
          expect(a.explorerUrl.startsWith('https://gateway.pinata.cloud/ipfs/')).toBe(true);
        } else if (a.chain === 'base-sepolia') {
          expect(a.explorerUrl.startsWith('https://sepolia.basescan.org/')).toBe(true);
        }
      }
    });

    it('encodes every on-chain artifact value with its chain-specific shape', () => {
      for (const a of EVIDENCE_ARTIFACTS) {
        if (a.kind === 'cid') {
          expect(a.value.startsWith('Qm')).toBe(true);
          expect(a.value).toHaveLength(46);
        } else {
          expect(a.value.startsWith('0x')).toBe(true);
          // tokens are 20-byte addresses (42 chars incl. 0x); txs are 32-byte hashes (66 chars).
          expect([42, 66]).toContain(a.value.length);
        }
      }
    });
  });

  // ─── PHASE_MAP ─────────────────────────────────────────────────────────────

  describe('PHASE_MAP', () => {
    it('highlights only Phase 2 (the current project)', () => {
      const highlighted = PHASE_MAP.filter((p) => p.highlighted);
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0]?.phase).toBe(2);
    });

    it('uses the "Agent Commerce Primitive" naming, not "Agentic Mode Phase 2"', () => {
      const phase2 = PHASE_MAP.find((p) => p.phase === 2);
      expect(phase2?.name).toContain('Agent Commerce Primitive');
      for (const node of PHASE_MAP) {
        expect(node.name).not.toContain('Agentic Mode Phase 2');
      }
    });

    it('names Phase 1 "Agent Skill Framework" and Phase 3 "Agent Economic Loop"', () => {
      expect(PHASE_MAP.find((p) => p.phase === 1)?.name).toContain('Agent Skill Framework');
      expect(PHASE_MAP.find((p) => p.phase === 3)?.name).toContain('Agent Economic Loop');
    });
  });

  // ─── HERO_TWEET_SAMPLE ─────────────────────────────────────────────────────

  describe('HERO_TWEET_SAMPLE', () => {
    it('is a safe mock tweet: $HBNB2026- prefix, no URL, within X length budget', () => {
      expect(HERO_TWEET_SAMPLE).toMatch(/^\$HBNB2026-/);
      expect(HERO_TWEET_SAMPLE).not.toContain('http');
      expect(HERO_TWEET_SAMPLE.length).toBeLessThanOrEqual(240);
    });
  });

  // ─── SOLUTION_STEPS ────────────────────────────────────────────────────────

  describe('SOLUTION_STEPS', () => {
    it('lists Launch / Pay / Shill in order with body copy inside a UI budget', () => {
      expect(SOLUTION_STEPS).toHaveLength(3);
      expect(SOLUTION_STEPS.map((s) => s.title)).toEqual(['Launch', 'Pay', 'Shill']);
      for (const step of SOLUTION_STEPS) {
        expect(step.body.length).toBeLessThanOrEqual(120);
      }
    });
  });

  // ─── VISION_TAKERATE ───────────────────────────────────────────────────────

  describe('VISION_TAKERATE', () => {
    it('exposes three tiers: demoFloor, realWorld, multiSkuTam', () => {
      // Three-tier framing prevents the demo-floor $1.6/d from being read as
      // the business ceiling. Every tier must stay present on the contract.
      expect(VISION_TAKERATE).toHaveProperty('demoFloor');
      expect(VISION_TAKERATE).toHaveProperty('realWorld');
      expect(VISION_TAKERATE).toHaveProperty('multiSkuTam');
    });

    it('encodes the literal demo-floor number ($1.6/d) so judges see the proof, not just the projection', () => {
      expect(VISION_TAKERATE.demoFloor.formula).toContain('$1.6/d');
      expect(VISION_TAKERATE.demoFloor.caption.toLowerCase()).toContain('floor');
    });

    it('frames real-world pricing with $1–5/shill and $117k lower band', () => {
      // Accept either the en-dash or the ASCII hyphen form of the price range
      // so future copy tweaks do not silently drop the bracket.
      expect(VISION_TAKERATE.realWorld.formula).toMatch(/\$1[–-]5/);
      expect(VISION_TAKERATE.realWorld.result).toContain('$117k');
    });

    it('lists four SKUs in multi-SKU TAM summing to a ~$2M/y headline', () => {
      expect(VISION_TAKERATE.multiSkuTam.breakdown).toHaveLength(4);
      const skus = VISION_TAKERATE.multiSkuTam.breakdown.map((row) => row.sku);
      expect(skus).toEqual(['Shill', 'Launch Boost', 'Community Ops', 'Alpha Feed']);
      expect(VISION_TAKERATE.multiSkuTam.total).toContain('$2M');
    });
  });
});
