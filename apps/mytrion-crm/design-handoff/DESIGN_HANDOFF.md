# Mytrion CRM — UI Design Handoff

Full structural spec of the Mytrion Ops CRM widget (Zoho-embedded React app) so the UI can be
re-drawn in Claude Design. This file = **layout + screens + states + copy**. Exact color / type /
spacing values live in `DESIGN_TOKENS.md` — reference token names here, values there.

The screen captured for this handoff is the **Admin module → Carrier User Management** tab, in the
**light** theme. Every module shares the same frame (`MytrionShell`); only the center content, the
rail icon set, and the accent hue change.

---

## 1. App frame (`MytrionShell`)

Every module renders inside one frame. Full-height column, no page scroll — the center column is the
only scroll region.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOPBAR  (58px tall, sticky)                                               │
├────┬─────────────────────────────────────────────┬───────────────────────┤
│    │                                             │                       │
│ R  │            CENTER  (scrolls)                 │   AI CHAT DOCK        │
│ A  │            the module's content              │   (always present,    │
│ I  │                                             │    scoped to module)  │
│ L  │                                             │                       │
│64px│            flex: 1                           │   ~360–420px          │
│    │                                             │                       │
└────┴─────────────────────────────────────────────┴───────────────────────┘
```

- Body is a **flex row**: `[ rail 64px | center flex:1 | chat dock ]`.
- Background `--bg-primary`, text `--text-primary`.
- **Responsive ≤1024px:** the rail flips to a horizontal strip under the topbar (icons in a row,
  active marker moves to the bottom edge), and the chat dock stacks **below** the center content
  (this is the state shown in the captured screenshot — chat sits under the table, not beside it).

---

## 2. TopBar (58px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◆ MYTRION AI  [RnD]              [⇄ Act as agent] [⇄ Switch Mytrion] [☀] (DU) │
└──────────────────────────────────────────────────────────────────────────┘
```

**Left cluster**
- **BrandMark** = FuelMark + wordmark.
  - FuelMark: rounded square, **orange fuel gradient** (`--fuel`, 135° `#fb923c → #f97316`), a white
    4-point Sparkle centered (~53% of mark size).
  - Wordmark: `MYTRION AI` in the **display font (Rajdhani)**, heavy; the ` AI` is colored `--accent`.
- **Context badge** — small pill next to the wordmark showing the module tag (here `RnD`). Uses
  accent-tinted style.

**Right cluster** (right-aligned, gap ~small)
- **Act as agent** — outline button with a swap icon. *Admin only* (impersonation picker).
- **Switch Mytrion** — outline link with a swap icon → returns to the module picker (`/`).
- **Theme toggle** — icon-only square button; Moon in dark, Sun in light.
- **Avatar** — circle with user initials (`DU` = "Dev User"), accent-tinted ring.
- **Sign out** — outline button with an ✕ icon; only shown for a trusted/standalone session.

---

## 3. Left rail (64px, icon-only)

- Vertical stack of **42×42px** square buttons, gap 6px, padding 14px top/bottom.
- Background `--sidebar-bg`, 1px right border `--border`.
- **States:**
  - default: icon in `--text-muted`.
  - hover: icon `--text-secondary`, background `--surface-raised`.
  - **active**: background `--accent-soft`, icon `--accent`, plus an **inset 2px accent bar on the
    left edge** (`box-shadow: inset 2px 0 0 var(--accent)`). On mobile the bar moves to the bottom.
