# Mytrion CRM — UI/UX Polish Brief

**This document is a prompt.** Hand it to Claude (a design/frontend agent) working inside this repo.
It is written to the best-practice structure — `<context>`, `<design_direction>`, `<current_system>`,
`<constraints>`, `<task>`, `<deliverables>` — with concrete tokens, exact file paths, and every screen
enumerated, so nothing is left to guesswork or "visual vibes." Read it top to bottom before touching code.

---

## Mission (read first)

You are a senior product designer + front-end engineer. Your job is to take an already-functional
internal CRM (`apps/mytrion-crm`) and elevate it to a **premium, cohesive, comfortable** product that
Octane's staff use for hours a day — polishing **every page, every component, the app shell, and every
interaction state (hover, focus, active, disabled, loading, empty, error)** down to the smallest detail.

This is a **polish and systematization pass, not a rebuild.** Functionality, routing, auth, and data flow
already work — do not regress them. You are raising the visual + interaction quality and, critically,
making it **consistent** across a codebase that currently speaks two different visual languages.

Success looks like: a stranger opening any screen cannot tell which module was built first; every
interactive element gives immediate, eased feedback; the keyboard user always sees where they are; the
app feels calm and fast at high information density; and it is beautiful in **both dark and light themes**.

---

<context>

**Product:** Mytrion CRM — the internal web app for **Octane** (a fuel-card company). It is an
operations cockpit: a portal of 9 department "Mytrions" (Sales, Billing, Collection, Finance, Retention,
Verification, Customer Service, Admin, Manager), each a workspace of dashboards, data tables, record
detail modals, and a docked AI assistant.

**Users:** Octane employees — sales reps, billing/finance staff, collections & retention agents,
verification analysts, customer-service reps, admins/managers. They are **power users** who live in this
app all day. They value: information density without clutter, speed, scannable numbers, keyboard
efficiency, and low eye-fatigue over long sessions. This is a professional tool, not a marketing site —
premium means *Linear / Stripe Dashboard / Vercel / Height*, **not** flashy or playful.

**Brand:** Fuel/energy. Logo `FuelMark` = orange gradient gem + sparkle. Wordmark "MYTRION AI"
(Rajdhani, uppercase). The AI assistant uses a "Gem" tri-color gradient mark. Each Mytrion has its own
accent hue (see token tables). Tone: confident, precise, quietly high-end.

**Tech stack (respect these — they shape *how* you implement):**
- React 18 + TypeScript (strict; no `any`), React Router v6, Vite.
- **Tailwind CSS v4, CSS-first config** — there is **no `tailwind.config.js`**. The theme lives in an
  `@theme inline { … }` block in `src/styles/global.css`. Tokens live in `src/styles/theme.css`.
- **shadcn-style primitives built on Base UI** (not Radix) in `src/components/ui/*` — only `button`,
  `badge`, `dialog`, `avatar` exist today.
- **CSS Modules** (`*.module.css`) for the app shell, auth screens, brand, and chat (labeled "legacy").
- `cn()` helper = `clsx` + `tailwind-merge` (`src/lib/utils.ts`); `class-variance-authority` for variants;
  `lucide-react` for icons (plus a hand-rolled `src/components/icons.tsx`).
- Theming: `<html data-theme="dark|light">` attribute cascade (default **dark**), persisted to
  `localStorage['mytrion-theme']`. **No `dark:` variants** — theming is pure CSS-variable cascade.
- Per-module accent: `data-mytrion="<id>"` on each module root overrides `--accent`.

**Repo location:** `/Users/user/Desktop/mytrion-ops/apps/mytrion-crm`.
**Verify commands (run from that dir):** `corepack pnpm build` (tsc + vite build) and `corepack pnpm dev`
(Vite on **:5173**). All data is **mock** (`data.ts` / `dashboardData.ts` per module) — do not wire APIs.

</context>

---

<design_direction>

**"Premium + comfortable" means, concretely:**

