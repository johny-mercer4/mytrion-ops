> **How to read this file (2026-08-21).**
> **Incumbent** = shipped CSS in `apps/mytrion-crm/src/styles/` + `apps/mytrion-crm/src/ds/`.
> **Target / exploratory** = sections labeled Phase 2 / Redesigner — not implemented unless HEAD already shipped them.
> Do not treat AUDIT "Phase 2 target untouched" as current blockers without re-checking the CSS.
> `feature/Redesigner` was a 2026-08 session branch, not the incumbent source of truth.

# Horizon Telegram mobile playbook

**Sprint:** 2026-08-13 · Sales core in the worker CRM (`apps/mytrion-crm`).  
**Not this product:** `apps/mini-app` (carrier Mini App) and `TELEGRAM_BOT_TOKEN`.  
**Host:** Telegram Mini App WebView, public HTTPS `/main`.

This document freezes the Day 1–3 design decisions, the Day 4 implementation contract, the Day 5
test script, and the roll-out order for every other Mytrion.

---

## Challenge and sprint question

How might we make Mytrion Horizon feel like a real phone app inside Telegram so a sales agent can
sign in, work a deal, and leave without fighting desktop chrome, a RingCentral pill, or a broken
Zoho hop?

**Sprint question:** Can a sales agent complete *sign-in → Home → open a client → Verification* on a
390px Telegram WebView without sideways tables, undismissable vendor UI, or a sign-in that looks
like a leftover desktop page?

**Cut:** Sales core only — login/OAuth, shared shell, Home, Data Center, Client detail, Verification.
Other Mytrions inherit the shell now and follow this playbook; they do not get a full rewrite in the
same sprint.

---

## Day 1 — Understand (frozen)

### Journey map

Cold open Mini App → Zoho hosted accounts page (out of brand control) → our callback → Home → Data
Center row → Client bottom sheet → Verification list → Verification bottom sheet.

```
Telegram WebView
  telegram-web-app.js + bootTelegram
       │
       ▼
  LoginGate (ours) ──redirect──► accounts.zoho.com (theirs)
       │                              │
       ◄──────── callback ────────────┘
       ▼
  MytrionShell + MobileTabBar
       │
       ├─ Home
       ├─ Data Center (list on phone, kanban/table on desktop)
       │     └─ Client / Lead / Deal / Rejection → bottom sheet
       └─ Verification (stacked cards → same DetailSheet)
```

### Test task (the one that counts)

> Open today’s Verification applicant and say the Zoho **Credit Decision** out loud.

Run on a real phone in Telegram, not DevTools-only. Five sales agents, ~30 minutes, think-aloud.

### RingCentral — never mount in Telegram

- `inAppCallingSupported()` is `false` inside Telegram WebView.
- `mountAdapter` teardowns and returns; **adapter.js is never injected**.
- `RingCentralPhone` returns `null` (no `#rc-widget`, no vendor popup, no persistent calling notice).
- `TelegramCallingNotice` is deleted. Call Hub copy tells the agent to use desktop Mytrion or the
  RingCentral app. History still lists.
- Desktop Embeddable is unchanged. OAuth redirect stays
  `https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html`.

### Zoho OAuth — honest limit

We cannot restyle `accounts.zoho.com`. Sprint success for OAuth:

- Pre-redirect (`LoginGate`) and post-callback (`AuthScreen` exchanging) look like Horizon phone.
- The hop stays **in this WebView**. If Zoho opens an external browser, the Mini App session never
  returns — copy tells the agent to stay in the window.
- OAuth state is dual-written (`sessionStorage` + `localStorage`) because Telegram can drop
  sessionStorage across the round-trip (`src/api/auth.ts`).

---

## Day 2 — Diverge (voted)

Lightning demos: iOS Settings grouped lists, Telegram profile sheets, HubSpot mobile deal card.

Crazy 8s covered login, tab bar + More, Data Center list, client sheet, Verification.

**Vote (shipped):** **list + bottom sheet**. Not kanban-on-phone. Not a second stacked modal.

| Surface | Phone (`< 640`) | Tablet (`640–900`) | Desktop |
| --- | --- | --- | --- |
| Nav | 4 tab slots + More as `ds/Drawer` sheet | Collapsed rail | Full rail |
| Data Center leads/deals | Grouped list rows, 56px min, chevron | Existing board/list | Unchanged |
| Client / Verification / Call detail | Bottom sheet, grabber, max 96dvh | Centered dialog OK | Centered 820/960 |
| Login / callback | Theme tokens, 16/22 type, 44px button | Same chrome | Same chrome |

Sales tab bar pins (so the test task is not buried): **Home, Inbox, Data Center, Verification**.
Everything else lives in More.

---

## Day 3 — Storyboard (six frames)

1. **Login** — Horizon surface, 22px title, 16px body, 44px “Sign in with Zoho”. Telegram copy:
   stay in this window.
2. **Callback** — one spinner + three steps (Connect → Verify → Open). No second loader, no RC
   notice. Telegram copy: stay in this window.
3. **Home** — greeting, streak tiles 2-up, announcements stacked (not a sideways rail), snapshot
   2-up.
4. **Data Center list** — full-bleed rows, one title + one meta line, no 8-column kanban, no
   `min-width: 640px` table.
5. **Client sheet** — enters from the bottom (`--duration-moderate` / `--ease-decelerate`), dim
   scrim, grabber, Credit / loyalty facts in the sheet.
