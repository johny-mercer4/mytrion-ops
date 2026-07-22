# Mini-app service wiring — handoff for Claude Code

> Task brief for continuing the C-code automation wiring in **mytrion**. Backend phase 1 is DONE
> (committed to the working tree, branch it before committing). Your job: the **frontend UI phase**
> and **tests**. Read this fully before touching code, and follow CLAUDE.md strictly.

## 1. Context

The Telegram carrier mini-app (`apps/mini-app` + `src/routes/v1/carrierMiniApp*.routes.ts`) lets
carriers (owners/drivers) self-serve. Analysis of 25k Telegram support-group messages showed the
top requests (money code 850+, card activate 429, override 131, limits 100, "both retail and with
discount" reports 91). The agent-facing Zoho widget (`zoho-octane/app/js/automations-catalog.js`,
C-codes) already automates these against **servercrm** endpoints; the mini-app only filed Desk
tickets. We are wiring the real automations into the mini-app.

## 2. What is already implemented (do NOT redo)

### New files
- `src/modules/carrier/miniAppAuth.ts` — shared auth gates extracted from
  `carrierMiniApp.routes.ts` (verifyTelegramUser, requireRegisteredMiniAppUser,
  requireRegisteredOwner, requireRegisteredOwnerUser, requireRegisteredCarrierUser,
  requireDriverCardNumber, resolveDriverCardNumber/Extras, toRegistrationView, lookupCtx,
  telegramCtx). Both route files import from here — the security boundary lives in ONE place.
- `src/routes/v1/carrierMiniAppActions.routes.ts` — registered in `app.ts` after
  `carrierMiniAppRoutes`. All bodies carry `initData` (Telegram WebApp HMAC, verified server-side):

| Route (POST) | C-code | Role | Notes |
|---|---|---|---|
| `/v1/carrier/mini-app/card/efs` | read | owner (cardId) / driver (own card) | live EFS card info (status, hold, limits) |
| `/v1/carrier/mini-app/card/override` | C-16 | owner (cardId) / driver (own card) | ~30-min fraud-hold override; servercrm 409s if not on hold |
| `/v1/carrier/mini-app/card/set-status` | C-1/C-3 | owner | `{ cardId, action: 'activate'\|'deactivate' }` |
| `/v1/carrier/mini-app/card/limits` | C-4/C-5 | owner | `{ cardId, limitId, value, action: 'increase'\|'decrease' }`; `value` is a DELTA, rejected above `env.MINIAPP_LIMIT_CHANGE_MAX` |
| `/v1/carrier/mini-app/card/info` | C-26 | owner | `{ cardId, unitNumber?, driverId?, driverName? }` (≥1 field) |
| `/v1/carrier/mini-app/card/fraud-request` | C-10 | owner | `{ cardId, request: 'fraud_hold'\|'fraud_release' }` — raises a request, human acts |
| `/v1/carrier/mini-app/money-code/preview` | C-17 | owner | `{ eligible, available, drawn, moneycode_reasons[] }` — servercrm owns the math |
| `/v1/carrier/mini-app/money-code/draw` | C-17 | owner | `{ amount, unitNumber, reason }`; the CODE VALUE IS NEVER RETURNED (delivered upstream) — report the outcome only |

Safety invariants already enforced server-side (keep them intact):
- Owner sends an opaque `cardId`; it is resolved via `findDwhCardById(carrierId, cardId)` —
  ownership proof. A driver's `cardId` is IGNORED; they are pinned to their registered card
  (fail-closed 503 if unresolvable).
- Feature flags, default OFF: `FF_MINIAPP_CARD_WRITES_ENABLED`, `FF_MINIAPP_MONEY_CODE_ENABLED`
  (see `.env.example`). Disabled → 503 with codes `MINIAPP_WRITES_DISABLED` /
  `MINIAPP_MONEY_CODE_DISABLED` — the UI must treat these as "fall back to service-request ticket".
- Rate limit: 5 writes/min per carrier → 429 `MINIAPP_WRITE_RATE_LIMITED`.
- Every action audit-logged (`carrier.mini_app.*`).

### Modified files
- `src/wrappers/efsWrapper.ts` — `setCardStatus`, `setCardLimits`, `fraudHoldRelease` added.
- `src/wrappers/serverCrmWrapper.ts` — `getMoneyCodePreview`, `drawMoneyCode` (body mirrors the
  agent widget exactly: `moneycode_reason`, `unit_number`).
- `src/modules/carrier/txnReport.ts` — `TxnReportMeta.priceMode?: 'discount'|'retail'`.
  Retail: Amount = funded+discount, Discount column blanked, `_Retail` filename tag, subtitle note.
- `src/routes/v1/carrierMiniApp.routes.ts` — `txnExportSchema` gained
  `priceMode: z.enum(['discount','retail']).default('discount')`; **drivers are FORCED to
  'retail'** in the route (business rule: owners hide discount terms from drivers); Telegram
  caption hides the "saved" figure in retail mode.
- `src/modules/carrier/serviceRequest.ts` — new key `'account-reactivate'` (C-7, owner, CS ticket).
- `apps/mini-app/src/lib/api.ts` — typed client fns for everything above: `fetchCardEfs`,
  `overrideCard`, `setCardStatus`, `setCardLimits`, `updateCardInfo`, `sendFraudRequest`,
  `fetchMoneyCodePreview`, `drawMoneyCode`, and `sendTransactionsReport(..., priceMode)`.
