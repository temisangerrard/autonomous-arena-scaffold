# AutoBett Arena — Design System

**Bold, tactical, clean.** Blue primary, teal for positive outcomes, neutral surfaces.

All tokens are CSS custom properties defined in `apps/web/public/styles.css`. Admin-specific aliases live in `apps/web/public/css/admin-chief.css` and map to the global tokens.

---

## Typography

| Role | Family | Weights | CSS var |
|---|---|---|---|
| Primary / Display | Plus Jakarta Sans | 400 500 600 700 800 | `var(--font-primary)` `var(--font-display)` |
| Mono | JetBrains Mono (fallback: IBM Plex Mono) | 400 500 600 | `var(--font-mono)` |

**Scale**

| Tag | Size | Weight | Use |
|---|---|---|---|
| h1 | 2.5rem | 600 | Page titles |
| h2 | 1.875rem | 600 | Section titles |
| h3 | 1.5rem | 600 | Card headings |
| h4 | 14px | 800 | Panel labels (admin) |
| Eyebrow / kicker | 10px mono uppercase | 800 | Section identifiers, admin view labels |
| Body | 16px / line-height 1.6 | 400 | Default prose |
| Small label | 13px | 600 | Form labels, table cells |
| Mono detail | 11–12px mono | 500 | IDs, addresses, timestamps, KPI labels |

---

## Color tokens

### Surfaces
```css
--bg-primary:    #f9f9f7   /* page background */
--bg-secondary:  #f4f4f2   /* subtle section fill */
--bg-tertiary:   #eeeeec   /* input backgrounds, hover states */
--bg-card:       #ffffff   /* card surface */
```

### Blue — primary UI, actions, links
```css
--blue-primary:    #005da7
--blue-dark:       #004883   /* hover state for primary buttons */
--blue-light:      #2976c7   /* links, secondary blue elements */
--blue-pale:       #d4e3ff   /* active nav items, selected states */
--blue-container:  #a4c9ff   /* highlight rings, focus outlines */
```

### Text
```css
--text-primary:    #1a1c1b   /* headings, body */
--text-secondary:  #414751   /* supporting text, descriptions */
--text-muted:      #717783   /* labels, captions, placeholder-like copy */
--text-light:      #c1c7d3   /* disabled, very faint detail */
```

### Semantic accents
```css
--accent-success:  #4a7c59   /* wins, positive P&L, online status */
--accent-error:    #ba1a1a   /* losses, errors, destructive actions */
--accent-warning:  #7a5a00   /* caution states, risk indicators */
--accent-info:     #2976c7   /* informational, same as --blue-light */
```

### Outcome aliases (gold = teal in this system)
> `--gold-*` vars are a legacy name. They map to the teal/success palette, not literal gold.
```css
--gold-primary:  #2f8f5e   /* positive outcome highlight */
--gold-dark:     #236b47
--gold-light:    #9ad4b4
--gold-pale:     #e0f4e9
```

### Borders
```css
--border-light:   #e2e3e1   /* default card/input borders */
--border-medium:  #c1c7d3   /* stronger dividers, button borders */
--border-gold:    rgba(47, 143, 94, 0.32)   /* outcome-tinted borders */
```

### Glassmorphism
```css
--glass-bg:      rgba(255, 255, 255, 0.9)
--glass-border:  rgba(0, 93, 167, 0.2)
--bg-glass:      rgba(255, 255, 255, 0.92)
```

---

## Shadows

```css
--shadow-sm:   8px 8px 0px 0px rgba(26, 28, 27, 0.04)   /* offset hard shadow — tactical feel */
--shadow-md:   0 4px 16px rgba(26, 28, 27, 0.08)
--shadow-lg:   0 8px 32px rgba(26, 28, 27, 0.10)
--shadow-gold: 0 4px 16px rgba(47, 143, 94, 0.18)        /* positive outcome glow */
```

Admin-specific:
```css
--admin-shadow:      0 10px 28px rgba(26, 28, 27, 0.08)
--admin-shadow-soft: 0 2px 12px rgba(26, 28, 27, 0.06)
```

---

## Spacing

```css
--space-xs:  4px
--space-sm:  8px
--space-md:  16px
--space-lg:  24px
--space-xl:  32px
--space-2xl: 48px
```

Default gaps: `10px` between cards in tight grids, `14px` in regular layouts.

---

## Border radius

```css
--radius-sm:  4px    /* tight tags */
--radius-md:  8px    /* buttons, inputs, cards — default */
--radius-lg:  12px   /* larger panels */
--radius-xl:  999px  /* pills, badges, fully rounded */
```

