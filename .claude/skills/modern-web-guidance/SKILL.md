---
name: modern-web-guidance
description: UI/UX and web-component guidance for the Mytrion CRM frontend — the one token system (theme.css + Tailwind @theme inline), per-Mytrion badge tone, Horizon glass primitives, motion and reduced-motion rules, the single-loader rule and skeleton patterns, the composited-layer and stacking-context traps that have actually broken this app, and the RESPONSIVE contract: the 480/640/900/1200 breakpoint ladder, mobile layout, bottom sheets, touch targets, hover-on-touch, safe-area insets and iOS input zoom. Use before any UI/UX, component, page, styling, responsive, mobile, phone, tablet or touch work under apps/mytrion-crm/src or apps/mini-app/src.
---

# Modern web guidance — Mytrion CRM

**Required by CLAUDE.md hard rule 10 before any UI/UX or web-component work.**

**TL;DR for this repo:** one token system, never raw hex. Accent comes from the Mytrion, not from
you. Glass is a primitive that already exists — don't hand-roll `backdrop-filter`. One loader per
loading region. Motion is short, eased, and must survive `prefers-reduced-motion`. And read
"Composited-layer traps" before adding `transform`, `overflow`, or `transition: all` to a glass card.

---

## 1. Tokens: one system, two consumers

`apps/mytrion-crm/src/styles/theme.css` holds the scale. `global.css` bridges it into Tailwind with
`@theme inline`, so `bg-card`, `text-muted-foreground`, and `bg-tint-good-bg` resolve to the same
values the CSS-Modules components use.

- **Never write a raw hex or `rgba()` in a component.** Use `var(--surface)`, `var(--border)`,
  `var(--text-muted)`, `var(--radius-md)`, `var(--shadow-sm)`.
- **There is no `dark:` variant, deliberately.** Theme swaps through the custom-property cascade via
  `[data-theme="light"]`. Writing `dark:` styles bypasses theming and will look wrong in one mode.
- **Status colors use the tint scale**, not ad-hoc opacity: `--tint-good-bg` / `--tint-good-bd`, and
  the `warn` / `bad` / `info` / `neutral` equivalents. The comment in `global.css` is explicit that
  this scale exists to kill the `/10 /12 /14` drift — reintroducing `bg-green-500/10` undoes it.
- Type: `--font-body`, `--font-head`, `--font-mono`. Radii: `--radius-xs|sm|md|lg`.

## 2. Identity belongs to the Mytrion — but only as a badge tone

Setting `data-mytrion="<id>"` on a module root binds **`--badge-tone` and nothing else**
(`global.css`). Two things read it: the launcher card and the header badge.

**Do not rebind `--accent` / `--accent-2` / `--accent-strong` / `--accent-soft` / `--accent-glow`
in a `[data-mytrion]` block.** It used to work that way, eleven modules did it, and every hover,
focus ring and chip had eleven variants to keep in sync. `tokens.test.ts` now fails the build on it.

Consume `var(--accent)`. Do not hardcode a module's colour — the same component is reused across
Mytrions. If a component needs a fixed colour it is a status colour, so it belongs on the tint
scale, not the accent.

## 3. Glass and depth

Horizon glass primitives live in `styles/horizon.css` and are applied through existing classes
(`.ss-card-h` and friends). Prefer them over new `backdrop-filter` declarations: each new blurred
surface is another composited layer, and they compound into real scroll jank.

Depth ladder — `--surface` → `--surface-alt` → `--surface-raised`, plus `--shadow-sm`. Reach for
elevation before blur. Glass is for chrome that floats over content (docked panels, modals,
headers), not for every card in a grid.

## 4. Motion

- Short and eased: ~`.2s` with `cubic-bezier(0.2,0,0,1)` is the house transition. Hover lift comes
  from `--hz-hover-lift-sm`.
- **List the properties you transition.** `transition: all` re-runs the transition machinery for
  every changed property, including ones that force a blur layer to re-rasterise, and it silently
  overrides the narrower transition the Horizon classes already set.
