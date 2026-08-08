# Mytrion Horizon — Foundations (Phase 2)

**Date:** 2026-08-09 · **Branch:** `feature/Redesigner` · **Status:** token layer complete, verified in-browser.
**Scope:** tokens only. No components — those are Phase 3.

Phase 1 audit: [AUDIT.md](./AUDIT.md).

---

## 0. What changed, and what did not

This phase **extended** `theme.css` / `horizon.css` into a three-tier system. It did not author a
competing layer, because the audit found a good one already there. Concretely:

| | |
| --- | --- |
| Files rewritten | `src/styles/theme.css`, `horizon.css`, `global.css` |
| Files added | `src/styles/fonts.css`, `src/styles/fonts/*.woff2` (4), `scripts/build-icon-font.mjs` |
| Files touched | `index.html`, `vite.config.ts`, `tokens.test.ts`, 5 module CSS files |
| Call sites edited | **0.** Every legacy token name is now an alias. `--hz-*` (2,796), `var(--accent*)` (1,204), `--hz-glass-inset` (245), `--hz-ease` (471) all resolve unchanged |
| Contract tests | 6 → **10**, all green |

**Verified in the browser, not asserted.** On the running dev server: `body` computes to
`"Space Grotesk", system-ui, …`, `.num` to `"Space Mono", …`, `document.fonts.size === 4`,
`--hz-dur-wash` = `170ms`, `--text-2xs` = `11px`, `--ember` = `#f97316` (light) / `#fb923c` (dark).

---

## 1. The three tiers

```
TIER 1  PRIMITIVES   raw palette + raw dimension ladders.   Carries literals. Names a value.
TIER 2  SEMANTIC     role aliases.                          var() of tier 1. Names a purpose.
TIER 3  COMPONENT    per-component references to tier 2.    var() of tier 2. Names a part.
```

Components consume tier 2 and tier 3, never tier 1.

**The one documented exception** is the dimension ladders — `--radius-*`, `--text-*`, `--space-*`,
`--font-*`. Those names are simultaneously the primitive and the semantic contract: there is no
useful role layer between "8px" and "a panel corner", and inventing one would rename ~1,500 call
sites for no gain. **Tier 1 is sealed for colour only.** This is a deliberate deviation from the
brief's "never primitives" rule, and it is the honest reading of a 45,000-line codebase.

---

## 2. Colour

### 2.1 Tier 1 — palette

| Token | Dark | Light |
| --- | --- | --- |
| `--page` | `#0a0e1a` | `#e9edf3` |
| `--surface-base` | `#0f131f` | `#f8f9fa` |
| `--container-low` | `#171b28` | `#f3f4f5` |
| `--container` | `#1b1f2c` | `#edeeef` |
| `--container-high` | `#262a37` | `#e7e8e9` |
| `--container-highest` | `#313442` | `#e1e3e4` |
| `--on-surface` | `#dfe2f3` | `#191c1d` |
| `--on-surface-variant` | `#bbc9cf` | `#434656` |
| `--outline` | `#859399` | **`#5c5f70`** ← was `#737688`, a WCAG failure |
| `--outline-variant` | `#3c494e` | `#c3c5d9` |
| `--primary` | `#a5e7ff` | `#0043c8` |
| `--primary-container` | `#00d2ff` | `#0057ff` |
| `--tint` | `#47d6ff` | `#004ee7` |
| `--secondary` | `#ffaede` | `#00677f` |
| `--secondary-container` | `#ff34cd` | `#00ccf9` |
| `--on-primary` | `#003543` | `#ffffff` |
| `--error` | `#ffb4ab` | `#ba1a1a` |
| **`--ember`** | **`#fb923c`** | **`#f97316`** |

**`--ember` is the only new primitive, and it is not a new colour.** It is the FuelMark orange that
was already in the file as the `--fuel` gradient stops, promoted to a name. The brand ramp has no
warm end at all — dark `--secondary` is `oklch(84.2% .112 343.4)`, magenta, 72° of hue from ember;
light `--secondary` is outright teal — so the horizon thesis had nothing warm to reach for.

