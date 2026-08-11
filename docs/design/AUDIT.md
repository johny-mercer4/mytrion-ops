# Mytrion Horizon — Design System Audit (Phase 1)

**Date:** 2026-08-09 · **Branch:** `feature/Redesigner` · **Scope:** `apps/mytrion-crm/src`
**Re-audited at HEAD `41159b94`** (first pass was taken at `41e087f7`, 8 commits earlier).
**Status:** Audit only. No tokens or components written.
**Purpose of the system:** feed **Claude Design** (claude.ai/design) so redesign happens against
Horizon's real components — see §8, which constrains Phase 3's architecture.

---

## 0a. What the 8 in-flight commits changed

The branch advanced mid-audit. The structural de-forking landed; **value-level tokenization did
not move.** Every number below was re-measured at HEAD.

| Metric | at `41e087f7` | at `41159b94` | Δ |
| --- | ---: | ---: | ---: |
| CSS files / lines | 110 / 45,357 | 114 / 44,491 | +4 / **−866** |
| Hex literals (non-token files) | 519 | 480 | −39 (−8%) |
| `rgba()` literals | 477 | 399 | −78 (−16%) |
| `font-size` hardcoded | 1,164 | **1,146** | −18 (−2%) |
| `border-radius` hardcoded | 393 | **385** | −8 (−2%) |
| Spacing hardcoded | 2,377 | **2,339** | −38 (−2%) |
| `z-index` hardcoded | 102 | 89 | −13 |
| `backdrop-filter` | 294 / 45 files | 282 / **46 files** | −12 |
| Raw `<button>` | 773 | 759 | −14 |
| `.btn*` selectors | 139 | **139** | **0** |

**Read this as: the shell layer got fixed, the token layer did not.** Structural commits
(`70b43e1b` page contract, `88017761` Billing, `ea8a8567` CS, `5e239026` Sales onto `MytrionShell`)
removed 866 lines of duplicated chrome. But hardcoded values moved 2%, and the button divergence
moved 0%. That is the honest before/after: **Phase 2's target is entirely untouched by this work.**

**Two audit findings changed status:**

- ✅ **P0-2 (stale bundle) is FIXED.** `c2d29efa` and `41159b94` rebuilt `app/`; it is now at HEAD
  with 0 commits of drift. Rajdhani, Outfit, Instrument Sans and JetBrains Mono are gone from the
  shipped CSS. One straggler remains: `font-family:Inter,Roboto,sans-serif`.
- ❌ **P0-1 (font cycle) is STILL PRESENT** — `theme.css:197-198` and `hr-polish.css:7-8` unchanged.
  **This is now worse, not better:** the bundle is current, so the cycle is live in production. The
  rebuilt CSS is full of `font-family:var(--font-body)` declarations that resolve to nothing.

---

## 0. Headline

**A canonical design system already exists, and it landed five commits ago.** `cdc3f40c feat(design):
one token system — Horizon palette, two-step radius, two fonts, one accent` plus the three shell
commits after it are exactly the work Phase 2/3 of the brief describes. The brief was written as if
starting from zero; it is not. **The correct Phase 2 is repair + extension of `src/styles/`, not a
fresh token layer.** Authoring a second system is the one outcome that would make the stated problem
worse.

The real problem is not that a system is missing. It is that **the system is declared but not
enforced past the module boundary**:

| | Tokenized | Hardcoded | Untokenized |
| --- | ---: | ---: | ---: |
| Spacing (`padding`/`margin`/`gap`) | 315 | **2,339** | **88%** |
| `font-size` | 401 | **1,146** | **74%** |
| `z-index` | 8 | **89** | **92%** |
| `border-radius` | 647 | **385** | **37%** |

Plus **480 hex literals** and **399 `rgba()` literals** in module CSS, against a token file whose
first line reads *"THE ONLY FILE IN THE APP THAT MAY CONTAIN A HEX LITERAL."*

The defects in §2 should be fixed before any Phase 2 work. P0-2 has since been fixed by the in-flight
commits (§0a); P0-1 is still live and is now shipping to production.

---

## 1. Stack

