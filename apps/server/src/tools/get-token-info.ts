/**
 * get_token_info — authoritative aggregator for token facts.
 *
 * Why this tool exists: prior to this, every persona that mentioned a token
 * in its output (shiller tweet, narrator chapter, heartbeat decision) had to
 * either trust whatever the LLM guessed from context or fall back to reading
 * lore prose and "inferring" a ticker. Both paths hallucinate — a single run
 * produced `$BONIN` from lore text when the real on-chain symbol was
 * `HBNB2026-HKAT`. `get_token_info` closes that gap by returning three
 * independent strands a persona might need:
 *   - identity : ERC-20 name / symbol / decimals / totalSupply (from chain)
 *   - narrative: chapter chain from LoreStore (the legitimate IPFS cache)
 *   - market   : curve progress / holder count / market cap (opt-in; slow)
 *
 * SOLID single responsibility: the factory ONLY composes the three readers;
 * it never computes fallbacks when a strand fails. Identity failure propagates
 * as an error — the caller's system prompt tells the LLM to stop generating
 * content. Narrative emptiness is a legitimate state (a freshly-deployed
 * token with no chapters yet) and surfaces as `{ totalChapters: 0, ... }`.
 *
 * The three strands run in parallel via `Promise.all` when all three are
 * requested — they share no data dependencies, so RPC and pg round-trips
 * compress to the slowest single call.
 */
import { z } from 'zod';
import { createPublicClient, http, type Chain, type PublicClient, type Transport } from 'viem';
import { bsc } from 'viem/chains';
import type { AgentTool } from '@hack-fourmeme/shared';
import type { LoreStore } from '../state/lore-store.js';
import type { TokenIdentityReader } from '../state/token-identity-reader.js';
import { marketStateSchema, readMarketState } from './token-status.js';

// Truncate the latest chapter to this many chars so the LLM context cost
// stays bounded. 2000 chars fits any tweet or short chapter in full and
// clamps runaway 10k-char chapters without losing the opening.
const LATEST_CHAPTER_CHAR_CAP = 2000;
// Per-chapter "first line" preview for the summaries array. 120 chars reads
// cleanly on a single UI line and gives the LLM enough signal to pick one.
const CHAPTER_FIRST_LINE_CHAR_CAP = 120;

export const getTokenInfoInputSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // `include` is itself optional so the LLM can call the tool with just a
  // tokenAddr and get the most common strands (identity + narrative). The
  // object-level `.default({})` runs BEFORE the inner `.default(...)`
  // calls, letting zod populate each field individually.
  include: z
    .object({
      identity: z.boolean().default(true),
      narrative: z.boolean().default(true),
      market: z.boolean().default(false),
    })
    .default({}),
});
// Expose the CALLER-facing (input) type so test callers and the Brain-side
// tool-use schema can supply a partial shape and let zod fill in the
// defaults. The execute path re-parses via `getTokenInfoInputSchema.parse`
// so the runtime still sees the fully-defaulted record.
export type GetTokenInfoInput = z.input<typeof getTokenInfoInputSchema>;

export const getTokenInfoIdentitySchema = z.object({
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  totalSupply: z.string(),
  deployedOnChain: z.boolean(),
});
export type GetTokenInfoIdentity = z.infer<typeof getTokenInfoIdentitySchema>;

export const getTokenInfoNarrativeSchema = z.object({
  totalChapters: z.number().int().nonnegative(),
  latestChapterText: z.string(),
  chapterSummaries: z.array(
    z.object({
      chapterNumber: z.number().int().positive(),
      firstLine: z.string(),
    }),
  ),
});
export type GetTokenInfoNarrative = z.infer<typeof getTokenInfoNarrativeSchema>;

export const getTokenInfoOutputSchema = z.object({
  tokenAddr: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  identity: getTokenInfoIdentitySchema.optional(),
  narrative: getTokenInfoNarrativeSchema.optional(),
  market: marketStateSchema.optional(),
});
export type GetTokenInfoOutput = z.infer<typeof getTokenInfoOutputSchema>;

export const GET_TOKEN_INFO_TOOL_NAME = 'get_token_info';

export interface CreateGetTokenInfoToolOptions {
  /** ERC-20 identity reader. Always required — identity is the anti-hallucination rail. */
  tokenIdentityReader: TokenIdentityReader;
  /** LoreStore for the narrative strand. */
  loreStore: LoreStore;
  /**
   * BSC mainnet JSON-RPC URL. Only used when `publicClient` is not provided
   * AND at least one caller enables the `market` strand. We accept either an
   * rpcUrl or a pre-built client so tests can pass the same viem fake they
   * use for other tools.
   */
  rpcUrl?: string;
  publicClient?: PublicClient;
}

/**
 * Factory that produces the `get_token_info` AgentTool. The tool is a pure
 * composition — it reads from injected dependencies and never writes. Error
 * contract:
 *   - identity failure ⇒ throw (caller's prompt must halt, not fabricate)
 *   - narrative empty  ⇒ return `{ totalChapters: 0, ... }`
 *   - market failure   ⇒ throw (caller opted in; they can retry without)
 */