It is deliberately **not** an alias of `--orange` / `--tone-orange`: those are consumed dynamically
from `MYTRIONS[id].hue`, and the page atmosphere must not shift when a workspace re-gamuts its card.

### 2.2 The two-hue system

Horizon is **a cool accent on a warm-horizon ground.** The accent ramp (cyan → pale blue → magenta)
and the atmosphere (ember) are deliberately different hue families. The brief asked for a single hue
transition; this is the one place the repo's palette won, and it is better — an accent that matches
the atmosphere stops being an accent.

### 2.3 Tier 2 — the intent scale

`--intent-{success,warning,danger,info,neutral}-{fg,bg,bd}`. A component asks for "danger
background", never for "13% of the error colour". The `--tint-*` names 40k lines already read are
aliases of these, not a second definition.

---

## 3. The horizon band

A horizon is the band where two atmospheres meet. Executed literally: **the gradient axis is
vertical, so the bands read horizontally.** No radial lobes, no orbs, no diagonal rainbow.

This **replaced** the old `--hz-mesh` outright — 3 radial lobes in dark, 5 in light, plus an
elliptical vignette. That was a blob field, and a blob field says nothing about a horizon.

### 3.1 Stops

| Stop | Position | Dark | Light |
| --- | --- | --- | --- |
| `--hz-band-zenith` | 0% | `--tint` 6% on `--page` | `--tint` 9% on `--page` |
| `--hz-band-sky` | 30% | `--tint` 3% | `--tint` 4% |
| `--hz-band-haze` | 52% | `--page` | `--page` |
| `--hz-band-halo` | 59% | `--ember` 5% | `--ember` 4% |
| **`--hz-band-ember`** | **63%** (`--hz-band-y`) | **`--ember` 13%** | **`--ember` 11%** |
| `--hz-band-halo` | 67% | — | — |
| `--hz-band-sea` | 78% | `#080c18` | `#e1e7f0` |
| `--hz-band-deep` | 100% | `#060a16` | `#dee4ef` |

The ember core is **one** stop with tight halos either side. 59% → 63% → 67% is a ~36px warm line
on a 900px viewport: a horizon, not a sunset.

`--hz-band-sea` / `--hz-band-deep` are the **old vignette colour** (`rgb(5,8,20)` dark,
`rgb(191,203,226)` light) resolved to opaque hexes. The vignette's containment job is now done by
the bottom of the same band, so there is no second layer. Neither value is pure black or white.

### 3.2 Dither — a requirement, not decoration

**Do not delete `--hz-grain`.** An 8-bit gradient this long is *guaranteed* to band: the zenith→sky
run has 7 distinguishable levels across ~270px — one visible contour every 38.6px — and the sea→deep
run is 99px per step. **Extra colour stops do not help**; they redistribute the same levels without
adding any. Only mean-zero noise of ~1 LSB breaks the contour.

Amplitude is calibrated: peak-to-peak = `opacity × 0.5 × 255` LSB, so `0.014` → 1.79 LSB (dark) and
`0.02` → 2.55 LSB (light — the eye resolves steps better at high luminance). Above ~0.025 it stops
being a dither and becomes a grain texture.

`background-size` must equal the tile's intrinsic 160px. A resampled noise tile is blur, and blur is
not a dither. `mix-blend-mode` is deliberately unused: overlay and soft-light both collapse toward
black, delivering almost no perturbation in exactly the dark region that needs it.

### 3.3 The oklab guard — do not remove the `@supports`

```css
@supports (background: linear-gradient(in oklab, #000, #fff)) { … }
```

Firefox 113–126 supports `color-mix()` but **not** gradient colour-interpolation (that landed in
127). A custom property accepts almost any token sequence at *parse* time, so
`--hz-field: linear-gradient(in oklab …)` stores fine there and then fails at
`background: var(--hz-field)` as invalid-at-computed-value-time — `background` computes to `initial`
and **the entire field silently disappears**. A second custom-property declaration does **not** guard
this, because both declarations parse; only `@supports`, which tests the *use*, does.

### 3.4 Where the band is allowed

Shells, empty states, auth screens, hero surfaces. **That is the whole list.** Tables, forms, lists
and data cards are flat and opaque (`--surface-data`). Atmosphere behind a 400-row table is noise
with a compositing cost this app has already paid once.