| Concern | Actual | Notes |
| --- | --- | --- |
| Framework | React 18.3.1 + TypeScript 5.6, `react-router-dom` 6.26 | |
| Build | Vite 5.4, `base: './'`, `outDir: app/` | Builds a Zoho widget bundle; committed to git |
| Styling | **Three systems at once**: Tailwind v4 utilities, CSS Modules (`*.module.css`), plain global CSS | 110 CSS files, **45,357 lines** |
| Tailwind config | **No `tailwind.config.*` file** — CSS-first via `@theme inline` in `src/styles/global.css:13` | v4 idiom; correct |
| Token layer | `src/styles/theme.css` (253L), `horizon.css` (327L), `global.css` (283L) | 196 canonical custom properties |
| Component library | **`@base-ui/react`** — 5 files (`components/ui/{avatar,badge,button,dialog,skeleton}.tsx`) | Not shadcn, not Radix, not MUI |
| Icons | `lucide-react` — 89 files | Plus 199 inline `<svg>` across 51 files, and 16 emoji-as-icon sites |
| Fonts | Space Grotesk (300–700) + Space Mono, **Google Fonts CDN** `<link>` in `index.html` | Not self-hosted, not variable woff2, no `preload` |
| Theming | `[data-theme='light']` attribute on `<html>`; `hooks/themeContext.tsx` + `hooks/useTheme.ts`; View Transitions crossfade | **No `dark:` variant, deliberately** — swap is via custom-property cascade |
| Charts | `recharts` in `package.json` — **0 importers**; charting is `@xyflow/react` (4 files) + hand-rolled SVG | |
| Enforcement | `src/styles/tokens.test.ts` (155L) — text assertions over the stylesheets | **The only automated check.** No stylelint (eslint ignores CSS), no visual regression |

### 1a. Dead dependencies — 7 packages, 0 importers

Every one of these is installed, shipped in the lockfile, and imported by nothing in `src/`:

| Package | Importers | Note |
| --- | ---: | --- |
| `@radix-ui/react-dialog` | 0 | Dialog is `@base-ui/react/dialog` |
| `@radix-ui/react-popover` | 0 | |
| `@radix-ui/react-toast` | 0 | Toast is `sonner` + 3 bespoke implementations |
| `@radix-ui/react-tooltip` | 0 | No canonical tooltip exists at all |
| `@radix-ui/react-slot` | 0 | |
| `framer-motion` | 0 | All motion is CSS |
| `recharts` | 0 | |

Removing these is a free, zero-blast-radius cleanup and shrinks the dependency surface the design
system has to reason about.

---

## 2. Defects found during the audit

These are not style opinions. They are three places where the shipped result differs from the
documented intent.

### P0-1 — `--font-head` and `--font-body` are self-referential; the app is not rendering in Space Grotesk

`src/styles/theme.css:197-198`:

```css
--font-head: var(--font-head);
--font-body: var(--font-body);
```

A custom property that references itself forms a dependency cycle. Per CSS Custom Properties Level 1,
*"If there is a cycle in the dependency graph, all the custom properties in the cycle are invalid at
computed-value time"* — they compute to the guaranteed-invalid value. So `body { font-family:
var(--font-body) }` (`global.css:107`) is an unresolvable `var()`, the declaration is dropped, and
`font-family` — an inherited property — falls back to `inherit`. It inherits from `<html>`, which
Tailwind v4 preflight sets to `var(--default-font-family, ui-sans-serif, system-ui, …)`.

**Net effect: the app body and all headings render in `system-ui`, not Space Grotesk.** Both webfonts
are still downloaded from Google Fonts on every load. `--font-mono` is validly defined, so `.num` /
`[data-num]` figures *do* get Space Mono — only head/body are broken.

The only two places that render Space Grotesk are the two modules that hardcode the literal:
`mytrions/recruit/recruit.css:12,22` and `mytrions/hr/hr-polish.css` — and `hr-polish.css:7-8`
reproduces the same cycle (`--font-body: var(--font-body)`).

`tokens.test.ts` does not catch this: its "declares every token that is consumed" check treats a
self-referential declaration as a declaration, so the token counts as declared.

> Fix is one line each — assign the literal family stack. Worth doing before Phase 2 so typography
> decisions are made against what actually renders.

### ~~P0-2~~ — ✅ FIXED at HEAD by `c2d29efa` + `41159b94`. Kept for the record.

*Original finding follows; the bundle is now current with 0 commits of drift and the four deleted
font families are gone from the shipped CSS.*

### P0-2 — The committed production bundle is 6 commits stale and predates the entire token system

Per `CLAUDE.md`, Render serves the committed `apps/mytrion-crm/app/` bundle and never runs Vite.

| | Commit | Date |
| --- | --- | --- |
| Last commit touching `src/` | `ba5bc50e` | 2026-08-09 |
| Last commit touching `app/` | `6a0bde73` | 2026-08-08 |

**6 commits to `src/` have not been rebuilt** — including all five design-system commits. The
committed CSS still contains the five families the token pass deleted:

```
font-family:"Inter",var(--font-head)
font-family:"Outfit","Inter",var(--font-head)
font-family:Rajdhani,Eurostile,Inter,sans-serif
font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif
font-family:JetBrains Mono,ui-monospace,monospace
```

**Production is not running the Horizon design system at all.** Any visual comparison against prod
is a comparison against the pre-standardization app.

### P1-3 — The token contract test exempts exactly the code that violates it

`tokens.test.ts:118-120`, the hex-literal check:

```js
const offenders = CSS_FILES.filter((f) => !f.includes('/styles/'))
  .filter((f) => !f.includes('/mytrions/'))   // module CSS is de-forked per phase, not here