- **Reduced motion is already enforced app-wide** — `global.css` neutralises animation and
  transition durations under `prefers-reduced-motion: reduce`, and `horizon.css` drops the hover
  lift. Never re-enable motion with `!important` on top of that, and never make an animation
  load-bearing for comprehension: if the only signal that something changed is a movement, a
  reduced-motion user gets no signal at all.
- Theme changes crossfade through the View Transitions API (`html.theme-vt`, see `themeContext.tsx`).

## 5. Loading states — one loader per region

CLAUDE.md calls out double loaders specifically. The rule:

- **A region shows exactly one loading affordance at a time.** A page-level `MytrionLoader` plus a
  panel spinner plus row skeletons inside it is three, and it reads as a broken screen.
- **First paint of a whole surface → `MytrionLoader`** (`components/MytrionLoader.tsx`), with
  `text` naming what is loading ("Sales Mytrion") and `themeColor` left to default to `--accent`.
- **Content whose shape is known → a skeleton**, using the shared shimmer (`--animate-shimmer`,
  `@keyframes shimmer`) and mirroring the real layout's dimensions so nothing shifts when data
  lands. See `DataCenterSkeletons.tsx` and `SalesTabSkeleton.tsx`.
- **Refresh of already-visible content → keep the content and mark it stale** (dim, disable the
  action, inline spinner on the button). Do not blank a populated panel back to a skeleton; that is
  the most common way a second loader appears.
- Empty and error states are part of the work, not an afterthought — `AutoEmptyState` shows the
  pattern: say what happened and what to try next ("Try a code like C-16 or a keyword like fraud").

## 6. Composited-layer traps

These are real defects this app has already shipped and fixed. Read before styling a glass card.

- **A permanent `transform` is not a no-op.** `transform: scale(1)` promotes the element to its own
  composited layer and makes it a containing block for its children. Stacked on
  `backdrop-filter: blur(20px)`, a scroll that changes what the filter samples can leave that layer
  un-repainted — the children are still in the DOM, just not painted. Emit `transform` only while it
  is animating (see `catalogCard` in `AutoCatalog.tsx`).
- **Don't add `overflow: hidden` reflexively.** On a card where nothing overflows it buys nothing and
  gives a stale composited layer something to clip against.
- **`transition: all` on a blurred surface forces re-rasterisation.** Name the properties.

## 7. Accessibility floor

- Semantic elements first; a clickable `div` is a bug. Interactive controls are `<button type="button">`.
- Every icon-only control needs `aria-label`; disclosure controls need `aria-expanded`.
- One polite live region per streaming surface, announcing transitions only — never per token. The
  chat panel's `liveStatus` is the reference implementation.
- Visible focus everywhere: `--color-ring` is bound to `--accent`.
- Respect the reduced-motion contract above.

## 8. Responsive and touch

**Read this before adding a single `@media`.** The app carried 127 width queries across 32
different breakpoint values while FOUNDATIONS.md documented three — because this skill said nothing
about responsiveness, and rule 10 points at this file.

### The ladder is four numbers

`(width < 480px)` · `(width < 640px)` · `(width < 900px)` · `(width < 1200px)`.

**Range syntax. Never `max-width`.** `(width < 640px)` excludes 640; `(max-width: 640px)` includes
it. Mixing the spellings is how the shell came to switch at 768 while `ds/*` guarded at 767, so a
viewport of exactly 768px got the mobile shell *and* 13px inputs — which iOS answers by zooming the
whole page and not zooming back. esbuild downlevels the range form at build time, so it costs
nothing in browser support. `src/styles/breakpoints.test.ts` fails on a fifth value.

- **640 is the STRUCTURE line.** The page changes shape: rail → tab bar, modal → sheet, table →
  cards. A module must not draw its own mobile navigation — `MobileTabBar` is it.
- **900 is the DENSITY line.** Nothing moves; the rail takes its collapsed 68px form, gutters go
  compact, inputs go to 16px. An iPad in portrait is 810–834px and belongs here, not on the phone
  layout.

