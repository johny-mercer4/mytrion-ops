---
name: verification-mytrion
description: Product facts for Verification Mytrion — live 10-phase underwriting rail vs Sales Verification tab vs quarantined credit_platform desk, ingest, write gates, Octane vs Credit Platform vendors, SOP vs shipped code. Use when editing verificationFlow, verification CRM UI, verification routes, or mytrions verification access.
---

# Verification Mytrion

Verification is a workspace product skill. Siblings: Sales, Collection, Customer Service, Billing, HR, Admin. Do not invent CS / Billing / Collection here.

Credit/compliance desk at `/main/verificationmytrion` (`department: 'verification'`). **Not mock.** Cases live in app Postgres (`verification_cases` + `verification_case_phases`). Business language comes from the draft SOP `Octane_New_Applicant_Underwriting_Flow`; **code is what shipped**. When they disagree, this skill states both — do not silently pick one, and do not “fix” the product from a skill mismatch.

## Three doors — do not invert

| Surface | Who | Routes | What it is |
| --- | --- | --- | --- |
| **Verification Mytrion** | Verification worker | `/v1/verification/flow/*` | The live 10-phase desk. Spine is interactive. |
| **Sales Verification tab** | Sales agent (admin-only Sales nav) | `/v1/verification/applications*` | Projection of the **same** `verification_cases` row. Intake until submit; then a read-only rail. **Not** this Mytrion. |
| **Legacy Decision Desk** | quarantined | `/v1/verification/cases*`, stop-factors, strategies | credit_platform inbox / iSoftPull / Creditsafe / Plaid Link. `VERIFICATION_LEGACY_DESK_ENABLED = false`. |

Do not call the Sales tab "Verification Mytrion". Completeness is a **server** verdict — the browser must not invent a gate. CRM live rails call **Octane only** (`verificationFlow.ts` / `verificationDeskWrites.ts`). Never loans / credit_platform HTTP from the browser.

## Ingest — not a numbered phase

There is **no Phase 0** in `PHASE_CATALOG`. Creation is ingest:

- Job `automation.verification.case-ingest` → `verificationFlow/dealIntake.ts`.
- Kill switch `VERIFICATION_ZOHO_INGEST_ENABLED = true`. This is the **only** normal create path.
- Row lands **red** (`verification_process = false`, `status_code = intake_incomplete`), rail seeded, missing list computed. Sales owner = the Deal’s Zoho owner. An unowned Deal is created unassigned — Sales will not see it.
- Applicant type from what Zoho **states**: a real MC/USDOT → `carrier`; `Business_Type` Sole Proprietorship / Natural Person → `owner_operator`; otherwise `null` and Sales picks. Ingest **no longer produces** `company`.
- `POST /verification/applications` is **admin-only backfill** (`origin: 'sales_application'`). Neither desk hand-creates in the normal flow.

SOP says Phase 1 is “Application submitted in Zoho → transferred to Mytrion → opened by Credit Agent”. Code today: Zoho creates the **shell**; Sales still completes intake; the desk cannot underwrite until submit (`loadWorkable` → `VERIFICATION_INTAKE_INCOMPLETE`). Schema comment “Zoho ingest is retired” on `VERIFICATION_CASE_ORIGINS` is **stale**.

## Two doors, one row

| Door | Gate | Verb |
| --- | --- | --- |
| Sales | `requireDepartment(..., 'sales')` | Fill until submit; attach requested PDFs after |
| Desk | `requireDepartment(..., 'verification')` + `requireMytrionWrite('verification')` | Underwrite phases 1–10; correct intake until `closed_at` |

Submit is the handover (`verification_process = true`). Saving a complete form does **not** open the gate — Sales must POST submit. Desk corrections use `refreshGate(..., { submitting: true })` so a desk fix can unlock a red case.

## 10-phase rail

