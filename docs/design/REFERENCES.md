# Reference libraries — what Horizon took, and what it rejected

Five libraries were studied against Horizon's constraints: **21st.dev**, **Magic UI**,
**Aceternity UI**, **React Bits**, **Motion / Motion Primitives**. Plus a separate research pass on
accessible date-picker patterns.

**Headline: the yield is low and that is the correct outcome.** Four of the five are landing-page
effects libraries, and Horizon's brief bans most of what they exist to do — gradients on text and
controls, spotlight/beam/meteor effects, glassmorphism on data, scroll-triggered animation, anything
over 300ms. The one that mattered is **21st.dev's `agent-elements`** registry, which is a different
product from its headline community catalogue.

---

## What was actually adopted

### From 21st.dev `agent-elements` — the real find

| Pattern | Why it earned its place |
| --- | --- |
| **`toolRenderers` map + `GenericTool` fallback** | A tool-name → renderer registry with a fallback means a new backend tool renders acceptably on day one instead of blocking on a design ticket. Horizon has 12 departments registering tools through `ToolManifest`, so this is a direct structural fit. It also satisfies "no variant without a real use site" by construction — a tool card variant exists only because a manifest entry does. |
| **Status derived, never stored** | Status computed as a pure function of `(part.state × chatStatus)` rather than written into state, so it cannot desync from the stream. |
| **Diff + approve/reject in ONE card, footer-attached** | The thing being approved stays visible next to the control that approves it. Never a modal. The terminal state stays on screen afterwards rather than disappearing — which mirrors the fact that Horizon audit-logs every tool call. |
| **Streaming-markdown normalisation before parse** | Mid-stream markdown is *by definition* malformed: an open fence, a half-typed language string, a list marker with no content yet. A naive renderer visibly thrashes between block types as tokens arrive. Pure logic, zero styling, so none of the bans apply. |
| **Collapse-and-cap on grouped tool calls** | An agent that fires eight DWH queries to answer one question would otherwise scroll the actual answer off screen. |

**The single most valuable finding — a state Horizon was missing.** Horizon's token layer defines
five tool states: `pending`, `running`, `ok`, `failed`, `denied`. None describes *"the tool never
resolved because the user hit stop or the socket died."* That is a frequent condition in a tool that
fires DWH, Zoho and CMP calls.

It matters more than it sounds: **"Failed" implies the backend answered.** For a money-code write,
nobody knows whether it ran. Rendering that as a failure is a lie about a financial operation.
Horizon adds an `interrupted` state, reusing the `--tool-failed-*` triad (no new token — the
discipline says reuse) with distinct copy: *"Interrupted — no result"*, never *"Failed"*.

### From Aceternity, Magic UI, React Bits, Motion — API shapes only, zero code

- `CodeBlock`'s tabs / `highlightLines` / copy API — kept the shape, discarded every line of styling.
- `StatefulButton`'s async-owning lifecycle contract (the component owns the pending state, not the caller).
- `LinkPreview`'s 50ms-in / 100ms-out hover-card timing, and its static-vs-fetched fallback.

That is genuinely the whole list from four libraries.

---

## What was rejected, and which ban it hit

