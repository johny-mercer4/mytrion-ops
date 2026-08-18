---
name: hr-mytrion
description: Product facts for HR Mytrion — live tabs (Home, Employees, Departments, Org Structure, Attendance, Time Off, admin-only Settings), team-lead vs HR Manager vs admin, Zoho People one-way sync vs app Postgres vs Ganga/DWH punches, two-stage leave. Use when editing HR nav, CRM hr UI, hr/attendance/leave routes, or mytrions hr access. Not Recruit Mytrion. Not the Zoho People API encyclopedia.
---

# HR Mytrion

People-ops desk at `/main/hrmytrion` (`department: 'hr'`). Write-enforced (`MYTRION_WRITE_ENFORCED`). **HR is the only Mytrion that defaults to `read`** (`READ_DEFAULT_MYTRIONS`). Profile default: **HR** → `hr` + `recruit`, home `hr`. Recruiter does **not** get HR. `allowedProfiles` / `allowedRoles`: `['HR']` (placeholder). Admin bypass.

`canAccess('hr')` is **every signed-in worker** (company directory). Team leads (`leadsTeam`, DB-derived) also get HR **pinned on the launcher**. Layer-2 tab grants are UI-only; the endpoint is the security boundary.

No backend chat dock in the CRM (`agentKeyFor('hr')` is `null`). Recruit is a **different** Mytrion. For Zoho People HTTP shapes, use `zoho-people-api` — do not duplicate it here.

## Who can do what (do not invert)

| Role | How it is proven | Desk |
| --- | --- | --- |
| **Anyone internal** | session audience | Enter HR. Read directory / org / departments (`requireHrRead`). Own attendance (`/attendance/me`). Own time off + apply + inbox (linked Active employee). |
| **Team lead** | `managesAnyone` — reportees ∪ departments they **lead**. Session `leadsTeam` is a hint (`leadsTeamFor`); routes re-derive. Not a Zoho title. | Same reads as anyone. Attendance **roster** = their team (`scope: 'all'` server-scoped). **One write:** assign a shift to the team, not themselves. Settings hidden. |
| **HR staff** | `hr` department grant / `accessibleMytrions` includes `hr` | Directory + Time Off **All requests** (`requireDepartment` `hr`). Roster = managed reach unless org-wide. Default **read** — no directory writes. |
| **HR Manager** | explicit `mytrionAccessModes.hr === 'full'` (`canManageHr` / `requireHrManage`). Fail-closed: absent mode ≠ full. | Create / edit / delete employees & departments, org drag + reparent, employee photos. **Not** Settings, Zoho sync, or Zoho-user link. |
| **Org-wide attendance** | admin **or** Zoho profile/role contains **`HR Manager`** (`canViewAllAttendance`) | Roster pane **All** = every Active employee. **Not** the same as `hr: full`. |
| **Mytrion Admin** | `allDepartmentAccess` / `isAdmin` / `requireHrAdmin` | Settings tab. Zoho People **pull** (employees + departments). Zoho CRM user **link**. Shift **CRUD**. Time Off policy (`requireMytrionWrite('hr')` + admin). |

`isHrAttendanceOnly` exists but **does not hide tabs**. Do not restore “team lead → Attendance only” — comments in `resolveAccess.ts`, `HrShell.tsx`, and `hrAttendance.routes.ts` that say the directory 403s a lead are **stale**. Tests: lead sees Home, Employees, Departments, Org, Attendance, Time Off; never Settings.

Person overlay (`HrPersonView`) is **not** global View-as. Needs `hr_employees.zoho_user_id`. Attendance on that panel is team-scoped (`canView`); a 403 does not fail the page.

## Live tab map

No `soon: true`. All seven nav ids are mounted. Profile is **not** a tab (shell username → `UserProfileModal`; `GET /hr/me`).

| Tab (nav id) | Purpose | Primary APIs | Agents get wrong |
| --- | --- | --- | --- |
| **Home** (`home`) | Jump cards (Layer-2 filtered) | none | Not a metrics dashboard. Does **not** fetch the directory. |
| **Employees** (`employees`) | Company directory, filters in memory, person overlay | `GET /hr/employees` limit **500**; writes `POST/PATCH/DELETE`; photo `/photo` + `/photo-links` | **App PG**, not live Zoho. Include Terminated. Sort Active → dept → name. `status` is free text (`lower = 'active'`). Search: name, email, employee id, Telegram. Server search only if `total > items`. |
| **Departments** (`departments`) | Org units + appearance | `GET /hr/departments` limit **500**; writes `POST/PATCH/DELETE` | Headcount from the **cached directory**, not a second endpoint. `mail_alias` / `source` are **not** shown. Icon/tone via `departmentAppearance` maps — never interpolate stored strings. |
| **Org Structure** (`org`) | React Flow canvas | `GET /hr/org-structure`; `PATCH /hr/org/position`, `/hr/org/reparent` | Flat lists, not a nested tree. Departments open, people **collapsed**. Cycles 400. Dept→dept, person→dept, person→person only. Position persist is not audit-logged. |
| **Attendance** (`attendance`) | My Data + one roster | `GET /attendance/me`; `GET /attendance/team` `scope: 'all'` `totals=0`; `POST /attendance/sync`; assign `POST /shifts/:id/assign` | **Not Zoho People attendance.** Ganga door punches in **app PG**. TZ **`Asia/Tashkent`**. Plain employee = My Data only. Do **not** sync the whole week on load — open-a-person or Refresh. Empty week usually means **no Face ID**, not absence. Old `team`/`direct` pane is gone. |
| **Time Off** (`requests`) | Summary / mine / inbox / All | `GET /time-off/me`, `/types`, `/requests` (`mine` \| `inbox` \| `all`); `POST` submit / decision / cancel | **Not Zoho leave.** Two-stage: `pending_lead` → `pending_hr` (skip lead if none or lead = final HR). Decide = **current approver row**, not `hr: full`. `scope=all` needs **`hr` grant** — a lead without it sees the All pane fail. Types: `sick` · `annual_paid` · `unpaid`. Flat yearly allocation — no accrual / carry / pro-rate. Years **2020–2100**. |
| **Settings** (`settings`) | Directory sync · shifts · leave policy | `POST /employees/sync`, `/departments/sync`; shift CRUD; `GET/PATCH /time-off/settings`, types, holidays, `POST /balances/reset` | **Admin only** (nav `isAdmin`). Sync is People → PG **pull**. Punches are **not** synced from Zoho. Final approver must be Active **and** `zoho_user_id`. |

