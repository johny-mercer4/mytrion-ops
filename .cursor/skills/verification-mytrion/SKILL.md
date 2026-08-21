---
name: verification-mytrion
description: Product facts for Verification Mytrion — live 10-phase underwriting rail, Sales intake vs desk `/verification/flow/*`, write gates, quarantined credit_platform desk. Use when editing verificationFlow, verification CRM UI, verification routes, or mytrions verification access.
---

# Verification Mytrion

Verification is a workspace product skill. Siblings: Sales, Collection, Customer Service, Billing, HR, Admin.

Credit/compliance desk at `/main/verificationmytrion` (`department: 'verification'`). **Not mock.** Cases live in app Postgres (`verification_cases` + `verification_phases`). The live UI is the 10-phase rail, not the quarantined credit_platform Decision Desk.

Cases are created by the Deal poller (`automation.verification.case-ingest` → `verificationFlow/dealIntake.ts`). Neither desk hand-creates one. `POST /verification/applications` is admin-only backfill.

## Two doors, one row

| Door | Who | Routes | Verb |
| --- | --- | --- | --- |
| **Sales intake** | Sales agent (admin-only Sales tab) | `/v1/verification/applications*` | Fill the application until submit |
| **Verification desk** | Verification worker | `/v1/verification/flow/*` | Underwrite the 10-phase rail |

Do not call the Sales tab "Verification Mytrion". Sales is a projection of the agent's applications. Completeness is a **server** verdict — the browser must not invent a gate.

## 10-phase rail

Source: `src/modules/verificationFlow/phases.ts` (`PHASE_CATALOG`). DB seed must match. Skips are explicit (`skipped` + reason), never a silent green.

| # | Code | Label | Applies |
| --- | --- | --- | --- |
| 1 | `intake` | Application Intake | all |
| 2 | `identity` | Initial Identity / Business Verification | all |
| 3 | `screening` | Automated Internal Screening | all |
| 4 | `authority` | Authority & Operating Status | **carrier** only |
| 5 | `routing` | Credit & Banking Review Routing | all |
| 6 | `creditBanking` | Credit & Banking Review | all |
| 7 | `hardStops` | Financial Hard Stops | all |
| 8 | `highway` | Carrier Operational Review (Highway) | **carrier** only |
| 9 | `riskCapacity` | Risk Tier & Credit Capacity | all |
| 10 | `decision` | Final Underwriting Decision | all |

Owner-operator / company-without-MC skip 4 and 8 with a reason on the rail. `company` (LLC, no MC/DOT) routes to Manager Review at intake.

## Write gates — submit is the handover

`applicationService` has three Sales assertions plus the desk door. Reaching for the wrong one lets Sales rewrite a file a reviewer is reading.

| Gate | Closes when | Used by |
| --- | --- | --- |
| `assertSalesOwns` | never (ownership only) | the other two Sales gates |
| `assertSalesMayEdit` | `verification_process = true` (submit) | Sales PATCH / principals / doc **delete** / submit |
| `assertSalesMayAttach` | `closed_at` set (decision) | Sales document **upload** (Pending Documents) |
| `assertDeskMayCorrect` | `closed_at` set | Desk corrections after submit |

After submit: `VERIFICATION_LOCKED` / 409 from Sales. Adding a requested PDF is not overriding. Banking is either/or — Plaid is the **desk's** to confirm (`plaidConnected`), not Sales'.

Desk writes are `requireDepartment(..., 'verification')` + `requireMytrionWrite('verification')` on `/verification/flow/*`.

## Live tabs

Declared in `verificationTabs.ts` (undeclared = invisible to non-admins):

| Tab | What it is |
| --- | --- |
| **Main** | Desk overview (`VerificationMain`) |
| **Inbox** | `mytrion_inbox_messages` tagged `verification`, live `/v1/realtime` |
| **Verification Case** | 10-phase queue + case (`ApplicantsList` / `CaseView`) |
| **Mytrion Watch** | Weekly behavioural re-score (`src/modules/mytrionWatch/`) |
| **Existing clients** | Read-only `octane.dim_company` roster (`/v1/verification/roster*`) |
| **Tickets** | `soon: true` — not mounted |

## High-level desk work

- **Phase 3 screening:** ban list (name / email / phone / authority) + duplicate / Citifuel. A decline writes identifiers onto **both** ban lists.
- **Phase 4 authority:** FMCSA register + Socrata census + insurance history (`deskAuthority.ts`). Carrier-only.
- **Phase 8 Highway:** operational review (`deskHighway.ts`). Carrier-only.
- Policy: `GET/POST /verification/flow/policy`.

## Quarantined — not the live UI

`VERIFICATION_LEGACY_DESK_ENABLED = false` (`killSwitches.ts`; FE mirror `legacyDesk.ts`). Credit-platform Decision Desk, stop-factors/strategies, and CP write-back stay on disk and 503 `VERIFICATION_LEGACY_DISABLED`. Do **not** call loans/CP from the CRM. Do not flip one flag without the other.

`VERIFICATION_DATABASE_URL` (`credit_platform`) is metadata / Admin schema browser only — never a migration target.

## Map

| Layer | Path |
| --- | --- |
| Phases | `src/modules/verificationFlow/phases.ts` |
| Sales intake | `src/modules/verificationFlow/applicationService.ts` · `src/routes/v1/verificationApplications.routes.ts` |
| Desk | `src/modules/verificationFlow/deskService.ts` · `src/routes/v1/verificationFlow.routes.ts` |
| CRM API | `apps/mytrion-crm/src/api/verificationFlow.ts` · `verificationDeskWrites.ts` |
| UI | `apps/mytrion-crm/src/mytrions/verification/**` |
| Sales tab (not this desk) | `apps/mytrion-crm/src/mytrions/sales/redesign/tabs/VerificationTab.tsx` |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` |

## Do not

- Invent CS / Billing / Collection workspace skills from this desk.
- Restyle `MytrionShell` sidebar/header.
- Call credit_platform / loans APIs from the CRM.
- Treat fixtures or the legacy Decision Desk as the live underwriting UI.
- Let Sales PATCH after submit. Corrections go through the desk door.

## Keep in sync

If you change Verification **tabs, gates, phases, routes, or which store a write hits**, update this skill in the **same PR** (mirrors: `.claude/skills/verification-mytrion/`, `.cursor/skills/verification-mytrion/`). `.agents/` is gitignored; `git add -f` if that mirror is present.
