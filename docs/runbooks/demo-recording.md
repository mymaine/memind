---
summary: 'Runbook for recording the 2-3 minute Four.Meme AI Sprint demo video (AC5 + AC-P4.6-5). Phase 4.6 shilling take is the primary narrative; Phase 4.5 a2a take is retained as a backup.'
read_when:
  - Before starting a demo recording session
  - After any change that could affect the dashboard or the shill-market flow
  - When triaging a mid-recording failure
status: active
---

# Demo Recording Runbook

This is the step-by-step script for producing the submission video. One operator, one screen, one take.

**Primary take** (this runbook's main content): Phase 4.6 — _Creator Promotion Service Market_. Creator pays an AI shiller 0.01 USDC; shiller reads the lore and posts a real promotional tweet from its own aged X account. ~100 seconds, one cut.

**Backup take** (see appendix): Phase 4.5 — _agent-to-agent commerce_ (Creator → Narrator → Market-maker reads lore via x402). Use only if the shilling take cannot be recovered (X API outage, Base Sepolia stalled ≥ 15 min, etc.).

---

## 1. Main take — Phase 4.6 Shilling Market (AC-P4.6-5)

### 1.1 Pre-flight checklist (T-30 min)

Verify every item before you hit record. A missing item mid-take burns 2-3 minutes of re-take time.

#### Environment — `.env.local`

- [ ] `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`)
- [ ] `AGENT_WALLET_PRIVATE_KEY` (Base Sepolia, ≥ 0.05 USDC + small ETH for gas — enough for 5+ shill orders at 0.01 USDC each)
- [ ] `BSC_DEPLOYER_PRIVATE_KEY` (BSC mainnet, ≥ 0.01 BNB, only needed if you re-deploy a fresh demo token)
- [ ] `GOOGLE_API_KEY` (Gemini 2.5 Flash Image)
- [ ] `PINATA_JWT`
- [ ] `X_API_KEY` / `X_API_KEY_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` — **required for the shilling segment**; the whole point is a real tweet from the Shiller's aged account
- [ ] X API pay-per-usage credit loaded: ≥ $5 balance on the developer portal (covers ~500 $0.01 posts)
- [ ] `CREATOR_DRY_RUN` is **unset** or `false` if you plan to redeploy; otherwise reuse an existing demo token via `DEMO_TOKEN_ADDR`
- [ ] Node.js 20+, pnpm installed, `pnpm install` run at least once this session

#### Demo token — pick one and commit to it

- [ ] Option A — **reuse the validated fallback token**: `DEMO_TOKEN_ADDR=0x4E39d254c716D88Ae52D9cA136F0a029c5F74444` (same address baked in as `DEFAULT_DEMO_TOKEN_ADDR` across all three `demos/demo-*.ts` CLIs). Fastest path.
- [ ] Option B — **deploy a fresh token on the day**: `pnpm --filter @hack-fourmeme/server demo:creator` → capture the printed `bsc-token` address → set `export DEMO_TOKEN_ADDR=0x<fresh>`. Do this at T-60 min so the lore chain has time to settle.
- [ ] Whichever you pick, echo once in the terminal you will record from so the env is visible on-screen if you cut to terminal: `echo "$DEMO_TOKEN_ADDR"`

#### Shiller X account warm-up (critical — X anti-spam)

- [ ] Log into the Shiller's aged X account in a regular browser tab (not an incognito window — OAuth tokens are already baked into `.env.local`, the tab is only for visual warm-up and the final cutaway shot)
- [ ] Scroll the timeline for 3-5 minutes. Like 1-2 posts. **Do not** go from zero activity straight into an API-driven post — unusual patterns trigger shadow bans on aged accounts.
- [ ] Open the account's profile page in a pinned tab; you will alt-tab to it at t=70s in the shot script.

#### Network + balances

- [ ] BSC mainnet RPC ping: `curl -s -X POST https://bsc-dataseed.binance.org/ -H "content-type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'` returns a block number
- [ ] BSC mainnet wallet balance: `cast balance <deployer-addr> --rpc-url https://bsc-dataseed.binance.org/` ≥ 0.01 BNB (only if deploying a fresh token)
- [ ] Base Sepolia agent wallet USDC balance ≥ 0.05 USDC — check on sepolia.basescan.org/address/...
- [ ] Pinata reachable: `curl -H "Authorization: Bearer $PINATA_JWT" https://api.pinata.cloud/data/testAuthentication` returns 200
- [ ] OpenRouter reachable: `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models | head -c 200` returns JSON

#### End-to-end dry-run (must finish ≤ 15s)