## Data sources — which writes where

| Source | HR reads | HR writes |
| --- | --- | --- |
| **App Postgres** (`hr_employees`, `hr_departments`, punches, shifts, leave_*, `file_assets`) | The desk. Tables **have `tenant_id`**. | Directory / org / photos / leave / shift assign. Manual rows `source: 'manual'`. |
| **Zoho People** | Admin sync only (`zohoPeople` forms `employee` / `department` `getRecords`) | **None from the desk.** Next sync **overwrites** synced projected fields. `raw_fields` stays off the list DTO. |
| **Zoho CRM** | Active users for the link picker | `zoho_user_id` bind (admin). Identity for RBAC / View-as picker — not act-as. |
| **DWH** (`public.acs_event`) | Attendance refresh | **None.** Six Ganga doors only (`DWH_ATTENDANCE_DOORS`). Max window **31** days. Cooldown **60s** unless `force`. |
| **Webhook** | — | `POST /hr/attendance/webhook` (`x-attendance-webhook-secret`). Hikvision / servercrm. Not a session. |
| **Dropbox / file pipeline** | Short-lived `/photo-link` (~4h) | Avatars via `hrStorageProvider()` (not `/comms`). Client-resized data URL, cap **700k**. |

Finder, Recruit, and the `hr` **agent tools** (`hr.find_employee`, `hr.my_time_off`) are not this desk.

## Fetching

| Surface | UI | API cap / default |
| --- | --- | --- |
| Employees / departments | one shot **500** (`DIRECTORY_WINDOW`); filter in memory | max **500**; repo default **100** |
| Org graph | one shot | unbounded vs the 500-row directory window — Refresh if a node has no record |
| Attendance team | one shot; `totals=0` | Active directory **500** when org-wide |
| Time Off lists | All pane **300** | max **300**, default **100** |
| Photo links | on-screen ids | max **100** |
| Shift assign | one person from roster | max **200** ids |
| DWH sync | person on open; week on Refresh | **31** days |

Caches: `hr:*` SWR — directory **60s**, depts/designations **5 min**. `invalidateHrEmployees` also drops org + designations. Attendance `hr:attendance:` — `lastGood`, no remount on Refresh.

## Map

| Layer | Path |
| --- | --- |
| Nav / RBAC | `hrNav.ts` · `hrNav.teamLead.test.ts` · `resolveAccess.ts` (`canManageHr`, `hasFullHrAccess`, `leadsTeam`) |
| UI | `apps/mytrion-crm/src/mytrions/hr/**` · Time Off `_shared/TimeOffWorkspace.tsx` |
| CRM API | `apps/mytrion-crm/src/api/{hr,hrPerson,hrTimeOff}.ts` |
| Routes | `src/routes/v1/{hr,hrPeople,hrDepartments,hrAttendance,hrLeave}.routes.ts` · gates `hrAccess.ts` |
| Modules | `src/modules/hr/**` (sync, org, attendance, leave) |
| Repos | `hrEmployeeRepo`, `hrDepartmentRepo`, `hrAttendance*`, `hrLeave*` |
| Schema | `src/db/schema/hr_*.ts` |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` |

## UI

Horizon tokens (`[data-mytrion='hr']`). **Do not restyle** `MytrionShell` sidebar/header. Dates/attendance: **`Asia/Tashkent`**. Leave list dates: UTC calendar days. One loader — a refetch dims, it does not skeleton over `lastGood`.

## Do not document as current

- **`soon` tabs / `<ComingSoon />`** — field exists; **no HR tab is parked**.
- **`peopleSchema.ts`** — stale People field notes (“attendance/requests still unwired”). Ignore as product truth.
- **Chat dock** — off. Backend `hr` agent exists; that is not this UI.
- **Recruit**, payroll, contracts, Zoho People live proxy, People attendance/leave APIs.
- **Admin hint** “Full access can approve time off” — approve is **current approver**, not `hr: full`.
- **Zoho-user linker** — UI follows `canManageHr`; API is **`requireHrAdmin`**. A non-admin Manager’s save 403s.

## Keep in sync

If you change HR **nav, tab gates, routes, caps, who may write, or which store a write hits**, update this skill in the **same PR** (mirrors: `.claude/skills/hr-mytrion/`, `.cursor/skills/hr-mytrion/`, `.agents/skills/hr-mytrion/`). `.agents/` is gitignored; `git add -f` the skill like the Zoho mirrors.