Desktop-first. `(width >= N)` only for a block that must not exist on mobile at all.

### Layout

- **One scroller.** `.center` is the only `overflow-y: auto` region. `contentScroll='content'` is
  the sanctioned escape hatch and exists for virtualised surfaces, which measure against a scroll
  ref and render the wrong rows if a second scroll parent appears.
- **Never `position: fixed` for chrome.** Bars are `flex: none` siblings. A fixed bar makes every
  workspace hand-maintain a matching content pad — see the orphaned
  `padding: 16px 12px 132px !important` this app carried for a bottom nav that never shipped, in
  the one workspace of thirteen that remembered. If you must pin something to the viewport, offset
  it by `var(--layout-bottom-inset)`.
- **The stacking-context trap, restated.** No `z-index` / `transform` / `filter` / `contain` /
  `isolation` on `.shell .body` or below: it traps every legacy `position: fixed` modal behind the
  header, and they stay in the DOM so nothing looks broken until someone opens one. New overlays use
  `ds/Dialog` / `ds/Drawer` — native `<dialog>` + `showModal()` puts them in the top layer, so they
  need no `z-index` at all and are immune by construction.
- `100vh` is a bug on mobile: it is the height with the URL bar hidden. `100dvh` for the app root,
  `svh` for a container that must not be covered.

### Touch

- **44px minimum, via an overhanging hit area** (`inset` on a `::before`), never by growing the
  control. Growing it adds 12px to every bar; overhanging spends padding that is already there.
- A `:hover` that changes `opacity` / `visibility` / `display` / `pointer-events` / `transform` is
  **unreachable with a finger**. Give it an `@media (hover: none)` reset or mark it
  `data-hover-reveal`. Colour and background hovers are harmless — do not wrap those, and never
  wrap a selector list mechanically: `.navActive, .navActive:hover` inside a `(hover: hover)` query
  kills the *active* state on touch.
- `title=` is never the only accessible name. Icon-only controls get a visible label on touch, not
  a tooltip nobody can summon.
- `useHasHover()` asks about the pointer; the breakpoint asks about the width. A touchscreen laptop
  is both — do not infer one from the other.

### iOS

- **`ds/*` already solves input zoom** via `--text-input-mobile`; `global.css` covers bare fields
  below the density line. Do not re-solve it, and do not out-specify it with a
  `.my-search input { font-size: 13px }` — `breakpoints.test.ts` counts those.
- `env(safe-area-inset-*)` works only because `index.html` carries `viewport-fit=cover`. Anything
  pinned to the bottom pads by it, plus `var(--kb-inset, 0px)` for the software keyboard.
- Every horizontal strip needs `.hscroll`. Its `overscroll-behavior-x: contain` is what stops a
  swipe past the last chip back-navigating out of the app.
- **Never `user-scalable=no`.** Safari has ignored it since iOS 10 and it is a WCAG 1.4.4 failure.

### Tables and modals

Priority columns as a card row below 640, tap opens the full record in a `ds/Drawer` sheet. Never a
nine-track grid with 430px of fixed track. Modals become sheets; wizards and anything over about a
screen of form become full-screen.

### What NOT to copy from `apps/mini-app`

It is the repo's only mobile-first surface and most of it is worth stealing — the app-shell scroll
lock, `.hscroll`, the three-slot row grammar, `InfiniteCardList`, the 44px-hit-area trick. Three
things are not:

- `user-scalable=no` (above).
- Global `user-select: none`. This is a CRM; agents copy carrier IDs, MC numbers and amounts out of
  tables all day.
- The 12/14/24px radius re-tune. `tokens.test.ts` enforces one corner language at 4/8/999.

## 9. Shipping UI — the part that is not styling

Production serves the **committed** bundle in `apps/mytrion-crm/app`; Render never runs Vite. A PR
that changes `apps/mytrion-crm/src` without rebuilding merges green and changes nothing on the live
site. Run `pnpm build:widget` and commit `app/` in the same PR. CI now fails the PR if `src` moved
and `app/` did not.