- Labels are **not** shown inline today — only as tooltip / `aria-label`. (A known ask is to add
  visible text labels; if you redraw, consider an expandable rail with label to the right of each
  icon, working for every module's icon set.)

**Admin rail items** (in order, each = icon + label):

| # | Label                     | Icon (lucide-ish)        |
|---|---------------------------|--------------------------|
| 1 | Knowledge Base            | database / cylinder      |
| 2 | Train                     | cloud-upload             |
| 3 | Knowledge Browser         | search                   |
| 4 | Carrier User Management   | users (2 people)         |
| 5 | Audit Log                 | history / clock-rewind   |
| 6 | Octane-Scope              | hash / blueprint         |

---

## 4. CENTER — Carrier User Management (the captured screen)

Panel: flex column, gap 16px, padding 24px, `max-width 1180px`.

### 4.1 Header row
```
Carrier User Management                              [ + New carrier user ]
Give carrier companies login access — fleet
owners see every card, drivers see one.
```
- **Title (`h2`)** — display font (Rajdhani), `--text-2xl` (26px), bold, `line-height:1`.
- **Subtitle** — `--text-sm` (13px), `--text-muted`. Copy: *"Give carrier companies login access —
  fleet owners see every card, drivers see one."*
- **Primary button** (top-right) — `+ New carrier user`. Accent background `--accent`, text
  `--on-accent`, 32px tall, `--radius-md`, leading `+` icon. When the create form is open this
  swaps to a **ghost** button `✕ Cancel`.

### 4.2 Filter bar
```
[ 🔍  Filter accounts — company, carrier id, application id, login, card…   0 accounts ]
```
- 34px tall, `--surface-alt` background, 1px `--border`, `--radius-md`, max-width 340px.
- Leading search icon; trailing **count chip** — `N account(s)`.
- Focus: border → `--accent`, 3px `--accent-glow` ring.

### 4.3 Accounts table
Card container: 1px `--border`, `--radius-lg`, `--surface` background, clipped corners.

**7-column grid** (fractions: `1.5 / 0.75 / 1.05 / 1.05 / 1 / 0.7 / 1.35`):

| ACCOUNT | PROFILE | CARRIER · APP | CARD · PARENT | AGENT | STATUS | ACTIONS |
|---------|---------|---------------|---------------|-------|--------|---------|

- **Header row (`tHead`)** — `--surface-alt` bg, uppercase, `--text-2xs` (10.5px), bold, tracked
  (0.08em), `--text-muted`. STATUS + ACTIONS are right-aligned.
- **Body rows (`tRow`)** — 13px, zebra striping (even rows tinted `--surface-alt` @45%), hover
  `--surface-raised`, 1px `--border-light` divider.
  - **Account** — two lines: `login` (semibold, primary) over company name (muted sub). Falls back
    to `no company on file`.
  - **Profile** — pill. Owner = **info pill** (accent tint), Driver = **neutral pill** (grey).
  - **Carrier · App** — mono `carrierId` over `app <id>` (muted mono sub). If no carrier: a small
    `Set carrier…` mini-button instead.
  - **Card · Parent** — *driver:* mono `cardId` (or `no card yet`) over `↳ <parent login>`.
    *owner:* an em-dash `—`.
  - **Agent** — `agentName` (secondary text) or `—`.
  - **Status** — pill with a 5px leading dot. Active = **good pill** (green tint), Disabled = **bad
    pill** (red tint).
  - **Actions** (right, inline mini-buttons): `Card` (driver only) · `Reset pw` · `Disable`/`Enable`
    · `Delete` (danger style, red text).

**Table states**
- *Loading:* single muted row — `Loading carrier users…`
- *Empty (no users):* muted line + primary button:
  `No carrier users yet.   [ + Create the first owner ]`
- *Empty (filter miss):* `No accounts match your filter.`

### 4.4 Notices (appear above the filter when present)
- **Notice** (`role=status`) — success/info line, accent-tinted. e.g. password-created / disabled
  messages.
- **Error** (`role=alert`) — danger-tinted line.

### 4.5 Create form (inline card, shown when "New carrier user" is clicked)
A single padded card, `--radius-lg`, three labelled steps. Each step opens with an **eyebrow**
(uppercase, 10.5px, tracked, muted).

**Step 1 · Account type**
- Segmented toggle: `Owner | Driver` (selected = `toggleOn`, accent).
- Hint under it: owner → *"The fleet account — sees every card of the carrier."*; driver →
  *"Belongs to an owner and sees one card only (with that card's limits)."*

**Step 2 · Which client** (owner) / **Which fleet + card** (driver)
- *Owner, searching:* a search field *"Search your clients — company name, carrier id, or
  application id"* → dropdown of results (company title + `carrier … · app … · applied … · stage`).
  Hint: *"Newest applications first. Enter the details manually instead"* (link).
- *Owner, picked:* a **picked card** showing the company + carrier/app/date/stage + a `Change`
  mini-button.
- *Owner, manual:* 3 fields — Company name / Carrier Id (mono) / Application Id (mono) + hint
  *"At least one id — application works before the carrier exists."* + `← Back to client search`.
- *Driver:* two fields — **Fleet account (owner)** select (`Choose…` + owners) with hint *"The
  driver inherits this fleet's company access."* and **Card Id** (mono, optional) with hint *"The
  one card this driver can see."*

**Step 3 · Credentials**
- **Login** (placeholder `acme.owner` / `acme.driver1`, min 3).
- **Password** — mono input + `Generate` mini-button; hint *"Shown (and copied) once on create —
  share it securely."*
- **Octane agent** — text input with a datalist of agents; hint owner → *"Filled from the picked
  client's deal owner."*, driver → *"Optional."*

**Submit row**
- Primary button `Create owner` / `Create driver` (disabled until valid; `Creating…` while busy).
- Trailing muted **blocker hint** explaining what's missing (e.g. *"Pick a client (or enter a
  carrier / application id manually)."*).

