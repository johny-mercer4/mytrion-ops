# Mytrion design tokens & patterns

Extracted from 9 standalone `.dc.html` module mockups (design-tool exports, custom
`DCLogic`/template runtime — **not** reused as-is). Source: pasted in chat 2026-07-02,
not saved verbatim (too large). This doc is the actual input for the Next.js +
shadcn + Tailwind port at `apps/mytrion-crm`.

## Brand

- Wordmark: `MYTRION` (Rajdhani 700, uppercase, 0.08em tracking) + `AI` in accent color.
- Mark: 4-point sparkle icon in round gradient chip, `linear-gradient(135deg,#FB923C,#F97316)` (orange "fuel spark").
- Fonts: **Rajdhani** (500/600/700) — headings, numerals, eyebrows, condensed labels.
  **Inter** (400–800) — body/UI text, buttons, inputs. **JetBrains Mono** (400/500/600) —
  IDs, currency, metrics, timestamps, code.

## Layered theme model

Each module is its own **dark "Soft Midnight" + light "Cool White"** pair, sharing the
same token *names* (`--bg`, `--surface`, `--surface-alt`, `--text`, `--text2`,
`--text-muted`, `--border`, `--accent`, `--accent-on`, `--good`, `--warn`, `--bad`,
plus 3-tier `--shadow-sm/md/lg`) but a different **accent hue per module**. In the
Next.js port this maps to: base shadcn CSS-variable theme (light/dark via
`next-themes`) + a `data-module="sales"` (etc.) attribute that overrides just
`--primary`/`--ring`/`--accent` per route/section.

| Module | Dark accent | Light accent | Dark bg | Notes |
|---|---|---|---|---|
| Admin | `#2FC7F0` cyan | `#0B8FB8` | `#0A0E15` | knowledge base / agent scope |
| Sales | `#38BDF8` sky | `#2563EB` | `#0B0F17` | |
| Billing | `#8B5CF6` violet | `#7C3AED` | `#191A22` | selectable accent: indigo/cyan/emerald |
| Collection | `#F0564E` coral-red | `#D5342B` | `#120E11` | selectable: rose/amber/slate |
| Customer Service | `#E0A83E` amber/gold | `#B4770F` | `#17140E` | selectable: rose/sky/emerald |
| Finance | `#10B981` emerald | `#0E9E6E` | `#000000` (true black) | sharper 2–4px radii, terminal feel |
| Retention | `#E85DC0` magenta | `#C0269E` | `#150F1A` | selectable: rose/violet/sky |
| Verification | `#5A8DFF` indigo-blue | `#2563EB` | `#0A0F1E` | selectable: indigo/teal/emerald |
| Design System (brand root) | `#38BEF0` | `#0C8FC7` | `#0B0E13` | canonical "Mytrion AI" picker shell |

Status colors (shared, deepen ~15% for light-mode contrast):
`--good` `#34D399`→`#16A34A`/`#1F9D62`, `--warn` `#FBBF4D`/`#FBBF24`→`#B9791A`,
`--bad` `#F4716F`/`#F87171`→`#D14545`/`#DC2626`, `--purple` `#A78BFA`→`#6D52D6`/`#7C3AED`,
`--orange` `#FB8A3C`/`#FB923C`→`#D9641A`.

## Radii & elevation

- Radius scale: `sm 5px · md 9px · lg 13px · full 999px` (Design System canonical).
  Finance module intentionally breaks this with a sharper `2–4px` "terminal" scale —
  treat as a per-module density variant, not a second global scale.
- Shadow: 3 tiers (`sm/md/lg`), each deeper/more diffuse in dark mode, tighter and
  lighter in light mode. Always paired with a 1px `border` in the module's border
  token — shadows alone don't define card edges.

## Component vocabulary (map to shadcn primitives)

- **Buttons** → shadcn `Button`: primary (solid accent), secondary (outline,
  surface-alt bg), icon-only ghost/circle (34–42px square, transparent → surface-2 on hover).