```

`/mytrions/` is **86 of the 110 CSS files and ~40,000 of the 45,357 lines.** The suite is green while
519 hex literals sit in the exempted tree. Likewise the radius check only forbids `--*-r-*: <number>`
declarations — it says nothing about `border-radius: 12px` at a call site, which is where all 393
hardcoded radii live.

The test is well-built and its intent is right; the exemption is what needs to close, phase by phase,
as modules migrate. **Migration order should be driven by this exemption list.**

---

## 3. Divergent implementations

### 3.1 Page shell — mostly solved by the in-flight commits ✅

The three biggest forks now **mount on** `MytrionShell` rather than competing with it (`88017761`,
`ea8a8567`, `5e239026` — *"keep the panels, lose the chrome"*). The files still exist but are
thinner adapters, not shells:

| File | Lines (before → **now**) | Status |
| --- | ---: | --- |
| `mytrions/_shared/MytrionShell.tsx` | 429 → **429** | **Canonical.** Slot header, collapsible rail, nested nav, error boundary, chat dock |
| `mytrions/sales/redesign/Shell.tsx` | 600 → **455** | Adapter — folded in |
| `mytrions/customer-service/Shell.tsx` | 362 → **165** | Adapter — folded in |
| `mytrions/billing/Shell.tsx` | 265 → **163** | Adapter — folded in |
| `mytrions/manager/ManagerShell.tsx` | 193 → **193** | **Not yet folded in** |
| `mytrions/_shared/ModuleShell.tsx` | 181 → **181** | Second shared shell — still a fork |
| `mytrions/hr/HrShell.tsx` | 110 → **110** | **Not yet folded in** |
| `mytrions/recruit/RecruitShell.tsx` | 79 → **79** | **Not yet folded in** |
| `mytrions/finance/FinanceShell.tsx` | 50 → **50** | **Not yet folded in** |
| `mytrions/_shared/MytrionScaffold.tsx` | 40 → **40** | **Dead, 0 importers — delete** |

**Remaining Phase 3 work here is small:** fold in Manager / HR / Recruit / Finance, merge
`ModuleShell` into `MytrionShell`, delete `MytrionScaffold`. The brief's `AppShell` is ~80% built.

### 3.1a The page contract — brand new, zero adoption

`70b43e1b` added `mytrions/_shared/page.tsx` (164L) + `page.module.css` (272L) +
`table.module.css` (70L), exporting **`PageShell`, `PageHead`, `PageAction`, `Panel`, `KpiGrid`,
`KpiTile`** and a CSS-only table. It fixes the content-measure drift (`.ms-page`'s 1280 vs Sales'
inline 1180 vs Billing's none) and makes `aria-busy` single-owner.

**Importers: 0.** It is deliberately staged for incremental adoption. This is the natural spine for
Phase 3 — extend it rather than introducing a parallel set.

### 3.1b Two component sets exist; the Tailwind one is effectively dead

`page.tsx`'s header comment states the repo's decision outright: these live in `_shared` as CSS
Modules *"because `_shared` is where every module already looks, and the Tailwind set has ~zero
adoption."* Measured by real import paths:

| Component | Importers |
| --- | ---: |
| `components/mytrion/table-skeleton` | 8 |
| `components/ui/{button,dialog,badge,skeleton}` | **1 each** |
| `components/ui/avatar` | **0** |
| `components/mytrion/{stat-card,status-badge,detail-dialog}` | **0** |

**12 import sites total**, 8 of them one file. The `@base-ui`-over-Tailwind stack in
`components/ui/` and `components/mytrion/` is a system nobody adopted.

> **Phase 3 decision this forces:** the canonical layer is **CSS Modules in `_shared/`**, not
> Tailwind + `@base-ui`. That is the repo's stated choice and the adoption numbers back it. It has
> a direct consequence for Claude Design — see §8.

### 3.2 Header — one canonical component, four heights

`components/AppHeader.tsx` is genuinely canonical (landed `4e01fc4b`, "one 64px AppHeader with slot
props, replacing TopBar"), takes slots not booleans, has a test. Only 7 files reference it.

But `--header-height` is declared four times with three values: **44px, 48px, 56px, 56px** — none of
them 64. Module CSS positions sticky elements against its own local value.

`--sidebar-width` is declared twice: **238px** and **216px**.

### 3.3 Button — the worst divergence in the codebase

**Unchanged by the in-flight commits** — the shell work did not touch controls.

| Signal | Count |
| --- | ---: |
| Files importing `components/ui/button.tsx` | **1** |
| Raw `<button>` elements in TSX | **759** |
| `.btn*` class selectors defined in CSS | **139** across 15 files (Δ 0) |
| Distinct `.btn*` class names | **60+** |

A sample of the namespaces in play: `.bm-btn` / `.bm-btn-primary` / `.bm-btn-ghost` (Billing),
`.cs-btn` / `.cs-btn-primary` / `.cs-btn-danger` / `.cs-btn-ghost` (CS), `.hr-btn` / `.hr-btn-primary`
/ `.hr-btn-danger` / `.hr-icon-btn` (HR), `.mg-btn` / `.mg-btn-primary` (Manager), `.an-btn` /
`.an-btn-ghost` (Analyst), `.fi-btn` / `.fi-btn-icon` (Finance), `.co-btn`, `.ms-btn`, `.mf-btn`,
plus CSS-Module-local `.iconBtn` / `.ghostBtn` / `.dangerBtn` / `.linkBtn` / `.miniBtn` / `.backBtn`.

Every module re-derived the same four variants (primary / ghost / danger / icon) with its own
padding, radius, and hover.

### 3.4 Select / picklist — 7 bespoke components + 80 native `<select>`

| File | Shape |
| --- | --- |
| `mytrions/customer-service/SearchableSelect.tsx` | Searchable |
| `mytrions/hr/HrSelect.tsx` | Styled, `.hr-cselect-btn` |
| `mytrions/admin/PersonPicker.tsx` | People search |
| `mytrions/sales/redesign/LeadStatusPicker.tsx` | Status picklist |
| `mytrions/sales/redesign/ViewAsPicker.tsx` | Impersonation |
| `components/ActAsPicker.tsx` | Impersonation (again) |
| `features/chat/TestAsPicker.tsx` | Impersonation (a third time) |

No multi-select primitive exists. Three separate "act as another user" pickers.

### 3.5 Date & time picker — none exists

| | Count |
| --- | ---: |
| Native `<input type="date">` | **36** across 19 files |
| Native `<input type="time">` | 3 |
| `datetime-local` / `month` | 1 / 1 |
| Date-picker library | **0** |
| Files styling the native widget | 1 |

Every date field is the raw browser control, so **the app's date UI differs per browser and per OS**
and is unthemed in 18 of 19 files. This is the largest genuinely-missing primitive. The brief's
"accessible date-picker patterns" research item is warranted — there is nothing here to systematize.

### 3.6 Modal / dialog — 23 bespoke modals

`components/ui/dialog.tsx` (`@base-ui/react/dialog`) has **1 importer**. Against that: **23
`*Modal.tsx` files** and **48 `.modal*` selectors across 26 CSS files**, plus two separate
`ConfirmDialog.tsx` (`mytrions/admin/`, `mytrions/customer-service/`) and one `DealTransferDrawer.tsx`
as the only drawer.

### 3.7 Toast — 4 systems

| Implementation | Files |
| --- | --- |
| `sonner` | `App.tsx`, `mytrions/_shared/TimeOffWorkspace.tsx` |
| `mytrions/admin/toast.tsx` | bespoke |
| `mytrions/admin/scope/toast.tsx` | bespoke (a second one inside the same module) |
| `mytrions/customer-service/Toast.tsx` | bespoke |
| `@radix-ui/react-toast` | installed, 0 importers |

### 3.8 Table — no primitive

35 raw `<table>` elements across 24 files; 22 CSS files define their own table/row/cell classes. No
shared table, no pagination component, no sort affordance, no column-alignment contract beyond the
`.num` utility.

### 3.9 Empty state — ~95 distinct class names

`.ss-pool-empty` alone has 11 sub-classes (`-badge -badges -body -cta -foot -glow -ico -kicker -pill
-title`). Others: `.cs-ct-empty` (+5), `.ss-ret-empty` (+4), `.ss-tk-empty` (+3), `.bm-empty` (+2),
`.hr-empty` (+2), `.fi-empty` (+3), `.mg-empty`, `.vf-empty`, `.recruit-empty`, `.db-empty-state`,
`.pickerEmpty`, `.navEmpty`, `.emptyState`… `AutoEmptyState` is the only one with a documented
pattern.

### 3.10 Loading — 9 skeleton components, 104 keyframes

| Component | Module |
| --- | --- |
| `components/ui/skeleton.tsx` | canonical-ish |
| `components/mytrion/table-skeleton.tsx` | shared |
| `mytrions/manager/ManagerSkeletons.tsx`, `cards/efs/EfsSkeletons.tsx`, `kpi/SalesKpiSkeleton.tsx` | Manager ×3 |
| `mytrions/sales/redesign/{DashSkeleton,DataCenterSkeletons,SalesTabSkeleton,tabs/HomeSkeleton}.tsx` | Sales ×4 |

Plus 2 page loaders (`MytrionLoader`, `MytrionPageLoader`), 69 skeleton/shimmer CSS classes, and
**104 distinct `@keyframes` names** app-wide.

---

## 4. Value extraction

> **Note:** the aggregate totals in this section are re-measured at HEAD (§0a). The per-value
> frequency tables below were taken at `41e087f7`; since every aggregate moved ≤8% and the module
> forks they describe were untouched by the shell work, the rankings and the load-bearing /
> accidental split hold. Exact per-value counts will be re-derived in Phase 2 when each is migrated.

### 4.1 Color

480 hex literals in CSS outside the two token files, concentrated in the module forks:

| File | Hex count |
| --- | ---: |
| `mytrions/customer-service/styles/shared-theme.css` | 76 |
| `mytrions/billing/styles/shared-theme.css` | 65 |
| `mytrions/sales/redesign/msd.css` | 56 |
| `mytrions/sales/redesign/theme.css` | 36 |
| `mytrions/manager/managerLoyalty.css` | 29 |
| `mytrions/sales/redesign/dc-clients.css` | 28 |
| `mytrions/customer-service/styles/retention-panel.css` | 22 |
| `mytrions/_shared/TimeOffWorkspace.module.css` | 22 |
| `mytrions/hr/hr-polish.css` | 20 |
| `mytrions/analyst/analyst.css` | 20 |

Plus **168 hex literals in 18 `.tsx`/`.ts` files** (inline styles and chart configs), and **399
`rgba()` literals**.

**Most-repeated values (token files excluded):**

| Value | × | Reading |
| --- | ---: | --- |
| `#fff` / `#ffffff` | 54 | **Accidental.** Brief bans pure white as a surface; `--on-primary` (light) is already `#ffffff` |
| `#f59e0b` | 23 | **Load-bearing** — amber. Not in the token set; closest is `--warning: #fbbf4d` |
| `#000` | 18 | **Accidental.** Brief bans pure black |
| `#fbbf24` | 11 | = `--tone-amber` verbatim → should be the token |
| `#ef4444` / `#f87171` / `#dc2626` | 27 | Red family → `--danger` |
| `#38bdf8` | 11 | **The old `--tone-sky`.** `horizon.css:225` records it was moved to `#3b82f6`; these 11 sites never followed |
| `#16a34a` / `#4ade80` / `#34d399` / `#10b981` | 25 | Green family → `--success` (`#34d399` is `--success` verbatim) |
| `#b45309` / `#e11d48` / `#9f1239` / `#c2410c` / `#92400e` | 34 | Light-mode tone values, hardcoded rather than themed |