**Signature corner style** — used on interaction cards, quick-play panel, and control hints overlay:
```css
border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
```
Applied via `.claude-corners` class (`apps/web/public/css/claude-corners.css`). Do not use on admin panels — admin uses flat `8px` radius throughout.

---

## Components

### Buttons

| Variant | Background | Text | Border | Use |
|---|---|---|---|---|
| Primary | `--blue-primary` | white | `--blue-dark` | Deploy, confirm, key actions |
| Ghost | white | `--text-primary` | `--border-medium` | Secondary actions |
| Gold / Outcome | `--gold-primary` (#2f8f5e) | white | darker teal | Positive outcome actions, CTAs |
| Destructive | transparent | `--accent-error` | `--accent-error` | Delete, stop session |

- Min height: `40px`
- Padding: `9px 12px`
- Font: `700 13px` Plus Jakarta Sans
- `transform: scale(0.96)` on `:active`

### Inputs and selects
- Height: `40px` min
- Border: `1px solid --border-light`
- Focus: `border-color: rgba(0, 93, 167, 0.55)` + `box-shadow: 0 0 0 3px rgba(0, 93, 167, 0.12)`
- Font: `600 13px` Plus Jakarta Sans

### Cards (`.panel-card`)
- Background: white
- Border: `1px solid --border-light`
- Border radius: `8px`
- Shadow: `--admin-shadow-soft`
- Padding: `14px`

### KPI grid (`.kpi-grid` / `.kpi`)
- Grid: `repeat(auto-fit, minmax(160px, 1fr))`
- Label: mono, uppercase, 10px, 800 weight, `--text-muted`
- Value: Plus Jakarta Sans, 25px, 800 weight, tabular-nums

### Badges and pills (`.badge`)
- Border radius: `999px`
- Font: `700 11px` Plus Jakarta Sans
- Min height: `26px`
- Padding: `4px 8px`
- Color modifiers: `.live` (teal), `.off` (red), `.warn` (amber)

### Tables (`.table-wrap`)
- Wrapper: `overflow: auto`, `max-height: 360px`, `border-radius: 10px`
- `th`: mono, uppercase, 11px, `--text-muted`, `0.04em` letter-spacing
- Row border: `1px solid --border-light`

### Admin rail
- Width: `248px`, sticky, `100vh`
- Background: `rgba(255, 255, 255, 0.94)`
- Active item: `--blue-pale` fill + `inset 3px 0 0 --blue-primary` left border
- Section label: mono, uppercase, 10px, `--text-muted`

### Eyebrow / view kicker (`.view-kicker`, `.topbar-eyebrow`)
```css
color: --blue-primary;
font: 800 10px/1.1 var(--font-mono);
text-transform: uppercase;
letter-spacing: 0.08em;
```

---

## Copy and tone

**Use**
- Agent, Strategy, Session, Deploy, Pause, Stop
- Risk controls, Stop loss, Take profit, Max wager
- Decision log, Last action, Performance
- Arena, Round, Station, Dealer
- Internal ledger (not "fake money")
- Player (not "user" in UI-facing copy)

**Avoid**
- Bot (say Agent)
- Auto-play, Passive income, Earn, Boost, Luck
- "Fair" without definition (say "matched wager")
- Chain-specific language in public copy (e.g. "on Base", "on-chain" as a feature headline)
- Gimmick copy, mascot language, emoji in UI text

**Admin panel labels** — noun + verb, no questions:
- ✅ "Deploy agent" / "Send payout" / "Refresh integrity"
- ❌ "Would you like to deploy?" / "Click here to send"

**Decimal formatting** — always show 2 decimal places for USDC: `1.00 USDC`, not `1 USDC`.

---

## Play screen rules

- HUD panels use `backdrop-filter: blur(18px)` with white-tinted glass background
- Interaction cards and overlays use the signature claude-corners radius
- No dark navy or parchment/serif design — those are legacy and have been removed
- Admin panel (admin-chief) uses flat `8px` radius and the blue token system, not glassmorphism

---

## File locations

| File | Purpose |
|---|---|
| `apps/web/public/styles.css` | Global tokens, reset, typography, shared components |
| `apps/web/public/css/admin-chief.css` | Admin panel design system (aliases global tokens) |
| `apps/web/public/css/claude-corners.css` | Signature border-radius utility class |
| `apps/web/public/css/landing.css` | Landing page layout |
| `apps/web/public/css/play/play-shell.css` | Play screen shell, interaction card, QP panel |
| `apps/web/public/css/play/responsive.css` | Mobile breakpoints for play screen |