---

## 4. Typography

### 4.1 The families — and one correction to the brief

**Space Grotesk** (UI, headings, body, table text) + **Space Mono** (small figures). No Inter.

> **The brief assumed both are variable. Half of that is wrong.** Space Grotesk *is* variable
> (`wght 300..700`). **Space Mono has no variable cut and never has** — verified four ways:
> `google/fonts/ofl/spacemono` ships four static TTFs with no `SpaceMono[wght].ttf`;
> `@fontsource-variable/space-mono` is a 404 on npm; `@fontsource/space-mono`'s files are static
> per-weight; and the Google CSS2 API rejects `Space+Mono:wght@400..700` with HTTP 400.
> Mono ships as **two static cuts, 400 and 700**. The 700 is required, not optional —
> `salesData.ts` asks for weight 600, which matches the 700 face; without it every emphasised figure
> gets a synthesized smear.

> **Space Grotesk ships no italic.** Neither the brief nor the old token file acknowledged this.
> `<em>`/`<i>` now map to **weight and colour**, not to a synthesized oblique, which shears a
> geometric face badly at exactly the 11–13px sizes this app is densest at.

### 4.2 The P0 that was fixed

`theme.css` declared `--font-head: var(--font-head)` and `--font-body: var(--font-body)`. A
self-reference is a **cycle**, which css-variables-1 makes invalid at computed-value time — so every
`font-family: var(--font-body)` in the app was **dropped** and the whole UI rendered in whatever
Tailwind preflight left on `<html>`. It shipped that way.

There were **three** sites, not the two the audit found: `theme.css:197-198`, `hr-polish.css:7-8`,
and `global.css`'s `--font-mono: var(--font-mono)` inside `@theme inline`, which only ever resolved
because it emitted into `@layer theme` while the real declaration was unlayered. Moving `theme.css`
into a layer would have killed `--font-mono`, `--font-num`, `.num` and `[data-num]` together.

**The fix is structural, not a value swap.** Fonts now have the raw layer they never had —
`--face-ui` / `--face-mono` carry the literals, and the semantic names point at *different* names,
so a cycle is no longer spellable. A contract test now fails the build on any self-reference.

### 4.3 The scale

Tracking **decreases monotonically as size increases**, per the brief — but the whole curve is
anchored **~0.05em lower** than you would use for Inter or SF. That is a measurement, not taste:
Space Grotesk's mean lowercase sidebearing pair is **0.1188em @400** against SF Pro's **0.0712em** —
67% wider in em, 74% wider normalised against its smaller x-height (0.486 vs 0.508em). The face
already ships ~+0.05em of tracking inside its sidebearings. Adding the textbook +0.02em at 12px puts
dense table text near +0.07em *perceived*, where word shapes stop cohering and scanning gets slower.

| Token | Size | Line-height | Tracking | Weight | Role |
| --- | ---: | ---: | ---: | ---: | --- |
| `--text-2xs` | **11px** | 14px | +0.005em | 500 | micro-labels, eyebrows |
| `--text-xs` | 12px | 16px | +0.003em | 400 | meta, help text |
| `--text-sm` | 13px | 18px | +0.001em | 400 | **table cells — the densest text in the app** |
| `--text-base` | 14px | 20px | 0 | 400 | body |
| `--text-md` | 15px | 22px | −0.003em | 400 | lead |
| `--text-lg` | 18px | 24px | −0.008em | 500 | section titles |
| `--text-xl` | 22px | 28px | −0.012em | 500 | page titles |
| `--text-2xl` | 26px | 31px | −0.016em | 600 | KPI values |
| `--text-3xl` | 32px | 37px | −0.020em | 600 | display |
| `--text-4xl` | **48px** | 52px | −0.026em | 300 | launcher title |

**Two changes, everything else byte-identical:**

1. **`--text-2xs` moved 10.5px → 11px.** Two steps 0.5px apart are not a scale — they rasterise
   identically at 1×. One move absorbs both the 33 raw `10.5px` sites *and* the 188 off-scale `11px`
   sites. `--lh-2xs` stays 14px, so **no row height moves**.
2. **`--text-4xl: 48px` added** — the launcher title, the app's only 48px site, previously untokenised.