Source: `src/modules/verificationFlow/phases.ts` (`PHASE_CATALOG`) ↔ seed in migration 0121. Skips are explicit (`skipped` + reason), never a silent green. Codes are `pN_*`.

| # | Code | SOP label | Code label | Applies | Owner after ingest |
| --- | --- | --- | --- | --- | --- |
| 1 | `p1_intake` | Application Intake | Application Intake | all | **Sales** until submit; desk may correct |
| 2 | `p2_identity` | Initial Verification (identity / business / bank ownership) | Initial Identity / Business Verification | all | Desk |
| 3 | `p3_screening` | Internal Screening (blacklist + duplicate) | Automated Internal Screening | all | Desk (run allowed on red) |
| 4 | `p4_authority` | Authority Status (carrier MC/DOT) | Authority & Operating Status | **carrier** | Desk (lookup allowed on red) |
| 5 | `p5_routing` | Review Routing (10+ trucks bank first) | Credit & Banking Review Routing | all | Desk |
| 6 | `p6_credit_banking` | Credit + Banking | Credit & Banking Review | all | Desk |
| 7 | `p7_hard_stops` | Hard Stops for LOC | Financial Hard Stops | all | Desk |
| 8 | `p8_highway` | Highway Review | Carrier Operational Review (Highway) | **carrier** | Desk |
| 9 | `p9_risk_capacity` | Risk + Capacity | Risk Tier & Credit Capacity | all | Desk |
| 10 | `p10_decision` | Final Decision | Final Underwriting Decision | all | Desk |

Owner-operator / `company` (LLC, no MC/DOT) skip 4 and 8 with a reason. `company` is still a **read** type for pre-change rows; new ingest does not emit it.

Sales spine uses `SALES_PHASE_LABEL` (“Financial checks”, “Operations”) — not the desk’s `PHASE_SHORT` (“Hard stops”, “Highway”). Sales spine is read-only (`no onPick`).

## Write gates — submit is the handover

`applicationService` has three Sales assertions plus the desk door. Reaching for the wrong one lets Sales rewrite a file a reviewer is reading.

| Gate | Closes when | Used by |
| --- | --- | --- |
| `assertSalesOwns` | never (ownership only) | the other two Sales gates |
| `assertSalesMayEdit` | `verification_process = true` (submit) | Sales PATCH / principals / doc **delete** / submit |
| `assertSalesMayAttach` | `closed_at` set (decision) | Sales document **upload** (Pending Documents) |
| `assertDeskMayCorrect` | `closed_at` set | Desk intake / principals / docs after submit |

After submit: `VERIFICATION_LOCKED` / 409 from Sales. Adding a requested PDF is not overriding. A correction after submit is the desk’s.

| Write | Sales | Desk |
| --- | --- | --- |
| Create application | admin backfill only | no |
| Intake fields, principals, doc delete | until submit | until closed |
| Doc upload | until closed | until closed |
| `plaidConnected` | in `IntakePatch` but **not** Sales’ to satisfy | desk intake pane |
| Phase 2–10 `decidePhase` | never | after submit (`loadWorkable`) |
| Phase 3 screening **run** | never | even on red (`loadScreenable`) |
| Phase 3 hit **verdict** | never | after submit |
| Phase 4 authority **run** | never | even on red |
| Phase 6 / 8 / 9 reviews | never | after submit |
| Phase reopen | never | after submit; not a decided case; reason required |
| Phase 10 decision | never | after submit |
| Policy `GET/POST /verification/flow/policy` | never | verification write |

Banking is either/or. `bankingSource = 'statements'` asks Sales for three received `bank_statement` docs. `'plaid'` asks Sales for nothing — the applicant connects; the desk confirms `plaidConnected`. Demanding that flag at Sales intake made Plaid a dead end.

## Vendor ownership

CRM never calls these vendors. Octane API does.

