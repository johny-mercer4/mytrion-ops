---
name: modern-web-guidance
description: UI/UX and web-component guidance for the Mytrion CRM frontend — the one token system (theme.css + Tailwind @theme inline), per-Mytrion accents, Horizon glass primitives, motion and reduced-motion rules, the single-loader rule and skeleton patterns, and the composited-layer traps that have actually broken this app. Use before any UI/UX, component, page, or styling work under apps/mytrion-crm/src or apps/mini-app/src.
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

## 2. Accent belongs to the Mytrion

Setting `data-mytrion="<id>"` on a module root rebinds `--accent`, `--accent-2` (the far end of the
module gradient), `--accent-strong`, `--accent-soft`, and `--accent-glow`.

Consume `var(--accent)`. Do not hardcode a module's color — the same component is reused across
Mytrions and must recolor itself. If a component needs a fixed color it is a status color, so it
belongs on the tint scale, not the accent.

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

## 8. Shipping UI — the part that is not styling

Production serves the **committed** bundle in `apps/mytrion-crm/app`; Render never runs Vite. A PR
that changes `apps/mytrion-crm/src` without rebuilding merges green and changes nothing on the live
site. Run `pnpm build:widget` and commit `app/` in the same PR. CI now fails the PR if `src` moved
and `app/` did not.