**Caps:** `--tr-caps: 0.06em` (12–15px) and `--tr-caps-micro: 0.08em` (≤11px). Grotesk sets caps on
the same sidebearings as lowercase while its caps are 44% taller (0.700em vs 0.486em x-height), so
relative to their own height caps read 44% *tighter*. These two values replace a 0.04→0.16em spread
scattered across 77 rules.

**Figures** track one notch looser than text (`--tr-fig: -0.01em`): tabular advances already build
the spacing in, and negative tracking crowds the thousands separator against the digit before it.

**Dark-mode weight compensation** — possible only because Grotesk is variable. Geometric strokes
optically thin on a dark ground, so `--fw-body` is **420** in dark and **400** in light. Twenty units,
not a whole named weight.

### 4.4 Figures split

| | Font | Where |
| --- | --- | --- |
| `.num` / `[data-num]` | **Space Mono** + `tabular-nums` | ids, codes, timestamps, table columns |
| `.num-lg` | **Space Grotesk** + `tabular-nums` | KPI values, hero counters (≥26px) |

At 26px+ Mono's very wide fit (0.1476em — the loosest thing we ship) reads as a licence plate. A KPI
value is the one number meant to be beautiful as well as aligned.

### 4.5 Self-hosting

Four files, 74.5 KB total, **38.8 KB on the critical path**:

| File | Bytes | Preloaded |
| --- | ---: | --- |
| `space-grotesk-latin-wght-normal.woff2` | 22,288 | ✅ |
| `space-mono-latin-400-normal.woff2` | 16,520 | ✅ |
| `space-grotesk-latin-ext-wght-normal.woff2` | 18,940 | demand-loaded via `unicode-range` |
| `space-mono-latin-700-normal.woff2` | 16,724 | demand-loaded via weight |

**`font-weight: 300 700` on the variable face is not optional.** The fvar *default* instance is 300,
so a `@font-face` omitting the range pins every weight to Light and the whole app renders thin —
including 600/700 headings, which would silently synthesize.

**Not custom-subset, deliberately.** This app renders arbitrary carrier, driver and company names
out of Zoho and the DWH. A hand-pruned glyph set breaks the first time a name arrives with a
character that was cut, and it breaks *mid-string* with a visible face swap. `latin-ext` covers
exactly the Eastern-European carrier names this business sees — it stays available, just off the
critical path.

**Where the files land is not cosmetic.** They are emitted to `assets/fonts/` with **stable,
unhashed** names via `assetFileNames` in `vite.config.ts`, because `errorHandler.ts` only 308-rescues
paths containing `/assets/`, and `base: './'` means a deep route like `/main/salesmytrion` would
resolve a `public/fonts/` path to `/main/fonts/…` and 404. Unhashed is safe: a webface is versioned
by its filename — if a face is ever swapped, **rename the file**.

`crossorigin` on the preload is **required even though these are same-origin**: fonts are always
fetched in anonymous-mode CORS, so a preload without it lands in a different cache partition and the
browser downloads the file twice.

---

## 5. Spacing, radii, layout

**Spacing** — unchanged 4px ladder with half-steps: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48,
64px. The half-steps are real at this density. What is *not* on the ladder — 3, 5, 7, 9, 11, 13px —
is **361 declarations of drift**, not a sub-scale.

**Radii — three, now named by intent:**

| Token | Value | Corners |
| --- | ---: | --- |
| `--radius-control` | 4px | buttons, inputs, chips, tabs, menu items, badges |
| `--radius-panel` | 8px | cards, panels, tables, modals, drawers, popovers |
| `--radius-pill` | 999px | avatars, status dots, counts, toggle tracks |

`--radius-xs/sm/md/lg/xl/full` are aliases, so all 763 tokenised call sites are unmoved. Named by
*what they corner* because "md" told nobody which of the two real values to reach for — which is how
22 distinct hardcoded radii grew.

> `horizon.css` used to carry a comment claiming "a design built on 12–16px radii". That was
> imported HorizonNew prose, never a measurement of this app: 763 tokenised sites sit at 4/8/999
> against 297 strays. **The comment was wrong, not the scale.** It has been corrected.