| Vendor / store | Owner | Used by live rail? |
| --- | --- | --- |
| FMCSA QCMobile (`fmcsaQcMobile.ts`) | **Octane** | Phase 4 + Data Center search. US Render only — `fmcsa.dot.gov` denies non-US egress. |
| Socrata census + filings | **Octane** | Phase 4 fallback. Insurance filings feed is **frozen**. |
| DWH broker snapshot | **Octane** | Phase 4 third opinion + Sales prefill. Not a dependency. |
| Local `verification_blacklist_entries` | **Octane** | Phase 3 Check A (this desk’s own declines). |
| Zoho Deals COQL | **Octane** | Phase 3 Check B (applicants who never became a case) + Citifuel status. |
| App PG reviews / risk / policy | **Octane** | Phases 6 / 7 / 9. Analyst-typed. |
| Highway | **neither** | SOP names it. **No API.** Agent types Phase 8 findings by hand (`deskHighway.ts`). |
| iSoftPull / Creditsafe / Plaid Link | **Credit Platform** | Legacy `/verification/cases*` only. Not pulled into `verification_credit_reviews` / banking. |
| `credit_platform.public.blacklist_entries` | **Credit Platform** (shared list) | Phase 3 Check A read. Decline+Blacklist insert-only writeback (`VERIFICATION_BAN_WRITEBACK_ENABLED`). CP types omit `ssn` / `mc` / `usdot` / `ip` — those stay local. |
| `kxd.sales_agent_*` write-back | Credit Platform | **Off** (`VERIFICATION_CP_WRITEBACK_ENABLED`). |
| `VERIFICATION_DATABASE_URL` | Credit Platform | Admin schema browser / metadata only — **never** a migration target. |

A Decline + Blacklist writes **both** ban lists, then informs Collections (`notify.ts`). Remote half audits on failure — the decision stands.

## Live tabs

Declared in `verificationTabs.ts` (undeclared = invisible to non-admins):

| Tab | What it is |
| --- | --- |
| **Main** | Desk overview (`VerificationMain`) — queue state, not a launcher grid |
| **Inbox** | `mytrion_inbox_messages` tagged `verification`, live `/v1/realtime` |
| **Verification Case** | 10-phase queue + case (`ApplicantsList` / `CaseView` / `PhaseSpine`). The open record still has **Case** / **Data Center** chrome that reuses the same search UI. |
| **Data Center** | Workspace vendor search (`CaseDataCenter`). No case required. `/main/verificationmytrion?tab=data-center`. Optional `dot` / `mc` / `name` / `email` / `phone` (or `q`) query prefills. |
| **Mytrion Watch** | Weekly behavioural re-score of **existing** carriers (`src/modules/mytrionWatch/`). Not the new-applicant SOP. |
| **Existing clients** | Read-only `octane.dim_company` roster (`/v1/verification/roster*`) |
| **Tickets** | `soon: true` — not mounted |