1. **One visual language.** The single biggest problem today is that the shell/auth/chat (CSS Modules,
   raw px) and the module pages (Tailwind + shadcn) look and feel like two different apps. Unify them
   onto **one token-driven system**. Every color, size, radius, shadow, and motion value comes from a
   token — zero arbitrary `text-[13px]` / raw-px / hardcoded hex.
2. **Calm density.** Power users want a lot on screen. Achieve density with *hierarchy and spacing
   rhythm*, not shrinking everything. Establish a real type scale and spacing scale; use whitespace,
   weight, and color-value (not borders everywhere) to separate content. Reduce visual noise: fewer
   hard borders, softer elevation, consistent tint usage.
3. **Immediate, eased feedback.** Every interactive element (button, link, nav item, tab, row, card,
   input, chip, avatar, toggle) must have **hover, focus-visible, active, disabled, and (where relevant)
   selected/loading** states, with a **consistent transition** (motion token). Nothing snaps.
4. **Keyboard-first accessibility.** Visible `:focus-visible` rings everywhere (token-driven), logical
   tab order, ARIA on interactive/stateful components, target **WCAG 2.1 AA** contrast in *both* themes.
   Honor `prefers-reduced-motion`.
5. **Motion with purpose.** Micro-interactions that aid comprehension (state transitions, modal
   enter/exit, streaming/loading, hover elevation) — subtle, fast (120–220ms), never decorative jank.
6. **Data-first surfaces.** Tables, KPI tiles, charts, and record modals are the heart of this app.
   Make them exemplary: aligned numerals (tabular/mono), clear status semantics, zebra/hover rows,
   sticky headers, empty/loading/error states, scannable KPI hierarchy.
7. **Dark-first, light-perfect.** Dark is the default and must feel like a premium "soft midnight"
   surface (not pure black). Light must be equally polished, not an afterthought. Per-module accents
   must remain legible on both.
8. **Cohesive brand moments.** The FuelMark, the Gem assistant mark, and the per-module accent are the
   brand's personality — use them deliberately (masthead, AI surfaces, active states), not everywhere.

Reference bar (feel, not copy): **Linear** (density + calm + keyboard), **Stripe Dashboard** (data
clarity, tables, forms), **Vercel/Geist** (restraint, typography), **Height/Attio** (CRM record UX).

</design_direction>

---

<current_system>

### Color tokens (from `src/styles/theme.css` — the source of truth; build on these)

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--bg-primary` | `#0b0e13` | `#f6f8fb` | app background |
| `--bg-secondary` | `#0f131a` | `#eef1f6` | secondary bg |
| `--surface` | `#161a22` | `#ffffff` | cards / panels |
| `--surface-alt` | `#11151c` | `#f3f5f9` | muted surface |
| `--surface-raised` | `rgba(255,255,255,.045)` | `rgba(16,24,40,.035)` | subtle raised fill |
| `--sidebar-bg` / `--header-bg` | `#0d1117` | `#ffffff` | rails / header |
| `--text-primary` | `#e7eaf0` | `#18202e` | primary text |
| `--text-secondary` | `#a9b0bd` | `#4d5666` | secondary |
| `--text-muted` | `#6e7682` | `#8a92a1` | muted / labels |
| `--border` / `-light` / `-dark` | `rgba(255,255,255,.09 / .06 / .045)` | `rgba(20,30,50,.10 / .07 / .05)` | borders |
| `--accent` / `-strong` | `#38bef0` / `#2cb6ec` | `#0c8fc7` / `#0e9ad6` | brand accent (cyan base) |
| `--on-accent` | `#04131c` | `#ffffff` | text on accent |
| `--accent-soft` / `--accent-glow` | `rgba(56,190,240,.12 / .26)` | `rgba(12,143,199,.10 / .20)` | tint / focus glow |
| `--success` | `#34d399` | `#1f9d62` | good |
| `--warning` | `#fbbf4d` | `#b9791a` | warn |
| `--danger` | `#f4716f` | `#d14545` | bad / error |
| `--purple` | `#a78bfa` | `#6d52d6` | brand purple |
| `--orange` | `#fb8a3c` | `#d9641a` | brand orange |

