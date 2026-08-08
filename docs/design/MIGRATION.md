# Mytrion Horizon — Migration

Maps every divergent implementation onto its canonical replacement, **ordered by blast radius** —
biggest first, because that is where the inconsistency is actually felt and where the payoff is
largest.

Nothing here is a flag day. Every row can land on its own, and the contract tests
(`src/styles/tokens.test.ts`, `src/ds/purity.test.ts`) hold the line behind each one with
ratchet-down budgets rather than a pass/fail cliff.

**Rule for all of it:** when you touch a file, migrate what you touched. Do not open a 120-file
sweep with no visual-regression harness — that is a diff nobody can review, and this repo has
already recorded that lesson.

---

## Legend

| | |
| --- | --- |
| **Sites** | measured call sites at HEAD `41159b94` |
| **Risk** | ⬤ high (visual regression likely, needs a look) · ◐ medium · ○ low (mechanical) |

---

## Tier 1 — the big three

### 1. Buttons → `<Button>` · 759 sites · ⬤

The single worst divergence in the codebase: **1** file imports the old `ui/button.tsx`, against
**759** raw `<button>` elements and **139** `.btn*` selectors across 15 files.

| Old | New |
| --- | --- |
| `.bm-btn`, `.bm-btn-primary`, `.bm-btn-ghost` (Billing) | `<Button variant="secondary\|primary\|ghost">` |
| `.cs-btn`, `.cs-btn-primary`, `.cs-btn-danger`, `.cs-btn-ghost` (CS) | same |
| `.hr-btn`, `.hr-btn-primary`, `.hr-btn-danger`, `.hr-icon-btn` (HR) | `<Button>` / `<Button icon="…" aria-label>` |
| `.mg-btn`, `.mg-btn-primary`, `.mg-backbtn` (Manager) | `<Button>` |
| `.an-btn`, `.an-btn-ghost` (Analyst) | `<Button>` |
| `.fi-btn`, `.fi-btn-icon` (Finance) | `<Button>` |
| `.co-btn`, `.ms-btn`, `.mf-btn`, `.db-*-btn`, `.lg-*-btn` | `<Button>` |
| module-local `.iconBtn` `.ghostBtn` `.dangerBtn` `.linkBtn` `.miniBtn` `.backBtn` | `<Button variant=… size=…>` |
| `components/ui/button.tsx` (@base-ui) | **delete** — 1 importer |

Every module re-derived the same four variants with its own padding, radius and hover. The five
`<Button>` variants were chosen to cover exactly what exists — no sixth.

**Watch for:** `type="submit"`. `<Button>` defaults to `type="button"`; a bare `<button>` inside a
form defaults to `submit`. Check each form footer as you convert it.

### 2. Icons → `<Icon>` · 616 lucide + 262 inline · ⬤

Three icon systems today. This is the migration that actually resolves the "everything looks
different" complaint at the glyph level.

| Old | Sites | New |
| --- | ---: | --- |
| `lucide-react` imports | 616 across 89 files | `<Icon name="…">` — `src/styles/icon-map.json` has the lucide → Material name for all 199 |
| Hand-inlined **Heroicons v1** `<svg>` | **262 across 43 files** | `<Icon>` — none of them is a shape the family lacks |
| `OCT_ICONS` registry (`admin/scope/model.ts`) | 30 paths | delete; `ic(key)` becomes `<Icon name>` |
| per-file `P_CLOSE` / `REFRESH_PATH` / `P_SEARCH` consts | 12+ files, one path copied up to 21× | delete |
| 4 lucide shapes hand-copied into `RetentionChannelIcons.tsx` | 4 | `<Icon>` |
| 16 emoji-as-icon sites | 16 | `<Icon>` |

**Keep hand-drawn:** the three third-party brand marks (Telegram, WhatsApp, Facebook) and the
`Sparkle` FuelMark. Those are logos, not icons. Chart primitives stay as SVG.