**Layout constants** — the old ones were **inert**. `--header-height` was declared four times as
44/48/56/56px and `--sidebar-width` twice as 238/216px, and *none of them had a single consumer* —
eleven dead declarations describing numbers nothing read, while the real values sat as literals in
the two shell files. Deleted, not reconciled.

| Token | Value |
| --- | ---: |
| `--layout-header-h` | 64px |
| `--layout-rail-w` | 248px |
| `--layout-rail-w-collapsed` | 68px |
| `--layout-measure` | 1280px |
| `--layout-measure-prose` | 62ch |
| `--layout-gutter` | 24px (16px ≤768px) |

Breakpoints are **560 / 768 / 1024**. They are deliberately *not* tokens — a custom property cannot
be used in an `@media` condition. They live here and nowhere else.

---

## 6. Icons

**One family: Material Symbols Sharp.** One weight, two sizes, no exceptions.

### 6.1 Why, and the honest cost

Five families were evaluated against the repo's real 200-icon list. None scored above 68/100.
Material Symbols Sharp was chosen for **sharpness and the four axes**, which are capabilities a
stroke set cannot offer:

| Axis | Value | Why |
| --- | --- | --- |
| `wght` | **300** | optically matches Grotesk beside it. Not 400 — 400 is heavier than the text it labels |
| `GRAD` | **−25** dark / **0** light | compensates icon halation on a dark ground. This axis exists for exactly this problem |
| `opsz` | tracks size | real optical correction — the 20px cut is not the 24px cut scaled down |
| `FILL` | 0 idle / 1 selected | the state axis. Replaces "two icons per nav row" with one glyph |

> **Correction to a number I quoted during the decision.** I said 16.8 KB subsetted vs lucide's
> 122.5 KB. **That comparison was wrong in both directions.** Measured here:
>
> | | 200 icons |
> | --- | ---: |
> | Material Symbols Sharp, subsetted | **101.5 KB** woff2 (already brotli — no further gain) |
> | lucide, tree-shaken | 112.3 KB raw → **11.5 KB gzipped** over the wire |
>
> lucide's 122.5 KB is the *entire un-tree-shaken barrel*, which nobody ships. **Material Symbols is
> ~9× larger over the wire, not 7× smaller.** The size argument points the other way.
>
> It does not flip the recommendation — the choice was made on sharpness and the axes, and 101.5 KB
> as an immutably-cached font loaded once is acceptable for an authenticated tool people open daily
> — but the decision should rest on the real number. Flagged rather than buried.

### 6.2 Tokens

`--icon-size: 20px` · `--icon-size-sm: 16px` · `--icon-wght: 300` · `--icon-grad: -25` (0 light) ·
`--icon-fill: 0` · `--icon-opsz: 20`

### 6.3 Build

`scripts/build-icon-font.mjs`. **Subset by codepoint, never by `--text`.** Material Symbols resolves
names through ligatures; a `--text` subset keeps the *letters* that spell the names and drops the
glyphs they resolve to. Measured: a 40-icon `--text` subset produced 25 glyphs and 1.8 KB of nothing.
The failure is silent — the font loads and every icon renders as its own name in prose.

Scaling is linear at ~0.5 KB/icon: 40 → 14.5 KB, 100 → 48.3 KB, 200 → 101.5 KB, full font 3.4 MB.

### 6.4 Deferred to Phase 3 — with the real work named

The face is **not** declared yet, because the subset cannot exist before the lucide → Material name
map does. Phase 3 owns:

1. The name map (`src/styles/icon-map.json`) and the `<Icon name size>` component.
2. **Converting 262 hand-inlined Heroicons v1** across 43 files — the audit's biggest icon finding.
   The app has *three* icon systems today, and this is the one that actually causes the
   inconsistency complaint. Two ad-hoc path registries die with it: `OCT_ICONS` (30 paths) and the
   per-file `P_CLOSE`/`REFRESH_PATH` consts, where one path string is copy-pasted up to 21×.
3. Addressing glyphs **by codepoint, not ligature** — which also removes the FOUT failure where an
   unloaded ligature font renders the literal word "refresh".
4. Retiring the 302 hand-tuned `strokeWidth` sites; `wght` + `opsz` replace them.