**Load-bearing brand colors (the palette to systematize from — do not replace):**

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--tint` | `#47d6ff` | `#004ee7` | Ramp start ("sky") |
| `--primary` | `#a5e7ff` | `#0043c8` | Accent — **1,204 `var(--accent*)` call sites** |
| `--primary-container` | `#00d2ff` | `#2f5fd0` | Accent fill |
| `--secondary` | `#ffaede` | `#00677f` | Ramp end ("sunset") |
| `--secondary-container` | `#ff34cd` | `#00ccf9` | |
| `--page` | `#0a0e1a` | `#e0e4f0` | |
| `--container` | `#1b1f2c` | — | Card surface (377 sites) |

The `--hz-*` compatibility layer has **2,796 call sites** — the largest token family in the app by a
wide margin. Any Phase 2 change has to keep those names resolving.

### 4.2 Type — 72 distinct sizes against a 10-step scale

1,164 hardcoded `font-size` vs 399 tokenized. Distinct hardcoded values: **72**.

| Value | × | Verdict |
| --- | ---: | --- |
| `11px` | 102 | **Load-bearing but off-scale** — no `--text-*` step is 11px |
| `13px` | 99 | On scale (`--text-sm`) |
| `12px` | 86 | On scale (`--text-xs`) |
| `0.6875rem` (11px) | 86 | **Same size as row 1, different unit** |
| `0.75rem` (12px) | 75 | Duplicate of `--text-xs` in rem |
| `12.5px` | 74 | **Accidental one-off** |
| `0.8125rem` (13px) | 68 | Duplicate of `--text-sm` in rem |
| `11.5px` | 41 | **Accidental** |
| `10.5px` | 33 | On scale (`--text-2xs`) but written raw |
| `13.5px` / `9.5px` | 36 | **Accidental** |

