---
name: zoho-people-api
description: Zoho People API reference — OAuth/scopes, the three coexisting API styles (legacy forms, v2 modules, new v3 REST), forms/records CRUD, employees, departments/designations/org structure, attendance, leave, timesheets, bulk import, rate-limits, errors. Use when building or debugging Zoho People tool integrations in this repo (the `zoho_people` wrapper + ToolManifest tools).
---

# Zoho People API — skill

**Using this in Mytrion Ops (our codebase):**
- **Auth:** `wrapper.authHeaders('zoho_people')` ([src/integrations/wrapper.ts](../../../src/integrations/wrapper.ts)) → `Authorization: Zoho-oauthtoken <token>`; token cached per service.
- **Base URL:** `zoho.baseUrl('zoho_people')` → env `ZOHO_PEOPLE_BASE_URL` (default `https://people.zoho.com/api`).
- **Scopes:** `ZOHO_PEOPLE_REFRESH_TOKEN` minted with the People scopes in §1 (e.g. `ZOHOPEOPLE.forms.ALL`, `ZOHOPEOPLE.employee.ALL`, leave/attendance scopes).
- **⚠️ Read §0 first:** Zoho People is **not one clean versioned API** — three styles coexist (legacy `forms/…`, `v2/…`, new `v3/…`) with different success envelopes (`status:0` vs `status:1` vs `"status":"success"`). Pick per-endpoint; this skill flags which.
- **Our org's live forms/fields:** `pnpm meta:zoho-people` → `metadataScripts/output/zoho-people.{json,md}` (git-ignored).
- **Wiring:** expose as `ToolManifest` tools → `toolDispatcher` (RBAC + department/`Administrator` gating).

---

# Zoho People API — Backend Engineering Reference

Compiled from official Zoho documentation under `https://www.zoho.com/people/api/`. Each section cites the source page. Where Zoho's docs are inconsistent or silent, this is called out explicitly rather than guessed.

---

## 0. Critical orientation: API "styles" and versions (read first)

Zoho People's HTTP API is **not one clean versioned surface**. Three overlapping styles coexist in the current official docs, and you will mix them in one integration:

| Style | Base path pattern | Shape | Auth envelope returned | Status / Example |
|---|---|---|---|---|
| **Legacy "forms" API** (the workhorse) | `…/api/forms/<formLinkName>/<action>` and `…/api/forms/json/<formLinkName>/<action>` | Form-centric. Records, employees, departments, leave-apply all go through *forms*. Params often `x-www-form-urlencoded` (e.g. `inputData={...}`) | `{"response":{"result":…,"message":…,"uri":…,"status":0}}` — **`status:0` = success** | Insert/Update/Get records, Add employee, Add leave |
| **Module "v2" endpoints** | `…/api/v2/<module>/…` (e.g. `v2/leavetracker/...`, `leave/v2/holidays/...`, `attendance/...`) | Module/report oriented; mixed conventions | Mixed: some `status:0`, holidays returns **`status:1`** for success | Leave records v2, Booked&Balance, Holidays |
| **New "v3" REST API** | `…/api/v3/<module>/<resource>[/<id>]` (e.g. `v3/leave-tracker/leaves`, `v3/orgstructure/divisions/{id}`, `v3/attendance/entries/{id}`) | Proper REST: resource nouns, path IDs, `PUT`/`POST`/`GET`, **snake_case** JSON, array/enum filters, `offset`/`limit` | `{"data":[…],"message":…,"status":"success"}` and `{"code":"NOT_FOUND",...}` on error | Org structure, v3 leave, v3 attendance edit |