export function createGetTokenInfoTool(
  options: CreateGetTokenInfoToolOptions,
): AgentTool<GetTokenInfoInput, GetTokenInfoOutput> {
  const { tokenIdentityReader, loreStore } = options;

  // Build a viem client lazily so callers that never opt into `market` pay
  // nothing (the `market: false` default path is the hot case for Brain-
  // side curiosity queries). The factory captures the client once so
  // subsequent market reads share it.
  let cachedMarketClient: PublicClient | undefined = options.publicClient;
  const getMarketClient = (): PublicClient => {
    if (cachedMarketClient !== undefined) return cachedMarketClient;
    if (options.rpcUrl === undefined) {
      throw new Error(
        'get_token_info: market strand requires either `publicClient` or `rpcUrl` in factory options',
      );
    }
    cachedMarketClient = createPublicClient({
      chain: bsc satisfies Chain,
      transport: http(options.rpcUrl) satisfies Transport,
    }) as unknown as PublicClient;
    return cachedMarketClient;
  };

  return {
    name: GET_TOKEN_INFO_TOOL_NAME,
    description:
      'Authoritative token facts — call this before generating any content that mentions a token. ' +
      'Never infer symbol/name/market from lore text. Input: { tokenAddr, include?: { identity?, narrative?, market? } }. ' +
      'Returns identity (on-chain ERC-20 name/symbol/decimals/totalSupply + deployedOnChain), narrative (chapter count + latest chapter prose + first-line summaries from the lore store), and market (curve progress / market cap / holder count; opt-in because it does extra RPC + getLogs). ' +
      'Defaults: identity=true, narrative=true, market=false. The identity.symbol is the ONLY acceptable ticker to mention.',
    // zod `.default()` produces a schema whose input and output types
    // differ; the AgentTool contract takes a single T. We cast to the
    // post-default shape so `execute(input)` sees the defaulted `include`
    // object, matching the lore-extend.ts pattern.
    inputSchema: getTokenInfoInputSchema as unknown as z.ZodType<GetTokenInfoInput>,
    outputSchema: getTokenInfoOutputSchema,
    async execute(input): Promise<GetTokenInfoOutput> {
      const parsed = getTokenInfoInputSchema.parse(input);
      const { tokenAddr } = parsed;
      const wantIdentity = parsed.include.identity;
      const wantNarrative = parsed.include.narrative;
      const wantMarket = parsed.include.market;

      // Three strands run in parallel — any subset enabled shares the same
      // Promise.all so the tool's wall-clock is max(strands), not sum.
      const identityPromise: Promise<GetTokenInfoIdentity | undefined> = wantIdentity
        ? tokenIdentityReader.readIdentity(tokenAddr).then((id) => ({
            symbol: id.symbol,
            name: id.name,
            decimals: id.decimals,
            totalSupply: id.totalSupply,
            deployedOnChain: id.deployedOnChain,
          }))
        : Promise.resolve(undefined);

      const narrativePromise: Promise<GetTokenInfoNarrative | undefined> = wantNarrative
        ? buildNarrative(loreStore, tokenAddr)
        : Promise.resolve(undefined);

      const marketPromise = wantMarket
        ? readMarketState(getMarketClient(), tokenAddr)
        : Promise.resolve(undefined);

      const [identity, narrative, market] = await Promise.all([
        identityPromise,
        narrativePromise,
        marketPromise,
      ]);

      return getTokenInfoOutputSchema.parse({
        tokenAddr,
        ...(identity !== undefined ? { identity } : {}),
        ...(narrative !== undefined ? { narrative } : {}),
        ...(market !== undefined ? { market } : {}),
      });
    },
  };
}

/**
 * Build the narrative strand from the LoreStore. Missing chapters are a
 * legitimate state (token deployed but never narrated) — we surface an empty
 * shape rather than `undefined` so the LLM reads a structural "no lore yet"
 * signal instead of having to infer it from a missing key.
 */
async function buildNarrative(
  loreStore: LoreStore,
  tokenAddr: string,
): Promise<GetTokenInfoNarrative> {
  const chapters = await loreStore.getAllChapters(tokenAddr);
  if (chapters.length === 0) {
    return {
      totalChapters: 0,
      latestChapterText: '',
      chapterSummaries: [],
    };
  }
  const latest = chapters[chapters.length - 1]!;
  const latestChapterText = latest.chapterText.slice(0, LATEST_CHAPTER_CHAR_CAP);
  const chapterSummaries = chapters.map((c) => ({
    chapterNumber: c.chapterNumber,
    firstLine: extractFirstLine(c.chapterText, CHAPTER_FIRST_LINE_CHAR_CAP),
  }));
  return {
    totalChapters: chapters.length,
    latestChapterText,
    chapterSummaries,
  };
}

/**
 * First-line preview: everything up to the first newline, clamped to
 * `maxChars`. When the chapter has no newline we still clamp to `maxChars`
 * so the preview length stays bounded regardless of chapter shape.
 */
function extractFirstLine(text: string, maxChars: number): string {
  const firstNewline = text.indexOf('\n');
  const firstLine = firstNewline >= 0 ? text.slice(0, firstNewline) : text;
  return firstLine.slice(0, maxChars);
}