The px/rem split is the clearest signal: the same three sizes are written four different ways
(`11px`, `0.6875rem`, `12.5px`, `11.5px` all live in the 11–12.5px band). **11px is used 188 times
across both units and is not in the scale** — it is a real step the scale is missing.

### 4.3 Spacing — 88% untokenized

2,377 hardcoded vs 315 tokenized.

| Value | × | On the 4px scale? |
| --- | ---: | --- |
| `10px` | 198 | Yes (`--space-2_5`) |
| `8px` | 172 | Yes (`--space-2`) |
| `12px` | 129 | Yes (`--space-3`) |
| `6px` | 119 | Yes (`--space-1_5`) |
| `2px` | 104 | Yes (`--space-0_5`) |
| `4px` | 91 | Yes (`--space-1`) |
| `14px` | 91 | Yes (`--space-3_5`) |
| **`7px`** | **85** | **No — off-grid** |
| **`5px`** | **73** | **No** |
| `16px` | 70 | Yes (`--space-4`) |
| **`3px`** | **67** | **No** |
| **`9px`** | **57** | **No** |
| **`11px`** | **54** | **No** |
| `18px` | 51 | No (between `--space-4` and `--space-5`) |
| **`13px`** | **25** | **No** |

**361 declarations sit on odd-pixel values with no scale step.** The scale itself is sound; nothing
consumes it.