---

## 7. Elevation — four levels, specified differently per mode

**Dark elevates with light** (border + inset glare; drop shadow only on hover or genuine float).
**Light elevates with shadow**, always slate-tinted — a neutral-black shadow on a cool pale field
reads as dirt.

| Token | Dark | Light |
| --- | --- | --- |
| `--elev-0` | transparent shadow | transparent shadow |
| `--elev-1` | `inset 0 1px 0 rgb(255 255 255 / .10)` | inset glare **+ 1px slate hairline** |
| `--elev-2` | `0 4px 14px -4px rgb(0 0 0/.28)`, accent glow | slate, softer |
| `--elev-3` | `0 2px 8px -2px rgb(0 0 0/.50)`, `0 24px 64px -18px rgb(0 0 0/.70)` | slate |

**`--elev-0` is a transparent shadow, never the keyword `none`.** 68 call sites write
`box-shadow: var(--hz-shadow-rest), var(--hz-glass-inset)`, and `none` is not a legal list item — it
would invalidate the whole declaration and take the glare with it, flattening every panel at once.

`--hz-shadow-rest`, `--glare`, `--hz-shadow-lift`, `--hz-shadow-pop`, `--menu-shadow`,
`--shadow-sm/md/lg` are all aliases. **348 call sites, none edited.**

> ⚠️ **One behavioural change needing a look in light mode:** `--elev-1` gains a second shadow item
> in light (the slate hairline), and it reaches **245 sites** through `--hz-glass-inset`. Valid CSS,
> splices correctly into comma lists — but it is the only non-aliasing change in this section.

---

## 8. Motion

**Ceiling is 220ms.** It governs state transitions and entrance/exit animations — anything with a
start state, an end state, and a user action between them.

| Token | Value | For |
| --- | ---: | --- |
| `--dur-instant` | 80ms | state flips: checkbox tick, toggle knob, icon swap |
| `--dur-fast` | 120ms | press / hover on small controls |
| `--dur-base` | 170ms | the house transition |
| `--dur-slow` | 220ms | **ceiling.** surface entrance/exit, rail collapse, theme crossfade |

`--ease-standard` `cubic-bezier(.2,0,0,1)` · `--ease-decelerate` `(0,0,.2,1)` · `--ease-accelerate`
`(.4,0,1,1)` · `--ease-spring` `(.22,1,.36,1)`. `--ease-emphasized` was deleted — zero call sites.

**Indefinite ambient loops are outside this rule** (shimmer 1.4s, spin, thinkBounce, blink) and are
floored at ≥1s, so they read as ambient rather than as a transition that has stalled.

**Four durations were over the ceiling and are re-pointed** — 900 call sites, none edited:

| Alias | Was | Now | Sites |
| --- | ---: | ---: | ---: |
| `--hz-dur-wash` | 350ms | **170ms** | **327** |
| `--hz-dur-tone` | 450ms | 220ms | 80 |
| `--hz-dur-lift` | 550ms | 170ms | 22 |
| theme crossfade | 420ms | 220ms | 1 |

> ⚠️ `--hz-dur-wash` 350 → 170ms changes the perceived responsiveness of **every hover state in
> every module**. It is the correct change — 350ms of hover feedback is lag, not smoothness — but it
> is a design decision, not a refactor, and it is the single most visible thing in this phase.

**On the View Transition:** ruled **not exempt** from the ceiling. The two snapshots have zero
geometric delta — only colour changes — so the extra 200ms bought nothing but a longer stretch of
low-contrast intermediate state. A ceiling with a case-by-case escape hatch is not a ceiling.

**Reduced motion had a live hole.** The existing `*` block does **not** match
`::view-transition-old/new(root)` — those are generated outside the document tree — so reduced-motion
users got the full 420ms crossfade. Now explicitly zeroed, plus the duration tokens themselves are
zeroed so the clean path needs no `!important`. The original `*` block and its `animation-delay` fix
are kept verbatim: they are the backstop for ~1,830 hardcoded durations no token re-point can reach.

---

## 9. Focus, disabled, z-index