**Brand marks:** `--fuel: linear-gradient(135deg,#fb923c,#f97316)` (FuelMark); `--gem:
linear-gradient(135deg,#4285f4 0%,#9b72cb 52%,#d96570 100%)` (AI Gem).

**Per-module accent overrides** (`data-mytrion`, `src/styles/global.css`) — dark / light:
billing `#8b5cf6`/`#7c3aed` · collection `#f0564e`/`#d5342b` · sales `#38bdf8`/`#2563eb` ·
finance `#10b981`/`#0e9e6e` · customer-service `#e0a83e`/`#b4770f` · retention `#e85dc0`/`#c0269e` ·
verification `#5a8dff`/`#2563eb` · **admin & manager** inherit the cyan base (give them intentional
accents too). *Note: base `--accent` `#38bef0` vs sales `#38bdf8` are near-dupes — reconcile.*

### Type / radii / shadow / motion

- **Fonts** (currently loaded from **Google Fonts CDN** in `index.html` — **self-host them** to satisfy
  CSP/offline; the bundle ships into a Zoho widget): **Rajdhani** 500/600/700 (`--font-head`, headings +
  numerals), **Inter** 400/500/600/700/800 (`--font-body`), **JetBrains Mono** 400/500 (`--font-mono`, IDs).
- **Radii:** `--radius-sm 5px`, `-md 9px`, `-lg 13px`, `-full 999px` (note `rounded-xl` is aliased to
  `-lg`; a stray `rounded-4xl`/32px exists on badges — normalize).
- **Shadows:** `--shadow-sm/md/lg` tokenized (dark uses deep `rgba(0,0,0,…)`, light uses soft blue-gray).
- Base body: Inter, `14px`, line-height `1.5`.

### What is NOT tokenized yet (you must add these — highest-value work)

- **Type scale** — today there are ~189 arbitrary `text-[Npx]` values in JSX (8.5–38px) *plus* a parallel
  15-value raw-px scale in the CSS modules. Define a real scale (e.g. `--text-2xs … --text-3xl` with
  size/line-height/weight) and migrate everything to it.
- **Spacing scale** — no tokens; raw px + Tailwind defaults mixed. Define a 4px-based rhythm.
- **Motion** — no duration/easing tokens; hovers are ~49:2 abrupt-vs-eased. Define
  `--dur-fast/base/slow` + `--ease-standard/emphasized`.
- **Z-index** — only ad-hoc `z-50` and a stray `z-100`. Define a scale (dropdown/sticky/modal/toast).
- **Breakpoints** — CSS modules use 280/420/640/900/1180; JSX uses Tailwind 640/768/1024/1280. Unify.
- **Status tint scale** — the good/warn/bad tint background appears at `/10`, `/12`, and `/14` in three
  places. Define one tint token per status and use it everywhere.

### Styling systems + primitives (the consolidation targets)

- **Reuse layer to grow (Tailwind, token-driven):** `src/components/mytrion/` — `stat-card`,
  `status-badge`, `segmented-filter`, `search-bar`, `detail-dialog` (the shared record-modal shell used
  by most modules). `src/components/ui/` — `button`, `badge`, `dialog`, `avatar` (Base-UI-backed).
- **Missing primitives done ad-hoc inline** (create proper shared components): **input, select,
  dropdown/menu, tooltip, tabs, card, table, toggle/switch, checkbox, skeleton, toast**. Cards are
  `rounded-lg border bg-card` copy-pasted everywhere; there are **5 separate Toast implementations**
  (sales/retention/verification/customer-service + none shared) — extract **one**.
- **CSS-Module shell to reconcile:** `TopBar`, `MytrionShell`, `MytrionScaffold`, `BrandMark`, `Gem`,
  `app/Screen.module.css` (auth screens), `features/chat/*`.
- **Charts are hand-rolled** (SVG polyline, CSS bars/donut/conic-gradient) — keep them dependency-free
  and make them a consistent, polished chart primitive set; do **not** add a heavy chart lib.

</current_system>

---

<screen_inventory>

Polish **all** of the following. Sub-screens inside a module are tab state (left icon rail), not routes.