- `src/config/env.ts`, `.env.example`, `WORKING_NOTES.md` (2026-07-20 entry).

## 3. YOUR TASKS (in order)

### T1 — Verify the backend compiles and tests pass
```bash
git switch -c feature/mini-app-wire-actions   # uncommitted tree changes carry over
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
```
Fix any typecheck fallout from the helper extraction (imports were updated, but verify).
Commit backend as its own conventional commit, e.g.
`feat(mini-app): wire C-code card actions + money code backend`.

### T2 — RBAC / safety tests (CLAUDE.md rule 9 — do this BEFORE UI)
Add `tests/` coverage for `carrierMiniAppActions.routes.ts` following the existing test patterns:
- driver calling an owner-only route (`set-status`, `limits`, `info`, `fraud-request`,
  `money-code/*`) → 403.
- owner passing a `cardId` belonging to ANOTHER carrier → 404 (mock `findDwhCardById` returning null).
- driver `override` ignores a body `cardId` and uses their registered card.
- flags off → 503 with the exact codes; rate-limit 6th call within a minute → 429.
- revoked registration → 403 `MINI_APP_REVOKED` (comes free from the shared gate — assert once).
- export route: driver + `priceMode: 'discount'` in body still produces retail (assert the
  `buildTxnReport` call arg or the audit detail).

### T3 — Frontend UI (apps/mini-app)
Vite + React 18, no router — screens/sheets in `App.tsx` (see `ActionSheet`, `SheetData`,
`serviceCatalog.ts`, `i18n.tsx`). Steps:

1. **i18n**: add keys for the new sheets/actions in `lib/i18n.tsx` for EVERY language present
   (check the file — en/ru/uz at minimum). Follow existing key naming (`svc.*`, `cat.*`, `act.*`).
2. **serviceCatalog.ts**: flip these items from `action: 'generic'` (ticket) to real actions:
   - owner: `card-activate` → new action `cardstatus`; `card-limit` → `cardlimits`;
     `fin-money-code` → `moneycode`; `card-fraud` → keep ticket BUT add hold/release direct
     variant if time allows; add `acct-reactivation` item wired to `sendServiceRequest('account-reactivate')`.
   - driver: `drv-override-card` → real `overrideCard()` call (own card, no picker);
     `drv-money-code` stays a ticket (drivers can't draw).
   - Extend the `ServiceKey` union in `lib/demo.ts` and the `SheetData` union + loader + renderer
     in `App.tsx` for each new sheet.
3. **Sheets to build** (reuse existing sheet components/styles — `DetailCard`, list rows, CTA):
   - `cardstatus` / `cardlimits` / `cardinfo`: owner picks a card (reuse `fetchFleet()` rows),
     then the small form; on success → toast + inbox item (see `sendGenericRequest` pattern).
   - `moneycode`: preview first (`fetchMoneyCodePreview`) → amount + unit + reason (reasons come
     from `moneycode_reasons`) → draw → success screen stating the code is delivered separately
     (NEVER render a code value).
   - diagnostics: extend the driver's `status` sheet with `fetchCardEfs()` (limit left, hold flag)
     and an **Override** button when the card is on hold.
4. **Fallback rule**: catch `ApiError` codes `MINIAPP_WRITES_DISABLED` / `MINIAPP_MONEY_CODE_DISABLED`
   → show the existing generic service-request sheet instead (the ticket path still works).
5. Build check: `pnpm --dir apps/mini-app build` (output goes to `apps/mini-app/app`, served at
   `/mini-app/`). Local click-through: `FF_DEV_MOCK_TELEGRAM_ENABLED=1` + the dev
   `/carrier-invitations/dev/mock-init-data` route mints a signed initData.

### T4 — Commit hygiene
Conventional commits, one concern per commit. NEVER push to `build` or `main` — branch off the
latest `build`, PR into `build` via review (see CLAUDE.md "Git branching").

## 4. Hard rules recap (from CLAUDE.md — they override everything)
- ESM: relative imports need explicit `.js` extensions; no `@/*` alias in src.
- Strict TS, no `any`, no `as unknown as X` without a justifying comment.
- 600-line file cap (580 target) — `carrierMiniApp.routes.ts` is legacy-over-cap; do not grow it,
  new routes go in `carrierMiniAppActions.routes.ts` (or a new file if it nears the cap).
- Every DB access via `repos/`; every tool via manifests (not relevant here, but don't drift).
- Migrations: schema change → `pnpm db:generate`, never `drizzle-kit push`. (No schema changes
  are expected for these tasks.)
- Read-only default; the write endpoints here are the sanctioned exception — keep flags,
  ownership checks, rate limits, and audit calls exactly as implemented.
- `pnpm lint && pnpm typecheck && pnpm test` green before any push; append WORKING_NOTES.md entry.

## 5. Reference: where the upstream lives (do not modify those repos)
- servercrm endpoints used: `/api/efs/card/{status,limits,info,override}`, `/api/fraud/hold-release`,
  `/api/agent/dwh/money-code/:carrierId` + `/draw`, `/api/agent/dwh/cards/:id/:card/efs`.
- Agent widget parity source: `zoho-octane/app/self-service/js/components/automation-modal.js`
  (money-code flow ~line 5026; card actions throughout) and `zoho-octane/app/js/automations-catalog.js`.
- Demand data / prioritization: `Analitika/mini_app_wire_royxati.md`, `Analitika/mini_app_wiring_plan.md`.
