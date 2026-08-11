# Mytrion Horizon — Design System

**Self-contained.** Everything needed to design or build with Horizon is in this file. No repo access required.

Horizon is the design system for an **AI-native internal operations platform** at a fuel-card
company. Twelve department workspaces — Sales, Billing, Collection, Finance, Retention,
Verification, Customer Service, HR, Recruiting, Manager, Analyst, Admin. Its users are power users
who live in it all day: dense tables, record modals, and a docked AI assistant.

It is **not a CRM with a chat box bolted on.** Agents, tool calls and streaming output are
first-class primitives with their own token group and their own components.

**Reference points:** Linear, Stripe Dashboard, Height. **Not** a marketing site.

---

## 1. Principles

1. **Density and legibility beat expressiveness** on every workspace surface. Expressiveness is
   allowed in exactly three places: shells, auth screens, and empty states.
2. **Never encode meaning in colour alone.** Every status pairs colour with an icon, a shape, or a
   label. A colour-blind operator must read the same information.
3. **Dark and light are both first-class.** Dark is not a filter over light — they elevate
   differently (dark with light, light with shadow) and are specified separately.
4. **Glass is for chrome.** `backdrop-filter` belongs on things that float over content — header,
   rail, modals, drawers, popovers. Data surfaces are flat and opaque, always.
5. **Restraint.** No gradients on buttons, badges or text. No spotlight, beam or orb effects. No
   scroll-triggered animation. Nothing over 220ms. No raster imagery.

---

## 2. Colour

### 2.1 Palette (tier 1 — primitives)

| Token | Dark | Light |
| --- | --- | --- |
| `--page` | `#0a0e1a` | `#e0e4f0` |
| `--surface-base` | `#0f131f` | `#f6f8fc` |
| `--container-low` | `#171b28` | `#f3f4f5` |
| `--container` | `#1b1f2c` | `#edeeef` |
| `--container-high` | `#262a37` | `#e7e8e9` |
| `--container-highest` | `#313442` | `#e1e3e4` |
| `--on-surface` | `#dfe2f3` | `#2b3141` |
| `--on-surface-variant` | `#bbc9cf` | `#434656` |
| `--outline` | `#859399` | `#5c5f70` |
| `--outline-variant` | `#3c494e` | `#8590ae` |
| `--primary` | `#a5e7ff` | `#0043c8` |
| `--primary-container` | `#00d2ff` | `#2f5fd0` |
| `--tint` | `#47d6ff` | `#004ee7` |
| `--secondary` | `#ffaede` | `#00677f` |
| `--secondary-container` | `#ff34cd` | `#00ccf9` |
| `--on-primary` | `#003543` | `#ffffff` |
| `--error` | `#ffb4ab` | `#ba1a1a` |
| `--ember` | `#fb923c` | `#f97316` |
| `--success` | `#34d399` | `#1f9d62` |
| `--warning` | `#fbbf4d` | `#b9791a` |

**Horizon is a two-hue system:** a **cool accent** (cyan → pale blue → magenta) on a **warm-horizon
ground** (ember). They are deliberately different hue families — an accent that matches the
atmosphere stops being an accent.

`--ember` is the FuelMark brand orange. It is the only warm value the brand owns, and the horizon
band needs one.

### 2.2 Semantic (tier 2) — what components consume

```
surfaces   --surface  --surface-alt  --surface-raised  --surface-data  --surface-data-alt  --field
ink        --text-primary  --text-secondary  --text-muted  --text-disabled
edges      --border  --border-subtle  --border-default  --border-strong
accent     --accent  --accent-strong  --accent-soft  --accent-glow  --on-accent
intent     --intent-{success,warning,danger,info,neutral}-{fg,bg,bd}
focus      --focus-ring-color  --focus-ring-width(2px)  --focus-ring-offset(2px)  --focus-halo
disabled   --disabled-fg  --disabled-bg  --disabled-bd  --disabled-cursor  --disabled-opacity(.45)
```

