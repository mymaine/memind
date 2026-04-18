---
summary: 'Runbook for recording the 2-3 minute Four.Meme AI Sprint demo video (AC5).'
read_when:
  - Before starting a demo recording session
  - After any change that could affect the dashboard flow
  - When triaging a mid-recording failure
status: active
---

# Demo Recording Runbook

This is the step-by-step script for producing the submission video that satisfies AC5. One operator, one screen, one take.

## 0. Pre-flight checklist

Verify every item before you hit record. A missing item mid-take burns 2-3 minutes of re-take time.

### Environment

- [ ] `.env.local` in repo root contains all of:
  - `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`)
  - `AGENT_WALLET_PRIVATE_KEY` (Base Sepolia, ≥ $1 USDC + small ETH for gas)
  - `BSC_DEPLOYER_PRIVATE_KEY` (BSC mainnet, ≥ 0.01 BNB)
  - `GOOGLE_API_KEY` (Gemini 2.5 Flash Image)
  - `PINATA_JWT`
  - `X_API_KEY` / `X_API_KEY_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` (needed only for the Heartbeat segment to do a real tweet; otherwise dry-run)
- [ ] `CREATOR_DRY_RUN` is **unset** or `false` (the whole point of the demo is the Creator running for real)
- [ ] Optional AC3 layer 2: set `ANCHOR_ON_CHAIN=true` iff `BSC_DEPLOYER_PRIVATE_KEY` holds real BNB (~0.01 BNB extra per anchor). With the flag off, the Anchor Evidence panel still surfaces layer-1 keccak256 commitments; with it on, each row also links to a BscScan memo tx.
- [ ] Node.js 20+, pnpm installed, `pnpm install` run at least once this session

### Network + balances

- [ ] BSC mainnet wallet balance: `cast balance <deployer-addr> --rpc-url https://bsc-dataseed.binance.org/` ≥ 0.01 BNB
- [ ] Base Sepolia USDC balance (agent wallet): ≥ 1 USDC — check on basescan.org/address/...
- [ ] Pinata reachable: `curl -H "Authorization: Bearer $PINATA_JWT" https://api.pinata.cloud/data/testAuthentication` returns 200
- [ ] OpenRouter reachable: `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models` returns 200

### Services

- [ ] Start server in one terminal: `pnpm --filter @hack-fourmeme/server dev`
- [ ] Start web in another terminal: `pnpm --filter @hack-fourmeme/web dev`
- [ ] Open http://localhost:3000 in Chrome — **fullscreen**, DevTools **closed**
- [ ] Force the browser viewport to 1920x960: Chrome DevTools → Toggle device toolbar → Responsive → set 1920x960. Leave DevTools open in the secondary monitor if you need to keep an eye on console errors.

### Recording setup

