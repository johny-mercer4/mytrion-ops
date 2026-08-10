# src/ds — house conventions

Every component in this directory follows these. They exist so that twenty-five components written
at different times read as one system, which is the entire point of the exercise.

`Button/` is the reference implementation. When a rule below is ambiguous, copy what Button does.

---

## 1. File layout

```
src/ds/<Name>/
  <Name>.tsx           the component
  <Name>.module.css    its styles
  <Name>.test.tsx      behaviour + a11y (optional for pure-presentational)
  index.ts             re-export (only when the folder exports more than one symbol)
```

Export from `src/ds/index.ts`. A component not exported there does not exist as far as the library
build, the kitchen sink, or a design tool is concerned.

## 2. Purity — enforced by `purity.test.ts`

No imports from `context/`, `api/`, `access/`, `mytrions/`, `features/`, `react-router`,
`react-query`. No `useUserContext()`. No `lucide-react` — the icon family is Material Symbols Sharp,
via `<Icon>`.

A component takes **props and nothing else.** If it needs the current user, the caller passes the
user. Workspace-aware things live in `mytrions/_shared`; that is a composition layer, not this one.

## 3. Styling

CSS Modules. **Zero literals** — no hex, no `border-radius: 8px`, no `font-size: 13px`. Every value
is a `var(--token)`. `purity.test.ts` fails the build on a literal.

Consume **semantic** tokens (`--surface`, `--intent-danger-bg`), not raw palette (`--container`,
`--error`). The exception is the dimension ladders (`--radius-*`, `--space-*`, `--text-*`), which are
dual-role by design.

- Class names are camelCase and describe the PART, not the look: `.root`, `.label`, `.trailing`.
- Variants and states are **data attributes**, not extra classes: `[data-variant='danger']`,
  `[data-loading='true']`. One selector surface, and the DOM tells you the state when you inspect it.
- Never write `transition: all`. Name the properties. `transition: all` re-runs the transition
  machinery for every changed property, including ones that force a blurred layer to re-rasterise.
- Never emit a permanent `transform`. It promotes the element to its own composited layer and makes
  it a containing block for its children; stacked on `backdrop-filter` that produces the
  un-repainted-panel defect this app has already shipped. Use `translate:` and only while animating.

## 4. Motion

`--dur-instant` 80ms (state flips) · `--dur-fast` 120ms (press/hover on small controls) ·
`--dur-base` 170ms (the house transition) · `--dur-slow` 220ms (surface entrance/exit, the CEILING).

Reduced motion is handled globally — the duration tokens are zeroed under
`prefers-reduced-motion: reduce`. Do not add `!important` on top of that. **Never make a motion
load-bearing for comprehension:** if the only signal that something changed is movement, a
reduced-motion user gets no signal at all.

## 5. States — the full matrix, every interactive component

`rest · hover · active · focus-visible · disabled` and, where the component can be busy, `loading`.
Where it holds a value: `empty · filled · invalid`. Where it can be chosen: `selected`.

- **Focus** is the global `:focus-visible` ring. Do not re-style it per component. A wrapper with a
  bare inner field takes `data-focus-shell`.
- **Disabled** recolours (`--disabled-fg`), never opacity-multiplies a label, so contrast stays
  known. **Never `pointer-events: none`** — it kills the tooltip that explains why and removes the
  control from the tab order. Native `disabled` when no explanation is owed; `aria-disabled` when
  one is.
- **Loading** keeps the control's width. A button that shrinks when it starts working makes the
  layout jump under the user's cursor.

## 6. Accessibility floor

- Semantic elements first. A clickable `<div>` is a bug. Controls are `<button type="button">`.
- Every icon-only control needs an accessible name. Disclosures need `aria-expanded`.
- Never encode meaning in colour alone — pair it with an icon, a label, or a shape.
- Full keyboard operability. Document the key map in the component's docblock.
- AA in both modes: 4.5:1 body text, 3:1 for large text and UI boundaries. `--border` alone is
  **below** 3:1 against its own card — fine for decorating a panel, **not** enough to be the only
  thing identifying an interactive control.

## 7. Props

- `className` and `style` on every component, merged last, so a caller can position it.
- Booleans read as adjectives: `filled`, `loading`, `invalid`. Never `isLoading`.
- A union beats a boolean pair: `size?: 'sm' | 'md'`, not `small?: boolean`.
- Extend the native element's props when the component wraps one, so `onClick`, `aria-*`, `form`
  and the rest pass through without a bespoke prop each.
- **No variant without a real use site in this codebase.** The audit lists what exists.

## 8. Documentation

Every component carries a docblock covering: what it is, the variants, the keyboard map, and — the
part people skip — **when NOT to use it**. That block is what a design agent reads through the
emitted `.d.ts`, so it is API documentation, not decoration.

## Responsive

The ladder is four numbers — `(width < 480 | 640 | 900 | 1200px)` — in **range syntax, never
`max-width`**. `src/styles/breakpoints.test.ts` fails on a fifth. `640` is the structure line (the
surface changes shape) and `900` is the density line (it only gets tighter). Full rationale in
`docs/design/FOUNDATIONS.md` §5.

**A ds component takes a prop, not a viewport.** §2 says a component takes props and nothing else,
and that holds here: the kitchen sink and the Figma library build have no viewport story, and the
library ships into a sandbox where `matchMedia` may not exist at all. Express responsiveness in CSS
where you can; where a component genuinely must branch in JS, it reads the shared internal hook
whose absent-`matchMedia` snapshot is `false` — i.e. the **desktop** rendering, never a mobile one
nothing can measure. The composition layer (`mytrions/_shared`) is where a viewport becomes a prop.

**Overlays need no `z-index`.** `Dialog` and `Drawer` are native `<dialog>` + `showModal()`, so they
live in the top layer and escape every stacking context by construction. Do not add one "to be
safe" — and never add `z-index`, `transform`, `filter` or `contain` to anything that could become an
ancestor of page content, which traps the app's legacy `position: fixed` modals behind the header.

**Touch:** 44px minimum via an overhanging hit area, never by growing the control. A `:hover` that
changes `opacity`/`visibility`/`display`/`pointer-events`/`transform` is unreachable with a finger
and needs an `@media (hover: none)` reset. Fields are already 16px below the density line via
`--text-input-mobile` — that is why iOS does not zoom them; do not re-solve it per component.