Sources: [API Overview](https://www.zoho.com/people/api/overview.html), [V3 Overview](https://www.zoho.com/people/api/v3/overview.html), [V3 scopes](https://www.zoho.com/people/api/v3/scopes.html).

**Which to use?**
- There is **no Zoho statement deprecating the legacy forms API** — it remains the documented, complete CRUD surface and is what most integrations (and your codebase) use. For **core record/employee/form CRUD, stay on the legacy forms API.**
- **V3 is the newer, cleaner surface but is partial** — at time of writing it covers org structure, parts of leave-tracker, and parts of attendance. Prefer V3 *only* for the modules where it exists and you want the nicer contract.
- **Ambiguity to be aware of (verified in docs):**
  1. **Two base prefixes appear interchangeably:** `https://people.zoho.com/api/...` and `https://people.zoho.com/people/api/...`. Different doc pages show different prefixes for the *same* action (e.g. Fetch Record shows `/api/forms/...`; Get Bulk Records shows `/people/api/forms/...`; both describe `getRecords`). Both resolve in practice. **Your codebase uses base `https://people.zoho.com/api`** — that is consistent with the newer pages. Treat `/people/api` and `/api` as equivalent roots; pick one and be consistent.
  2. **Scope name typo in docs:** the Forms-metadata pages cite `ZOHOPEOPLE.form.READ` (singular "form"), while the [scopes page](https://www.zoho.com/people/api/scopes.html) only defines `ZOHOPEOPLE.forms.*` (plural). Use the **plural** `ZOHOPEOPLE.forms.READ`; the singular is almost certainly a documentation typo.
  3. **Success sentinel differs by endpoint:** legacy/forms uses numeric `status:0`; the holidays v2 endpoint returns `status:1` on success; v3 uses string `status:"success"`. **Do not hardcode one success check across modules.**
  4. **`getDataByID` vs `getRecordByID`:** `getDataByID`/`getRecordById` is the **Deluge** task name; the **REST** endpoint is `getRecordByID`.

---

## 1. Authentication & OAuth Scopes

Source: [OAuth Overview](https://www.zoho.com/people/api/oauth.html), [OAuth Steps](https://www.zoho.com/people/api/oauth-steps.html), [Scopes](https://www.zoho.com/people/api/scopes.html), [V3 Scopes](https://www.zoho.com/people/api/v3/scopes.html).

### 1.1 Protocol & header
- OAuth 2.0, **Authorization Code** grant.
- **Every API call** sends:
  ```
  Authorization: Zoho-oauthtoken <access_token>
  ```
  (Confirmed in your codebase and across all doc pages.)
- **Access token lifetime: 1 hour** (`expires_in: 3600`). **Refresh token: no expiry** until revoked — store it securely, never client-side.

### 1.2 Data centers (DCs)
The `accounts` (auth) domain and the `people` (API) domain must match the org's DC. Confirmed DCs from the docs:

| DC | Accounts (OAuth) domain | People API host |
|---|---|---|
| US | `https://accounts.zoho.com` | `https://people.zoho.com` |
| EU | `https://accounts.zoho.eu` | `https://people.zoho.eu` |
| India | `https://accounts.zoho.in` | `https://people.zoho.in` |
| Australia | `https://accounts.zoho.com.au` | `https://people.zoho.com.au` |
| Japan | `https://accounts.zoho.jp` | `https://people.zoho.jp` |
| China | `https://accounts.zoho.com.cn` | `https://people.zoho.com.cn` |

> The OAuth-steps page **explicitly lists only US, AU, EU, IN, CN, JP.** Other Zoho DCs (Canada `.ca`, Saudi `.sa`) exist for Zoho generally but are **not enumerated on this People page** — do not assume them without checking the org's actual accounts domain. The People API host mapping above follows Zoho's standard per-DC suffix convention; verify the host for non-US orgs.

### 1.3 Authorization request (get the `code`)
```
GET https://accounts.zoho.{dc}/oauth/v2/auth
    ?scope=ZOHOPEOPLE.forms.ALL,ZOHOPEOPLE.employee.ALL
    &client_id={client_id}
    &response_type=code
    &access_type=offline            # "offline" → returns a refresh_token; "online" → access only
    &redirect_uri={redirect_uri}
```

### 1.4 Exchange code → tokens
```
POST https://accounts.zoho.{dc}/oauth/v2/token
  (params, form-encoded or query)
  grant_type=authorization_code
  client_id={client_id}
  client_secret={client_secret}
  redirect_uri={redirect_uri}
  code={grant_token}
```
Response:
```json
{
  "access_token": "1000.xxxx.yyyy",
  "refresh_token": "1000.aaaa.bbbb",
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer",
  "expires_in": 3600
}
```
> Note: the returned `api_domain` (`https://www.zohoapis.com`) is the **generic Zoho APIs domain**; for Zoho People you still call the **`people.zoho.{dc}`** host, not `zohoapis`. The docs only show the US `api_domain`; per-DC `zohoapis.{dc}` values are not enumerated on this page.

### 1.5 Refresh the access token (your codebase's path)
```
POST https://accounts.zoho.{dc}/oauth/v2/token
    ?refresh_token={refresh_token}
    &client_id={client_id}
    &client_secret={client_secret}
    &grant_type=refresh_token
```
Returns a fresh `access_token` (+ `expires_in: 3600`); the `refresh_token` is reused.

### 1.6 Scopes
**Format:** `service_name.scope_name.operation_type` → service is always `ZOHOPEOPLE`.
**Operation types:** `CREATE`, `READ`, `UPDATE`, `DELETE`, `ALL`.

| Functional area | Scope name | Documented scopes |
|---|---|---|
| Forms / records | `forms` | `ZOHOPEOPLE.forms.ALL`, `.CREATE`, `.READ`, `.UPDATE` (and `.DELETE` by the format) |
| Employee | `employee` | `ZOHOPEOPLE.employee.ALL` |
| Leave | `leave` | `ZOHOPEOPLE.leave.ALL`, `.READ`, `.CREATE`, `.UPDATE` |
| Attendance | `attendance` | `ZOHOPEOPLE.attendance.ALL` (v3 also uses `.UPDATE`, `.READ`) |
| Time Tracker | `timetracker` | `ZOHOPEOPLE.timetracker.ALL`, `.READ`, `.CREATE` |
| Dashboard | `dashboard` | `ZOHOPEOPLE.dashboard.ALL` |
| Automation | `automation` | `ZOHOPEOPLE.automation.ALL` |
| Org structure (V3) | `orgstructure` | `ZOHOPEOPLE.orgstructure.READ` |

> The v2 and v3 scopes pages list the **same scope strings** — scopes are shared across API styles; the version is in the URL path, not the scope. Most read endpoints accept `…ALL` or `…READ`. Several endpoint pages (leave types, attendance entries, regularization, holidays, record-count) **omit the scope**; based on the area, use the matching module scope (`ZOHOPEOPLE.leave.*`, `ZOHOPEOPLE.attendance.*`). Multiple scopes are comma-separated in the auth request.

---

## 2. Metadata / Forms (Forms are People's "modules")

Source: [Fetch Forms](https://www.zoho.com/people/api/forms-api/fetch-forms.html), [Get Fields of Form](https://www.zoho.com/people/api/forms-api/get-field-forms.html), [Views](https://www.zoho.com/people/api/default-custom-views.html), [Appendix](https://www.zoho.com/people/api/appendix.html).

**Concept:** A *form* (e.g. `employee`, `department`, `leave`) is the equivalent of a CRM "module." Each form has a **`formLinkName`** (immutable internal label) and one or more **views** (`viewName`, e.g. `P_EmployeeView`). Records carry **field label names** (immutable, e.g. `EmailID`) distinct from display names ("Email address").

### 2.1 List all forms
```
GET https://people.zoho.com/people/api/forms
Scope: ZOHOPEOPLE.forms.READ   (docs say ZOHOPEOPLE.form.READ — typo; use plural)
Rate limit: 30 req / 5 min
```
```json
{ "response": { "result": [
  { "componentId": 759415000000035743, "iscustom": false,
    "displayName": "Asset", "formLinkName": "asset",
    "PermissionDetails": { "Add": 3, "Edit": 3, "View": 3 },
    "isVisible": true,
    "viewDetails": { "view_Id": 759415000000035745, "view_Name": "AssetView" } }
] } }
```

### 2.2 Get a form's fields/components (field metadata)
```
GET https://people.zoho.com/api/forms/<formLinkName>/components
Scope: ZOHOPEOPLE.forms.READ
Rate limit: 400 req / 5 min
```
```json
{ "response": { "result": [
  { "comptype": "Email", "ismandatory": true, "displayname": "Email address",
    "labelname": "EmailID", "maxLength": 100, "formcomponentid": 759415000000036259 },
  { "comptype": "Text", "ismandatory": true, "displayname": "First Name",
    "labelname": "FirstName", "maxLength": 100 }
] } }
```
Field-object keys: `comptype`, `ismandatory`, `displayname`, `labelname`, `formcomponentid`, `maxLength`, `description`, `descriptionType`, `autofillvalue`.

**Field types (`comptype`) confirmed in docs:** `Email`, `Text` (single line), `Multi_Line`, `Lookup`, plus the standard set referenced in examples (Number, Decimal, Date, Picklist/dropdown, URL). The docs **do not publish an exhaustive `comptype` enum** — discover types per form via `/components`.

> **Lookup fields:** `/components` returns the lookup's possible values each with an `Id`. **You must pass that `Id` (not the display text)** as the value for lookup fields in insert/update calls. (Appendix.)

### 2.3 List views (per form)
```
GET https://people.zoho.com/api/views
Scope: ZOHOPEOPLE.forms.READ
Rate limit: 30 req / 5 min
```
```json
{ "response": { "result": [
  { "P_Employee": [
    { "viewId": 759415000000035705, "viewdisplayName": "Employee View", "viewName": "P_EmployeeView" },
    { "viewId": 759415000000035793, "viewdisplayName": "Disabled Employee View", "viewName": "DowngradedEmployeeView" }
  ]},
  { "P_Department": [
    { "viewId": 759415000000035707, "viewdisplayName": "Department View", "viewName": "P_DepartmentView" }
  ]}
], "status": 0 } }
```

### 2.4 Finding `formLinkName` / field label names
Three documented methods (Appendix): (1) Settings → Customization → Forms → form/field properties → "Label Name"; (2) Settings → Developer Space → Zoho People API → API reference tab; (3) the Fetch Forms / Get Fields APIs above.

---

## 3. Core Record APIs (form-based CRUD)

Sources: [Fetch Record](https://www.zoho.com/people/api/fetch-record.html), [Get Bulk Records](https://www.zoho.com/people/api/bulk-records.html), [Search Records](https://www.zoho.com/people/api/forms-api/search-record.html), [Fetch Single Record by ID](https://www.zoho.com/people/api/forms-api/fetch-single-section.html), [Insert Record](https://www.zoho.com/people/api/insert-records.html), [Update Records](https://www.zoho.com/people/api/update-records.html), [Record count](https://www.zoho.com/people/api/record-count.html).

> **Heads-up — two record-read shapes exist** and the docs present both:
> - **`/api/forms/<viewName>/records`** (Fetch Record page) → returns a **flat JSON array** of records with a `recordId` key; param for page size is **`rec_limit`** (min 10, default 200); rate limit **30/5min**.
> - **`/api/forms/<formLinkName>/getRecords`** (Bulk Records & Search pages) → returns **`response.result`** as an array of single-key objects `{ "<recordId>": [ {fields…} ] }`; page size param is **`limit`** (max 200); includes `tabularSections`; rate limit **400/5min**.
>
> They take a **view name** vs a **form link name** respectively and return **different JSON shapes**. Pick deliberately and parse accordingly. The `getRecords` form-based variant is the more widely referenced one.

### 3.1 Fetch records (flat, by view)
```
GET https://people.zoho.com/api/forms/<viewName>/records
Scope: ZOHOPEOPLE.forms.READ      Rate limit: 30 req / 5 min
```
| Param | Default | Notes |
|---|---|---|
| `viewName` (path) | — | from Views API |
| `sIndex` | 1 | starting index |
| `rec_limit` | 200 | min 10 |
| `searchColumn` | — | `EMPLOYEEID` or `EMPLOYEEMAILALIAS` |
| `searchValue` | — | the value to match |
| `modifiedtime` | — | epoch **ms**; returns records added/modified after |

```
GET /api/forms/P_EmployeeView/records?searchColumn=EMPLOYEEMAILALIAS&searchValue=johndoe@example.com
```
```json
[{ "Email address":"johndoe@example.com","recordId":"759415000001155233",
   "Employee ID":"HRM02","First Name":"John","Last Name":"Doe",
   "Employee Status":"Active","modifiedTime":"1744977447648" }]
```

### 3.2 Get bulk records (nested, by form) — primary list endpoint
```
GET https://people.zoho.com/people/api/forms/<formLinkName>/getRecords
Scope: ZOHOPEOPLE.forms.READ      Rate limit: 400 req / 5 min      Max 200 records/call
```
| Param | Default | Notes |
|---|---|---|
| `sIndex` | 1 | index starts at 1 |
| `limit` | 200 | **max 200** |
| `searchColumn` / `searchValue` | — | simple filter |
| `searchParams` | — | rich filter (see 3.3) |
| `modifiedtime` | — | epoch ms |

```json
{ "response": { "result": [
  { "759415000001155233": [
    { "EmailID":"johndoe@example.com","FirstName":"John",
      "tabularSections": { "Work experience": [ { "Jobtitle":"Developer","tabular.ROWID":"759415000001294003" } ] } }
  ]}
], "message":"Data fetched successfully", "status":0 } }
```

**Pagination pattern (both variants):** start `sIndex=1`, request `limit=200`, then `sIndex += 200`; stop when fewer than `limit` are returned. (Time Tracker endpoints additionally return `isNextAvailable` — see §8.)

### 3.3 Search records by field values
Same `getRecords` endpoint with a **`searchParams`** expression. Multiple criteria are **pipe-delimited** (`|` = AND):
```
GET /api/forms/employee/getRecords?searchParams={searchField:'Employeestatus',searchOperator:'Is',searchText:'Active'}|{searchField:'Role',searchOperator:'Is',searchText:'Team Member'}
Scope: ZOHOPEOPLE.forms.READ
```
**Operators:** `Is, Is_Not, Is_Empty, Is_Not_Empty, Starts_With, Ends_With, Like, Contains, Not_Contains, Lesser_Than, Greater_Than, Lesser_than_or_equal_to, Greater_than_or_equal_to, Before, After, Between, Yesterday, Today, Tomorrow, Last_7_Days, Last_30/60/90/120_Days, Next_7/30/60/90/120_Days, Last_Month, This_Month, Next_Month, Current_and_Previous_Month, Current_and_Next_Month, Last_Year, This_Year, Next_Year, Last_2_Years, Next_2_Years, Current_and_Previous_Year, Current_and_Next_Year, True, False`.

### 3.4 Get a single record by ID
```
GET https://people.zoho.com/api/forms/<formLinkName>/getRecordByID?recordId=<id>
Scope: ZOHOPEOPLE.forms.READ
```
Returns the record **grouped by section** (note the section-keyed object) plus `ApprovalStatus`:
```json
{ "response": { "result": [
  { "Department Details": { "Department":"Marketing","Department_Code":"01",
      "Department_Lead":"Jane Doe","Department_Lead.ID":"759415000000240001",
      "Parent_Department":"HR","Parent_Department.ID":"759415000000240003",
      "MailAlias":"marketing@example.com" },
    "ApprovalStatus":"Approval Not Enabled" }
], "status":0 } }
```
> The REST action is **`getRecordByID`**. (`getRecordById`/`getDataByID` are Deluge task names.)

### 3.5 Insert a record
```
POST https://people.zoho.com/api/forms/json/<formLinkName>/insertRecord
Content-Type: application/x-www-form-urlencoded
Scope: ZOHOPEOPLE.forms.CREATE   (or .ALL)     Rate limit: 100 req / 5 min
```
Body params: `inputData` (JSON of `{LabelName:"value", …}`, **required**), `isDraft` (`true|false`, optional).
```
--data-urlencode 'inputData={Single_Line_1:"a1",Multi_Line_1:"12",Lookup_1:"705358000000229001"}'
```
```json
{ "response": { "result": { "pkId":"705358000000970013", "message":"Successfully Added" },
  "message":"Data added successfully", "uri":"/api/forms/json/test_form/insertRecord", "status":0 } }
```
- New record id is returned as **`pkId`**.
- **Tabular sections:** pass rows as a JSON **array** inside `inputData`. There is **no separate "bulk insert records" REST endpoint** — insert is one record per call (rate-limited at 100/5min). Bulk only exists for Attendance and Leave-balance (see §6, §7) and via the in-product CSV import (not an API).

### 3.6 Update a record
```
POST https://people.zoho.com/api/forms/json/<formLinkName>/updateRecord
Content-Type: application/x-www-form-urlencoded
Scope: ZOHOPEOPLE.forms.UPDATE    Rate limit: 300 req / 5 min
```
Body: `inputData={...}` (fields to change) + `recordId=<id>` (get the id from getRecords/getRecordByID).
```json
{ "response": { "result": { "pkId":"100002000000038085", "message":"Successfully Updated" },
  "message":"Data updated successfully", "status":0 } }
```

### 3.7 Delete a record — **documentation gap**
There is **no dedicated public REST page** for deleting a form record in Zoho People's API docs (verified: `forms-api/delete-record.html` → 404; targeted searches surface only Creator/CRM/Recruit delete APIs and the Deluge `zoho.people.deleteRecord` task). Error code **7037–7040** (permission) and the `ZOHOPEOPLE.forms.DELETE` operation type imply a delete capability exists, but **Zoho does not document the endpoint.** Do **not** hardcode an assumed path. Options: use Deluge (`zoho.people.deleteRecord(<form>, <recordId>)`) via a custom function, or contact Zoho/confirm in *Settings → Developer Space → API reference* for your org. **Flagging as unresolved rather than inventing a URL.**

### 3.8 Record count
```
GET https://people.zoho.com/people/api/employee/counts[&month=<m>&year=<y>]
```
Returns `[{"Count":1752}]`. (Docs show the legacy `authtoken` query param; use the OAuth header instead. Scope undocumented — use `ZOHOPEOPLE.employee.ALL`/`forms.READ`.)

---

## 4. Employee APIs

Source: [Adding Employees](https://www.zoho.com/people/api/adding-employees.html). Employee is just the **`employee`** form (view `P_EmployeeView`), so all of §3 applies. Mandatory fields: **`EmployeeID`, `FirstName`, `LastName`, `EmailID`.**

### 4.1 Get employees
Use §3.1/§3.2/§3.3 against `P_EmployeeView` / `employee`. By email:
```
GET /api/forms/employee/getRecords?searchColumn=EMPLOYEEMAILALIAS&searchValue=johndoe@example.com
```
By employee id: `searchColumn=EMPLOYEEID&searchValue=HRM02`. By record id: §3.4.

### 4.2 Add an employee
```
POST https://people.zoho.com/people/api/forms/json/employee/insertRecord
Scope: ZOHOPEOPLE.forms.CREATE       Rate limit: 300 req / 5 min
inputData={"EmployeeID":"HRM02","FirstName":"John","LastName":"Doe","EmailID":"johndoe@example.com"}
```
```json
{ "response": { "result": { "pkId":"759415000001352001", "message":"Successfully Added" },
  "message":"Data added successfully", "status":0 } }
```
Optional behavior flags:
| Flag | Effect |
|---|---|
| (none) | Creates an **inactive** record and sends an invitation email |
| `isNonUser=true` | Creates an employee profile **without** system/login access |
| `isDirectAdd=true` | Adds employee as **active** immediately; **requires `password`** param |

### 4.3 Update an employee
Use §3.6 against form `employee` with the employee `recordId`. Changing status/role is constrained (error codes 7060 super-admin role change, 7061 invalid status change).

---

## 5. Department / Designation / Org structure

### 5.1 Departments (legacy = the `department` form)
Departments are managed as the **`department`** form / **`P_DepartmentView`** view.
- **List:** `GET /api/forms/department/getRecords` (§3.2) or `/api/forms/P_DepartmentView/records`.
- **Get one:** `GET /api/forms/department/getRecordByID?recordId=<id>` → fields `Department`, `Department_Code`, `Department_Lead`(+`.ID`,`.MailID`), `Parent_Department`(+`.ID`), `MailAlias`. (See §3.4 example.)
- **Add:** `POST /api/forms/json/department/insertRecord` with `inputData` fields `Department`, `MailAlias`, `Department_Lead`, `Parent_Department`. (The dedicated [Adding Departments page](https://www.zoho.com/people/api/add-department.html) currently 404s, but the field set is confirmed from the department record schema and the Add-Departments search result; treat it as a normal form insert per §3.5.)
- Cyclic parent-department references are rejected (error **7062**).

### 5.2 Designations / Roles
**No dedicated Zoho People REST endpoint is documented** for listing/adding designations or roles. Designations/roles are configured in-product (Settings → Roles) and surface as **fields on the employee form** (e.g. `Role`, `Role.ID` appear in employee records, see §3.3). To enumerate them, read distinct values via the employee form or the relevant lookup field's `/components` values. (Org-wide `getDesignations` exists only in **Zoho Directory / Zoho One** APIs, a different product surface — not Zoho People.) **Flagging as a People-API gap.**

### 5.3 Organization Structure — **V3 API**
Source: [V3 Org Structure — Get single record](https://www.zoho.com/people/api/v3/orgstructure/single-record.html). Three hierarchy levels: **entities**, **units**, **divisions**.
```
GET https://people.zoho.com/api/v3/orgstructure/entities/{id}
GET https://people.zoho.com/api/v3/orgstructure/units/{id}
GET https://people.zoho.com/api/v3/orgstructure/divisions/{id}
Scope: ZOHOPEOPLE.orgstructure.READ      Rate limit: 30 req / 5 min
```
```json
{ "zp_code":"1",
  "parent_division": { "name":"Management", "zoho_id":"100002…" },
  "name":"HR", "description":"division1 description", "zoho_id":"100002…" }
```
Error: `{ "code":"NOT_FOUND", "message":"Record not found" }` (404). **List/bulk endpoints for org structure are not documented** — only get-by-id is shown.

---

## 6. Attendance

Sources: [Check-In/Out](https://www.zoho.com/people/api/attendance-checkin-checkout.html), [Attendance Entries](https://www.zoho.com/people/api/attendance-entries.html), [Bulk Import](https://www.zoho.com/people/api/attendance-bulkimport.html), [Regularization Records](https://www.zoho.com/people/api/attendance-regularization.html), [V3 Edit Entry](https://www.zoho.com/people/api/v3/attendance/entries-edit.html). Also referenced: Fetch Last Entries, Shift Details, User Report.

**Employee identification across attendance APIs:** supply **at least one** of `empId`, `emailId`, `mapId` (mapper id), or `erecno`. If none, the calling user's own data is used.

### 6.1 Check-in / Check-out
```
POST https://people.zoho.com/people/api/attendance
Scope: ZOHOPEOPLE.attendance.ALL        Rate limit: 100 req / 5 min
```
| Param | Req | Notes |
|---|---|---|
| `dateFormat` | yes | e.g. `dd/MM/yyyy HH:mm:ss` |
| `checkIn` | yes* | datetime in `dateFormat` |
| `checkOut` | yes* | datetime in `dateFormat` |
| `empId` / `emailId` / `mapId` | one required | employee mapping |
| `latitude`,`longitude`,`accuracy`,`altitude` | opt | GPS punch location (floats) |
| `location` | opt | location name |

```
checkIn=09/09/2013 09:30:45  checkOut=09/09/2013 18:45:13  empId=0941
latitude=28.6139  longitude=77.2090  accuracy=10.5  altitude=216.0  location=New Delhi
```
> Date format is **`dd/MM/yyyy HH:mm:ss`** here (note: differs from the bulk-import format below). Older docs show XML responses; with the OAuth header you receive the standard JSON envelope.

### 6.2 Get attendance entries
```
GET https://people.zoho.com/people/api/attendance/getAttendanceEntries
Rate limit: 100 req / 10 min
Params: date, dateFormat, erecno | mapId | emailId | empId   (all optional)
```
```json
{ "firstIn":"2023-03-03 09:00:00", "lastOut":"2023-03-03 20:00:00",
  "totalHrs":"10:00", "status":"Present",
  "entries":[ { "checkIn":"03-Mar-2023 - 09:00 AM","checkOut":"03-Mar-2023 - 03:00 PM",
    "checkIn_Location":"Delhi","checkOut_Location":"Delhi",
    "sourceOfPunchIn":"Web","sourceOfPunchOut":"Web" } ] }
```

### 6.3 Bulk import attendance
```
POST https://people.zoho.com/people/api/attendance/bulkImport
Scope: ZOHOPEOPLE.attendance.ALL        Rate limit: 10 req / 5 min
Params: data=<JSONArray> (required), dateFormat=yyyy-MM-dd HH:mm:ss (required)
```
```json
[ { "empId":"1","checkIn":"2014-11-07 09:01:00","location":"Chennai","building":"Administration" },
  { "empId":"1","checkOut":"2014-11-07 18:02:00" },
  { "empId":"2","checkIn":"2014-11-07 09:01:00","location":"Chennai","building":"Administration" },
  { "empId":"2","checkOut":"2014-11-07 18:02:00" } ]
```
> **Date format here is `yyyy-MM-dd HH:mm:ss`** — different from §6.1. Check-in and check-out are **separate array elements** keyed by the same `empId`. Max records/call not documented.

### 6.4 Regularization records
```
POST https://people.zoho.com/people/api/attendance/getRegularizationRecords
Rate limit: 30 req / 5 min       Max 200 records/call
```
| Param | Notes |
|---|---|
| `recordId` | if present, **all other params ignored** |
| `fromdate`,`todate` | **mandatory when `recordId` absent** |
| `dateFormat` | optional (e.g. `yyyy-MM-dd`) |
| `employeeId` | optional, narrows to one employee |
| `startIndex` | pagination; next page starts at e.g. 201 |
```json
{ "result":[ { "recordId":"173907000000181100","approvalStatus":"Waiting for approval",
   "employeeName":"Kumar","employeeId":"1",
   "regDetails":[ { "date":"15-Oct-2018","newCheckInTime":"07:45 AM","newCheckOutTime":"04:50 PM" } ] } ],
  "message":"Success","status":0 }
```
> This **fetches** regularization requests. A documented endpoint to *raise/approve* regularization via API is not published; that flow is in-product.

### 6.5 Edit an attendance entry — **V3**
```
PUT https://people.zoho.com/api/v3/attendance/entries/{entry_id}
Scope: ZOHOPEOPLE.attendance.ALL  (or .UPDATE)     Rate limit: 20 req / min
```
Body fields: `punch_in`, `punch_out` (org datetime format e.g. `2025-09-22 10:00:00`), `punch_in_note`, `punch_out_note`, `date` (only when the day falls outside the current year).
```json
{ "message":"Request processed successfully.", "status":"success" }
```

### 6.6 Other attendance endpoints (referenced, not fully detailed here)
- **Fetch Last Attendance Entries** (`…/attendance/fetchLastEntries`) — admin/data-admin only. ([page](https://www.zoho.com/people/api/attendance-fetchlastentries.html))
- **Shift Details** (`…/attendance/getShiftDetails`) — params: emp/email/mapId, start/end dates. ([page](https://www.zoho.com/people/api/attendance-shift-details.html))
- **Attendance User Report** ([page](https://www.zoho.com/people/api/userreport.html)).

---

## 7. Leave

Sources: [Leave Types](https://www.zoho.com/people/api/leave-types.html), [Add Leave](https://www.zoho.com/people/api/add-leave.html), [Add Leave Balance](https://www.zoho.com/people/api/add-leave-balance.html), [Customize Leave Balance](https://www.zoho.com/people/api/customize-leave-balance.html), [Booked & Balance Report](https://www.zoho.com/people/api/leave/reports/bookedandbalance.html), [Leave Records v2](https://www.zoho.com/people/api/get-records-v2.html), [Get Leave Record (legacy)](https://www.zoho.com/people/api/get_record.html), [V3 Get Leaves](https://www.zoho.com/people/api/v3/leave-tracker/get-leave.html), [Holidays (all)](https://www.zoho.com/people/api/all-holiday.html), [Holidays](https://www.zoho.com/people/api/holiday.html).

> Leave exists in **all three styles** simultaneously — choose one and be consistent.

### 7.1 Get leave types (per user)
```
GET https://people.zoho.com/people/api/leave/getLeaveTypeDetails?userId=<EmpID|Email|RecordId>
Scope: ZOHOPEOPLE.leave.READ (undocumented on page; use leave scope)
```
```json
{ "result":[ { "Name":"DayBased","Id":3000000030001,"Unit":"Days",
   "PermittedCount":90,"AvailedCount":0,"BalanceCount":90 } ],
  "message":"Data fetched successfully","status":0 }
```

### 7.2 Apply for leave (legacy = the `leave` form)
```
POST https://people.zoho.com/people/api/forms/json/leave/insertRecord
Scope: ZOHOPEOPLE.forms.CREATE        Rate limit: 300 req / 5 min
```
`inputData` fields: `Employee_ID`, `Leavetype` (the leave-type **Id**), `From`, `To`, and **`days`** (per-date map).
- **Day-based:** `days: { "07-Jan-2021": { "LeaveCount":0.5, "Session":2 } }` (Session: 1=forenoon, 2=afternoon; 0/absent = full day per docs' usage).
- **Hour-based:** `days: { "<date>": { "StartTime":"15:00","EndTime":"18:00","LeaveCount":"03:00" } }`.
```
inputData={'Employee_ID':'3000000020481','Leavetype':'3000000046003','From':'07-Jan-2021','To':'07-Jan-2021','days':{'07-Jan-2021':{'LeaveCount':0.5,'Session':2}}}
```
```json
{ "response": { "result": { "pkId":"3000000248001","message":"Successfully Added" },
  "message":"Data added successfully","status":0 } }
```
Leave-validation error codes: 7101–7112 (inactive/expired type, overlapping leave, beyond limit, before DOJ, etc.).

### 7.3 Get leave records — three options
**Legacy / v2 (form-style records, nested by id):**
```
GET https://people.zoho.com/api/v2/leavetracker/leaves/records      (also works under /people/api/...)
Max 200/call      Rate limit: 30 req / 5 min (one page lists 300 — see note)
```
| Param | Notes |
|---|---|
| `from`*, `to`* | date range |
| `dateFormat` | optional |
| `startIndex` | default 0 |
| `limit` | 0–200, default 200 |
| `employee` | JSONArray of erecnos |
| `leavetype` | JSONArray of leave-type ids |
| `approvalStatus` | JSONArray: `APPROVED, PENDING, CANCELLED, REJECTED` |
| `dataSelect` | `MINE`(def), `SUB`, `DIRSUBS`, `MINE,SUBS`, `ALL` |
| `portalID`/`zuid` | only for ISC/cross-org access |
```json
{ "records": { "100002000000188009": {
   "Employee":"Christine Spalding","Leavetype":"Casual",
   "From":"25-Jan-2023","To":"27-Jan-2023","ApprovalStatus":"Approved",
   "Days": { "26-Jan-2023": { "LeaveCount":"0.25","StartTime":"15:00","EndTime":"18:00","Session":4 } } } } }
```
> The two leave-records pages disagree on the rate limit (one says 30/5min, one says 300/5min). Treat **30/5min** as the safe lower bound.

**V3 (recommended for new builds):**
```
GET https://people.zoho.com/api/v3/leave-tracker/leaves
Scope: ZOHOPEOPLE.leave.READ      Rate limit: 30 req / 5 min
```
| Param | Notes |
|---|---|
| `from_date`*, `to_date`* | range |
| `employee_zoho_ids` / `employee_department_ids` / `employee_location_ids` | JSONArrays |
| `leave_type_ids` | JSONArray |
| `employee_status` | `ACTIVE_USERS, ACTIVE_EMPLOYEE_PROFILES, EX_EMPLOYEES, LOGIN_DISABLED` |
| `type_of_leave` | `PAID, UNPAID, ON_DUTY, RESTRICTED_HOLIDAY, COMPENSATORY_OFF` |
| `approval_status` | `ALL`(def), `APPROVED, PENDING, REJECTED, CANCELLED, CANCEL_PENDING` |
| `data_select` | `ALL`(def), `MINE, SUBORDINATES, DIRECT_SUBORDINATES, "MINE,SUBORDINATES"` |
| `offset` | default 1 | `limit` | result count |
| `sort` | `leave_type, employee, from_date, to_date` (prefix `-` = descending) |
```json
{ "data":[ { "leave_id":100002000000084241,
   "from_date":"05-Sep-2025","to_date":"05-Sep-2025","date_of_request":"30-Jul-2025",
   "approval_status":"Pending",
   "leave_type": { "id":100002000000051005,"name":"Optional holiday","unit":"Days","type":"PAID" },
   "days": { "05-Sep-2025": { "leave_count":"1.0","start_time":"09:00","end_time":"18:00" } },
   "employee": { "zoho_id":100002000000040456,"name":"Dhivya Dharshini","id":"1" } } ],
  "message":"Record(s) fetched successfully.","status":"success" }
```
Also: **Get a single leave record by id** ([page](https://www.zoho.com/people/api/singe-leave.html)) and **Get leave record by ID** ([page](https://www.zoho.com/people/api/get_record._byID.html)).

### 7.4 Leave balance
**Booked & Balance report (v2 path):**
```
GET https://people.zoho.com/people/api/v2/leavetracker/reports/bookedAndBalance
Scope: ZOHOPEOPLE.leave.READ      Rate limit: 30 req / min (2-min lock)
```
| Param | Req | Notes |
|---|---|---|
| `from`*, `to`* | yes | report window (def: leave-year start → today) |
| `unit` | yes | `Day`(def) or `Hour` |
| `leavetype` | no | JSONArray, **max 30** ids |
| `employee` | no | JSONArray of erecnos, max 30 |
| `department` | no | JSONArray, max 30 |
| `employeeStatus` | no | def `[ACTIVE_USERS]` |
| `startIndex` | no | default 0 |
| `limit` | no | 0–30, default 30 |

Leave-type **categories:** `PAID`, `ABSENT`, `ON_DUTY`, `UNPAID`.
```json
{ "leavetypes": { "2857000015111005": { "unit":"Day","name":"Leave with monthly encashment","type":"PAID" } },
  "report": { "2857000000069940": {
     "2857000015111005": { "balance":5.91 },
     "totals": { "paidBalance":5.91, "ondutyBalance":74 },
     "employee": { "name":"Zylker","id":"2" } } } }
```

**Adjust balance (Add Leave Balance):** increments/decrements a type's balance — positive `count` adds, negative subtracts (e.g. balance 20, count −4 → 16). ([page](https://www.zoho.com/people/api/add-leave-balance.html))
**Customize Leave Balance:** sets an absolute `newBalance` for an employee's leave type, with `date` and `reason`. ([page](https://www.zoho.com/people/api/customize-leave-balance.html))

### 7.5 Holidays
```
GET https://people.zoho.com/people/api/leave/v2/holidays/get
Scope: ZOHOPEOPLE.leave.ALL
Params: location, shift, employee (EmpID|Email|Erecno), upcoming (true|false → next 365d), from, to, dateFormat
```
```json
{ "data":[ { "Id":"413124000003341001","Name":"New year","Date":"01-Jan-2019",
   "isRestrictedHoliday":false,"isHalfday":false,"Session":0,
   "ShiftName":"General","ShiftId":"413124000000456081",
   "LocationName":"Chennai","LocationId":"4131240008700117006","Remarks":"New year holiday" } ],
  "message":"Data fetched successfully!","uri":"/api/leave/v2/holidays/get","status":1 }
```
> **Quirk:** this endpoint returns **`status:1` on success** (not `0`). There is also an older `…/leave/getHolidays?userId=<id>` (30 req/5min). ([page](https://www.zoho.com/people/api/holiday.html))

---

## 8. Time Tracker (Timesheets / Jobs / Time logs)

Sources: [Timesheet overview](https://www.zoho.com/people/api/timesheet.html), [Get time logs](https://www.zoho.com/people/api/timesheet/get-timelogs.html), [Add time log](https://www.zoho.com/people/api/timesheet/add-timelogs.html), [Get jobs](https://www.zoho.com/people/api/timesheet/get-jobs.html), plus Bulk Timelogs, Modify Timelogs, Job Details, General Settings pages. Module = **clients → projects → jobs → time logs / timers / timesheets.**

### 8.1 Get time logs
```
GET https://people.zoho.com/people/api/timetracker/gettimelogs
Scope: ZOHOPEOPLE.timetracker.ALL or .READ      Rate limit: 20 req / 5 min
```
| Param | Default | Allowed |
|---|---|---|
| `user` | current user | `all` \| ERECNO \| Email \| EmployeeID |
| `jobId` | all | a job id |
| `fromDate`,`toDate` | today | `yyyy-MM-dd` or company format |
| `dateFormat` | company | — |
| `clientId`,`projectId` | all | id |
| `billingStatus` | all | `billable`\|`non billable`\|`all`\|`0`\|`1`\|`-1` |
| `approvalStatus` | all | `approved`\|`unapproved`\|`all` |
| `isCommentsCount` | false | true/false |
| `sIndex` | 0 | — |
| `limit` | 200 | **max 200** |
```json
{ "response": { "result": [ {
   "timelogId":"492688000000808276","erecno":"492688000000135005",
   "employeeFirstName":"Christine","employeeMailId":"c.spalding@zylker.com",
   "workDate":"04-04-2019","hours":"05:00","totaltime":18015,
   "jobId":"492688000000808246","jobName":"Development Phase",
   "billingStatus":"billable","approvalStatus":"notsubmitted","timerLog":true,
   "fromTimeInTimeFormat":"03:00PM","toTimeInTimeFormat":"06:00PM",
   "timearr":[ { "timerId":"492688000000808292","fromTime":54040,"toTime":64847 } ] } ],
  "message":"Data fetched successfully","status":0 } }
```

### 8.2 Add a time log
```
POST https://people.zoho.com/people/api/timetracker/addtimelog
Scope: ZOHOPEOPLE.timetracker.ALL or .CREATE      Rate limit: 20 req / 5 min
```
Mandatory: `user` (ERECNO/Email/EmployeeID), `workDate` (`yyyy-MM-dd`), `jobId`. Common: `hours` (`2.5` or `2:30`), `workItem`, `billingStatus`, `description`, `dateFormat`; optional `projectId/projectName`, `clientId/clientName`, `fromTime`, `toTime`, `timer`. (`jobName` may be used instead of `jobId` per the example.)
```json
{ "response": { "result": [ { "timeLogId":"469505000000265019" } ],
  "message":"Timelog entry added Successfully","status":0 } }
```
Related: **Modify** ([page](https://www.zoho.com/people/api/timesheet/modify-timelogs.html)), **Get details** ([page](https://www.zoho.com/people/api/timesheet/timelog-details.html)), **Bulk timelogs** ([page](https://www.zoho.com/people/api/timesheet/bulk-timelogs.html)).

### 8.3 Get jobs
```
GET https://people.zoho.com/people/api/timetracker/getjobs
Scope: ZOHOPEOPLE.timetracker.ALL or .READ
```
| Param | Default | Notes |
|---|---|---|
| `assignedTo` | — (**mandatory**) | `all`\|Email\|EmployeeID\|ERECNO |
| `assignedBy` | all | same value set |
| `jobStatus` | all | `all`\|`in-progress`\|`completed` |
| `projectId`,`clientId` | all | id |
| `dateFormat` | company | — |
| `isAssigneeCount` | false | add `assigneeCount` to result |
| `fetchLoggedHrs` | false | add logged hours |
| `sIndex` | 0 | — | `limit` | default/max 200 |
```json
{ "response": { "result": [ {
   "jobId":"469505000000268001","jobName":"System Performance Analysis","jobStatus":"In-Progress",
   "projectId":"469505000000267333","projectName":"Analysis",
   "clientId":"469505000000133417","clientName":"Adamo Meyrick",
   "fromDate":"05/04/2019","toDate":"12/04/2019",
   "hours":"57:00","totalhours":"52:00","jobBillableStatus":"Non-Billable",
   "ratePerHour":0,"assigneeCount":26,"isDeleteAllowed":true } ],
  "message":"Data fetched successfully","isNextAvailable":true,"status":0 } }
```
> Time Tracker list endpoints expose **`isNextAvailable`** — use it to drive pagination alongside `sIndex`/`limit`.

The Job API also supports add/assign, modify, delete, change-status, and add-permission checks; Time-log API supports get/add/modify/delete (per the [overview](https://www.zoho.com/people/api/timesheet.html)). General settings: [page](https://www.zoho.com/people/api/timesheet-gensettings.html).

---

## 9. Bulk / Import

| Capability | Status |
|---|---|
| **Bulk *fetch* records** | Yes — `getRecords` (max **200**/call, paginate via `sIndex`/`limit`). §3.2 |
| **Bulk *insert* form records** | **No dedicated REST endpoint.** Insert one record per call (`insertRecord`, 100/5min). Tabular rows go as a JSON array *within a single record's* `inputData`. CSV bulk import exists only in the product UI (Settings → Form import/export), not as an API. |
| **Attendance bulk import** | Yes — `POST …/attendance/bulkImport` with `data` JSONArray. §6.3 |
| **Bulk time logs** | Yes — [Bulk Timelogs API](https://www.zoho.com/people/api/timesheet/bulk-timelogs.html). |
| **Leave balance bulk** | Add/Customize balance endpoints (§7.4); not a generic bulk job. |
| **File / attachment upload** | Not documented as a standalone People API; status codes 413/415 imply file uploads exist on some forms, but no upload endpoint is published. |
| **Async job + job-status pattern** | **Does not exist** in Zoho People (unlike Zoho CRM's bulk-read/write jobs). All imports here are synchronous. |

---

## 10. Rate Limits, Status & Errors

### 10.1 Response envelopes (three shapes — match to the endpoint)
- **Legacy/forms:** `{"response":{"result":…,"message":"…","uri":"…","status":0}}` — **`status:0` = success.**
- **v2 modules:** mostly `status:0`; **holidays returns `status:1`** on success. Some return a bare `{"records":{…}}` or `{"data":[…],"status":…}`.
- **V3:** `{"data":[…]|{},"message":"…","status":"success"}`; errors `{"code":"NOT_FOUND","message":"…"}`.

There is **no single canonical envelope** — write a per-style response adapter.

### 10.2 HTTP status codes (Source: [Status Codes](https://www.zoho.com/people/api/status-codes.html))
| Code | Meaning |
|---|---|
| 200 OK / 201 Created (single) / 202 Accepted (multiple) / 204 No Content | success variants |
| 304 Not Modified | unchanged |
| 400 Bad Request | invalid request/auth input |
| 401 Authorization Error | invalid/expired token |
| 403 Forbidden | no permission |
| 404 Not Found | invalid request/resource |
| 405 Method Not Allowed | wrong HTTP method |
| 413 Request Entity Too Large | file too big |
| 415 Unsupported Media Type | bad file type |
| 429 Too Many Requests | rate limit hit |
| 500 Internal Server Error | server error |

### 10.3 Rate limits (per-endpoint; "lock period" = cooldown after the threshold)
| Endpoint | Limit |
|---|---|
| Fetch Record (`/records`), Views, Fetch Forms | 30 / 5 min |
| Get Bulk Records (`getRecords`), Get Fields (`/components`) | 400 / 5 min |
| Insert record / Add leave (forms insert) | 100 / 5 min (insert page) — Add-employee & Update show **300 / 5 min** |
| Update record | 300 / 5 min |
| Attendance check-in/out | 100 / 5 min |
| Attendance get entries | 100 / 10 min |
| Attendance bulk import | 10 / 5 min |
| Regularization records | 30 / 5 min |
| Attendance edit (v3) | 20 / min |
| Leave records (v2 & v3) | 30 / 5 min (one page says 300 — use 30) |
| Booked & Balance report | 30 / min (2-min lock) |
| Holidays | 30 / 5 min |
| Time Tracker get/add | 20 / 5 min |
| Org structure (v3) | 30 / 5 min |

> A global account ceiling also applies: hitting **~50 calls/minute** returns **HTTP 429 with code 2955** ("You have reached your API call limit for a minute…"). Limits vary by plan/edition (Essential HR/Professional/Premium/Enterprise). Treat the per-endpoint numbers above as authoritative for each call, and implement **429 backoff** universally.

### 10.4 Error codes (Source: [Error Codes](https://www.zoho.com/people/api/error-codes.html))
Errors return `code` + `message`. Full documented table:

**Forms / records (70xx):**
`7011` Invalid form name · `7012` Invalid view name · `7016` Invalid input data · `7019` Missing parameter · `7020` Invalid/no such field · `7022` Invalid input format · `7024` No records found · `7029` Save-as-draft disabled for form · `7031` Single field edit not allowed · `7034` Invalid input value · `7037` Permission denied (action) · `7038` Permission denied to add · `7039` Permission denied to edit · `7040` Permission denied to view · `7041` Invalid search operator / permission / no data · `7042` Invalid search value · `7043` Invalid search operator · `7048` Invalid/no such user · `7049` Missing record for record id · `7050` Invalid value for field · `7051` Value already exists · `7052` Missing mandatory field values · `7053` Invalid email · `7054` Invalid date value · `7055` Invalid date format · `7056` Invalid number value · `7057` Field length exceeded · `7058` Number out of range · `7059` Invalid URL field · `7060` Cannot change super-admin role · `7061` Invalid employee-status change · `7062` Cyclic department dependency.

**Leave (71xx):**
`7101` Inactive leave type · `7102` Invalid hours-taken format · `7103` Leave type not chosen · `7104` Leave type not applicable · `7105` From-date after To-date · `7106` Outside leave-type validity · `7107` Applied during notice period · `7108` Expired leave type · `7109` Leave already taken in period · `7110` Beyond allowed limit · `7111` Before date-of-joining · `7112` Exceeds consecutive-days allowed · `7119` Location access error.

**API invocation (72xx):**
`7200` API invocation failure · `7201` Invalid URL · `7202` Invalid authtoken · `7203` Invalid extra parameters · `7204` Invalid data type for param · `7205` Input format mismatch · `7207`/`7216` Wrong HTTP method.

**Generic / Time Tracker (80xx):**
`8000` No parameter specified · `8001` Wrong parameter value · `8002` Wrong date-parameter format · `8003` Invalid From/To date · `8004` Job deletion error · `8005` Timer operation error · `8006` Job-status change error.

### 10.5 Pagination quirks (consolidated)
- Index base differs: `getRecords`/regularization start at **1**; `/records` flat at **1**; leave v2 & time tracker start at **0**; v3 leave `offset` default **1**.
- Page-size param name differs: `limit` (most) vs **`rec_limit`** (flat `/records`).
- Hard cap **200** for forms/leave/time-tracker; **30** for the Booked & Balance report.
- Stop condition: returned count `< limit`, **or** rely on Time Tracker's `isNextAvailable:true/false`.
- Incremental sync: `modifiedtime` (epoch **milliseconds**) on `getRecords`.

---

## Appendix A — Endpoint cheat-sheet

`{H}` = `https://people.zoho.com` (use your DC host). `/people/api` and `/api` are interchangeable roots.

| Area | Method | Path | Scope |
|---|---|---|---|
| **OAuth: get token** | POST | `https://accounts.zoho.{dc}/oauth/v2/token` (grant=authorization_code) | — |
| **OAuth: refresh** | POST | `https://accounts.zoho.{dc}/oauth/v2/token?…&grant_type=refresh_token` | — |
| List forms | GET | `{H}/api/forms` | forms.READ |
| Form fields/metadata | GET | `{H}/api/forms/<form>/components` | forms.READ |
| List views | GET | `{H}/api/views` | forms.READ |
| Fetch records (flat) | GET | `{H}/api/forms/<viewName>/records` | forms.READ |
| Get bulk records | GET | `{H}/api/forms/<form>/getRecords` | forms.READ |
| Search records | GET | `{H}/api/forms/<form>/getRecords?searchParams=…` | forms.READ |
| Get record by id | GET | `{H}/api/forms/<form>/getRecordByID?recordId=` | forms.READ |
| Insert record | POST | `{H}/api/forms/json/<form>/insertRecord` | forms.CREATE |
| Update record | POST | `{H}/api/forms/json/<form>/updateRecord` | forms.UPDATE |
| Delete record | — | **not documented** (use Deluge) | forms.DELETE |
| Record count | GET | `{H}/people/api/employee/counts` | employee.ALL |
| Add employee | POST | `{H}/people/api/forms/json/employee/insertRecord` | forms.CREATE |
| Get employees | GET | `{H}/api/forms/employee/getRecords` | forms.READ |
| Add department | POST | `{H}/api/forms/json/department/insertRecord` | forms.CREATE |
| Org structure (v3) | GET | `{H}/api/v3/orgstructure/{entities\|units\|divisions}/{id}` | orgstructure.READ |
| Attendance check-in/out | POST | `{H}/people/api/attendance` | attendance.ALL |
| Attendance entries | GET | `{H}/people/api/attendance/getAttendanceEntries` | attendance.ALL |
| Attendance bulk import | POST | `{H}/people/api/attendance/bulkImport` | attendance.ALL |
| Regularization records | POST | `{H}/people/api/attendance/getRegularizationRecords` | attendance.ALL |
| Edit attendance entry (v3) | PUT | `{H}/api/v3/attendance/entries/{id}` | attendance.UPDATE |
| Leave types | GET | `{H}/people/api/leave/getLeaveTypeDetails?userId=` | leave.READ |
| Apply leave | POST | `{H}/people/api/forms/json/leave/insertRecord` | forms.CREATE |
| Leave records (v2) | GET | `{H}/api/v2/leavetracker/leaves/records` | leave.READ |
| Leave records (v3) | GET | `{H}/api/v3/leave-tracker/leaves` | leave.READ |
| Leave booked & balance | GET | `{H}/people/api/v2/leavetracker/reports/bookedAndBalance` | leave.READ |
| Add / customize leave balance | POST | `{H}/…/leave/…` (add-leave-balance / customize) | leave.UPDATE |
| Holidays | GET | `{H}/people/api/leave/v2/holidays/get` | leave.ALL |
| Get time logs | GET | `{H}/people/api/timetracker/gettimelogs` | timetracker.READ |
| Add time log | POST | `{H}/people/api/timetracker/addtimelog` | timetracker.CREATE |
| Get jobs | GET | `{H}/people/api/timetracker/getjobs` | timetracker.READ |

---

## Appendix B — Implementation gotchas for our codebase

1. **Keep base `https://people.zoho.com/api`** (matches the newer pages); add a per-call note that `/people/api` is equivalent — needed because some endpoints (attendance, leave-apply, holidays, time tracker) are documented only under `/people/api`.
2. **Per-style response parser:** branch on `status:0` (forms) vs `status:1` (holidays) vs `status:"success"` (v3). Don't centralize one success check.
3. **Token cache:** access tokens last exactly 3600s; your reusable token cache should refresh slightly early (e.g. at ~3300s).
4. **Lookup & date handling:** pass lookup **Ids** (from `/components`), not labels; mind the **two attendance date formats** (`dd/MM/yyyy HH:mm:ss` for check-in/out vs `yyyy-MM-dd HH:mm:ss` for bulk import).
5. **`modifiedtime` is epoch ms** — good fit for an incremental-sync repo.
6. **Delete is unsupported via documented REST** — if a write tool needs delete, gate it behind a Deluge custom function or mark it unavailable; don't fabricate `deleteRecord`.
7. **No async bulk jobs** — design importers around synchronous, rate-limited, paginated calls with 429 backoff.

---

### Sources (all official Zoho People docs)
[API home](https://www.zoho.com/people/api/) · [Overview](https://www.zoho.com/people/api/overview.html) · [V3 Overview](https://www.zoho.com/people/api/v3/overview.html) · [OAuth](https://www.zoho.com/people/api/oauth.html) · [OAuth steps](https://www.zoho.com/people/api/oauth-steps.html) · [Scopes](https://www.zoho.com/people/api/scopes.html) · [V3 scopes](https://www.zoho.com/people/api/v3/scopes.html) · [Fetch Forms](https://www.zoho.com/people/api/forms-api/fetch-forms.html) · [Get Fields](https://www.zoho.com/people/api/forms-api/get-field-forms.html) · [Views](https://www.zoho.com/people/api/default-custom-views.html) · [Appendix](https://www.zoho.com/people/api/appendix.html) · [Fetch Record](https://www.zoho.com/people/api/fetch-record.html) · [Bulk Records](https://www.zoho.com/people/api/bulk-records.html) · [Search Records](https://www.zoho.com/people/api/forms-api/search-record.html) · [Record by ID](https://www.zoho.com/people/api/forms-api/fetch-single-section.html) · [Insert Record](https://www.zoho.com/people/api/insert-records.html) · [Update Records](https://www.zoho.com/people/api/update-records.html) · [Record count](https://www.zoho.com/people/api/record-count.html) · [Add Employees](https://www.zoho.com/people/api/adding-employees.html) · [V3 Org Structure](https://www.zoho.com/people/api/v3/orgstructure/single-record.html) · [Check-in/out](https://www.zoho.com/people/api/attendance-checkin-checkout.html) · [Attendance entries](https://www.zoho.com/people/api/attendance-entries.html) · [Attendance bulk import](https://www.zoho.com/people/api/attendance-bulkimport.html) · [Regularization](https://www.zoho.com/people/api/attendance-regularization.html) · [V3 attendance edit](https://www.zoho.com/people/api/v3/attendance/entries-edit.html) · [Leave types](https://www.zoho.com/people/api/leave-types.html) · [Add leave](https://www.zoho.com/people/api/add-leave.html) · [Leave records v2](https://www.zoho.com/people/api/get-records-v2.html) · [Get leave record](https://www.zoho.com/people/api/get_record.html) · [V3 leaves](https://www.zoho.com/people/api/v3/leave-tracker/get-leave.html) · [Booked & Balance](https://www.zoho.com/people/api/leave/reports/bookedandbalance.html) · [Add leave balance](https://www.zoho.com/people/api/add-leave-balance.html) · [Customize balance](https://www.zoho.com/people/api/customize-leave-balance.html) · [Holidays (all)](https://www.zoho.com/people/api/all-holiday.html) · [Holidays](https://www.zoho.com/people/api/holiday.html) · [Time logs](https://www.zoho.com/people/api/timesheet/get-timelogs.html) · [Add time log](https://www.zoho.com/people/api/timesheet/add-timelogs.html) · [Get jobs](https://www.zoho.com/people/api/timesheet/get-jobs.html) · [Timesheet overview](https://www.zoho.com/people/api/timesheet.html) · [Status codes](https://www.zoho.com/people/api/status-codes.html) · [Error codes](https://www.zoho.com/people/api/error-codes.html)