- [ ] Recorder: QuickTime Screen Recording or OBS Studio
- [ ] Output: 1920x1080 @ 60fps (the page is 1920x960 so there's a 120px bottom strip; let it crop)
- [ ] Audio: no voice-over. Sponsor rubric values the visuals; narration is optional.
- [ ] Close Slack, Mail, and any notification source. Set macOS to "Do Not Disturb".

---

## 1. Shot script (target length 2:30 ± 0:20)

Rehearse once before recording. Single take — no cuts unless a hard failure triggers the degrade plan.

### 0:00 – 0:10 · Opening: architecture + one-prompt input

- Page idle. Header + empty architecture diagram (all nodes `idle`) in view.
- Click the first preset button ("Shiba Astronaut on Mars building a moon colony").
- Click **Run swarm**.

> _Expected visuals_: all 3 architecture nodes visible; ThemeInput shows the preset text; Run button transitions to `Running…`.

### 0:10 – 0:40 · Creator agent running

- Left column (`creator`) starts filling with logs: `narrative_generator` → `meme_image_creator` → `onchain_deployer` → `lore_writer`.
- ToolCallBubble spinners appear and complete per tool.
- Creator node in the architecture diagram pulses with accent emerald.
- `bsc-token` pill and `token-deploy-tx` pill light up in the on-chain artifacts row.
- Meme image thumbnail appears in the run-view tab row (next to the `3 columns` / `timeline` tabs).

> _Expected visuals_: left column alive with log lines and token-by-token assistant text; 64px meme thumb visible; 2 pills shown.

### 0:40 – 1:20 · Narrator + Market-maker + x402 settlement

- Middle column (`narrator`) fills: `extend_lore` tool call, lore chapter CID.
- Right column (`market-maker`) fills: `check_token_status` → `x402_fetch_lore`.
- Bottom edge of the architecture diagram glows gold for ~3.6 seconds (the x402 flow animation) the moment the `x402-tx` artifact arrives.
- `lore-cid` and `x402-tx` pills light up; artifact row now shows 4-5 pills.

> _Expected visuals_: all 3 agent nodes done (emerald border), gold edge pulse, full pill row populated.

### 1:20 – 1:30 · Anchor Evidence (AC3)

- Click the `Anchor Evidence — AC3` header to expand the panel.
- Point at the row(s): the chapter label, contentHash short form, and timestamp are visible. If `ANCHOR_ON_CHAIN=true` was set pre-flight, each row also shows a `bsc-mainnet` BscScan link; hover one to reveal the full tx hash tooltip.
- Collapse the panel again so the single-screen layout stays clean for the Timeline segment.

> _Expected visuals_: `N anchors · M on-chain · click to expand` in the header, one row per narrator chapter when expanded.

### 1:30 – 1:40 · Timeline view

- Click the `timeline` tab.
- Scroll slowly (or stay still if no scroll needed — the V2-P4 view is bounded to 200 events).
- Point (hover) at a tool-use bubble, a transfer card (x402), and a meme thumbnail so the viewer sees what each event type looks like.

> _Expected visuals_: the run rendered as a chronological narrative — agent speech bubbles, tool chips, transfer cards.

### 1:40 – 2:10 · Heartbeat segment

- Click the `3 columns` tab to go back.
- Scroll down (or expand in place — heartbeat section is collapsed by default) and click the Heartbeat header to expand.
- Copy the BSC token address from the `bsc-token` pill. Paste it into the heartbeat tokenAddress input.
- Click **Run heartbeat**.
- The panel shows `01 / 03 ticks` → `02 / 03 ticks` → `03 / 03 ticks`, ~10 seconds between ticks.
- Decision tree fills: `#01 check_status → post — <reason>`, etc.
- TweetFeed shows the posted tweets (or `(dry-run)` labels if no X credit is loaded).

> _Expected visuals_: tick counter progressing, decision rows populating, at least one tweet card rendered.

### 2:10 – 2:25 · X page cutaway (optional — skip if X credit not loaded)

- Alt-tab to the X / Twitter tab you pre-opened on the agent's profile.
- Scroll to the most recent post. Show the tweet with the token address / bscscan link.
- Alt-tab back to the dashboard.

> _Degrade_: if X credit is not loaded, skip this shot. The TweetFeed in the heartbeat panel with `(dry-run)` labels is acceptable per AC7 fallback.

### 2:25 – 2:40 · Closing — pill row + architecture recap

- Scroll back up to the top of the page.
- Hover each of the 5 on-chain artifact pills so the cursor highlights them.
- Let the architecture diagram loop one more x402 animation (or trigger it by running again — avoid re-run to keep the take short; a natural long-hold is fine).
- End on the full page view with all pills lit.

---

## 2. Degrade plans

Run order: detect failure → stop recording → apply degrade → start fresh take. Do **not** attempt mid-take rescue.

| Failure                                                  | Symptom                                                            | Degrade                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinata upload timeout                                    | Meme thumbnail shows the `upload-failed` placeholder               | Keep rolling — the placeholder card with the prompt is on spec (AC-V2-2). Do not re-take for this.                                                                                                                                                                                                 |
| X API credit unloaded                                    | Heartbeat TweetFeed shows `(dry-run)`                              | Skip the X cutaway shot (2:10-2:25) and let the `(dry-run)` TweetFeed carry the segment. Video stays under 2:40.                                                                                                                                                                                   |
| Creator `onchain_deployer` failure (BNB gas / RPC flake) | Left column shows red `error` log, bsc-token pill never lights     | Stop recording. Switch to dry-run: `export CREATOR_DRY_RUN=true DEMO_TOKEN_DEPLOY_TX=<recent-good-tx> DEMO_CREATOR_LORE_CID=<recent-good-cid>`. Re-record from 0:00. Mention in README that the video was captured with the dry-run fallback for the Creator segment due to transient RPC failure. |
| OpenRouter 429 / stream chop                             | All 3 columns stall, no log lines for 15s+                         | Stop recording. Wait 2 minutes. Re-start server / web. Re-record.                                                                                                                                                                                                                                  |
| Base Sepolia settlement failure                          | `x402-tx` pill never lights, right column log shows 402 retry loop | Check agent wallet USDC balance. Top up from faucet. Re-record.                                                                                                                                                                                                                                    |

## 3. Recording tooling details

### QuickTime

- File → New Screen Recording → click the dropdown → select "Record Entire Screen"
- Start recording → click the browser window to capture → perform the shot script → Cmd+Ctrl+Esc to stop
- Trim leading/trailing dead air in QuickTime's built-in trim view

### OBS Studio (better quality, more setup)

- Scene: single "Display Capture" source aimed at the primary display
- Output: 1920x1080 @ 60fps, CBR 6000 kbps H.264, MP4 container
- Hotkey Start/Stop: F9 / F10 so your hands don't leave the browser mid-take

## 4. Post-production

- **Do not cut** unless you blew a take (hard failure above). Sponsor rubric rewards "real demo" vibes. A single-take with dead air reads more authentic than 5 jump-cuts.
- If cuts are unavoidable, only cut at dead air (mouse-still for ≥ 1s).
- **No text overlays** — the dashboard's own labels are sufficient.
- **No background music** — silence or soft room tone only.
- Export: H.264 MP4, 1920x1080, < 200 MB (YouTube/Loom comfort range).

## 5. Upload + Dorahacks submission

- Upload to YouTube as unlisted or Loom. Copy the shareable link.
- Add the link to the README `## Demo video` section.
- Verify the README link opens the video in an incognito window (no auth wall).
- Final Dorahacks submission field: paste the same video link in the Pitch Video field.

---

## Appendix: Pre-recorded fallback assets

Keep these on hand in case the live take cannot be rescued:

- `docs/archive/demo-captures/`: the most recent successful BSC tx hashes + Pinata CIDs for a clean dry-run take.
- `docs/archive/x-screenshots/`: historical screenshots of the agent's X timeline (for use only if the live X cutaway fails and the dry-run TweetFeed alone is not sufficient).

Do not create these directories eagerly — they are only created when a real recording failure forces a fallback.