**Data Center.** First-class desk tab, not Sales Verification and not Telegram-only. Live `GET /v1/verification/flow/fmcsa/search?by=dot|mc|name&q=` wraps `lookupFmcsaCarrier` with one QCMobile key. Live `GET /v1/verification/flow/motus/search?by=dot|name&q=` is Motus: the four free Socrata placements (`socrata.census` / `socrata.census.name` / `socrata.insurance` / `socrata.process_agents`). USDOT fans out census + frozen insurance + BOC-3; name is census only — there is no MC or VIN client. Live `GET /v1/verification/flow/broker-snapshot/search?by=dot|name&q=` is our DWH `public.stg_broker_snapshot` (17 columns, no MC). USDOT is exact `dot_number`; name is a prefix on `owner_full_name` (a person, not a legal name) with min 3 chars and LIMIT 25. Live `GET /v1/verification/flow/blacklist/search?by=dot|mc|email|phone|name&q=` runs three probes in parallel (never a merged BLOCKED): own `verification_blacklist_entries` + Credit Platform `blacklist_entries` (hashed identifier; CP has no `mc`/`usdot` type), other `verification_cases` + Zoho Deals COQL (`Email` / `Secondary_Email` / `MC` / `DOT1` / `Deal_Name`; any stage; no invented phone COQL), and DWH `cmp_invoice` roll-up on `carrier_id` with outstanding **> $100** (company-wide debtor law — not `dim_company.is_debtor`, not Collection, not Finance/Sales ≥ $1; invoice age ≥ 2 days is same-day noise only). A down probe is `{ available: false }` on 200, not a clear and not a 403. Live `GET /v1/verification/flow/citi/search?by=dot|mc|email|name&q=` wraps `queryDealsForNeedles` — the same org-wide Zoho Deals COQL Phase 3 already uses (`Email` / `Secondary_Email` / `MC` / `DOT1` / `Deal_Name` + `citifuel_Status`; any stage; no Owner filter; no invented phone COQL). Full selected Deal fields on expand. CMP live Collections (`cmp-backend.production.united-fuel.com`) stays backlog — no `X-API-Key` / `CITI_API_KEY`. All five return the full vendor/warehouse/Deal row on `fields` plus a typed summary; the UI row is name / DOT / MC / status (snapshot has no MC; Blacklist shows three labeled sections; CITI badges `citifuel_Status`) and expand lists remaining keys (null/empty skipped). Prefills USDOT → MC → name from an open case or from the query (Motus and Broker Snapshot skip MC; snapshot prefers the person name; Blacklist also reads `email` / `phone`; CITI also reads `email`, not phone); does not auto-run; does not write findings (Phase 4 `authority/run` still does that). The record chrome is the same component; a failed case GET hides only that chrome, not the workspace tab.

Legacy “Verification cases” / “Decision rules” stay on disk and **undeclared** while `legacyDesk.ts` is off.

## Phase facts (SOP vs code)

**Phase 1 — Intake.** SOP Flow A (owner-operator): name, DOB, DL, SSN card, residential address, phone/email, trucks, cards, requested limit, last 3 statements **or** Plaid. Flow B (carrier): legal name, EIN, MC, USDOT, business address, phone/email, principals, same request + banking. Incomplete → Pending Documents. LLC/corp without MC/DOT → Manager Review. Merge: 1–20 cards → Octane internal; 21+ → WEX.

Code: `intake.ts` is the only completeness verdict. Flow A requires last-4 **and** the DL/SSN **files**. MC/USDOT are collected but **do not** block completeness — missing authority is a **route** (`requiresManagerReviewAtIntake`: `carrier` or `company` + no digit MC/DOT), not an omission. WEX: `resolveUnderwritingRoute` is `wex` when cards **>** `wexCardCutoff` (default 20). Status `routed_wex` is seeded and terminal, but **no flow module writes it** — the route is derived/displayed, not a handoff.

**Phase 2 — Identity.** SOP: cross-check ID / business / bank ownership; missing → Pending Documents; inconsistent → Additional Verification / Manager Review. Code: analyst checklist (`caseIdentity.ts`). **No KYC vendor.**

**Phase 3 — Screening.** SOP Check A (name, EIN/SSN, phone, email, address, IP, MC, USDOT): match → Credit Agent verifies → confirmed → Decline + Blacklist + inform Collections; false match → continue. Check B duplicate/active customer → Manager Review.

Code: four probes — local ban list, CP ban list, other `verification_cases`, Zoho Deals. Hits land `unverified`; verdicts need a complete case. SOP lists IP; code passes `applicantIp: null` (no intake field), so CP `ip` entries are unreachable. Code also surfaces `Deals.citifuel_Status` on deal hits. **SOP places this after a complete application; code may run screening on a red case** so a banned applicant is found before Sales chases documents. A failed remote probe is `available: false`, not a clear.

