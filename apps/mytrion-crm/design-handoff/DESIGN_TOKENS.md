# Mytrion Horizon — design tokens

**Source of truth: `src/styles/theme.css` and `src/styles/horizon.css`.** This document describes
them; it does not define anything. If the two disagree, the CSS is right and this file is stale.

The previous version of this document described Rajdhani, Inter and JetBrains Mono, and a
3/5/9/13px radius ramp. None of that ever shipped — the app was on Space Grotesk and a flat 6px.
Anyone building from it built the wrong thing, which is why it is the first thing the
standardization pass rewrote.

`src/styles/tokens.test.ts` enforces the structural rules below. It is the only automated check the
design system has: there is no stylelint on this app (`.eslintrc.cjs` ignores it), no
visual-regression harness, and `tsc` never reads a `.css` file.

---

## 1. How the token system is shaped

`theme.css` has two layers, and the direction is one-way.

**Layer 1 — the raw palette.** The Horizon Digital Cockpit values on `:root`, the Luminous Horizon
values under `[data-theme='light']`. This is the only place in the app allowed to contain a hex
literal.

**Layer 2 — semantic aliases.** The names ~40,000 lines of module CSS already read (`--surface`,
`--border`, `--text-primary`, `--accent`…). Every one is a `var()` of a layer-1 token and never
carries a literal.

Because layer 2 is derived, the light block only has to restate the palette. That is what makes it
structurally impossible for the two themes to drift apart on a semantic name — the failure mode the
old hand-maintained light/dark pairs had.

> Never point a layer-1 token at a layer-2 name. That is a cycle, and a cycle is a blank page.

Glass, the brand ramp and the ambient backdrop live in `horizon.css`. **No token may be declared in
both files** — their `[data-theme='light']` blocks have equal specificity, so a duplicate would
resolve by `@import` order, i.e. by accident.

---

## 2. Palette

| Role | Dark | Light |
| --- | --- | --- |
| `--page` | `#0a0e1a` | `#e9edf3` |
| `--surface-base` | `#0f131f` | `#f8f9fa` |
| `--container-low` / `--container` | `#171b28` / `#1b1f2c` | `#f3f4f5` / `#edeeef` |
| `--container-high` / `--container-highest` | `#262a37` / `#313442` | `#e7e8e9` / `#e1e3e4` |
| `--on-surface` / `--on-surface-variant` | `#dfe2f3` / `#bbc9cf` | `#191c1d` / `#434656` |
| `--outline` / `--outline-variant` | `#859399` / `#3c494e` | `#737688` / `#c3c5d9` |
| `--primary` / `--primary-container` | `#a5e7ff` / `#00d2ff` | `#0043c8` / `#0057ff` |
| `--tint` | `#47d6ff` | `#004ee7` |
| `--secondary` / `--secondary-container` | `#ffaede` / `#ff34cd` | `#00677f` / `#00ccf9` |
| `--on-primary` | `#003543` | `#ffffff` |
| `--error` | `#ffb4ab` | `#ba1a1a` |

**One alias inverts, on purpose.** In dark, containers step *up* from the page, so a card is
`--container`. In light they step *down*, so `--surface: var(--surface-base)`. Mapping `--surface`
to `--container` in light turns all 377 card surfaces grey against an `#e9edf3` page and collapses
the figure/ground separation light mode depends on. Do not "simplify" that asymmetry away.

---

## 3. The ramp, and workspace identity

The brand gradient is `--ramp` (90°, for wordmarks, hairlines and progress), `--ramp-d` (135°,
two-stop, for small fills, chips and avatars — five stops read as mud at that size) and
`--ramp-soft` (the low-alpha wash that marks a selected row). All three derive from the palette, so
the light theme swaps them for free.

**There is no per-workspace accent.** `--accent` is the Horizon ramp in all twelve workspaces, so a
hover, a focus ring, a chip and a primary button look the same everywhere. Eleven `[data-mytrion]`
accent blocks used to mean eleven versions of each of those to keep in sync.

Identity travels as **`--badge-tone`**, set per workspace in `global.css` from the `--tone-*`
wayfinding set, and exactly two things may read it:

1. the launcher card (`app/launcher/WorkspaceCard.module.css`), and
2. the workspace badge in the header (`components/WorkspaceSwitcher.module.css`).

That boundary is what makes a workspace recognisable at the door and consistent once you are
inside. It is enforced: `tokens.test.ts` fails if any `[data-mytrion]` block declares an `--accent*`.

Wayfinding `--tone-*` (13 hues, both themes) survives for **categorical encoding within one screen**
— HR's org canvas, Verification's client types, a long categorised rail. Tint the glyph only; the
label stays on the text scale, or the sidebar becomes a fruit salad. On a selected nav row the tone
is overridden, so one selected row looks identical in every workspace.

---

## 4. Surfaces and depth

One glass set, replacing what used to be four forks:

| Token | Dark | Light |
| --- | --- | --- |
| `--glass` | `rgba(31,34,44,.40)` | `rgba(255,255,255,.44)` |
| `--glass-hi` | `rgba(255,255,255,.07)` | `rgba(255,255,255,.86)` |
| `--glass-bd` / `--glass-bd-hi` | `rgba(255,255,255,.07)` / `.18` | `rgba(20,30,50,.07)` / `rgba(0,67,200,.30)` |
| `--glare` | `inset 0 1px 0 0 rgba(255,255,255,.10)` | `inset 0 1px 0 0 #fff` |
| `--field` | `rgba(255,255,255,.04)` | `rgba(255,255,255,.55)` |
| `--row-line` / `--row-hover` | `rgba(255,255,255,.06)` / `.05` | `rgba(20,30,50,.07)` / `.035` |
| `--menu-bg` | `rgba(27,31,44,.92)` | `rgba(255,255,255,.94)` |
| `--blur` | `24px` | `24px` |

**Depth is refraction, not shadow: border + `--glare` at rest, a drop shadow only on hover or when a
surface floats over the page.** `--shadow-sm` maps to `--glare`, which puts that rule on all 60 of
its call sites without touching one.

Two traps worth knowing:

- **`--hz-shadow-rest` is a transparent shadow, never `none`.** Sixty of its sixty-seven call sites
  write `box-shadow: var(--hz-shadow-rest), var(--hz-glass-inset)`, and `none` is not a valid item
  in a shadow list — it invalidates the whole declaration and takes the inset glare with it.
- **`--hz-blur-sm` stays 12px.** 122 of its sites are chips and rows inside scrolling lists, and
  every blurred element is its own composited layer. 24px on a 400-row table is the compositing
  cliff this app has already fallen off.

`--hz-*` is a compatibility layer, not a second system: 2,843 call sites read those names, and they
are aliases of the set above. **Do not add new `--hz-*` names.**

---

## 5. Shape

`--radius-xs` / `--radius-sm` = **4px** (controls: button, input, select, chip).
`--radius-md` / `--radius-lg` = **8px** (panels: card, table, modal, drawer).
`--radius-full` = **999px** — pills only: avatars, status dots, counts.

Two steps carry hierarchy that one cannot; the app was previously flattened to 6px everywhere,
while `.ss-root` rendered `--radius-md` at 12px and `.bm-root` at 8px — three live scales at once.

**Only `theme.css` may put a number on a radius.** Every module scale (`--ms-r-*`, `--mg-r-*`,
`--an-r-*`, `--co-r-*`, `--fi-r-*`, `--hr-r-*`, CS's `--r-*`) is a `var()` alias, so 236 call sites
move by editing one block. `tokens.test.ts` fails on a numeric radius anywhere else.

---

## 6. Type

Two families, one source (`index.html`). Five families from four origins was itself a
standardization failure.

- `--font-head` — **Space Grotesk**. Headings and UI.
- `--font-body` — **Space Grotesk**.
- `--font-mono` / `--font-num` — **Space Mono**. Reserved strictly for figures, ids, codes and
  timestamps.

**Every figure takes `.num` or `[data-num]`** (`font-family: var(--font-num)` +
`font-variant-numeric: tabular-nums`). Financial columns must align vertically to be scannable —
not optional in Billing, Finance or Analytics.

Scale: `--text-2xs` 10.5 · `--text-xs` 12 · `--text-sm` 13 · `--text-base` 14 · `--text-md` 15 ·
`--text-lg` 18 · `--text-xl` 22 · `--text-2xl` 26 · `--text-3xl` 32, each with a matching `--lh-*`.
Weights `--fw-regular` 400 → `--fw-extra` 800. Spacing is a 4px rhythm, `--space-0_5` → `--space-16`.

---

## 7. Motion

`--dur-fast` 120ms · `--dur-base` 170ms · `--dur-slow` 220ms, with `--ease-standard`
`cubic-bezier(0.2,0,0,1)`; `--hz-ease` `cubic-bezier(0.22,1,0.36,1)` for the longer Horizon washes.

**Write an entrance animation inside `@media (prefers-reduced-motion: no-preference)`, not as a base
rule with a global override.** `global.css` zeroes `animation-duration` and (now) `animation-delay`
under `reduce`, but a base `opacity: 0` still applies — so `opacity: 0` + `animation-delay` +
`forwards` left a staggered grid blank for the length of the whole stagger and then snapped it in,
the opposite of the intent. It is also one keyword from catastrophic: drop `forwards` and the
content never appears, and nothing in the suite can see it.

**Never put a permanent `transform` on, or above, a `backdrop-filter` element.** `transform: scale(1)`
at rest promotes a composited layer and makes the element a containing block; stacked on a blur, a
scroll that changes what the filter samples can leave that layer un-repainted. Prefer the
independent `translate` property (initial value `none`, so it promotes nothing at rest) and put it
on a *different* element from the blur. See `app/launcher/WorkspaceCard.module.css`.

---

## 8. Shipping

Production serves the **committed** bundle in `apps/mytrion-crm/app`; Render never runs Vite. A PR
that changes `src` without rebuilding merges green and changes nothing on the live site.

Run `pnpm build:widget` from the repo root, confirm a new string reached the hashed bundle
(`rg 'Search the Horizon ecosystem' apps/mytrion-crm/app`), and commit `app/` in the same PR.

CI's check (`.github/workflows/ci.yml`, job `web`) is a **path-presence** check on PRs into
`main`/`build` — touching any file under `app/` satisfies it. A stale bundle passes. Rebuild as the
last commit before opening or updating the PR, and rebuild again if you push after that.