---

## 5. AI Chat dock (right rail, shared by every module)

```
┌───────────────────────────────────────────────┐
│ ◆ AI Chat                    [⟲ History] [+ New]│
│   Knowledge-grounded · scope: admin            │
├───────────────────────────────────────────────┤
│                                               │
│                    ◆  (gem)                    │
│                 Ask Mytrion                    │
│      Grounded in your knowledge base and       │
│    scoped to your department — ask about       │
│    policies, carriers, invoices, tickets,      │
│                  and more.                      │
│                                               │
├───────────────────────────────────────────────┤
│ [ Ask the knowledge base…              →  ]   │
└───────────────────────────────────────────────┘
```

- **Header:** a **gem avatar** (the `--gem` gradient, 135° blue→purple→coral, white sparkle) +
  `AI Chat` title + sub `Knowledge-grounded · scope: <module>`. Right side: `History` (clock icon)
  and `New` (plus icon) buttons.
- **Empty state:** centered gem icon, **Ask Mytrion** heading, and the grounding blurb: *"Grounded
  in your knowledge base and scoped to your department — ask about policies, carriers, invoices,
  tickets, and more."*
- **Composer:** rounded input *"Ask the knowledge base…"* + a circular **Send** button (arrow-right,
  accent background, `--on-accent` arrow), disabled while empty; a Stop affordance appears while
  streaming.

The gem is the AI-surface brand; the orange FuelMark is the app/masthead brand. Keep them distinct.

---

## 6. Component inventory (reusable)

| Component        | Shape / notes                                                                 |
|------------------|-------------------------------------------------------------------------------|
| Primary button   | accent bg, on-accent text, 32px, `--radius-md`, semibold, optional leading icon |
| Ghost button     | transparent, border, muted text (used for Cancel)                             |
| Mini button      | small inline text button for row/step actions; `miniDanger` = red text        |
| Link button      | text-only accent link inside hints                                            |
| Segmented toggle | 2 options, selected pill is accent                                            |
| Status pill      | rounded-full, tint bg + tint border + status text; variants good/warn/bad/info/neutral; optional 5px leading dot or 8px spinner |
| Search field     | 34px, surface-alt, leading icon, focus accent ring                            |
| Table            | bordered card, surface-alt header, zebra rows, hover raise                    |
| Panel head       | display-font title + muted sub, action on the right                           |
| Eyebrow          | uppercase tracked micro-label above a group                                   |
| Card             | bordered, `--radius-lg`, surface bg, `cardPad` = 20px                          |

---

## 7. The other 8 modules (same frame, different skin)

Same `MytrionShell` + chat dock. Each module sets `data-mytrion="<id>"` on its root, which swaps the
accent tokens (see `DESIGN_TOKENS.md §6`). Tags shown in the topbar badge:

| Module id          | Badge          | Accent family |
|--------------------|----------------|---------------|
| admin              | RnD            | cyan          |
| sales              | Sales          | blue          |
| billing            | Billing        | purple        |
| collection         | Collection     | red           |
| finance            | Finance        | green         |
| customer-service   | Customer Svc   | amber         |
| retention          | Retention      | pink          |
| verification       | Verification   | indigo        |
| manager            | Manager        | teal          |

Only the accent + rail icon set + center content differ; everything structural is identical.

---

## 8. Redraw checklist

- [ ] Two themes: dark ("Soft Midnight", default) and light. Every surface reads from tokens.
- [ ] Two brand marks: orange **FuelMark** (app) vs multicolor **gem** (AI). Don't merge them.
- [ ] Display font (Rajdhani) only on titles/wordmark; body font (Inter) everywhere else; mono
      (JetBrains Mono) for ids/passwords/cards.
- [ ] Rail active marker = accent-soft square + inset accent edge bar.
- [ ] Status is always a pill (never bare text); ids are always mono.
- [ ] Chat dock is a persistent surface, not a modal — beside the content on desktop, stacked below
      on narrow.