**Watch for:** the 302 hand-tuned `strokeWidth` props go away — `--icon-wght` replaces them. And
`size={N}` collapses onto `size="sm" | "md"`; a third size is how icon scales drift.

### 3. Hardcoded values → tokens · ~4,000 sites · ◐

Not a component swap; a per-module sweep, and the ratchet budgets in `tokens.test.ts` are the
mechanism.

| What | Hardcoded | Target |
| --- | ---: | --- |
| spacing | 2,339 | `--space-*` (the off-grid 3/5/7/9/11/13px band — 361 sites — has no scale step and should not gain one) |
| `font-size` | 1,146 | `--text-*` (11px is now a real step) |
| `border-radius` | 385 | `--radius-control` / `-panel` / `-pill` |
| `z-index` | 89 | `--z-*`; raw is legal only in the −1…3 local band |
| hex / `rgba()` | 480 / 399 | semantic tokens |

**Order:** largest module CSS first, because that is where the drift concentrates —
`admin.module.css` (2,078L) · `hr.css` (2,031) · `finance.css` (1,448) ·
`cs/retention-panel.css` (1,239) · `billing/ledger-panel.css` (1,215) ·
`billing/transactions-panel.css` (1,066) · `comms.module.css` (1,030) ·
`sales/redesign/theme.css` (1,023) · `hr/hr-workspace.css` (1,023).

As each module clears, remove it from the `/mytrions/` exemption in `tokens.test.ts:119`.

---

## Tier 2 — one canonical implementation per concern

### 4. Modals → `<Dialog>` / `<Drawer>` / `<ConfirmDialog>` · 23 files · ⬤

23 `*Modal.tsx` files, 48 `.modal*` selectors across 26 CSS files, **two** separate
`ConfirmDialog.tsx` (`admin/`, `customer-service/`), one `DealTransferDrawer`. `components/ui/dialog.tsx`
has 1 importer.

`<Dialog>` uses the native `<dialog>` element, so focus trapping, background inert, Escape-to-close
and `::backdrop` come from the platform. **Delete the hand-rolled focus traps** as you convert —
they are the part that is subtly wrong most often.

### 5. Selects → `<Select>` · 7 components + 80 native · ◐

| Old | New |
| --- | --- |
| `customer-service/SearchableSelect.tsx` | `<Select searchable>` |
| `hr/HrSelect.tsx` | `<Select>` |
| `admin/PersonPicker.tsx` | `<Select searchable>` |
| `sales/redesign/LeadStatusPicker.tsx` | `<Select>` |
| `sales/redesign/ViewAsPicker.tsx` · `components/ActAsPicker.tsx` · `features/chat/TestAsPicker.tsx` | `<Select searchable>` — **three** separate "act as another user" pickers |
| 80 raw `<select>` | `<Select>` |

### 6. Toasts → `<ToastProvider>` + `useToast()` · 4 systems · ◐

`sonner` (2 files) · `admin/toast.tsx` · `admin/scope/toast.tsx` (a *second* one inside the same
module) · `customer-service/Toast.tsx` · `@radix-ui/react-toast` (installed, 0 importers).

**Watch for:** the polite/assertive split. Errors must be `role="alert"`; a polite error is an error
nobody hears.

### 7. Tables → `<Table>` · 35 tables / 22 CSS files · ⬤

No table primitive exists. Sticky headers, sort affordances and numeric alignment are re-derived per
module today. Numeric columns take the `.num` treatment — not optional in Billing, Finance or
Analytics, where a column that jitters by digit width is unreadable.

### 8. Empty states → `<EmptyState>` · ~95 class names · ○

`.ss-pool-empty` alone has 11 sub-classes. `AutoEmptyState` is the only one with a documented
pattern and is the model: say what happened **and** what to try next.

### 9. Skeletons / loaders → `<Skeleton>` · 9 components · ○