**Components consume tier 2 and tier 3, never tier 1.** The one exception is the dimension ladders
(`--radius-*`, `--space-*`, `--text-*`, `--font-*`), which are dual-role by design.

**Theming mechanism:** dark is `:root, [data-theme='dark']`; light is `[data-theme='light']`.
There is deliberately **no `dark:` variant** — everything resolves through the custom-property
cascade, which is what lets a `<div data-theme="dark">` render correctly inside a light document.

---

## 3. The horizon line

A horizon is the band where two atmospheres meet. Executed literally: **the gradient axis is
vertical, so the bands read horizontally.** No radial lobes, no orbs, no diagonal rainbow.

| Stop | Position | Dark | Light |
| --- | --- | --- | --- |
| zenith | 0% | `--tint` 6% on `--page` | `--tint` 9% |
| sky | 30% | `--tint` 3% | `--tint` 4% |
| haze | 52% | `--page` | `--page` |
| halo | 59% | `--ember` 5% | `--ember` 4% |
| **ember** | **63%** | **`--ember` 13%** | **`--ember` 11%** |
| halo | 67% | — | — |
| sea | 78% | `#080c18` | `#e1e7f0` |
| deep | 100% | `#060a16` | `#dee4ef` |

Light reads as **dawn**; dark as **nautical twilight**. The ember core is one stop with tight halos
— a ~36px warm line on a 900px viewport. A horizon, not a sunset.

**Two implementation requirements, neither optional:**

- **A dither layer.** An 8-bit gradient this long is guaranteed to band — one visible contour every
  38.6px. Extra colour stops do not help; they redistribute the same levels. Only mean-zero noise of
  ~1 LSB breaks the contour. Amplitude: `opacity × 0.5 × 255` LSB → `0.014` dark, `0.02` light.
- **An `@supports` guard on oklab interpolation.** Firefox 113–126 parses
  `linear-gradient(in oklab …)` inside a custom property and then fails at use, so `background`
  computes to `initial` and the entire field silently disappears.

**Where the band is allowed:** shells, empty states, auth screens, hero surfaces. That is the whole
list. Never behind dense data.

---

## 4. Typography

**Two families. Space Grotesk** (UI, headings, body, table text) and **Space Mono** (small figures).
Self-hosted, 74.5 KB total, 38.8 KB on the critical path.

> Space Grotesk **is** variable (`wght 300–700`). **Space Mono is not** — no variable cut exists;
> it ships as two static faces, 400 and 700. Space Grotesk also has **no italic**, so emphasis maps
> to weight and colour, never to a synthesized oblique.

| Token | Size | Line-height | Tracking | Weight | Role |
| --- | ---: | ---: | ---: | ---: | --- |
| `--text-2xs` | 11px | 14px | +0.005em | 500 | micro-labels, eyebrows |
| `--text-xs` | 12px | 16px | +0.003em | 400 | meta, help text |
| `--text-sm` | 13px | 18px | +0.001em | 400 | **table cells** |
| `--text-base` | 14px | 20px | 0 | 400 | body |
| `--text-md` | 15px | 22px | −0.003em | 400 | lead |
| `--text-lg` | 18px | 24px | −0.008em | 500 | section titles |
| `--text-xl` | 22px | 28px | −0.012em | 500 | page titles |
| `--text-2xl` | 26px | 31px | −0.016em | 600 | KPI values |
| `--text-3xl` | 32px | 37px | −0.020em | 600 | display |
| `--text-4xl` | 48px | 52px | −0.026em | 300 | launcher title |

Tracking decreases as size increases, but **the whole curve sits ~0.05em lower than you would use
for Inter or SF.** That is measured, not taste: Space Grotesk's mean lowercase sidebearing pair is
0.1188em at weight 400 against SF Pro's 0.0712em — the face already carries ~+0.05em inside its
sidebearings, and adding the textbook +0.02em at 12px pushes dense table text past the point where
word shapes cohere.