| Library | Rejected | Ban |
| --- | --- | --- |
| **Magic UI** | Border Beam (6s infinite gradient loop), Shine Border (14s), Magic Card (cursor spotlight, `#9E7AFF`→`#FE8BBB`), Meteors, Particles, Neon Gradient Card, Warp Background | gradients on components · >300ms · spotlight/orb effects |
| | Animated Gradient Text, Aurora Text, Sparkles Text, Animated Shiny Text (8s `bg-clip-text` sweep) | **gradients on text** — explicit |
| | Text Reveal, Scroll Based Velocity, Scroll Progress, Text Animate (`startOnView`) | **no scroll-triggered animation** — explicit |
| **Aceternity** | Card Spotlight — a cursor-following `radial-gradient(350px circle)` that is *literally* the violet→indigo→purple SaaS gradient | named ban, twice over |
| | Glowing Effect (2000ms, plus a `document.body` pointermove listener), Moving Border, Hover Border Gradient, Evervault Card | gradients on controls · >300ms |
| | **Noise Background** — I expected CSS and checked: it loads a **raster PNG** from a CDN | no raster imagery; texture must be CSS/SVG |
| | Tracing Beam, Sticky Scroll Reveal, Hero Parallax, Container Scroll | no scroll animation — categorical |
| | 3D Card Effect, Wobble Card, Glare Card, Comet Card | density and legibility beat expressiveness on every workspace surface |
| **React Bits** | The entire Backgrounds category — **53 of ~165 components are WebGL shader backgrounds** | floating orbs · beams · raster/GPU spectacle |
| | Stepper — hardcodes `#5227FF` | the exact banned SaaS violet |
| | ShinyText, GradientText, BorderGlow, ElectricBorder, GlareHover | gradients on text and controls |
| | FluidGlass, GlassSurface, GlassIcons | glassmorphism on data |
| | Every cursor-hijacking component (BlobCursor, TargetCursor, SwarmCursor…) | density/legibility; also pointer-only, so not keyboard operable |
| **Motion Primitives** | TextShimmer, GlowEffect (`#FF5733, #33FF57, #3357FF`), Spotlight, ProgressiveBlur | gradient · glass · orb bans |
| | InView, ScrollProgress | no scroll-triggered animation |
| | Cursor, Magnetic, Tilt, Dock | pointer-only by construction — **nothing here is keyboard operable** |
| | TextScramble, TextMorph, Typewriter | >300ms, and *dishonest on an AI surface*: character-by-character reveal fakes generation that has already finished |
| **21st.dev** (community half) | Marketing Blocks: animated heroes, shaders, "liquid & metal", the featured Shimmer Button; most of the 248+ community `ai-chat` components (glassmorphic) | close to a perfect inverse of the brief |
| | `ToolGroup`'s progressive reveal — nested tools appearing one at a time on a `visibleCount` timer | >300ms, and **fabricated progress**: the tools already completed |
| | `InputBar`'s `typingAnimation` prop — choreographed fake typing | demo-reel scaffolding |
| | Hardcoded literals throughout the shipped source (`#3b82f6`, code-block `#1e1e1e`), and JS theme detection via `classList.contains('dark')` | components consume tokens; Horizon themes through the CSS cascade, not JS |

One modelling defect worth naming rather than banning: `agent-elements` models a tool step as
`'pending' | 'animating' | 'complete'`. **`animating` is a view concern living in a domain enum** —
copying it would put presentation state into the data model.

---

## Date & time pickers — the research that changed the answer

This is the one topic where the sources **overturned** the obvious approach rather than confirming it.

The instinct for an internal ops tool is "wrap a calendar popover around the existing input." Every
good source says that is backwards. **Adobe's React Aria is the standout**, and Horizon follows its
core decision: the primary control is a **segmented field** where each unit (day / month / year) is
individually labelled and independently editable with arrow keys. The calendar is the *secondary*
affordance, not the main event — because a user entering a known date types it, and a 7×6 grid is
slower than typing for the operator who does it forty times a day.

**Rejected, with reasons:**

| Rejected | Why |
| --- | --- |
| Material 3's clock-dial time picker | density — dragging a hand around a circle to enter 14:30 |
| React DayPicker's `role="application"` option | it suppresses the screen reader's own navigation mode; a calendar grid must stay a grid |
| APG's habit of announcing full keyboard-help text via a live region on every open | fine once, hostile on a control used dozens of times a day |
| Free-text heuristic date parsing (`dayjs('whatever')`) | silent misparse on an ambiguous `03/04/2026`; in a fuel-card ops tool that is a wrong invoice period |
| `date-fns` / `dayjs` / `luxon`, and any picker library bundling its own CSS | drags in a second design system's DOM and styling, which then has to be fought |
| Emoji or a second icon set for the calendar affordance | one icon family — the trigger uses Material Symbols `calendar_month` / `schedule` |
| Always-visible inline calendars in filter bars | a permanent 7×6 grid in a filter row on a dense workspace |

---

## The meta-point

Four of these five libraries optimise for a first impression on a marketing page. Horizon is used
for eight hours a day by people who need to read a number and act on it. **That is not a quality
gap — it is a different objective**, and copying across it is how a dense ops tool ends up with a
cursor-following spotlight on a table of fuel transactions.

What survived is almost entirely *structure*: registries, state derivation, lifecycle contracts,
and one genuinely missing state. That is the useful part of a reference library.