`ui/skeleton.tsx` · `mytrion/table-skeleton.tsx` · Manager ×3 · Sales ×4, plus `MytrionLoader` and
`MytrionPageLoader`. **The one-loader rule survives the migration:** a region shows exactly one
loading affordance. Do not nest a `<Skeleton>` inside a region that already shows a page loader.

### 10. Date & time → `<DatePicker>` / `<TimePicker>` · 41 inputs · ◐

36 `<input type="date">` across 19 files, 3 `type="time"`, 1 `datetime-local`, 1 `month`. Unthemed
in 18 of 19 files, so the date UI differs per browser and per OS today.

### 11. Tooltips → `<Tooltip>` · 0 → n · ○

There is **no** tooltip in the app today. This is net-new; adopt where a title attribute is
currently doing the job badly.

---

## Tier 3 — shells and dead code

### 12. Shells → `MytrionShell` + the `page.tsx` contract · ◐

Mostly done already (`88017761`, `ea8a8567`, `5e239026` folded Billing, CS and Sales in). Remaining:

| File | Action |
| --- | --- |
| `manager/ManagerShell.tsx` (193L) · `hr/HrShell.tsx` (110L) · `recruit/RecruitShell.tsx` (79L) · `finance/FinanceShell.tsx` (50L) | fold into `MytrionShell` |
| `_shared/ModuleShell.tsx` (181L, 3 importers) | merge into `MytrionShell` |
| **`_shared/MytrionScaffold.tsx` (40L, 0 importers)** | **delete** |
| `_shared/page.tsx` (`PageShell`/`PageHead`/`Panel`/`KpiGrid`/`KpiTile`) — 0 importers | adopt on next touch per workspace |

### 13. Delete outright · ○

| What | Why |
| --- | --- |
| `@radix-ui/react-{dialog,popover,toast,tooltip,slot}` | **0 importers each** |
| `framer-motion` | 0 importers |
| `recharts` | 0 importers |
| `components/ui/*` (@base-ui set) | 4 importers total across 5 components |
| `components/mytrion/{stat-card,status-badge,detail-dialog}` | 0 importers each |
| `_shared/MytrionScaffold.tsx` | 0 importers |
| `--bottom-nav-height` ×3 | describes a component that does not exist — the mobile layout is a top strip |
| 11 dead layout declarations (CS + Billing) | `--header-height` / `--sidebar-width` with zero consumers |

### 14. Ambient field forks · ⬤

| File | Action |
| --- | --- |
| `manager/managerPolish.css:26-36, 57-70` | delete the six forked `--hz-mesh`/`--hz-grid`/`--hz-vignette` declarations — until then Manager keeps radial blobs while every other workspace has the horizon band, which is worse than either state alone |
| `_shared/MytrionShell.module.css:25-49` | hand-copies `.hzMesh`; re-point at the shared rule |

### 15. Focus shells · ○

`global.css` keeps a **deprecated** list of 15 module class names as a bridge. Replace with the
`data-focus-shell` attribute on each wrapper, delete the module's local focus CSS, then remove the
name from the list. When the list is empty, delete the block.

Also: `admin.module.css .search`, `MytrionShell.module.css .navSearch`, `Composer.module.css .pill`
(hashed CSS-module names, so they are not in the list but need the same treatment).

---

## Known defects to fix during migration

| Where | What |
| --- | --- |
| `MessageBubble.module.css` | **9 class names referenced from TSX do not exist** — `chipAgent`, `stoppedNote`, `retryBtn`, `groundingCol`, `sourcesToggle`, `sourcesList`, `sourceItem`, `sourceTitle`, `sourceMarker`. The agent chip, stop notice, retry button and the whole sources list render unstyled today. The AI-native components replace them. |
| `horizon.css` | stale comment claiming "a design built on 12–16px radii" — imported prose, never true of this app. Corrected in Phase 2. |
| `CLAUDE.md` rule 10 | still mandates glassmorphism with no data/chrome split. **The instruction file contradicts the shipped system until amended.** |