6. **Verification** — stacked application rows; open → same bottom sheet; **Credit Decision** is
   the Zoho `Credit_Decision` headline (desk/platform decision stays a secondary line).

Motion: purposeful, ≤ 300ms for tab/sheet, decelerate in / accelerate out. Tokens:

| Token | Value | Use |
| --- | --- | --- |
| `--duration-instant` | 50ms | micro |
| `--duration-fast` | 100ms | press / color |
| `--duration-normal` | 200ms | dialog pop |
| `--duration-moderate` | 300ms | sheet travel |
| `--duration-slow` | 400ms | rare |
| Sequence cap | 500ms | stagger 30–50ms on list enter |

`prefers-reduced-motion` zeros the ladder to `0.01ms` in `global.css` (same as `--dur-*`).

Loaders: one skeleton language per screen (`SalesBodySkeleton` / `Skel`). Never `MytrionLoader` +
page skeleton + RC notice together. Phone Data Center cold-load uses `rows`, not a kanban board
skeleton.

---

## Day 4 — What shipped in CRM

| Area | Where |
| --- | --- |
| Skip RC adapter in Telegram | `rcCapability.ts`, `rcAdapterHost.ts`, `RingCentralPhone.tsx` |
| Theme-aware login / callback | `Screen.module.css`, `AuthScreen.tsx`, `LoginGate.tsx`, `UserContextProvider.tsx` |
| Phone sheets | `phoneSheetLayout.ts` → `dataCenterSheet.tsx`, `ClientModal.tsx` |
| Phone lists | `dataCenterPhoneList.tsx` wired from `dataCenterViews.tsx` |
| Tab bar pins | `sales/redesign/Shell.tsx` `primary` on Home / Inbox / Data Center / Verification |
| Call Hub Telegram copy | `CallHubTab.tsx` |
| Duration tokens | `styles/theme.css` + reduced-motion in `global.css` |
| Verification phone stack | `verification.css` `@media (width < 640px)` |

Rebuild vendored UI before any PR: `pnpm build:widget` (commits `apps/mytrion-crm/app/`).

---

## Day 5 — Five-agent Telegram test

**URL:** public HTTPS `/main` (Horizon worker Mini App).  
**Device:** real Telegram, ~390px logical width.  
**Task:** Open today’s Verification applicant and say the Zoho Credit Decision out loud.  
**Think-aloud.** 30 minutes. Facilitator notes, no coaching unless stuck > 60s.

### Capture

- [ ] Sign-in stays in the WebView (no hop to Safari that never returns).
- [ ] Login and callback look like Horizon phone, not a dark desktop card on a light WebView.
- [ ] Inspect DOM: **no** `#rc-widget`, **no** `mytrion-rc-embeddable-adapter` script.
- [ ] No undismissable calling popup / notice.
- [ ] Data Center / Verification: no required horizontal-scroll table on the test path.
- [ ] Detail is a bottom sheet (grabber, enters from bottom), not a centered 960px dialog.
- [ ] Credit Decision on list and detail is Zoho `Credit_Decision`.
- [ ] Tap targets ≥ 44px; iOS does not zoom inputs (16px).
- [ ] Keyboard + safe-area: sheet footer not under the home indicator.

### Pass bar

4/5 agents complete the task without asking “where did the popup go / why is this a website.”

### Debrief → ship / iterate

Ship if the pass bar holds and DOM checks are green. Iterate list (in order): OAuth stay-in-window
copy, sheet dismiss, Verification findability, Credit Decision label, leftover desktop chrome.

---

## Other-Mytrions roll-out (after Sales)

Same grammar everywhere. No one-off nav. Shared floor already in `responsive-tables.css` and
`MytrionShell.tsx` — replace the scroll-floor with card/list per workspace.

| Order | Workspace | First phone pass |
| --- | --- | --- |
| 1 | **Customer Service** | Pool / ticket list rows + bottom sheet detail. Same tab bar + More. No RC in Telegram (already gated by route + `inAppCallingSupported`). |
| 2 | **Billing** | Ledgers as grouped rows (date + amount), not `min-width` tables. Invoice / payment in a sheet. |
| 3 | **Admin** | Tables → list rows; invite / carrier detail as sheets. |
| 4 | **HR / Marketing / Manager** | Same list + sheet + tab bar. Do not invent a second mobile nav. |

### Pattern checklist (copy this per Mytrion)

1. Branch layouts on `useIsPhone()` (`< 640`, the structure line). Do not invent a fifth breakpoint.
2. Lists: full-bleed grouped rows, 12–16px gap, 44px min tap, chevron, one primary line + one meta
   line. Cards are for **objects**, not every KPI tile.
3. Sheets: `sheetBackdrop` / `sheetPanel` from Sales, or `ds/Drawer`. Centered 820/960 dialogs are
   desktop only.
4. One `SalesBodySkeleton`-class skeleton (or `ds/Skeleton`) per screen. No double loaders.
5. Type: body 16–17px, titles 22–28px `--font-head`, captions 13px. Do not default dates/IDs to
   `font-mono`.
6. Motion: `--duration-*` + `--ease-decelerate` in, `--ease-accelerate` out. Honor reduced-motion.
7. Rebuild `apps/mytrion-crm/app/` via `pnpm build:widget` in the same PR as the source change.

### Out of scope (still)

- Telegram `initData` as identity (Zoho OAuth stays the login).
- In-Telegram WebRTC calling.
- Restyling Zoho’s own accounts page.
- Carrier mini-app (`apps/mini-app`).