**Phase 4 — Authority (carrier).** SOP: FMCSA / QCmobile; active → continue; inactive → Manager Review; related company may need Corporate Guarantee; third-party carrier may need Lease + units.

Code: QCMobile + Socrata + DWH snapshot. **Nothing here decides** — findings are suggestions. Insurance: QCMobile only on US Render; Socrata filings frozen. Doc types `lease_agreement` / `corporate_guarantee` exist; **no automated structure check**.

**Phase 5 — Routing.** SOP and code agree: **carrier with 10+ trucks** (`bankFirstTruckMin`, policy) reviews **banking first**; owner-operator or smaller carrier is **credit first**. An owner-operator with a large fleet on paper is still credit-first. Both reviews must exist before Phase 9 (`VERIFICATION_REVIEWS_REQUIRED`). Thresholds live on `verification_policy`, not in the pane.

**Phase 6 — Credit + banking.** SOP: full credit profile (score, lates, collections, utilization, inquiries, history, open accounts/debt, revolving/auto/mortgage, repayment, recent trend). Banking last 3 months (ownership, revenue, weekly net cash flow, balances, NSF/OD, deposit sources, fuel, debt service, one-offs, unusual transfers). Credit: Strong/Acceptable → Pass; Borderline/Mixed → Manager Review; Unacceptable → Deposit/Prepaid.

Code: analyst-typed rows. Net cash flow is **derived** (income − expenses), never accepted from the client. CRM maps borderline → `manager_review`, unacceptable → `deposit_prepaid`; **server `decidePhase` accepts any outcome**. iSoftPull / Creditsafe / Plaid Link are **not** this pane.

**Phase 7 — Hard stops.** SOP two stops, neither an automatic decline: (A) average weekly net cash flow not **> $0** → no standard unsecured LOC → Deposit 1:1 / Prepaid / Manager Review; (B) no bureau file → same. Indicators (revenue decline, ADB ≈ below $500, negative balances, overdrafts, 2+ NSF/ACH, high volatility, heavy debt service, unexplained deposits, related-account transfers, recent deterioration, banking ≠ operations) are **not** declines.

Code: `evaluateHardStops` returns `pass` or `deposit_prepaid` only — **never** `decline`, **never** auto `manager_review`. Exactly $0 fails the stop. Missing Phase 6 cash flow is a third trigger `cash_flow_unrecorded` (unanswered, not “negative”). Indicators are listed for the human; they do not flip the outcome.

**Phase 8 — Highway (carrier).** SOP: safety, alerts, fleet vs requested cards, logbook, connected trucks, insurance, MC/DOT history, authority age, current activity, consistency. Suspicious → Manager Review. Fleet/cards do not automatically cap a strong non-carrier.

Code: **no Highway integration.** Agent types the SOP fields into phase `findings`. `loadWorkable` (needs a complete case), unlike 3/4.

**Phase 9 — Risk + capacity.** SOP marked “TO BE DEVELOPED”. Tiers Strong / Moderate / Weak. Formulas: weekly net = recurring income − recurring expenses; adjusted capacity = net + weekly fuel; recommended limit = capacity × risk factor. Strong ≈ 80% of adjusted capacity. Moderate/Weak unset. Avoid double-counting fuel.

Code: formulas live in `capacity.ts`. Fuel exceeding recurring expenses → `VERIFICATION_FUEL_DOUBLE_COUNTED`. Null moderate/weak factor → `VERIFICATION_POLICY_NOT_SET` (no fallback to Strong or 1.0). Non-positive capacity yields recommended limit `0`. Approve requires a stored risk row.

**Phase 10 — Decision.** SOP outcomes: Approve (assign limit); Borderline/Exception (manager); Deposit 1:1 / Prepaid (reason + conditions); Pending Documents (return to the asking phase); Declined by customer; Decline + Blacklist.

