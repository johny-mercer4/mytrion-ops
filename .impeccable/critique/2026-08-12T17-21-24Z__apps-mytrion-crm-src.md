---
target: apps/mytrion-crm/src
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-08-12T17-21-24Z
slug: apps-mytrion-crm-src
---
Method: dual-agent (A: 2de56960-0867-4558-b03d-ff31a2f56fe5 · B: 675c6022-c821-4ad2-a46c-a35636f9745f)

CONTEXT_STALE: no PRODUCT.md, DESIGN.md, or surface brief. FOUNDATIONS.md is tokens only. Code is design authority. Not repaired.

Evidence: source + CSS. CRM Vite was listening on [::1]:5173; no browser MCP; no live screenshots; detector overlay skipped.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | RC incoming call has no host UI |
| 2 | Match System / Real World | 3 | Ops nouns; Telegram user thinks call / lead |
| 3 | User Control and Freedom | 2 | Admin tab not in URL; Telegram Back unused |
| 4 | Consistency and Standards | 2 | Admin CSS grids vs Sales DataTable cards |
| 5 | Error Prevention | 3 | Confirms exist; 32px RC Sign in |
| 6 | Recognition Rather Than Recall | 2 | Admin tab bar pins AI/KB, not Users/Deals |
| 7 | Flexibility and Efficiency | 2 | ⌘K focuses a field that does not search |
| 8 | Aesthetic and Minimalist Design | 3 | Horizon authored; phone chrome stacks |
| 9 | Error Recovery | 3 | Admin retry; RC OAuth failure is vendor Loading… |
| 10 | Help and Documentation | 1 | No PRODUCT/DESIGN; false global search |
| **Total** | | **24/40** | **Acceptable** |

## Audit Health Score (evaluate only, no polish loop)

| Dimension | Score | Key finding |
|---|---|---|
| Accessibility | 2/4 | Nav ARIA + drawers; Admin div-grids; RC 15px dismiss |
| Performance | 2/4 | Glass + Embeddable iframe/WebRTC |
| Responsive | 2/4 | 640 structure line; Admin tables 1040px; no TG SDK |
| Theming | 3/4 | Token system real; RC Sign in `#fff` |
| Integrity | 3/4 | Horizon coherent; 15/26 detector hits are side-tab FPs |
| **Total** | **12/20** | **Acceptable** |

## Design Specificity Verdict

LLM: Authored for this product (Horizon ember band, Space Grotesk, Mytrion badge tone, Octane ops copy). Scene mismatch for Telegram WebView, not blandness.

Deterministic scan: 26 findings across admin, ringcentral, _shared, styles, app. Rules: side-tab 15, gradient-text 5, layout-transition 3, overused-font 2, codex-grid-background 1. False positives: side-tab on table/toast/status cards; Space Grotesk is the product face; shell width transition is intentional.

Visual overlays: none. Browser visualization skipped (no browser MCP).

## Overall Impression

Desktop Admin is a real ops tool. CRM has an earned mobile contract (MytrionShell + MobileTabBar in flow, 100dvh, kb-inset). CRM+RingCentral cannot launch as a Telegram mini-app as-is: Zoho OAuth, no Telegram SDK/top safe-area, Embeddable WebRTC+popup.

## What's Working

1. MytrionShell + MobileTabBar as flow sibling; viewport-fit=cover without user-scalable=no.
2. Admin empty/error language and permission-set gating.
3. Sales DataTable card grammar + a defensible four-slot tab order.

## Priority Issues

### [P0] RingCentral Embeddable cannot run as a Telegram mini-app phone
Why: adapter.js iframe, defaultCallWith=browser, OAuth popup + window.opener (COOP already a prod footgun).
Fix: Do not ship Embeddable in Telegram. RingOut / PWA / desktop-only.
Suggested command: /impeccable shape then /impeccable harden

### [P0] CRM has no Telegram Mini App contract
Why: no telegram-web-app.js, no Telegram.WebApp, zero safe-area-inset-top.
Fix: SDK + theme chrome + top inset, or do not launch CRM as a mini-app. Do not copy mini-app user-scalable=no.
Suggested command: /impeccable adapt

### [P0] Identity is Zoho OAuth, not Telegram
Why: beginZohoLogin → window.location.assign; sessionStorage may not survive WebView hop.
Fix: Telegram-native auth for mini-app surface; keep Zoho for desktop.
Suggested command: /impeccable shape · /impeccable onboard

### [P1] Admin is not a 320–430px product
Why: no primary: flags → tab bar is AI/KB; 6-col grids; min-width 1040px carrier tables.
Fix: Exclude Admin from Telegram, or pin Users/Deals/Jobs and use DataTable cards.
Suggested command: /impeccable adapt · /impeccable layout

### [P1] Incoming call + sign-in are not high-stakes UI
Why: vendor iframe owns ring; host Sign in 32px; pill vs tab bar.
Fix: Desktop host sheet; Telegram system ring, not Embeddable.
Suggested command: /impeccable harden · /impeccable clarify

### [P2] Chrome stack and false search
Why: 64px header under Telegram header; GlobalSearch unused; Sales 90px pad; leftover 100vh.
Suggested command: /impeccable distill · /impeccable adapt

### [P3] No PRODUCT.md / DESIGN.md / surface brief
Suggested command: /impeccable document (when asked) · /impeccable init

## Cognitive load

6/8 checklist failures (high). Fail: single focus, chunking, visual hierarchy on phone, one thing at a time, minimal choices, working memory. Pass: grouping, progressive disclosure (pattern exists; Admin tables don't use it).

## Persona red flags

Alex: no URL per Admin tab; ⌘K theater; no bulk grant; Octane-Scope wants a pointer.
Casey: double header; RC pill vs tab bar; no incoming sheet; Zoho redirect.
Sam: Admin div grids; RC 15px dismiss; touch-action: manipulation tradeoff.
Admin operator: 19-item More sheet; 100vh tableScroll.
CRM agent in Telegram: no SDK; no top inset; Embeddable WebRTC.
RingCentral caller: no host ring; OAuth in vendor iframe.

## Minor observations

Marketing URL-sync is the deep-link pattern to steal. Client News “bot push” talks to the other mini-app. Detector overused-font on Space Grotesk is a false positive.

## Questions

What if Admin is not in the Telegram build? What if the phone is RingOut, not WebRTC? What if Telegram identity replaces Zoho as the first sentence?

## Verdict

No. Conditional only if launch is redefined: Sales (maybe CS) without Embeddable, Telegram auth, Mini App chrome — Admin + RingCentral Embeddable stay desktop.
