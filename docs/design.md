---
summary: 'Terminal Cyber design system — visuals, components, motion, and accessibility rules for the four-agent swarm dashboard'
read_when:
  - Before writing frontend code or UI components
  - When generating new components
  - Before adjusting visuals, motion, or responsive behavior
  - Before recording the demo video (to keep visuals consistent)
status: active
---

# Design System — Four.Meme Agent-as-Creator

> Based on [VoltAgent DESIGN.md](https://getdesign.md/voltagent/design-md) (deep-space terminal + emerald signal) as the foundation, layered with dual-chain semantic color for BNB / Base Sepolia. The visual positioning of the whole artifact: **"the AI-agent engineering terminal at 2 AM"** — no marketing aesthetic, only code and current.

---

## 1. Visual Theme & Atmosphere

**One-line style**: deep-space terminal + electric-green signal + dual-chain semantic color — an AI-agent engineering platform with the feel of a 2 AM IDE.

**Design philosophy**:

- **Code is the hero**: code blocks, tx hashes, and agent logs are first-class content, not decoration
- **Border defines space, not shadow**: hierarchy is expressed through border weight and color (1px Warm Charcoal → 2px Emerald); shadows appear only at the hero / modal level
- **Dense over airy**: heading line-height compressed to 1.0–1.11 with negative letter-spacing; information density wins over whitespace
- **Warm neutrals prevent clinical cold**: borders use `#3d3a39` (warm brown-gray) rather than `#333` (cold neutral) — a club IDE, not a hospital
- **Single accent energy**: Emerald `#00d992` is the only "energized" signal; it is not overused and never fills large backgrounds

**Inspiration / reference products**:

- VoltAgent (AI agent platform, deep space + electric green)
- Vercel CLI + v0.dev dashboard
- Arc browser developer mode
- Warp terminal
- GitHub 2025 Copilot Workspace dark

**Mood keywords**: calm · sharp · technical · alive · dense · nocturnal

---

## 2. Color Palette & Roles

### Core Palette (dark-first; no light mode offered)

| Role             | Token           | Hex                      | Usage                                                   |
| ---------------- | --------------- | ------------------------ | ------------------------------------------------------- |
| `bg-primary`     | Abyss Black     | `#050507`                | Page background, app shell                              |
| `bg-surface`     | Carbon Surface  | `#101010`                | Cards, buttons, log panels, code blocks                 |
| `bg-elevated`    | Surface Raised  | `#181818`                | Base color for modals, dropdowns, tooltips              |
| `border-default` | Warm Charcoal   | `#3d3a39`                | Default border (note: warm brown-gray)                  |
| `border-accent`  | Emerald Signal  | `#00d992`                | Accent border (active, running agent, highlighted card) |
| `border-dashed`  | Blueprint Slate | `rgba(79, 93, 117, 0.4)` | Architecture and flow diagram dashed lines              |
| `fg-primary`     | Snow White      | `#f2f2f2`                | Primary text (most common)                              |
| `fg-emphasis`    | Pure White      | `#ffffff`                | Highest-emphasis headings, tx hashes                    |
| `fg-secondary`   | Warm Parchment  | `#b8b3b0`                | Secondary text (body descriptions)                      |
| `fg-tertiary`    | Steel Slate     | `#8b949e`                | Metadata, timestamps, agent ids                         |
| `fg-muted`       | Fog Gray        | `#bdbdbd`                | Secondary links, footer                                 |

### Accent / Brand

| Role            | Token                | Hex       | Usage                                                |
| --------------- | -------------------- | --------- | ---------------------------------------------------- |
| `accent`        | Emerald Signal Green | `#00d992` | Brand color, active border, glow, logo pulse         |
| `accent-text`   | VoltAgent Mint       | `#2fd6a1` | CTA button text (more readable than pure `#00d992`)  |
| `accent-subtle` | Tailwind Emerald     | `#10b981` | Subtle background at 30% opacity, default link color |

### Semantic (status and chain network)

| Role         | Token           | Hex       | Usage                                                   |
| ------------ | --------------- | --------- | ------------------------------------------------------- |
| `chain-bnb`  | BNB Saffron     | `#F0B90B` | BSC testnet tx, four.meme token address hover, BNB logo |
| `chain-base` | Base Cobalt     | `#0052FF` | Base Sepolia tx, USDC payment hash                      |
| `chain-ipfs` | Soft Purple     | `#818cf8` | IPFS CID, Pinata upload marker                          |
| `success`    | Success Emerald | `#008b00` | Success state (agent finished a task)                   |
| `warning`    | Warning Amber   | `#ffba00` | Warnings (bonding curve near full, low balance)         |
| `danger`     | Danger Coral    | `#fb565b` | Errors, failed tx, rug warnings                         |
| `info`       | Info Teal       | `#4cb3d4` | Informational hints, callouts                           |

### Usage rules

- **Accent is only used for**: active borders, CTA text, logo glow, and one hero-level text highlight. **Never** as a large fill or as body text.
- **Chain colors**: use on tags indicating chain type or as the leading icon of a tx hash. Not for body text.
- **Primary text always uses `fg-primary` (`#f2f2f2`)**, **never** `#ffffff` — pure white is harsh against dark backgrounds.
- **Status colors never carry meaning alone** — always pair with an icon or text. Hard accessibility requirement.

---

## 3. Typography Rules

### Font Family

```css
/* Headings: system fonts, instant rendering, native OS feel */
--font-sans-display:
  system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, 'Helvetica Neue',
  sans-serif;

/* Body / UI: geometric, precise */
--font-sans-body: 'Inter', system-ui, sans-serif;
font-feature-settings: 'calt', 'rlig'; /* Required: contextual alternates + required ligatures */

/* Code / tx hash / agent log: developer signal */
--font-mono: 'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace;
```

### Scale (VoltAgent-derived)

| Role       | Font         | Size    | Weight  | Line Height | Letter Spacing | Usage                                   |
| ---------- | ------------ | ------- | ------- | ----------- | -------------- | --------------------------------------- |
| `display`  | sans-display | 60px    | 400     | **1.00**    | -0.65px        | Hero "Agent Swarm" heading              |
| `h1`       | sans-display | 36px    | 400     | **1.11**    | -0.9px         | Page primary heading                    |
| `h2`       | sans-display | 24px    | 700     | 1.33        | -0.6px         | Section heading                         |
| `h3`       | sans-body    | 20px    | 600     | 1.40        | normal         | Card headings, feature names            |
| `overline` | sans-display | 18px    | 600     | 1.56        | 0.45px         | Uppercase small headers, section labels |
| `body`     | sans-body    | 16px    | 400     | 1.5         | normal         | Default body text, buttons              |
| `body-sm`  | sans-body    | 14px    | 400-500 | 1.5         | normal         | Secondary copy, nav                     |
| `caption`  | sans-body    | 12px    | 500     | 1.33        | normal         | Metadata, agent ids                     |
| `tag`      | sans-display | 14px    | 600     | 1.43        | **2.52px**     | Uppercase tags / badges                 |
| `code`     | mono         | 13-14px | 400     | 1.43        | normal         | Code blocks, tx hashes, log lines       |
| `code-sm`  | mono         | 12px    | 400     | 1.45        | normal         | Inline small code, timestamps           |

### Typography principles

- **System-native first**: display/h1 use `system-ui` — instant render, no FOIT.
- **Inter is the UI backbone**: body, buttons, and descriptions all use Inter; the geometric feel matches terminal cyber.
- **Compression creates density**: hero line-height 1.0 with negative letter-spacing makes blocks read like "tech spec" rather than marketing copy.
- **Weight gradient, not contrast**: 300 → 400 → 500 → 600 → 700 progression; 700 is reserved for h2 and code-button.
- **Uppercase always carries letter-spacing**: all-caps ships with 0.45–2.52px of spacing; no tight uppercase.

---

## 4. Component Stylings

### Button

Six full states (default / hover / active / focus / disabled / loading). Three variants:

**`ghost` (default)**

```
background: transparent
color: #f2f2f2 (Snow White)
border: 1px solid #3d3a39 (Warm Charcoal)
padding: 12px 16px
radius: 6px
font: 16px Inter 500

hover:    background: rgba(0,0,0,0.2); border-color: #00d992 (Emerald at 50%)
focus:    outline: 2px solid rgba(47,214,161,0.5); outline-offset: 2px
active:   opacity: 0.8
disabled: opacity: 0.4; cursor: not-allowed
loading:  show spinner, keep width fixed
```

**`primary` (CTA)**

```
background: #101010 (Carbon Surface)
color: #2fd6a1 (VoltAgent Mint)  ← note, not #00d992
border: 2px solid #00d992 (Emerald Signal)
padding: 12px 16px
radius: 6px
font: 16px Inter 600
```

**`tertiary` (large card button, e.g. code copy block)**

```
background: #101010
color: #f2f2f2
border: 3px solid #3d3a39
padding: 20px
radius: 8px
font: 16px Inter 500
```

### Input / Code Input

- Background `#101010` (Carbon Surface)
- Border `1px solid #3d3a39`, focus becomes `2px solid #00d992`
- Radius **6px** (matches buttons)
- Padding `12px 16px`
- Typeface: placeholder in Inter; when the user input is a URL or hash, switch to mono
- Error state: border becomes `#fb565b` (Danger Coral) + red helper text below

### Card

- Background `#101010`
- Default border `1px solid #3d3a39` (Level 1 Contained)
- Accent border `2px solid #00d992` (Level 3 Accent, running / selected)
- Radius **8px** (standard card)
- Padding 24–32px
- Hover (optional): add the Level 4 Ambient Glow shadow

### Log Panel (project-specific)

The three-column agent log is a core UI block:

```
background: #050507 (app shell bg, not Carbon Surface — creates layering against the enclosing card)
border: 1px solid #3d3a39
radius: 8px
padding: 16px
font: 13px JetBrains Mono
color: #f2f2f2 (default), #8b949e (timestamp), #00d992 (success ✓)
line-height: 1.5
max-height: 60vh
overflow-y: auto (momentum scroll)

Per-line structure:
[HH:MM:SS] <agent.tool>  message
  ^ caption+fg-tertiary    ^ fg-primary
```

### Tx Hash Pill

A clickable pill that shows an on-chain transaction:

```
display: inline-flex
padding: 4px 10px
border-radius: 9999px (pill)
background: #101010
border: 1px solid <chain-color>  ← #F0B90B BSC / #0052FF Base / #818cf8 IPFS
color: #f2f2f2
font: 12px JetBrains Mono
gap: 6px

Left icon (14x14): monochrome miniature of the chain logo
Right text: <chain>_<short_hash>, e.g. "BSC 0x12ab..cd34"

hover: thicker border or glow, cursor: pointer
```

### Navigation

The project is a **single-page dashboard** with no traditional top nav. Only:

- Top-left logo + the "AGENT SWARM" marker (rendered as `system-ui 20px 600 uppercase + 0.5px spacing`)
- Top-right GitHub star badge + agent-mode toggle button (ghost)
- No sidebar, no tabs

### Distinctive Component: Agent Status Bar

Three agents displayed side-by-side at the top:

```
╭──────────╮ ╭──────────╮ ╭──────────╮
│ creator  │ │ narrator │ │ market-mk│
│  ● idle  │ │  ● idle  │ │  ● idle  │
╰──────────╯ ╰──────────╯ ╰──────────╯
```

- Status dot colors: `#8b949e` idle / `#00d992` running / `#008b00` done / `#fb565b` error
- Running state: dot adds a glowing pulse animation (see §7)
- Card background `#101010`, border `1px solid #3d3a39`; while running, border becomes `2px solid #00d992`

---

## 5. Layout Principles

### Spacing Scale (8px base)

| Token      | Value | Usage                                           |
| ---------- | ----- | ----------------------------------------------- |
| `space-0`  | 0     | —                                               |
| `space-1`  | 4px   | Icon interior spacing                           |
| `space-2`  | 8px   | Tight elements                                  |
| `space-3`  | 12px  | Button vertical padding                         |
| `space-4`  | 16px  | Default component gap, card padding             |
| `space-5`  | 20px  | Tertiary button padding                         |
| `space-6`  | 24px  | Large card padding, sibling gap                 |
| `space-8`  | 32px  | Sub-section gap                                 |
| `space-12` | 48px  | Chapter gap                                     |
| `space-16` | 64px  | Large page blocks (rarely needed for hackathon) |

### Grid

- Max content width: `max-width: 1280px`, centered
- Single-page dashboard layout: top input region (single column) + middle agent status (3 columns) + lower log region (3 columns) + bottom tx list (single column)
- Gutter: 24px (desktop) / 16px (<768px)

### Whitespace Philosophy

- **Borders signal whitespace**: use `1px solid #3d3a39` to divide regions; do not rely on raw spacing alone.
- **Tight inside cards, breathing between cards**: card padding 24px, sibling gap 24px, section gap 48–64px.
- **Hero first**: the top input region gets the largest vertical space; information density increases downward.

### Border Radius Scale

| Token            | Value  | Usage                                                  |
| ---------------- | ------ | ------------------------------------------------------ |
| `radius-sharp`   | 4px    | Small inline elements, code fragments, icon containers |
| `radius-default` | 6px    | Buttons, inputs, links (workhorse)                     |
| `radius-code`    | 6.4px  | pre / code blocks (a 0.4px nudge from buttons)         |
| `radius-card`    | 8px    | Cards, large containers, log panels                    |
| `radius-pill`    | 9999px | Tags, tx hash pills, status dots                       |

---

## 6. Depth & Elevation

Depth comes from **borders** first, **shadows** second.

| Level            | Treatment                                                                       | Usage                                            |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| 0 Flat           | no border, no shadow                                                            | Page background, inline text                     |
| 1 Contained      | `1px solid #3d3a39`                                                             | Default card, log panel, nav                     |
| 2 Emphasized     | `3px solid #3d3a39`                                                             | Large interactive buttons, emphasized containers |
| 3 Accent         | `2px solid #00d992`                                                             | Active card, running agent, selected state       |
| 4 Ambient Glow   | `rgba(92,88,85,0.2) 0px 0px 15px`                                               | Card hover, soft lift                            |
| 5 Dramatic Float | `rgba(0,0,0,0.7) 0px 20px 60px` + `rgba(148,163,184,0.1) 0px 0px 0px 1px inset` | Modal, hero, topmost layer                       |

### Decorative depth

- **Emerald Signal Glow**: `drop-shadow(0 0 2px #00d992)` → `drop-shadow(0 0 8px #00d992)` pulse (see §7); used on the logo and the running agent status dot.
- **Warm Ambient Haze**: warm glow on card hover.
- **Dashed Blueprint Lines**: `1px dashed rgba(79,93,117,0.4)`, reserved for architecture and flow diagrams only.

---

## 7. Motion & Animation

### Duration tokens

| Token              | Value     | Usage                                                  |
| ------------------ | --------- | ------------------------------------------------------ |
| `duration-instant` | 80–100ms  | Micro-feedback (button press)                          |
| `duration-fast`    | 150ms     | Hover, toggle, default transition                      |
| `duration-normal`  | 200–250ms | Modal entry, dropdown, tooltip                         |
| `duration-slow`    | 400ms     | Page transitions, complex transitions (used sparingly) |
| `duration-signal`  | 1500ms    | Signal glow pulse period                               |
| `duration-marquee` | 40–80s    | Decorative infinite marquee (not used in this project) |

### Easing

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* use sparingly */
```

### Core animations

1. **Signal Glow Pulse** (logo + running agent dot)

   ```css
   @keyframes signal-pulse {
     0%,
     100% {
       filter: drop-shadow(0 0 2px #00d992);
     }
     50% {
       filter: drop-shadow(0 0 8px #00d992);
     }
   }
   animation: signal-pulse 1500ms ease-in-out infinite;
   ```

2. **Log Line In** (new SSE line enters)

   ```css
   from {
     opacity: 0;
     transform: translateY(4px);
   }
   to {
     opacity: 1;
     transform: translateY(0);
   }
   duration: 150ms ease-out;
   ```

3. **Card Border Accent Transition** (idle → running)

   ```css
   transition:
     border-color 150ms ease-out,
     border-width 150ms ease-out;
   ```

4. **Tx Hash Pill Hover**

   ```css
   transition: filter 150ms ease-out;
   hover: filter: drop-shadow(0 0 4px <chain-color>);
   ```

### Motion principles

- **Feedback first**: every interaction has a visible response in ≤ 150ms.
- **Motion communicates state**: animations express state change (idle → running), not decoration.
- **Restraint**: at most three animations active in one viewport at the same time (three agent status dots pulsing is already the ceiling).
- **Skippable**: respect `prefers-reduced-motion` — disable signal-pulse and fall back to a static glow.
- **No decorative loops**: except signal-pulse (which serves the running state), infinite loops are disallowed.

---

## 8. Responsive Behavior

### Breakpoints

| Token | Value  | Device                            |
| ----- | ------ | --------------------------------- |
| `sm`  | 640px  | Large phones                      |
| `md`  | 768px  | Tablets                           |
| `lg`  | 1024px | Small desktops / landscape tablet |
| `xl`  | 1280px | Desktop (primary target)          |
| `2xl` | 1536px | Large desktop                     |

### Strategy

- **Desktop-first** (the demo is recorded on desktop; mobile is not an MVP target) — the floor is "doesn't break at `≥ md`".
- **Primary resolution**: 1280–1440px wide (optimal for the YouTube demo).
- **Log panel**: `< md` stacks vertically (three agents in one column); `≥ md` displays three columns side by side.
- **Tx pill list**: `< md` stacks; `≥ md` wraps horizontally.
- **Touch targets**: ≥ 44×44px (hard a11y requirement even when mobile is not primary).
- **Code blocks**: `< md` uses horizontal scroll; do not wrap (preserve legibility).

### Viewport Assumptions

**Demo recording is locked at 1440×900; other viewports only need to not break.**

---

## 9. Accessibility

Hackathon reviewers will look; these are hard requirements:

- [ ] Every interactive element is `Tab`-focusable.
- [ ] `focus` has a visible `outline: 2px solid rgba(47,214,161,0.5)` (no `outline: none` without replacement).
- [ ] Text contrast: `#f2f2f2` on `#050507` = 19.56:1; `#b8b3b0` on `#050507` = 10.5:1; `#8b949e` on `#050507` = 6.42:1 (all pass WCAG AAA).
- [ ] Icon-only buttons carry `aria-label`.
- [ ] Form `<label>` is bound to `<input>`.
- [ ] Status color **never** carries information alone — always pair with an icon or text (e.g. `● running`, `✓ done`, `✗ error`).
- [ ] Color is not the sole chain identifier — chain pills always include the chain abbreviation (`BSC`, `BASE`, `IPFS`).
- [ ] Respect `prefers-reduced-motion`: disable signal-pulse, fall back to a static glow (`filter: drop-shadow(0 0 4px #00d992)`).
- [ ] `prefers-color-scheme: light` is unsupported — this project is a dark-only terminal and does not ship a light mode.

### Validation tooling

- `@axe-core/playwright` scan, 0 critical issues.
- Keyboard-only test: unplug the mouse and run the core flow (input → start swarm → view tx).

---

## 10. Do's and Don'ts

### Do

- Use semantic tokens (`bg-primary`, `border-accent`) rather than raw hex.
- Keep the two-layer dark system: `#050507` page + `#101010` cards — that is the identity.
- Use Emerald `#00d992` only as signal: active border, logo glow, and one hero-level text highlight.
- Use VoltAgent Mint `#2fd6a1` for button text — more legible than `#00d992`.
- Compress heading line-height to 1.0–1.11 with negative letter-spacing.
- Express depth via border weight (1 → 2 → 3) and color (`#3d3a39` → `#00d992`); reserve shadow for the top tiers.
- Treat code blocks, tx hashes, and agent logs as hero content and give them visual weight.
- Pair `system-ui` with headings, Inter with body, JetBrains Mono with code.
- Enable `"calt"` and `"rlig"` OpenType features across all text.
- Pair every status with an icon or text; never rely on pure color.

### Don't

- Don't introduce a light background — the entire identity is built on deep black.
- Don't add orange/red/yellow decoration — the palette is green + warm gray + chain color. Warm hues only appear as semantic (warning/error).
- Don't let Emerald `#00d992` become a large fill — it is accent, not surface.
- Don't stretch heading line-height past 1.33 — compression density is the core of the engineering-platform feel.
- Don't overuse shadow — depth comes from borders; shadows only for Level 4–5.
- Don't use `#ffffff` for default body text — `#f2f2f2` is the default; pure white is reserved for emphasis.
- Don't introduce serif or decorative fonts — the system is pure geometric sans + mono.
- Don't use border-radius > 8px on cards; 9999px pill is reserved for small tags.
- Don't omit the `#3d3a39` border — cards will float in the void and lose their boundary.
- Don't use fast decorative animations — below 150ms is feedback; decorative animations (e.g. marquee) must last > 25s.
- Don't drop below 16px for body text on mobile — `body` is 16px minimum (iOS refuses to zoom).

---

## 11. Agent Prompt Guide

> Paste this section when generating a new component with an AI.

### Cheat sheet

```
Theme:     "2 AM AI agent engineering terminal" — dark, dense, alive-with-signal
Mood:      calm · sharp · technical · nocturnal
Canvas:    bg-primary #050507 / bg-surface #101010
Border:    #3d3a39 warm charcoal (1px default, 2px when accent, 3px when emphasized)
Accent:    Emerald Signal Green #00d992 (border / glow / CTA text mint #2fd6a1)
Text:      #f2f2f2 Snow White (primary) / #b8b3b0 Warm Parchment (body) / #8b949e Steel Slate (meta)
Chain:     BSC #F0B90B / Base Sepolia #0052FF / IPFS #818cf8
Type:      system-ui display, Inter body, JetBrains Mono code (OpenType "calt","rlig")
Spacing:   8px grid, component gap 16-24px, section gap 48-64px
Motion:    150ms ease-out default, 1500ms signal-glow pulse for running agents
Radius:    4px small / 6px button / 8px card / 9999px pill
Elevation: flat default, 1px border contained, 2px emerald border accent, no heavy shadow unless modal
```

### Prompt template (new component)

```
Generate a <component name> that conforms to this design.md. Must:

1. Use semantic tokens (see §2) — no raw hex
2. Ship the full six states (default / hover / active / focus / disabled / loading; see §4)
3. Default transition 150ms ease-out (see §7)
4. Honor the radius scale (4 / 6 / 8 / 9999; see §5 radius)
5. Express depth through borders; shadows only at Level 4–5 (see §6)
6. Always have a 2px emerald focus outline (see §9)
7. Pair status with icon + text, never color alone (see §10 Do)
8. Avoid every anti-pattern in §10 Don't

Environment: Next.js 15 App Router + TypeScript + Tailwind v4 + shadcn/ui
Font variables are injected in layout.tsx: --font-sans-display / --font-sans-body / --font-mono
```

### Common task examples

**Generate an agent status card**

```
On a Carbon Surface #101010, place a card with border 1px solid #3d3a39, radius 8px,
padding 24px. The "creator" title uses system-ui 20px weight 600 Snow White.
The status dot is an 8px circle — #8b949e while idle, #00d992 while running plus
a signal-pulse 1500ms animation. While running, the card border upgrades to
2px solid #00d992.
```

**Generate a tx hash pill**

```
inline-flex pill, padding 4px 10px, radius 9999px, bg #101010.
Border 1px solid chain-color (BSC #F0B90B / Base #0052FF / IPFS #818cf8).
Left chain-logo icon 14x14 monochrome; right text JetBrains Mono 12px #f2f2f2
formatted as "BSC 0x12ab..cd34". Hover adds a drop-shadow 4px blur in the chain color.
```

**Generate an SSE log panel**

```
Card container, bg #050507 (darker than the outer layer), border 1px solid #3d3a39,
radius 8px, padding 16px. Each line: [HH:MM:SS] <agent.tool> message.
Timestamp JetBrains Mono 12px #8b949e, body JetBrains Mono 13px #f2f2f2.
New-line entrance animation: opacity 0→1 + translateY(4px)→0, 150ms ease-out.
max-height 60vh, overflow-y auto, scrollbar themed with a thin #3d3a39 track.
```

---

## Notes

- This is a **living document**. Update the relevant sections whenever a component lands or the style shifts. A stale design.md is worse than none — it misleads AI into producing inconsistent UI.
- Freeze this file before the demo recording on 2026-04-22 to keep visuals consistent.