**App shell & entry:** `App` → `AppRouter`; `WorkerLayout` (auth gate) · `UserContextProvider`
"Signing you in…" boot card · `TopBar` (58px: brand, context badge, theme toggle, Switch Mytrion,
identity, avatar, Sign out) · `MytrionShell` (TopBar + left icon nav rail + center content + docked AI
chat on the right) · `MytrionScaffold` (stub placeholder).

**Auth / entry screens** (`src/app/`, `Screen.module.css`): `LoginGate` (Sign in with Zoho) ·
`ClientLogin` (public `/client` placeholder) · `MytrionPicker` (welcome + grid of Mytrion cards) ·
`Forbidden` (403) · `NotFound` (404).

**AI Chat** (`src/features/chat/`, docked in every module): `ChatPanel` (header + Gem + New) ·
`MessageList` (transcript + empty state) · `MessageBubble` (user/assistant, tool-call chips, thinking
dots, streaming caret, "Grounded in N passages", errors) · `Composer` (auto-grow textarea, send) ·
`ConversationList` (built but unmounted — consider surfacing history).

**Modules** (`src/mytrions/<id>/`):
- **Sales** (built, 7 tabs): Home (greeting, workday bar, announcements, KPI grid, activity tiles, CTAs,
  inbox preview) · Inbox · DataCenter (5 KPIs + client table) · Create (3 forms) · Automations (action
  cards + run modal) · Dashboard (Sales/Invoices/Debtors: donuts, utilization meter, bar rows, SVG
  line/area chart, aging stacked bar) · Carriers. Modals: Client/Carrier/Automation/Announcement.
- **Billing** (built, 3 tabs): DataCenter (deals table → DealDetail → EditDeal w/ selects) ·
  Transactions (grouped by date, source tags) · Debtors (8-col table → DebtorDetail).
- **Collection** (built, 3 tabs): Cases (**6-col Kanban**, draggable-feel cards → CaseDetail w/
  escalation stepper + payment-plan bar) · ArrayReport (wide 10-col table + Excel export) · Inbox.
- **Finance** (built, 6 tabs): Home (Parent Balance hero) · SmartBalance (sweep list) · Audits ·
  Transactions · Dashboard (Debtors/Payments/Fueling/Segments: AR aging bars, day/hour bar charts,
  conic-gradient donut) · Clients (→ Drilldown w/ 4 inner tabs).
- **Retention** (built, 3 tabs): Cases (**risk-colored Kanban**) · OpenPool (11-col table w/ checkboxes
  + bulk assign) · Inbox.
- **Verification** (built, 3 tabs): Applications (2 sub-tabs, step-dot tables → the rich
  ApplicationModal: 4-step tracker, vendor checks, hard-stop cards, decision panel) · Configuration
  (vendor toggle cards + threshold tables) · Inbox.
- **Customer Service** (built, 4 tabs): Home (team stats, priority meters) · Applications (onboarding
  segments) · CitiFuel (clients table) · Analytics (delta pills, volume bars, leaderboard).
- **Admin** (partial): KnowledgeBase (doc list + search) is built; **Train, Knowledge-browser,
  Octane-Scope tabs are dead `TODO`s that always render KnowledgeBase** — design + build these three.
- **Manager** (stub): only `MytrionScaffold` — design the real workspace (cross-dept KPI roll-up,
  approvals/escalations queue, team metrics).

Shared record modal `components/mytrion/detail-dialog.tsx` and KPI `stat-card`, `status-badge`,
`segmented-filter`, `search-bar` are used across most of the above — polishing them lifts every module.

</screen_inventory>

---

<known_issues>

From an interaction audit (fix these as part of the pass; P0 = most impactful):

- **P0 — Two visual systems.** Shell/auth/chat (CSS Modules) vs modules (Tailwind+shadcn). Unify.
- **P0 — Missing `:focus-visible`.** Present in only ~2 files. Keyboard users can't see focus. Add a
  global, token-driven focus ring to every interactive element.