**Caps:** `--tr-caps: 0.06em` (12–15px), `--tr-caps-micro: 0.08em` (≤11px).
**Dark compensation:** `--fw-body` is **420** in dark, **400** in light — geometric strokes
optically thin on a dark ground.

**Figures:** `.num` → Space Mono + `tabular-nums` for ids, codes, timestamps and table columns.
`.num-lg` → Space Grotesk + `tabular-nums` for KPI values ≥26px, where Mono's very wide fit reads
as a licence plate.

**Type roles** (classes, because `letter-spacing` cannot ride in the `font` shorthand):
`.t-label` `.t-eyebrow` `.t-meta` `.t-cell` `.t-body` `.t-title` `.t-page` `.t-display`

---

## 5. Space, radius, layout

**Spacing** — 4px base with half-steps: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64px.
3/5/7/9/11/13px are **off-grid** and are not scale steps.

**Radii — three, named by intent:**

| Token | Value | Corners |
| --- | ---: | --- |
| `--radius-control` | 4px | buttons, inputs, chips, tabs, menu items, badges |
| `--radius-panel` | 8px | cards, panels, tables, modals, drawers, popovers |
| `--radius-pill` | 999px | avatars, status dots, counts, toggle tracks |

**Layout constants:** `--layout-header-h` 64px · `--layout-rail-w` 248px ·
`--layout-rail-w-collapsed` 68px · `--layout-measure` 1280px · `--layout-measure-prose` 62ch ·
`--layout-gutter` 24px (16px ≤768px).

**Breakpoints: 480 / 640 / 900 / 1200**, in range syntax (`(width < 640px)`), never `max-width`.
Not tokens — a custom property cannot be used in an `@media` condition. **640 is the structure
line** (rail → tab bar, modal → sheet, table → cards); **900 is the density line** (rail forced
collapsed, compact gutters, 16px inputs). Enforced by `src/styles/breakpoints.test.ts`; the full
rationale is in FOUNDATIONS §5.

**Z-index:** `--z-base` 0 · `--z-raised` 10 · `--z-sticky` 100 · `--z-dropdown` 1000 ·
`--z-overlay` 2000 · `--z-modal` 2100 · `--z-popover` 2200 · `--z-toast` 3000 · `--z-tooltip` 4000.
A raw `z-index` is legal only in the −1…3 band.

---

## 6. Elevation — four levels, mode-specific

**Dark elevates with light** (border + inset glare; drop shadow only on hover or genuine float).
**Light elevates with shadow**, always slate-tinted — a neutral-black shadow on a cool pale field
reads as dirt.

| Token | Dark | Light |
| --- | --- | --- |
| `--elev-0` | transparent shadow | transparent shadow |
| `--elev-1` | `inset 0 1px 0 rgb(255 255 255/.10)` | inset glare + 1px slate hairline |
| `--elev-2` | `0 4px 14px -4px rgb(0 0 0/.28)` + accent glow | slate, softer |
| `--elev-3` | `0 2px 8px -2px rgb(0 0 0/.50)`, `0 24px 64px -18px rgb(0 0 0/.70)` | slate |

`--elev-0` is a **transparent shadow, never `none`** — it composes into comma-separated shadow lists
where `none` would invalidate the whole declaration.

---

## 7. Motion

**Ceiling 220ms.** Governs state transitions and entrance/exit — anything with a start state, an end
state, and a user action between.

| Token | Value | For |
| --- | ---: | --- |
| `--dur-instant` | 80ms | state flips: checkbox tick, toggle knob, icon swap |
| `--dur-fast` | 120ms | press / hover on small controls |
| `--dur-base` | 170ms | the house transition |
| `--dur-slow` | 220ms | **ceiling** — surface entrance/exit, rail collapse, theme crossfade |

`--ease-standard` `cubic-bezier(.2,0,0,1)` · `--ease-decelerate` `(0,0,.2,1)` ·
`--ease-accelerate` `(.4,0,1,1)` · `--ease-spring` `(.22,1,.36,1)`

**Indefinite ambient loops** (spinners, shimmer, a thinking pulse) are outside this rule and are
**floored at ≥1s**, so they read as ambient rather than as a transition that has stalled.