- [ ] Dry-run the whole shilling flow without burning real X credit or USDC:
  ```
  SHILL_DRY_RUN=true pnpm --filter @hack-fourmeme/server demo:shill -- --token "$DEMO_TOKEN_ADDR"
  ```
  (Equivalent to passing `--dry-run`.) If this does not complete inside ~15 seconds the live take will be too slow — investigate before going live.
- [ ] Heartbeat / Shiller tick cadence: the Shiller agent is the Heartbeat runtime with the shill persona. Default `HEARTBEAT_INTERVAL_MS=60000` (60s) is **too slow** for a 100s take. Export a demo-only override before starting the server:
  ```
  export HEARTBEAT_INTERVAL_MS=3000   # 3s between ticks; 5000 also works
  ```
  This is read by `apps/server/src/config.ts` (lines 58-59) and flows through `runs/heartbeat-runner.ts`. Reset to unset / 60000 after recording. **Do not** commit the override to `.env.local`.

#### Services

- [ ] Start server in terminal A: `pnpm --filter @hack-fourmeme/server dev` (with `HEARTBEAT_INTERVAL_MS=3000` exported)
- [ ] Start web in terminal B: `pnpm --filter @hack-fourmeme/web dev`
- [ ] Open `http://localhost:3000/market` in Chrome — **fullscreen**, DevTools **closed**
- [ ] Force viewport 1920x960: Chrome DevTools → Toggle device toolbar → Responsive → 1920x960. Leave DevTools on the secondary monitor if you want to watch console errors.
- [ ] Pre-open these tabs (they will be alt-tabbed to during the take):
  - Tab 1: `http://localhost:3000/market` (primary)
  - Tab 2: `http://localhost:3000` (Phase 4.5 dashboard — used for the creator phase and the closing Heartbeat recap)
  - Tab 3: Shiller X profile page

#### Recording setup

- [ ] Recorder: QuickTime Screen Recording or OBS Studio
- [ ] Output: 1920x1080 @ 60fps (the page is 1920x960 so there is a 120px bottom strip; let it crop)
- [ ] Audio: no voice-over. Sponsor rubric values the visuals; narration is optional.
- [ ] Close Slack, Mail, Discord. macOS → Do Not Disturb.

### 1.2 Shot script — ~100 seconds, one cut

Rehearse once before recording. Target ≤ 2:00; ideal 1:40.

#### 0:00 – 0:10 · Opening title + 32k spam framing

- **Tab**: any title slide tool or a static browser tab showing a pre-rendered title card.
- **Visual**: large text — _"Four.meme launched 32,000 tokens in a single day of October 2025."_ Background: the Four.meme explorer page scrolling past a blur of spam token names.
- **Observation**: set the problem before any product appears. 10 seconds is the full budget — do not linger.

#### 0:10 – 0:18 · Transition — legit creators drown

- **Visual**: single highlighted token name (e.g. `HBNB2026-<today's theme>`) briefly glows gold then gets flooded by the scrolling spam.
- **Text overlay** (optional): _"Legit creators drown before anyone sees them."_
- **Observation**: viewer is now primed for a tool that rescues creators.

#### 0:18 – 0:35 · Creator phase (reuse Phase 4.5 assets)

- **Tab**: switch to `http://localhost:3000` (Tab 2).
- **Action**: click the first preset button (e.g. "Shiba Astronaut on Mars…") → click **Run swarm**.
- **Visual**: Creator column fills — `narrative_generator` → `meme_image_creator` → `onchain_deployer` → `lore_writer`. MemeImageCard renders in the tab row. `bsc-token` + `token-deploy-tx` pills light up.
- **Observation** (what the viewer should see): left column alive with log lines + 64px meme thumb + 2 BSC pills. The token is _real, on BSC mainnet_, gas ~$0.05.

#### 0:35 – 0:50 · Narrator continues lore

- **Action**: let the Narrator column auto-fill. No clicks.
- **Visual**: middle column `extend_lore` tool call → lore chapter CID pill → `lore-cid` pill lights up.
- **Observation**: architecture diagram — Narrator node pulses emerald; streaming delta visible in the log.

#### 0:50 – 0:55 · Transition — "so the creator hires a shiller"

- **Visual**: quick cut to a text card — _"So the creator hires an AI shiller."_ — or simply alt-tab straight to `/market` and let the new panel speak for itself.
- **Observation**: keep this beat ≤ 5s; the payoff is the next 25 seconds.

#### 0:55 – 1:05 · Order the shill — x402 payment