### 4.4 Radius — 22 distinct values against 3

393 hardcoded vs 651 tokenized (the best-tokenized dimension, thanks to `tokens.test.ts`).

Distinct hardcoded: `2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 20 22 24 99 999` px.

| Value | × | Verdict |
| --- | ---: | --- |
| `999px` / `99px` | 82 | Pills — should be `--radius-full` |
| `10px` | 25 | **Off-scale** (scale is 4 / 8) |
| `12px` | 23 | **Off-scale** |
| `2px` | 20 | Off-scale |
| `9px`, `11px` | 36 | **Accidental** |
| `4px` / `8px` | 30 | On scale, written raw |
| `14px`, `16px`, `13px`, `17px`, `18px`, `20px`, `22px`, `24px` | ~60 | **Accidental drift** |

Note the token file's own comment describes a "12–16px radii" design while the scale ships 4/8. The
comment in `horizon.css:107` and the values in `theme.css:127-131` disagree.

### 4.5 Elevation

652 `box-shadow` declarations. Named tokens: `--shadow-sm/md/lg` (semantic) → `--glare`,
`--hz-shadow-lift`, `--menu-shadow`; plus `--hz-shadow-rest` and `--hz-shadow-pop`. That is **6 named
elevation values**, above the brief's cap of 4 — though `rest`/`sm` are structural (a transparent
shadow and an inset glare, not drop shadows), so the effective ladder is 3.

The dark/light split the brief asks for **already exists and is well-reasoned**: dark elevates with
border + inset glare, light restates `--hz-shadow-lift` with a slate tint (`horizon.css:181-183`).
Keep this.

### 4.6 Z-index — 93% untokenized, 25 distinct values

8 tokenized vs 102 hardcoded. The scale (`--z-base` 0 → `--z-tooltip` 4000) is sound and unused.

Values in the wild: `-1, 0, 1, 2, 3, 8, 9, 10, 20, 30, 40, 50, 60, 80, 90, 95, 100, 120, 150, 200,
300, 999, 9990, 9995, 9999`. The `9990/9995/9999` cluster is the classic escalation war — three
different overlays each trying to win.

### 4.7 Blur