- **P0 — Missing token scales.** Type, spacing, motion, z-index, breakpoints, status-tint (see above).
- **P1 — Abrupt state changes.** ~49 hovers with no transition vs ~2 eased. Add motion tokens + apply.
- **P1 — 5 divergent Toast implementations** and ad-hoc modals — consolidate to shared primitives.
- **P1 — Missing loading / empty / error states** on many data surfaces (tables, dashboards). Design a
  consistent set (skeletons, empty illustrations/copy, inline errors + retry).
- **P1 — Inconsistent interactive patterns** (raw `<button>`s in `segmented-filter`/`search-bar`;
  two icon systems). Standardize.
- **P2 — Hardcoded values:** `#fff` inline in BrandMark/Gem/Screen; `--danger` fallback `#d64545`
  matches neither theme; radii sprawl (`7px`, `10px`, `18px`, `rounded-4xl`); tint opacity drift.
- **P2 — Stale references** to a non-existent `docs/design-mockups/design-tokens.md` in comments.
- **P2 — Fonts via CDN** — self-host.
- **Config drift:** `mytrions.config.ts` marks collection/retention/verification as `status:'new'` though
  they're fully built; ensure "New/Ported" badges in the picker reflect reality.

</known_issues>

---

<constraints>

**Do:**
- Keep it a **polish pass** — preserve all routes, auth gate, RBAC, `useUserContext`, chat wiring, and the
  mock-data contracts (`data.ts`, `dashboardData.ts`). Change presentation, not behavior.
- Work **token-first**: extend `theme.css` + the `@theme inline` bridge in `global.css`, then refactor
  components to consume tokens. Output developer-ready values (hex, CSS custom properties, and a
  JSON/TS token map if helpful).
- Keep both **dark + light** perfect and all **per-module accents** working via the existing
  `data-theme` / `data-mytrion` cascade (no `dark:` classes).
- Grow the shared layers (`components/ui/*`, `components/mytrion/*`); delete duplication.
- Maintain strict TypeScript (no `any`), ESM, and reasonable file sizes. Run `corepack pnpm build` green.
- Enumerate and design **every state** for each component (the audit found the gaps — close them).
- Target **WCAG 2.1 AA**; honor `prefers-reduced-motion`.

**Don't:**
- Don't introduce heavy dependencies (no chart lib, no component kit swap, no CSS-in-JS). Tailwind v4 +
  the existing Base-UI primitives + CSS vars only. **No `tailwind.config.js`** — this is CSS-first v4.
- Don't add external network requests (CSP: the widget ships same-origin; self-host fonts/assets).
- Don't rely on visual judgment you can't verify — produce concrete specs (tokens, states, measurements)
  and verify with a build + both-theme + keyboard pass. (Per best practice: Claude is for systematic
  design specs and implementation, not "does this *feel* right" — leave final taste calls to the human.)
- Don't rename routes/props/exports that other code depends on.

</constraints>

---

<task>

Work in phases. After each phase, `corepack pnpm build` must stay green and both themes must render.

1. **Foundational tokens.** In `src/styles/theme.css` + the `@theme inline` block in `global.css`, add
   the missing scales — **type** (size + line-height + weight, e.g. `2xs…3xl`), **spacing** (4px rhythm),
   **motion** (`--dur-fast/base/slow`, `--ease-*`), **z-index**, **breakpoints**, and **status-tint**
   (good/warn/bad/info/neutral bg + fg). Reconcile radii; fix the `--danger` fallback and near-dupe
   accents; self-host fonts. Document the full token set at the top of `theme.css` (kill the stale
   `design-mockups` references).
2. **Primitive library.** Bring `components/ui/*` and `components/mytrion/*` to a gold standard, and add
   the missing primitives: **input, select, dropdown/menu, tooltip, tabs, card, table, toggle/switch,
   checkbox, skeleton, and ONE shared toast**. Every primitive ships all states (hover/focus-visible/
   active/disabled/selected/loading) + transitions, in both themes. Replace the 5 toasts and ad-hoc
   buttons/cards with these.
3. **App shell.** Reconcile `TopBar`, `MytrionShell` (nav rail, content frame, chat dock), and the auth
   screens (`Screen.module.css`) onto the token system — either Tailwind or token-driven CSS modules,
   but visually identical language to the modules. Polish the masthead, nav rail (active/hover/tooltip),
   theme toggle, avatar/identity, and the "Signing you in…" boot state.