- **Tab**: switch to `http://localhost:3000/market` (Tab 1).
- **Action**:
  1. Click **Order shill for $<SYMBOL>** (the primary CTA on the ShillOrderPanel).
  2. The UI triggers a POST to `/shill/:tokenAddr`; x402 middleware returns 402; the agent wallet signs EIP-3009; Base Sepolia USDC tx settles.
- **Visual**: payment status row shows `402 Payment Required` → `Signing EIP-3009` → `Settled ✓` with a Base Sepolia tx hash pill.
- **Observation**: pay-link pill must have an actual tx hash (not `pending…`) before you move on. If still `pending…` after 5s, **pause** — Base Sepolia sometimes stalls; see degrade plan below.

#### 1:05 – 1:20 · Shiller picks up, posts real tweet

- **Action**: none — wait for the Shiller tick (3-5s with the demo override).
- **Visual**: in the Active Orders panel, the row transitions `queued` → `processing ⚙️` → `done ✓`. A `shill-tweet` artifact appears with the tweet URL pill.
- **Observation**: the tweet text appears inline in the Completed Shills column. Body must lead with `$<SYMBOL>` and must **not** contain `http://` or `bscscan.com` (URL-posts trigger the $0.20 X surcharge — guard is in the tool, but eyeball it anyway).

#### 1:20 – 1:30 · Cutaway to real X tweet

- **Action**: alt-tab to Tab 3 (Shiller X profile). Refresh if needed. Click into the newest post.
- **Visual**: the real tweet on x.com with the token `$<SYMBOL>` visible. Do **not** scroll — stay on the tweet for ~8 seconds so the viewer has time to read it and verify this is a real X post, not a mock.
- **Observation**: this is the money shot for the "Practical Value" rubric line. Spend the time.

#### 1:30 – 1:40 · Heartbeat persistence recap