**Reduced motion** zeroes the duration tokens directly, so the clean path needs no `!important`.
Never make motion load-bearing for comprehension.

**Never** `transition: all`. **Never** a permanent `transform` — it promotes a composited layer and
becomes a containing block for its children; stacked on `backdrop-filter` that produces
un-repainted panels. Use `translate:`, and only while animating.

---

## 8. Icons

**One family: Material Symbols Sharp.** 175 glyphs, 34 KB subsetted.

| Token | Value |
| --- | --- |
| `--icon-size` | 20px |
| `--icon-size-sm` | 16px |
| `--icon-fill` | 0 idle / 1 selected |
| `--icon-wght` | 290 dark / 300 light |

Two axes ship: **FILL** (the selected-state axis — one glyph covers idle and active) and **wght**.
`opsz` and `GRAD` were pinned out; together they cost 81 KB and neither could vary usefully here
(`opsz`'s range is 20–48 and both Horizon sizes hit the floor).

Glyphs are addressed **by codepoint, not ligature** — an unloaded ligature font paints the literal
word "refresh". `font-display: block`, deliberately the opposite of the text faces: a glyph has no
readable fallback.

`<Icon name size filled label />`. Omit `label` for decorative icons (they become `aria-hidden`);
provide it when the icon *is* the control's meaning.

---

## 9. AI-native tokens

The differentiator. Every name maps to something the product actually renders.

```
streaming    --stream-text --stream-caret --stream-caret-glow --stream-cursor-w
agent        --agent-thinking --agent-thinking-dot --agent-live-{fg,bd} --agent-live-glow
             --agent-idle-fg --agent-badge-{fg,bg,bd} --agent-handoff-fg
tool calls   --tool-{pending,running,ok,failed,denied,interrupted}-{fg,bg,bd} --tool-label-font
citations    --cite-{fg,bg,bd,hover-bg,hover-bd,invalid-fg,invalid-bg,marker-fg,marker-font}
             --source-item-fg --source-icon
grounding    --ground-{fg,rule,verified-fg,none-fg}
confidence   --conf-{high,med,low,unknown,track,fill,font}
trace        --trace-rail --trace-node-{bg,bd,running,ok,error}
diff         --diff-{add,del,changed}-{bg,fg} --diff-gutter-fg --diff-rule --diff-font
approval     --approve-{fg,bg} --reject-{fg,bg,bd}
elicitation  --elicit-{surface,bd,opt-bg,opt-bd,opt-hover-bd,opt-on-bg,opt-on-bd,hint-fg}
controls     --retry-{fg,bd} --stop-{fg,bg,hover-bg} --stopped-note-{fg,bg}
             --turn-error-{fg,bg,bd}
structured   --struct-{code,pre}-{bg,fg,bd} --struct-quote-rule --struct-marker-fg
```

**Three modelling decisions that matter:**

- **Tool calls have six states, not four.** `denied` is RBAC refusing the call — the tool worked
  exactly as designed, so it is warning-toned, never danger. `interrupted` means the call never
  resolved (user pressed stop, or the socket dropped) — it is **neutral**, because `failed` asserts
  the backend answered and said no. For a money-code write, the honest statement is "we do not know
  whether this ran"; rendering that as a failure is a false claim about a financial operation.
- **`--conf-unknown` is not `--conf-low`.** An ungrounded answer and a low-confidence answer mean
  different things and must never share a colour.
- **One polite live region per streaming surface**, announcing transitions only ("Answering",
  "Ran 3 tools", "Done") — never per token. A live region that fires on every token reads
  continuous gibberish and is worse than no announcement.

---

## 10. Component inventory

All under `src/ds/`. Props in, nothing else — no app context, no router, no data layer.

### Foundation & actions
| Component | Notes |
| --- | --- |
| `Icon` | 175 glyphs, 2 sizes, FILL for selected state |
| `Button` | `primary \| secondary \| ghost \| danger \| link` × `sm \| md`; icon, iconEnd, loading, fullWidth. Replaces 60+ bespoke `.btn` classes |

### Forms
`Input` (types, icon, clearable, password reveal, invalid+message) · `Textarea` (autoGrow) ·
`Select` (single, searchable, multi — replaces 7 bespoke pickers) · `Checkbox` (+ indeterminate) ·
`Radio` / `RadioGroup` · `Switch` · `DateField` (segmented) · `TimePicker` (segmented)

### Display
`Badge` (5 intents, icon or dot) · `Avatar` / `AvatarGroup` · `Table` (+ Head/Body/Row/Cell/
HeaderCell/SelectCell/MessageRow; sticky header, sortable, density, numeric alignment) ·
`Tabs` / `TabPanel` (manual activation) · `Pagination` · `Skeleton` · `EmptyState` / `ErrorState`

### Overlays
`Tooltip` · `DropdownMenu` · `Dialog` / `ConfirmDialog` · `Drawer` · `Toast` (`ToastProvider` +
`useToast`)

### AI-native
`StreamingText` · `AgentStatus` / `AgentBadge` · `ToolCallCard` / `ToolCallList` · `CitationChip` ·
`SourceList` · `Provenance` · `ConfidenceMeter` · `InlineDiff` · `ApprovalBar` · `StopButton` ·
`RetryButton` · `StoppedNote` · `TurnError` · `StructuredOutput` · `ElicitationPicker`

---

## 11. Usage rules

**Buttons.** One `primary` per surface — two means one of them is secondary. `danger` is for
destructive and irreversible, not for "important". If it changes the URL it is a link, not a button.

**Disabled.** Recolour, never opacity-multiply a label — contrast must stay knowable. **Never
`pointer-events: none`**: it kills the tooltip explaining why and removes the control from the tab
order. Native `disabled` when no explanation is owed; `aria-disabled` when one is.

**Loading.** A control keeps its width while busy. One loading affordance per region — a page loader
plus a panel spinner plus row skeletons is three, and reads as a broken screen.

**Tables.** Flat and opaque. Numeric columns right-aligned with tabular figures. Horizontal overflow
scrolls inside its own container, never the page body.

**Empty states.** Say what happened **and** what to try next. "No results" is a dead end.

**Dialogs.** Native `<dialog>` — focus trap, inert background and Escape come from the platform.
Focus returns to the trigger on close. The body scrolls; header and footer stay put.

**Approval.** State plainly what will happen. Never autofocus the destructive option.

---

## 12. Accessibility floor

- **WCAG AA in both modes:** 4.5:1 body text, 3:1 large text and UI boundaries.
- Semantic elements first. A clickable `<div>` is a bug.
- Full keyboard operability; visible focus via the global `:focus-visible` ring.
- Every icon-only control needs an accessible name; disclosures need `aria-expanded`.
- Never meaning by colour alone.
- **By design:** `--border` alone composites below 3:1 against its own card (1.23:1 dark,
  1.35:1 light). A 3:1 hairline on all ~637 card edges reads as a drawn box, which is the "too sharp"
  complaint from the other direction — so the 3:1 non-text obligation is carried by `--border-strong`
  (`--outline-variant`, 2.99:1 light), used where a real line is meant. Both floors are asserted by
  the contrast test in `tokens.test.ts`, which also caps `--on-surface` so the theme cannot drift
  back to near-black-on-near-white. `--border` is fine for decorating a panel; **not** sufficient as
  the only thing identifying an
  interactive control.

---

## 13. Anti-patterns

Do not: use the violet→indigo→purple SaaS gradient · apply gradients to buttons, badges or text ·
add spotlight, beam, meteor or orb effects · blur data surfaces · use emoji as icons or mix icon
families · use pure `#000`/`#fff` as surfaces · ship more than 4 shadow levels or 3 radii · animate
above 220ms · animate on scroll · centre-align dense or long-form content · add a variant with no
real use site · use raster imagery (texture must be CSS or inline SVG).