**294 `backdrop-filter` declarations across 45 files**, against `horizon.css`'s claim of "ONE
definition, replacing what used to be four forks." The token exists (`--blur: 24px`, `--hz-blur-sm:
12px`); call sites largely re-declare their own. Given the composited-layer defects already
documented in the repo (`modern-web-guidance` §6), this is the highest-risk hardcode class.

---

## 5. Token namespace forks

480 custom properties are declared app-wide; **196 in the canonical files, 284 in module CSS.**

| Prefix | Declared | Module |
| --- | ---: | --- |
| `--hz-*` | 82 | Horizon compat layer (canonical) |
| `--lty-*` | 47 | Manager / loyalty |
| `--cs-*` | 43 | Customer Service |
| `--an-*` | 27 | Analyst |
| `--mg-*` | 19 | Manager |
| `--fi-*` | 17 | Finance |
| `--rf-*` | 11 | Referrals |
| `--hr-*` | 11 | HR |
| `--ms-*`, `--co-*`, `--to-*`, `--kpi-*`, `--th-*`, `--ss-*` | 25 | assorted |

Three module files are effectively private token systems: `sales/redesign/theme.css` (1,023 lines),
`customer-service/styles/shared-theme.css` (211L, 76 hex), `billing/styles/shared-theme.css` (226L,
65 hex).

**Largest CSS files** (migration cost proxy): `admin/admin.module.css` 2,078 · `hr/hr.css` 2,031 ·
`finance/finance.css` 1,448 · `customer-service/styles/retention-panel.css` 1,239 ·
`billing/styles/ledger-panel.css` 1,215 · `billing/styles/transactions-panel.css` 1,066 ·
`features/comms/comms.module.css` 1,030 · `sales/redesign/theme.css` 1,023 · `hr/hr-workspace.css`
1,023.

---

## 6. Where the brief conflicts with the repo

Per instruction: the repo wins, flagged here for your decision.

| # | Brief says | Repo says | Severity |
| --- | --- | --- | --- |
| 1 | Space Grotesk + **Inter**, strict role split; Inter for body/tables | `theme.css:196` deliberately **removed Inter**: *"Satoshi, Rajdhani, Inter, Instrument Sans and JetBrains Mono are gone: five families from four CDNs was itself a standardization failure."* Ships **Space Grotesk (UI + heads) + Space Mono (figures)** | ✅ **RESOLVED — repo wins** |
| 2 | **No glassmorphism blur panels** | `CLAUDE.md` hard rule 10 **mandates** glassmorphism; `horizon.css` is a glass primitive layer; 294 `backdrop-filter` sites | ✅ **RESOLVED — scoped compromise** |
| 3 | Gradients are **horizontal bands**, no radial blobs/orbs | `.hzMesh` is literally 3 radial lobes (dark) / 5 (light); `--ramp` is `90deg`, `--ramp-d` is `135deg` | High |
| 4 | Dark = twilight with an **ember/amber** horizon line | Brand ramp is **cyan → pale blue → magenta**. No amber anywhere in the ramp | High |
| 5 | **No gradients on text** | `.hzGrad` (`horizon.css:290`) is background-clip gradient text; `--gem` is used on AI surfaces | Medium |
| 6 | Self-host both fonts as **variable woff2** with `preload` | Google Fonts CDN `<link>`, static weights, `display=swap` only | Medium — easy win |
| 7 | Tables/forms/lists on **flat** surfaces | `--hz-pane` is a `150deg` gradient applied to cards, tables and modals | Medium |
| 8 | Nothing animates **above 300ms** | `--hz-dur-lift: 0.55s`, `--hz-dur-tone: 0.45s`, `--hz-dur-wash: 0.35s`, theme crossfade `0.42s` | Medium |
| 9 | **One icon family**, one stroke width | lucide (89 files) **+ 199 inline SVG** (51 files) **+ 16 emoji** | Medium |
| 10 | Max **3 radii** | Scale ships 3 real values (4/8/999) ✓ — but 22 in practice | Low (already aligned in principle) |
| 11 | Max **4 shadow levels** | 6 named, effective ladder of 3 | Low |
| 12 | Phase 3 authors a new `AppShell` | `AppHeader` + `MytrionShell` already implement it (commits `4e01fc4b`, `ea222c1e`, `41e087f7`) | **Scope — extend, don't replace** |
| 13 | Phase 2 authors a token layer | Token layer exists with a contract test, landed `cdc3f40c` | **Scope — repair, don't re-author** |

### 6a. Resolutions (decided 2026-08-09)

**Conflict #1 — Typography: the repo wins.** The system stays on **two families, Space Grotesk +
Space Mono**. Inter is not reintroduced. Consequences for Phase 2:

- Fix the P0-1 cycle so Space Grotesk actually renders.
- **Self-host both as variable woff2** with `font-display: swap` and `preload` on the critical
  weights; drop the Google Fonts CDN `<link>` and both `preconnect`s.
- Space Grotesk carries body and table text. Because the brief's legibility concern below ~14px is
  real and now unmitigated by a second family, the **type scale absorbs it**: explicit
  line-height + letter-spacing per step, looser tracking at small sizes (the inverse of the
  large-size tightening), and the missing **11px step** (188 sites) added as a real token.
- Space Mono stays restricted to figures/ids/codes/timestamps via `.num` / `[data-num]`.

**Conflict #2 — Glass: scoped, not removed.** Glass survives as a primitive but is confined to
**floating chrome only** — header, rail, modals, drawers, popovers, docked panels. Consequences:

- **Tables, forms, lists and data cards become flat opaque surfaces.** This also settles conflict
  #7: `--hz-pane`'s `150deg` gradient comes off dense-data surfaces.
- Targets the 294 `backdrop-filter` sites — every one inside a scrolling list or table row is a
  removal, which is also the fix for the composited-layer class of defects already documented in
  `modern-web-guidance` §6 and `theme.css`'s own `--hz-blur-sm` comment ("the compositing cliff this
  app has already fallen off").
- **`CLAUDE.md` hard rule 10 needs a wording amendment** to say *glass is for chrome, flat for data*
  — otherwise the rule and the system disagree and the next contributor re-glasses a table.
  Flagged, not yet edited.

Conflicts #3–#11 remain open and will be resolved with a recommendation inside Phase 2, not by
another gate. #12 and #13 are scope corrections already reflected in §7.

---

## 7. Recommended Phase 2 shape

Not started — for your approval.

1. **Fix P0-1** (font cycle) and rebuild `app/` (P0-2) so we are designing against reality.
2. **Add the missing scale steps the code proves it needs**: an 11px type step, and either legitimize
   or eliminate the 5/7/9/11/13px spacing band (361 sites).
3. **Extend, not replace**, `theme.css` / `horizon.css` into the three-tier split — the raw palette is
   already tier 1, the semantic aliases are already tier 2; tier 3 (component tokens) and the
   AI-native semantic group (`agent.thinking`, tool-call states, citation chips) are genuinely new.
4. **Close the `tokens.test.ts` `/mytrions/` exemption** module by module — this is the migration
   ordering, and blast radius is the file sizes in §5.
5. **Delete the 7 dead dependencies** and `MytrionScaffold.tsx`.

6. **Apply the §6a resolutions**: self-host Grotesk + Mono as variable woff2; add the 11px type step
   with per-step line-height and tracking; scope glass to chrome and flatten data surfaces.

Phase 3 is now materially smaller than the brief assumed — `MytrionShell` + the `page.tsx` contract
already cover the AppShell and the page spine. The real Phase 3 work is **controls** (§3.3–§3.10):
button, input, select, date/time picker, table, modal, toast, empty state — plus the AI-native
surfaces, which have no implementation at all today.

**Both blocking questions are resolved (§6a). Phase 2 is unblocked and awaiting approval of this
audit.**

---

## 8. Constraint from the end goal: Claude Design

The stated purpose of this system is to **redesign through Claude Design** — i.e. the design agent
builds screens out of Horizon's real compiled components, so its output maps 1:1 onto shippable
code. That imposes requirements Phase 3 must satisfy *by construction*, because retrofitting them
later means rewriting components:

| Requirement | Today | Implication |
| --- | --- | --- |
| A **library build** producing a `dist/` of components | `apps/mytrion-crm` is an **app** — Vite builds to `app/` as a Zoho widget bundle. There is no library entry, no `exports` map | **Phase 3 must add a library build target.** This is the single biggest gap between "we have a design system" and "Claude Design can use it" |
| Components importable **standalone** | Canonical components live in `_shared/` and reach into `UserContextProvider`, router, and app config | Components must take **props, not app context**, or they cannot render outside the app |
| **CSS reachable from one stylesheet** | CSS Modules → hashed class names, CSS emitted per-module | Workable, but the build must emit one CSS file reachable from `styles.css`; the §3.1b decision (CSS Modules over Tailwind) makes this a real build task, not a config flag |
| **Typed props** per component | Mixed; several components take inline object props | `.d.ts` per component is what the design agent codes against — loose typing degrades every design it makes |
| A **portable** spec | none | `DESIGN_SYSTEM.md` (definition of done) doubles as the sync's conventions source |

**None of this changes Phase 2.** Tokens are CSS custom properties either way, and they are what
`styles.css` carries. Flagging it now so Phase 3 is designed against it rather than discovering it
at sync time.

**One thing to decide before Phase 3, not now:** whether the components Claude Design consumes are
extracted into a small library package (`packages/horizon-ui`) that the CRM then imports, or whether
the CRM gains a second build target that emits the library from `_shared/`. The first is cleaner and
is what makes the sync trivial; the second is less disruptive. I'd recommend the first, and it is
exactly the kind of broad-refactor decision the brief says to ask about.