- **Badges/status pills** → shadcn `Badge`: rounded-md status tag (ready/embedding/failed/info),
  rounded-full context/count badge. Always `bg = color-mix(accent 14%, transparent)`,
  `border = color-mix(accent 30%, transparent)`, `text = accent`.
- **Inputs** → shadcn `Input` + leading search icon; focus state = accent border +
  `0 0 0 3px accent-glow` ring, matches shadcn's default focus-visible ring pattern closely.
- **Cards** → shadcn `Card`: (a) action card — icon chip, title, desc, CTA link with
  arrow; (b) stat/KPI card — icon chip + big Rajdhani numeral + label, optional delta chip;
  (c) list row — icon, title+meta, trailing status badge, `cursor-pointer` hover raise.
- **AI chat surface** → custom composite over shadcn primitives: user bubble
  (right-aligned, tinted bg, rounded-2xl minus one corner), assistant reply (left,
  plain text no bubble, gradient-orb avatar `linear-gradient(135deg,#4285F4,#9B72CB,#D96570)`),
  tool-call chips (running spinner / success check / denied X, each tinted),
  "Grounded in N passages · source" footer line, pill composer with icon send button.
  Streaming: word-by-word reveal + blinking caret span.
- **Boot loader** → full-bleed overlay, dual counter-rotating rings + brand icon center,
  top-edge sweep bar, bottom progress bar, ~900–1400ms then fade. One-time per session mount.
- **Toast** → shadcn `Sonner`/`Toast`: bottom-right (or top-right on wider shells),
  colored left border (3px) matching kind, icon chip + label + message, auto-dismiss ~3.4–3.8s.
- **Modal** → shadcn `Dialog`: scrim overlay, centered card, header (title + status
  badges + close), scrollable body (multi-section: info rows, timeline, related list),
  footer (secondary + primary action right-aligned, sometimes a destructive action left-aligned).
- **Kanban board** (Retention, Collection) → horizontal-scroll column list, each column
  = header (dot + title + count pill) + vertical card stack; cards click-to-open detail
  modal (no native drag in the mockups — stage advance is a button action inside the modal).
- **Data table / list** → sticky header row (uppercase 9.5–10px labels), row grid via
  CSS grid template columns, click-to-open modal, search bar + segmented filter chips
  above, empty state centered text block.
- **Tabs** → top-level nav (icon + label + optional count/badge, bottom-border active
  indicator) and in-modal sub-tabs (same bottom-border pattern, smaller).

## Layout shell (shared across all 8 modules)

Fixed 54–58px header (brand mark + module badge chip, theme toggle button, agent
name/role + initials avatar) → optional left sidebar (icon+label nav, active =
tinted bg + accent text, badge counts, bottom "today's queue" mini-stat card) →
scrollable main content region. Some modules (Sales) use a top-nav-only layout
(no sidebar) instead — treat sidebar-vs-topnav as a per-module layout choice, not
a hard rule.

## Behaviors to reimplement as real React state (not template-runtime specific)

- Theme toggle persisted to `localStorage`, key pattern `mytrion-<module>-theme`.
- Search + multi-select segmented filters over an in-memory list (client-side filter, no debounce needed at mock scale).
- Modal open/close via selected-id state, not boolean+separate-data.
- Toast queue: single active toast, auto-clear timer, replaced on new call.
- Chat: append user message → typing/status indicator (rotating status strings) →
  stream assistant reply word-by-word → attach citations after stream completes.
- Kanban stage advance / mark-lost / mark-recovered as explicit action buttons inside
  the detail modal, not drag-and-drop.

## What NOT to port

- The `DCLogic`/`sc-for`/`sc-if`/`{{ }}` template runtime (`support.js`) — that's the
  mockup tool's own React-less templating engine. Next.js port uses plain React/JSX,
  hooks, and shadcn components instead.
- Per-mockup duplicated boot-loader/toast/modal CSS — centralize once in the design
  system, module pages just set the accent token.