**Focus** is token-driven: `--focus-ring-color` (= `--accent`), `--focus-ring-width` 2px,
`--focus-ring-offset` 2px, `--focus-halo`. The shell contract is now **one attribute**,
`[data-focus-shell]`, instead of a hardcoded list of 15 module class names.

> The old block set `border-radius: var(--radius-xs)` inside `:focus-visible` — a latent bug that
> squared an 8px panel or a 999px pill down to 4px *while focused*. Browsers already follow
> `border-radius` for outline. Deleted.

> The 15-class list is **kept as a deprecated bridge** until the Phase 3 codemod adds the attribute.
> Deleting it now would regress focus on every search and select field in six workspaces at once.

**Disabled** — recolour, not an opacity multiply, so labels keep a *known* contrast ratio instead of
an unknowable composite. `:where()` gives it zero specificity, so all 175 existing module rules still
win without `!important` — that is what makes it adoptable incrementally. **No `pointer-events:
none`**: it kills the tooltip explaining *why* and removes the control from the tab order.

**Z-index** — raw values are legal only in the **−1…3** band (sibling ordering inside an already
isolated stacking context). Everything else is a token. `--z-popover: 2200` is new — a confirm
dialog over an open modal is a real layer that previously escalated to 9995.

`--z-base 0` · `--z-raised 10` · `--z-sticky 100` · `--z-dropdown 1000` · `--z-overlay 2000` ·
`--z-modal 2100` · `--z-popover 2200` · `--z-toast 3000` · `--z-tooltip 4000`

---

## 10. AI-native tokens

The differentiator, and it did not exist. Every name maps to something `features/chat` **already
renders** — derived from `ToolSummary.status`, `TurnTraceEvent.status` and `UiMessage`, not invented.

| Group | Tokens |
| --- | --- |
| Streaming | `--stream-text`, `--stream-caret`, `--stream-caret-glow`, `--stream-cursor-w` |
| Agent status | `--agent-thinking`, `--agent-thinking-dot`, `--agent-live-*`, `--agent-idle-fg`, `--agent-badge-*`, `--agent-handoff-fg` |
| Tool lifecycle | `--tool-{pending,running,ok,failed,denied}-{fg,bg,bd}`, `--tool-label-font` |
| Citations | `--cite-*`, `--source-item-fg`, `--source-icon` |
| Grounding | `--ground-fg`, `--ground-rule`, `--ground-verified-fg`, `--ground-none-fg` |
| Confidence | `--conf-{high,med,low,unknown}`, `--conf-track`, `--conf-fill`, `--conf-font` |
| Trace | `--trace-rail`, `--trace-node-*` |
| Diff / approval | `--diff-*`, `--approve-*`, `--reject-*` |
| Elicitation | `--elicit-*` |
| Retry / stop | `--retry-*`, `--stop-*`, `--stopped-note-*`, `--turn-error-*` |
| Structured output | `--struct-*` |

**Two deliberate design calls:**

- **Tool lifecycle has five states, not four.** `denied` is RBAC refusing the call — that is not a
  failure, the tool worked exactly as designed. The UI collapses it into `failed` today; the token
  layer should stop encoding that.
- **`--conf-unknown` is not `--conf-low`.** An ungrounded answer and a low-confidence answer mean
  different things and must never share a colour.

> ⚠️ **These tokens are ahead of the CSS.** Nine class names referenced from `features/chat/*.tsx`
> do not exist in `MessageBubble.module.css`: `chipAgent`, `stoppedNote`, `retryBtn`, `groundingCol`,
> `sourcesToggle`, `sourcesList`, `sourceItem`, `sourceTitle`, `sourceMarker`. The agent-attribution
> chip, stop notice, retry button and the entire expandable sources list **render unstyled today**.
> Phase 3 writes that CSS. Tokens for surfaces nobody displays buy nothing.

---

## 11. Accessibility

**A pre-existing WCAG failure was fixed.** Light `--outline` — aliased to `--text-muted` — was
`#737688`, which failed AA body text on every light surface that ships:

| On | Old ratio | New (`#5c5f70`) |
| --- | ---: | ---: |
| `--page` `#e9edf3` | **3.82:1** ❌ | 5.37:1 ✅ |
| `--surface` `#f8f9fa` | **4.26:1** ❌ | 5.99:1 ✅ |
| `--container-low` | **4.08:1** ❌ | ✅ |
| horizon band, worst stop | 3.34:1 ❌ | 4.70:1 ✅ |