- **Tab**: alt-tab back to Tab 2 (`http://localhost:3000`).
- **Action**: scroll down to the Heartbeat panel → click the `timeline` tab or the panel header to show prior autonomous ticks.
- **Visual**: the TweetFeed with several prior Heartbeat posts from the same Shiller account (these are the AC7 self-shill tick posts, not today's shill-for-creator tweet).
- **Observation**: demonstrates the agent is _persistent_ — not a one-shot demo. The tick counter and decision rows ("`#N check_status → post — <reason>`") drive this home.

#### 1:40 – 1:50 · Closing title cards

- **Card 1** (3s): _"First agent-to-agent shilling market on Four.meme."_
- **Card 2** (3s): _"Phase 2 of Agentic Mode — shipped in 4 days, solo."_
- **Card 3** (3s): _"Next: multi-shiller competition, quality scoring, reputation."_

### 1.3 Time-axis sanity — matches `docs/features/shilling-market.md`?

The spec's recording script defines these beats. The runbook above adds operator instructions (tab, click, expected pill) but preserves the same time windows:

| spec beat                          | runbook segment                                        | delta                                                                                       |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 0-10s spam opener                  | 1.2 §0:00-0:10                                         | identical                                                                                   |
| 10-18s drown transition            | 1.2 §0:10-0:18                                         | identical                                                                                   |
| 18-35s Creator real run            | 1.2 §0:18-0:35                                         | identical                                                                                   |
| 35-50s Narrator lore               | 1.2 §0:35-0:50                                         | identical                                                                                   |
| 50-55s "hire a shiller" transition | 1.2 §0:50-0:55                                         | identical                                                                                   |
| 55-65s order + pay                 | 1.2 §0:55-1:05                                         | identical (5s earlier start than spec's 55s, same duration)                                 |
| 65-80s Shiller posts               | 1.2 §1:05-1:20                                         | identical                                                                                   |
| 80-92s Heartbeat recap             | 1.2 §1:20-1:30 (compressed by 2s) + §1:30-1:40 (recap) | Heartbeat recap split between X cutaway and dashboard tick view; total dwell time preserved |
| 92-100s closing cards              | 1.2 §1:40-1:50                                         | identical                                                                                   |

Total target: 100-110s. If a take runs > 120s, the slowdown is almost always the Shiller tick; verify `HEARTBEAT_INTERVAL_MS` export before the next attempt.

---

## 2. Dry-run fallback for the shilling segment

If the live take's X or Base Sepolia steps fail, **do not** attempt a mid-take rescue. Stop recording, apply the degrade, start a fresh take.

### 2.1 X API real-post failure

Symptoms: Shiller panel sits on `processing` past 20s; server log shows `[x-post] 401 Unauthorized` / `403 Forbidden` / `429 Too Many Requests` / timeouts.

- **Degrade**: switch the CLI path to dry-run. Kill the server, re-export `SHILL_DRY_RUN=true`, restart:
  ```
  SHILL_DRY_RUN=true pnpm --filter @hack-fourmeme/server dev
  # alternatively, for a pure CLI-only segment (no UI):
  SHILL_DRY_RUN=true pnpm --filter @hack-fourmeme/server demo:shill -- --token "$DEMO_TOKEN_ADDR"
  ```
- **Visual impact**: the ShillOrderPanel still shows orders moving `queued → processing → done` and a `shill-tweet` artifact still appears with a tweet URL pill, but the tweet URL is a deterministic stub (`dry-run/<orderId>`). Skip the §1:20-1:30 X cutaway — the `(dry-run)` label in the panel carries the segment.
- **Note on UI query-param**: the `/market` page does **not** currently read a `?dryRun=1` query parameter. Dry-run must be toggled at the server level (env var above). If the UI grows a toggle later, prefer that.

### 2.2 Base Sepolia settlement delayed > 10 s

Symptoms: payment pill stuck on `pending…`; server log shows `facilitator polling tx <hash>`.

- If < 20s: wait it out; Base Sepolia does occasionally spike. The UI will eventually flip.
- If > 20s: **cut and re-take**. In post, a delayed settlement is usually invisible — but during a live take, the viewer loses the beat. If you already rolled past the payment, note the cut point and splice in the next take's payment beat; match the cut at a full-black frame (alt-tab gap).

### 2.3 Creator phase RPC flake (BSC)

Covered by the Phase 4.5 runbook's `CREATOR_DRY_RUN` fallback (see appendix §A.3). The shilling segment does not depend on a fresh deploy — reuse `DEFAULT_DEMO_TOKEN_ADDR` and skip §0:18-0:35 of the shot script (swap in a pre-recorded 17s creator-phase clip from `docs/archive/demo-captures/` if available, or start the take at §0:35 with a title card bridging _"With a token already launched…"_).

### 2.4 Editing / cut-points

Cuts are cheap at **tab transitions** and **title cards**. Cuts are visible inside a single panel (log streams, pill animations). If you must cut mid-take, do it:

- Before/after §0:50 transition card
- Entering §1:20 X cutaway (alt-tab gives you a natural black frame)
- Between closing cards §1:40-1:50

---

## 3. Recording prohibitions (shilling takes only)

These rules come from `docs/features/shilling-market.md` §"禁止事項（錄影期）" and map directly onto AGENTS.md discipline #3.

- **No URLs in any posted tweet body.** `post_shill_for` strips them, but eyeball it — a tweet with `bscscan.com` costs $0.20 per post and flags the account.
- **Do not post the same `$SYMBOL` twice in the same take.** If you need a second try, pick a different token (or a different take entirely).
- **No `@mention` of unrelated accounts.** The Shiller never replies to or tags strangers; this would trigger X anti-spam.
- **No private keys on screen.** Keep `.env.local` closed. If you must show a terminal, only use one whose scrollback has been cleared.
- **No `CREATOR_DRY_RUN=true` banner in the Creator phase of a "live" take** — if the creator phase is dry-run, acknowledge it in the submission README so the video's framing is honest.

---

## 4. Recording tooling details (shared with backup take)

### QuickTime

- File → New Screen Recording → click the dropdown → select "Record Entire Screen"
- Start recording → click the browser window to capture → perform the shot script → Cmd+Ctrl+Esc to stop
- Trim leading/trailing dead air in QuickTime's built-in trim view

### OBS Studio (better quality, more setup)

- Scene: single "Display Capture" source aimed at the primary display
- Output: 1920x1080 @ 60fps, CBR 6000 kbps H.264, MP4 container
- Hotkey Start/Stop: F9 / F10 so your hands don't leave the browser mid-take

## 5. Post-production

- **Do not cut** unless you blew a take (hard failure above). Sponsor rubric rewards "real demo" vibes. A single-take with dead air reads more authentic than 5 jump-cuts.
- If cuts are unavoidable, only cut at tab transitions or dead air (mouse-still for ≥ 1s).
- **No text overlays** except the opening and closing title cards explicitly called out in §1.2.
- **No background music** — silence or soft room tone only.
- Export: H.264 MP4, 1920x1080, < 200 MB (YouTube/Loom comfort range).

## 6. Upload + Dorahacks submission

- Upload to YouTube as unlisted or Loom. Copy the shareable link.
- Add the link to the README `## Demo video` section.
- Verify the README link opens the video in an incognito window (no auth wall).
- Final Dorahacks submission field: paste the same video link in the Pitch Video field.
- Remember: **after submission, do not edit the README** (AGENTS.md discipline #6 — Dorahacks timestamp lock).

---

## Appendix A — Phase 4.5 a2a backup take (reference only)

Use this take only if the shilling take cannot be recorded (prolonged X API outage, Shiller account suspended, etc.). The narrative is weaker but every AC1-AC7 is already green, so the video is still submission-grade.

### A.1 Pre-flight (delta from §1.1)

Same as §1.1 except:

- `HEARTBEAT_INTERVAL_MS` override is optional (no tick-driven segment in this take)
- `/market` route is not visited
- Shiller X warm-up is not required (the Heartbeat agent can post with `(dry-run)` if needed per AC7 fallback)

### A.2 Shot script (target 2:30 ± 0:20)

Single take — no cuts unless a hard failure triggers the degrade plan.

**0:00 – 0:10 · Opening — architecture + one-prompt input.** Page idle, all 3 architecture nodes `idle`. Click preset → click **Run swarm**.

**0:10 – 0:40 · Creator agent running.** Left column fills with `narrative_generator` → `meme_image_creator` → `onchain_deployer` → `lore_writer`. ToolCallBubble spinners complete per tool. `bsc-token` + `token-deploy-tx` pills light. Meme thumbnail renders.

**0:40 – 1:20 · Narrator + Market-maker + x402 settlement.** Middle column fills `extend_lore`; right column fills `check_token_status` → `x402_fetch_lore`. Bottom edge of the architecture diagram glows gold ~3.6s when `x402-tx` arrives. `lore-cid` + `x402-tx` pills light; artifact row shows 4-5 pills.

**1:20 – 1:30 · Anchor Evidence (AC3).** Click the `Anchor Evidence — AC3` header; point at row(s) showing chapter label, contentHash short form, timestamp. If `ANCHOR_ON_CHAIN=true` was set pre-flight, show the BscScan link. Collapse again.

**1:30 – 1:40 · Timeline view.** Click `timeline` tab. Hover a tool-use bubble, a transfer card (x402), a meme thumbnail.

**1:40 – 2:10 · Heartbeat segment.** Back to `3 columns` tab. Expand Heartbeat header. Paste BSC token addr from `bsc-token` pill. Click **Run heartbeat**. Tick counter `01/03 → 02/03 → 03/03` (~10s apart at default interval). Decision rows populate. TweetFeed shows posts (or `(dry-run)` labels).

**2:10 – 2:25 · X cutaway (optional).** Alt-tab to Shiller X profile. Show the latest post. Alt-tab back.

**2:25 – 2:40 · Closing — pill row + architecture recap.** Scroll to top. Hover each of the 5 on-chain artifact pills. Let the architecture animation loop once. End on full page view.

### A.3 Degrade plans (Phase 4.5)

| Failure                                                  | Symptom                                                            | Degrade                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinata upload timeout                                    | Meme thumbnail shows the `upload-failed` placeholder               | Keep rolling — the placeholder card with the prompt is on spec (AC-V2-2). Do not re-take.                                                                                                                                                                                                          |
| X API credit unloaded                                    | Heartbeat TweetFeed shows `(dry-run)`                              | Skip the X cutaway (2:10-2:25) and let the `(dry-run)` TweetFeed carry the segment.                                                                                                                                                                                                                |
| Creator `onchain_deployer` failure (BNB gas / RPC flake) | Left column shows red `error` log, `bsc-token` pill never lights   | Stop recording. Switch to dry-run: `export CREATOR_DRY_RUN=true DEMO_TOKEN_DEPLOY_TX=<recent-good-tx> DEMO_CREATOR_LORE_CID=<recent-good-cid>`. Re-record from 0:00. Mention in README that the video was captured with the dry-run fallback for the Creator segment due to transient RPC failure. |
| OpenRouter 429 / stream chop                             | All 3 columns stall, no log lines for 15s+                         | Stop recording. Wait 2 minutes. Re-start server / web. Re-record.                                                                                                                                                                                                                                  |
| Base Sepolia settlement failure                          | `x402-tx` pill never lights, right column log shows 402 retry loop | Check agent wallet USDC balance. Top up from faucet. Re-record.                                                                                                                                                                                                                                    |

## Appendix B — Pre-recorded fallback assets

Keep these on hand in case neither the shilling take nor the a2a take can be rescued:

- `docs/archive/demo-captures/`: the most recent successful BSC tx hashes + Pinata CIDs for a clean dry-run take.
- `docs/archive/x-screenshots/`: historical screenshots of the Shiller's X timeline (for use only if both live X cutaway and dry-run TweetFeed are insufficient).

Do not create these directories eagerly — they are only created when a real recording failure forces a fallback.