Code `FINAL_DECISIONS`: `approve` (limit required; note required if **above** recommended); `deposit_prepaid` (reason + `deposit_1_1` | `prepaid`); `manager_review` (reason; stays open); `pending_docs` (outstanding request required, else `VERIFICATION_DOCS_REQUEST_REQUIRED`; stays open; resume uses `requested_in_phase`); `declined_customer`; `decline`; `decline_blacklist`. SOP footnote matches code: Pending Documents = missing information; Manager Review = inconsistent / borderline / unusual / exception.

## Policy defaults

`VERIFICATION_POLICY_DEFAULTS` / seed: `strongFactor = 0.800`, moderate/weak **null**, `adbReviewThreshold = 500`, `nsfReviewThreshold = 2`, `bankFirstTruckMin = 10`, `wexCardCutoff = 20`.

## Fetching

| Surface | UI | API |
| --- | --- | --- |
| Desk case queue | table | default **50**, max **2000** |
| Sales Verification apps | one shot **200**, 15/page in the table | max **200**; scope/search/sort **client-side** |

## Quarantined — not the live UI

`VERIFICATION_LEGACY_DESK_ENABLED = false` (`killSwitches.ts`; FE `legacyDesk.ts`). Decision Desk, stop-factors/strategies, first-run, CP write-back stay on disk and 503 `VERIFICATION_LEGACY_DISABLED`. Do **not** flip one flag without the other. Legacy CRM still has iSoftPull helpers; those tabs are undeclared.

## Map

| Layer | Path |
| --- | --- |
| Phases / machine | `src/modules/verificationFlow/phases.ts` · `stateMachine.ts` |
| Sales intake | `applicationService.ts` · `intake.ts` · `src/routes/v1/verificationApplications.routes.ts` |
| Ingest | `dealIntake.ts` · `automation.verification.case-ingest` |
| Desk | `deskService.ts` · `deskDecision.ts` · `deskScreening.ts` · `deskAuthority.ts` · `deskHighway.ts` · `deskReviews.ts` · `hardStops.ts` · `capacity.ts` · `src/routes/v1/verificationFlow.routes.ts` (incl. `DELETE .../documents/:documentId`) · `verificationAuthority.routes.ts` (Phase 4/8 writes + `GET .../fmcsa/search`) · `verificationPolicy.routes.ts` |
| CRM API | `apps/mytrion-crm/src/api/verificationFlow.ts` · `verificationDeskWrites.ts` · `verificationFmcsa.ts` |
| Desk UI | `apps/mytrion-crm/src/mytrions/verification/**` |
| Sales tab (not this desk) | `.../sales/redesign/tabs/VerificationTab.tsx` · `salesVerificationQueue.ts` · `applicationIntake.tsx` |
| Kill switches | `src/modules/verification/killSwitches.ts` ↔ `legacyDesk.ts` |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` |

## Do not

- Invent CS / Billing / Collection workspace skills from this desk.
- Restyle `MytrionShell` sidebar/header, or restyle the CRM while updating this skill.
- Call credit_platform / loans APIs from the CRM live rail.
- Treat fixtures, Highway-as-API, or the legacy Decision Desk as the live underwriting UI.
- Let Sales PATCH after submit. Corrections go through the desk door.
- Treat a skip as a pass. Treat a failed ban-list probe as a clear.
- Silently “fix” SOP vs code in product code unless the skill itself was simply wrong.
- Add a Salesforce TARGET.md / pack from this skill.
- Write Data Center FMCSA, Motus, Broker Snapshot, Blacklist, or CITI Fuel hits onto the case. Search is view-only; Phase 4 Run still stores the register.

## Keep in sync

If you change Verification **tabs, gates, phases, routes, vendors, or which store a write hits**, update this skill in the **same PR** (mirrors: `.claude/skills/verification-mytrion/`, `.cursor/skills/verification-mytrion/`). `.agents/` is gitignored; `git add -f` if that mirror is present. Canonical tree: `.claude/skills` (see that folder’s README).