This is at full opacity, before any disabled dimming, on the micro-labels that make up **35% of all
11px rules** — i.e. exactly the text the new `--text-2xs` step governs. Hue is preserved:
`oklch(48.9% .027 277.4)` vs the old `oklch(56.9% .028 279.1)`.

**Text on the band** is verified at every stop in both modes; the worst dark case is `--text-muted`
on the ember core at **5.07:1**.

**UI boundaries (3:1)** — the flat-opaque-data decision keeps the band away from card fills, so
borders are measured against the card, not the band. Note for Phase 3: `--border` composites to
1.23:1 (dark) and 1.14:1 (light) against its card. **That is already below 3:1 today** — fine for
decorating a panel, *not* fine anywhere a border is the only thing identifying an interactive
control. Phase 3 must not use `--border` alone to delimit a control.

**Never colour alone.** Tool states pair colour with an icon and a label; confidence pairs colour
with a value; the FILL axis gives nav selection a shape change, not just a tint.

---

## 12. Known deviations from the brief

| Brief | What shipped | Why |
| --- | --- | --- |
| Space Grotesk + **Inter** | Grotesk + Mono, no Inter | Your decision; the repo had already deleted Inter |
| Self-host **both** as variable woff2 | Grotesk variable, **Mono static ×2** | Space Mono has no variable cut. Verified four ways |
| No glassmorphism | Glass **confined to floating chrome** | Your decision; `CLAUDE.md` rule 10 mandates it |
| Single hue transition | **Two-hue**: cool accent, warm ground | The palette has no warm end; `--ember` is the minimum honest addition |
| No gradients on text | `.hzGrad` **kept, scoped** to wordmark + assistant identity | Those two are the mark. Not extended to headings, KPIs or status |
| Components never consume primitives | True for **colour**; dimension ladders are dual-role | No useful role layer exists between "8px" and "a panel corner" |
| Max 4 shadows | 4 (`--elev-0..3`) | ✅ |
| Max 3 radii | 3 | ✅ |
| Nothing above 300ms | 220ms ceiling | ✅ — stricter than asked |

---

## 13. Outstanding — needs a decision or belongs to Phase 3

1. **`CLAUDE.md` hard rule 10 still says "prioritize glassmorphism"** with no data/chrome split. The
   token layer and the contract test now encode the *new* rule. **The instruction file and the
   system disagree until it is amended.** One line; it is your file.
2. **`--elev-1` light-mode visual check** — 245 sites, the one behavioural change.
3. **`--hz-dur-wash` 350→170ms** — every hover in the app. Worth one deliberate look.
4. **Manager forks the ambient field** (`managerPolish.css`) with its own radial lobes. Until those
   six declarations are deleted, Manager keeps blobs while every other workspace has the band —
   worse than either state alone.
5. **`MytrionShell.module.css` hand-copies the `.hzMesh` rule.** Same fix, same reason.
6. Phase 3 owns: the icon map + `<Icon>`, the 262 Heroicons conversion, the nine missing chat CSS
   classes, the `data-focus-shell` codemod, and closing the `/mytrions/` budgets.

---

## 14. Contract tests

`src/styles/tokens.test.ts` — 10 tests, all green. Four are new:

| Test | Catches |
| --- | --- |
| **no self-referential custom property** | the cycle that shipped 3× and rendered the whole app in the wrong font |
| **faces resolve to literal stacks** | the chain terminating in nothing |
| **backdrop-filter budget** (≤282) | glass creeping back onto data surfaces |
| **hardcoded font-size / radius / z-index budgets** | 1146 / 385 / 89, ratchet-down only |

The budgets are the mechanism that closes the audit's `/mytrions/` exemption **gradually**, per
module, instead of demanding a 40,000-line rewrite. They may only ever decrease.

> While writing these I found a bug in the *existing* test: `declaredIn()` read the raw file while
> the file's own `code()` helper exists to strip comments. Any prose naming a token followed by a
> colon registered as a declaration. Fixed.