4. **Global interaction + a11y layer.** Add the token-driven `:focus-visible` ring globally, consistent
   hover/active transitions, `prefers-reduced-motion` handling, and ARIA/roles on interactive/stateful
   components. Verify keyboard nav across a full module.
5. **Data surfaces.** Elevate the shared **table**, **KPI stat-card**, **chart** primitives, and the
   **detail-dialog** record modal: alignment, tabular numerals, status semantics, row hover/zebra,
   sticky headers, and consistent **loading (skeleton) / empty / error** states. These lift every module.
6. **Per-page polish — every screen in `<screen_inventory>`.** Go module by module (Sales → Billing →
   Collection → Finance → Retention → Verification → Customer Service → Admin → Manager), then auth
   screens, then chat. For each: apply tokens, fix spacing/hierarchy/alignment, wire the polished
   primitives, add missing states, and refine the module's signature surfaces (Kanban boards, dashboards/
   charts, wide tables, rich modals). **Build out** Admin's three dead tabs and Manager's workspace.
7. **Motion & micro-interactions.** Modal enter/exit, tab/nav transitions, hover elevation, toast
   in/out, chat streaming/thinking, KPI/chart mount — subtle, fast, reduced-motion-safe.
8. **Cross-theme + responsive QA.** Every screen in dark + light + its module accent; every CSS-module
   breakpoint reconciled to the unified set; no horizontal overflow; tables scroll within their own
   container.

</task>

---

<deliverables>

1. **An updated token system** (`theme.css` + `global.css`) with the full documented scale set, plus a
   short **`DESIGN_SYSTEM.md`** in this folder describing tokens, primitives, states, and usage rules
   (the durable style guide; replaces the stale mockups reference).
2. **A polished primitive library** (`components/ui/*` + `components/mytrion/*`) with all states, both
   themes — and the duplicates (5 toasts, ad-hoc modals/buttons/cards) removed.
3. **Every screen** in `<screen_inventory>` visually polished and consistent, including Admin's 3 new
   tabs and the Manager workspace.
4. A green `corepack pnpm build`, strict TS, no new external requests.

### Acceptance criteria (a change is "done" only when all hold)
- No arbitrary `text-[Npx]` / raw-px sizes / hardcoded hex remain — all reference tokens.
- Every interactive element has hover + **visible focus-visible** + active + disabled (+ selected/
  loading where relevant), each with a motion-token transition; `prefers-reduced-motion` respected.
- Shell/auth/chat and module pages are visually indistinguishable in language.
- Dark **and** light are both polished on every screen; per-module accents legible in both.
- Every data table/dashboard has loading, empty, and error states.
- WCAG 2.1 AA contrast on text/controls in both themes; full keyboard operability.
- `corepack pnpm build` green; no functional/route/auth regressions.

</deliverables>

---

<pro_tips>

- **Start by reading, then tokenize, then refactor.** Read `theme.css`, `global.css`, one gold-standard
  Tailwind screen (e.g. `mytrions/finance/Dashboard.tsx`), and one CSS-module surface (`TopBar`,
  `ChatPanel`) to feel both languages before you change anything.
- **Enumerate every state per component** — the audit proved states are the main gap. For each
  component, explicitly list and implement: default, hover, focus-visible, active, disabled, selected,
  loading, empty, error. Missing states are where "cheap" shows.
- **Be specific and developer-ready** — every proposal in hex / px / rem / token names / CSS properties,
  never "make it nicer." Include before/after token values.
- **Verify, don't vibe** — after each phase run `corepack pnpm build`, then eyeball the screen in dark,
  light, and the module accent, and Tab through it. Leave subjective final taste calls to the human
  reviewer; your job is a correct, consistent, complete system.
- **One module at a time**, smallest-diff-that-lifts-the-most-first (tokens → shared primitives → shell →
  pages). The shared `stat-card` / `status-badge` / `table` / `detail-dialog` give the biggest lift per edit.

</pro_tips>
