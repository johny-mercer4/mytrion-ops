# Mytrion CRM — Design Tokens

Exact values behind every token name used in `DESIGN_HANDOFF.md`. Source of truth: `src/styles/theme.css`
(base scale) + `src/styles/global.css` (per-module accents). Components read **token names only** — no
raw hex, no arbitrary px. Dark ("Soft Midnight") is the default; light applies under `[data-theme="light"]`.

---

## 1. Color — Soft Midnight (dark, default)

| Token | Value | Use |
|-------|-------|-----|
| `--bg-primary` | `#12161e` | app background |
| `--bg-secondary` | `#161b24` | secondary background |
| `--surface` | `#1b212c` | cards, tables |
| `--surface-alt` | `#161a23` | table header, filter field |
| `--surface-raised` | `rgba(255,255,255,0.045)` | hover raise |
| `--sidebar-bg` | `#13171f` | rail |
| `--header-bg` | `#13171f` | topbar |
| `--text-primary` | `#e7eaf0` | headings, primary text |
| `--text-secondary` | `#a9b0bd` | secondary text |
| `--text-muted` | `#6e7682` | subtitles, placeholders |
| `--border` | `rgba(255,255,255,0.09)` | default border |
| `--border-light` | `rgba(255,255,255,0.06)` | row dividers |
| `--accent` | `#38bef0` | admin accent (cyan) |
| `--accent-strong` | `#2cb6ec` | hover accent |
| `--on-accent` | `#04131c` | text on accent |
| `--accent-soft` | `rgba(56,190,240,0.12)` | active tint |
| `--accent-glow` | `rgba(56,190,240,0.26)` | focus ring |
| `--success` | `#34d399` | active/good |
| `--warning` | `#fbbf4d` | warn |
| `--danger` | `#f4716f` | disabled/delete |
| `--purple` | `#a78bfa` | — |
| `--orange` | `#fb8a3c` | — |

**Shadows:** `--shadow-sm` `0 1px 2px rgba(0,0,0,.45)` · `--shadow-md` `0 6px 18px rgba(0,0,0,.42), 0 2px 6px rgba(0,0,0,.32)` · `--shadow-lg` `0 18px 48px rgba(0,0,0,.58), 0 6px 16px rgba(0,0,0,.42)`.

## 2. Color — light

| Token | Value |
|-------|-------|
| `--bg-primary` | `#f6f8fb` |
| `--bg-secondary` | `#eef1f6` |
| `--surface` | `#ffffff` |
| `--surface-alt` | `#f3f5f9` |
| `--surface-raised` | `rgba(16,24,40,0.035)` |
| `--sidebar-bg` | `#ffffff` |
| `--header-bg` | `#ffffff` |
| `--text-primary` | `#18202e` |
| `--text-secondary` | `#4d5666` |
| `--text-muted` | `#8a92a1` |
| `--border` | `rgba(20,30,50,0.1)` |
| `--border-light` | `rgba(20,30,50,0.07)` |
| `--accent` | `#0c8fc7` |
| `--accent-strong` | `#0e9ad6` |
| `--on-accent` | `#ffffff` |
| `--accent-soft` | `rgba(12,143,199,0.1)` |
| `--accent-glow` | `rgba(12,143,199,0.2)` |
| `--success` | `#1f9d62` |
| `--warning` | `#b9791a` |
| `--danger` | `#d14545` |

## 3. Status tints (derived via `color-mix`, both themes)

- good: bg = success @13%, border = success @30%
- warn: bg = warning @13%, border = warning @30%
- bad: bg = danger @13%, border = danger @30%
- info: bg = `--accent-soft`, border = accent @30%
- neutral: bg = `--surface-alt`, border = `--border`

## 4. Radii · Type · Spacing · Motion

**Radii:** `--radius-xs` 3px · `--radius-sm` 5px · `--radius-md` 9px · `--radius-lg` 13px · `--radius-full` 999px.

**Fonts:**
- `--font-head` = **Rajdhani**, system-ui, sans-serif (titles, wordmark)
- `--font-body` = **Inter**, system-ui, sans-serif (everything)
- `--font-mono` = **JetBrains Mono**, ui-monospace (ids, cards, passwords)

**Type scale** (size / line-height):
`2xs` 10.5/14 · `xs` 12/16 · `sm` 13/18 · `base` 14/20 · `md` 15/22 · `lg` 18/24 · `xl` 22/28 ·
`2xl` 26/31 · `3xl` 32/37. Mobile input min 16px (iOS no-zoom).
**Weights:** regular 400 · medium 500 · semibold 600 · bold 700 · extra 800.

**Spacing (4px rhythm):** 0_5=2 · 1=4 · 1_5=6 · 2=8 · 2_5=10 · 3=12 · 3_5=14 · 4=16 · 5=20 · 6=24 ·
8=32 · 10=40 · 12=48 · 16=64.

**Motion:** `--dur-fast` 120ms · `--dur-base` 170ms · `--dur-slow` 220ms.
Ease standard `cubic-bezier(0.2,0,0,1)` · emphasized `cubic-bezier(0.4,0,0,1)` · out `cubic-bezier(0,0,0.2,1)`.

## 5. Brand gradients

- `--fuel` = `linear-gradient(135deg, #fb923c, #f97316)` — the orange **FuelMark** (app/masthead).
- `--gem` = `linear-gradient(135deg, #4285f4 0%, #9b72cb 52%, #d96570 100%)` — the **gem** (AI surfaces).

## 6. Per-module accents (`[data-mytrion="<id>"]`)

Each module swaps `--accent`, `--accent-strong`, `--on-accent`, `--accent-soft`, `--accent-glow`.
Dark value / light value:

| Module | Dark accent | Light accent | Family |
|--------|-------------|--------------|--------|
| admin | `#38bef0` | `#0c8fc7` | cyan |
| sales | `#4d9dff` | `#2563eb` | blue |
| billing | `#8b5cf6` | `#7c3aed` | purple |
| collection | `#f0564e` | `#d5342b` | red |
| finance | `#10b981` | `#0e9e6e` | green |
| customer-service | `#e0a83e` | `#b4770f` | amber |
| retention | `#e85dc0` | `#c0269e` | pink |
| verification | `#6d7cff` | `#4f46e5` | indigo |
| manager | `#2dd4bf` | `#0d9488` | teal |

`--accent-soft` ≈ hue @ ~12–14% alpha; `--accent-glow` ≈ hue @ ~26–28% (dark) / ~20% (light);
`--on-accent` is a near-black tint of the hue in dark, `#fff` in light.
