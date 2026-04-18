---
summary: '2026-04-18 decision — overturn the "no X API" hard rule and add agent auto-posting plus a heartbeat loop in Phase 3'
read_when:
  - Before writing Phase 3 heartbeat / X posting code
  - When a reviewer asks why this is a real agent product, not just a demo
  - When X API pricing or policy later changes and we re-evaluate
status: locked
---

# X Posting Agent (overturning the original "no X API" rule)

**Decision date**: 2026-04-18 (end of Phase 2, before Phase 3 kickoff)
**Trigger**: after reviewing 70+ competitor submissions, the "AI takes over an abandoned token" storyline turns out to be the lever that promotes Practical Value (20%) from a weakness to a strength — but only if we add 24/7 always-on capabilities: the agent stays alive, posts regularly, and checks token health.

## Original rule vs. new judgment

| Original AGENTS.md hard rule #3 (2026-04-17) | Revised (2026-04-18)                                            |
| -------------------------------------------- | --------------------------------------------------------------- |
| No X API — 2026-02 paywall is a dead zone    | Conditional go-ahead: tight scope, aged account, precise budget |

## Why we can allow it now

### 1. The 2026 pricing model has changed — no longer a dead zone

The 2025 "X Basic tier $200/month" information is obsolete. Current 2026 regime:

- **Pay-per-usage credit model** (no subscriptions)
- **Content: Create = $0.010 per request** (post a tweet or media)
- **User Interaction: Create = $0.015 per request** (follow / like / RT / reply)
- **Posts: Read = $0.005 per resource**

Source: https://docs.x.com/x-api/getting-started/pricing (pulled from the pricing page after signing into console.x.com).

### 2. Four-day budget estimate (~$3.70 total)

| Purpose                                                    | Count | Unit price | Subtotal   |
| ---------------------------------------------------------- | ----- | ---------- | ---------- |
| Developer manual testing                                   | 50    | $0.010     | $0.50      |
| Integration tests                                          | 30    | $0.010     | $0.30      |
| Demo video NG takes (5 takes × 5 posts)                    | 25    | $0.010     | $0.25      |
| Heartbeat accelerated-mode demo (15s tick × 60s × 5 takes) | ~20   | $0.010     | $0.20      |
| Review-window agent lives (4/23–4/28 × 24 ticks/day)       | ~144  | $0.010     | $1.44      |
| Buffer                                                     | —     | —          | $1.00      |
| **Total**                                                  |       |            | **~$3.70** |

**A $5 top-up covers the entire run.** Idle time costs nothing.

### 3. Rate limits are generous

- User OAuth: **100 posts / 15 min**
- App-only Bearer: 10,000 / 24h

Accelerated demo peak: 15s tick × 60s × 1 post/tick = **4 posts/min = 16 posts / 15 min**, well under the 100 ceiling.

### 4. Shadow-ban risk is neutralized by using an aged account

Original concern: a new account + AI-generated content + high-frequency posting → shadow-banned within 48h → reviewers see a blank account.

Resolution: **use an existing 10+ year-old account** (high trust score; account age is the heaviest signal in X's anti-abuse model). The account already has an organic social graph and historical tweets, so AI-authored posts do not trip the "new account ramps high-frequency" red flag.

## Allowed scope (hard boundaries)

### Permitted

- The agent proactively posts about **its own deployed token** (name / bscscan link / lore fragment)
- The agent reads its own account timeline (to monitor its own tweets' engagement)
- Template library varies emoji and hashtags to avoid pure boilerplate

### Prohibited (no exceptions)

- Spraying @mentions at strangers
- Flooding trending hashtags for reach
- Auto-follow / auto-unfollow on unfamiliar accounts
- Auto-reply or auto-like on other users' tweets
- Cross-account interaction (one agent per account)

### Stretch (only if time permits; OpSec re-reviews the ceiling)

- Listen for @mentions on our own account and reply (User Interaction: Create $0.015/reply)
  - Constraint: only reply to mentions targeting ourselves; never initiate replies under strangers' tweets
  - Extra budget estimate: assume 50 mentions during the review window × $0.015 = $0.75
  - Conservative principle: prefer silence over being classed as spam

## Implementation OpSec discipline

When dispatching agents to implement this, the lead first distills a "technical requirements list" from the public X API docs — OAuth 1.0a vs 2.0 PKCE trade-offs, rate-limit retry strategy, error code handling — and hands that list to the agent. Implementations must be written from scratch from the official docs; no copy-paste from any other source. Directory names, file names, function names, and constants are all chosen fresh for this repo.

## Impact on the demo video

Demo flow upgrade:

```
0–20s:   input theme → Creator agent deploys token (existing)
20–60s:  three agents trade via x402 (existing climax)
60–90s:  heartbeat accelerated mode (15s tick) → dashboard shows agent thinking →
         cut to X page, show real tweet + engagement
90–100s: cut back; show the five on-chain artifacts in sequence
```

The video grows from 90 to 100 seconds with doubled visual density. The X page cut is strong visual proof that makes the "not mocked" claim credible.

## Risks + mitigations

| Risk                                                       | Level  | Mitigation                                                                                                               |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Tweets flagged by X's anti-spam model                      | Medium | Aged account + low frequency (production 1/min) + emoji variance + accelerated-heartbeat demo runs only during recording |
| X policy changes suddenly (pricing / rate / account rules) | Low    | Pay-per-usage has no monthly lock-in; stop using and the loss stops                                                      |
| OpSec leak of external project references in this repo     | Low    | Lead personally reviews every dispatch prompt; lead reviews every file diff before commit                                |
| Six-day review-window runtime crashes                      | Medium | setInterval + error isolation + graceful shutdown; each tick is independent, no shared state                             |

## Rollback conditions

If by end of Phase 3 Day 3 any of the following is true:

- X API changes rules on the spot
- The aged account is shadow-banned (engagement collapses to zero)
- Credit burn rate runs far ahead of budget (e.g. 3x above $0.01/post)

**Rollback path**: cut the X feature; keep only heartbeat + `check_token_status` + `extend_lore`. All agent behavior is shown on the dashboard and the demo video skips the X cut. The Phase 3 core (three-agent swarm + A2A x402) is unaffected.

## Related file changes

| File                                            | Change                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| (internal AGENTS doc, not public)               | Hard rule #3 flipped from "off-limits" to "conditional go-ahead" + X API added to the Startup tech stack              |
| (internal roadmap, not public)                  | Phase 3 expanded from 5 tasks to 7 core + 3 stretch + an OpSec section; AC7 added; four new items in the risk section |
| `.env.example` / `.env.local`                   | Added five X API credential placeholders (API Key / Secret / Access Token / Access Token Secret / Bearer)             |
| `apps/server/package.json` (at Phase 3 kickoff) | Add `twitter-api-v2` or sign OAuth 1.0a directly with `fetch`                                                         |
