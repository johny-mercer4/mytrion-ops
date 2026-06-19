---
name: zoho-crm-api
description: Zoho CRM REST API v8 reference — OAuth/scopes, metadata (modules/fields/layouts), record CRUD, search, COQL, related records/notes/attachments/tags, bulk read/write, rate-limits/credits, errors. Use when building or debugging Zoho CRM tool integrations in this repo (the `zoho_crm` wrapper + ToolManifest tools).
---

# Zoho CRM API (v8) — skill

**Using this in Mytrion Ops (our codebase):**
- **Auth:** `wrapper.authHeaders('zoho_crm')` ([src/integrations/wrapper.ts](../../../src/integrations/wrapper.ts)) → `Authorization: Zoho-oauthtoken <token>`; access token cached per service (refresh handled by `src/integrations/zoho.ts`).
- **Base URL:** `zoho.baseUrl('zoho_crm')` → env `ZOHO_CRM_API_DOMAIN` (default `https://www.zohoapis.com/crm/v8`).
- **Scopes:** `ZOHO_CRM_REFRESH_TOKEN` must be minted with the scopes in §1 below (settings.*, modules.*, coql, bulk, search → `ZohoSearch.securesearch.READ`).
- **Our org's live module/field API names:** `pnpm meta:zoho-crm` → `metadataScripts/output/zoho-crm.{json,md}` (git-ignored). Use those for exact `api_name`s; use this skill for *how* to call.
- **Wiring:** expose calls as `ToolManifest` tools dispatched through `toolDispatcher` (RBAC + department/`Administrator` gating). Prefer COQL / Bulk Read for large pulls; respect the v8 mandatory-`fields` rule.

---

# Zoho CRM REST API v8 — Backend Engineering Reference

> Scope: Zoho CRM API **v8** (latest). All endpoints below are relative to the data-center API base, e.g. `https://www.zohoapis.com/crm/v8`. Authentication on every call: header `Authorization: Zoho-oauthtoken <access_token>`.
> Sourced from official docs at `https://www.zoho.com/crm/developer/docs/api/v8/`. Doc URLs are cited inline per section.

---

## 0. Endpoint cheat-sheet

All paths are prefixed with the API base `https://www.zohoapis.{dc}/crm/v8` unless a different host is noted. `{m}` = module API name (e.g. `Leads`), `{id}` = record id.

| Area | Method | Path | Scope |
|---|---|---|---|
| Refresh token | POST | `{accounts}/oauth/v2/token?grant_type=refresh_token&...` | — |
| Get records | GET | `/{m}` (requires `fields`) | `ZohoCRM.modules.{m}.READ` |
| Get one record | GET | `/{m}/{id}` | `ZohoCRM.modules.{m}.READ` |
| Insert | POST | `/{m}` | `...CREATE` |
| Update (mass) | PUT | `/{m}` | `...UPDATE` |
| Update one | PUT | `/{m}/{id}` | `...UPDATE` |
| Upsert | POST | `/{m}/upsert` | `...CREATE`/`WRITE` |
| Delete (mass) | DELETE | `/{m}?ids=...` | `...DELETE` |
| Delete one | DELETE | `/{m}/{id}` | `...DELETE` |
| Search | GET | `/{m}/search?criteria=…` | module READ + `ZohoSearch.securesearch.READ` |
| COQL | POST | `/coql` | `ZohoCRM.coql.READ` + module READ |
| Get related | GET | `/{m}/{id}/{related_list}` | module READ |
| Update/associate related | PUT | `/{m}/{id}/{related_list}` | module WRITE |
| De-link related | DELETE | `/{m}/{id}/{related_list}/{rel_id}` | module WRITE |
| Create notes | POST | `/Notes` or `/{m}/{id}/Notes` | `ZohoCRM.modules.notes.CREATE` |
| Upload attachment | POST | `/{m}/{id}/Attachments` (multipart) | `ZohoCRM.modules.attachments.CREATE` |
| Upload file to ZFS | POST | `/files` (multipart) | `ZohoCRM.Files.CREATE` |
| Add tags | POST | `/{m}/actions/add_tags` | module WRITE |
| Remove tags | POST | `/{m}/actions/remove_tags` | module WRITE |
| Modules meta (all) | GET | `/settings/modules` | `ZohoCRM.settings.modules.READ` |
| Module meta (one) | GET | `/settings/modules/{m}` | same |
| Fields meta | GET | `/settings/fields?module={m}` | `ZohoCRM.settings.fields.READ` |
| Layouts meta | GET | `/settings/layouts?module={m}` | `ZohoCRM.settings.layouts.READ` |
| Related-lists meta | GET | `/settings/related_lists?module={m}` | `ZohoCRM.settings.related_lists.READ` |
| Custom views meta | GET | `/settings/custom_views?module={m}` | `ZohoCRM.settings.custom_views.READ` |
| Variables | GET | `/settings/variables` | `ZohoCRM.settings.variables.READ` |
| Users | GET | `/users?type=…` / `/users/{id}` | `ZohoCRM.users.READ` |
| Org info | GET | `/org` | `ZohoCRM.org.READ` |
| Bulk Read create | POST | `/crm/bulk/v8/read` | `ZohoCRM.bulk.READ` + module READ |
| Bulk Read status | GET | `/crm/bulk/v8/read/{job_id}` | same |
| Bulk Read download | GET | `/crm/bulk/v8/read/{job_id}/result` | same |
| Bulk Write upload | POST | `https://content.zohoapis.{dc}/crm/v8/upload` (multipart) | `ZohoFiles.files.ALL` |
| Bulk Write create | POST | `/crm/bulk/v8/write` | `ZohoCRM.bulk.CREATE` + module |
| Bulk Write status | GET | `/crm/bulk/v8/write/{job_id}` | `ZohoCRM.bulk.CREATE` |
| Notifications (watch) | POST | `/actions/watch` | `ZohoCRM.notifications.CREATE` |
| Execute function | GET/POST | `/functions/{api_name}/actions/execute?auth_type=apikey` | apikey or oauth |

> Note the **bulk path ordering**: bulk endpoints are `/crm/bulk/v8/…` (segment order is `bulk` then `v8`), unlike all other endpoints which are `/crm/v8/…`.

---

## 1. Authentication & scopes

Docs: [oauth-overview](https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html), [access-refresh](https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html), [refresh](https://www.zoho.com/crm/developer/docs/api/v8/refresh.html), [scopes](https://www.zoho.com/crm/developer/docs/api/v8/scopes.html)

### 1.1 Auth header
Every API request carries:
```
Authorization: Zoho-oauthtoken 1000.xxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyy
```

### 1.2 Token model
- **Access token**: valid **1 hour** (`expires_in: 3600`, seconds). Scoped to its granted scopes.
- **Refresh token**: does **not** expire until revoked. There is a cap on the number of refresh tokens per client/user (older ones are invalidated when the limit is exceeded — keep one per client+user).
- **Self-client flow** (server-to-server, no UI): create a Self Client in the [Zoho API Console](https://api-console.zoho.com), generate a `grant_token` (code) for the needed scopes, exchange it once for an access+refresh token, then use the refresh token thereafter.

### 1.3 Refresh-token request (the one your backend uses long-term)
```
POST {accounts_url}/oauth/v2/token
     ?refresh_token={refresh_token}
     &client_id={client_id}
     &client_secret={client_secret}
     &grant_type=refresh_token
```
Parameters can be sent as query string or `application/x-www-form-urlencoded` body. Response:
```json
{
  "access_token": "1000.new_access_token",
  "expires_in": 3600,
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer"
}
```
Note: a refresh response does **not** return a new refresh token. Use `api_domain` from the response as the base for subsequent CRM API calls (it reflects the user's DC).

### 1.4 Scope syntax
Format: `service.scope.operation` → e.g. `ZohoCRM.modules.ALL`, `ZohoCRM.settings.fields.READ`. Operations: `ALL`, `READ`, `CREATE`, `UPDATE`, `DELETE`. Combine multiple scopes comma-separated: `scope1,scope2,scope3`.

| Area | Scope(s) |
|---|---|
| Records (all modules) | `ZohoCRM.modules.ALL` or per-module `ZohoCRM.modules.{leads\|contacts\|deals\|…\|custom}.{READ\|CREATE\|UPDATE\|DELETE}` |
| Search | module READ **plus** `ZohoSearch.securesearch.READ` |
| COQL | `ZohoCRM.coql.READ` (+ module READ; `ZohoCRM.settings.fields.READ` if requesting field metadata) |
| Settings (metadata) | `ZohoCRM.settings.ALL` or granular: `.modules`, `.fields`, `.layouts`, `.related_lists`, `.custom_views`, `.profiles`, `.roles`, `.currencies`, `.variables`, `.tags`, `.macros`, `.territories`, `.tab_groups`, `.custom_links`, `.custom_buttons` (each `.READ`/`.ALL`) |
| Users | `ZohoCRM.users.ALL` (or READ) |
| Org | `ZohoCRM.org.ALL` (or READ) |
| Bulk | `ZohoCRM.bulk.ALL` / `ZohoCRM.bulk.READ` / `ZohoCRM.bulk.CREATE` (+ relevant module scope) |
| Notifications | `ZohoCRM.notifications.{READ\|CREATE\|UPDATE\|DELETE}` |
| Files (ZFS / bulk upload) | `ZohoCRM.Files.CREATE` / `ZohoFiles.files.ALL` |

### 1.5 Multi-DC domains
You must mint and use tokens within the **same** DC as the user's org (or enable Multi-DC on the client). The refresh response's `api_domain` tells you which.

| DC | API base (`zohoapis`) | Accounts (token) | Bulk-upload content host |
|---|---|---|---|
| US (.com) | `https://www.zohoapis.com` | `https://accounts.zoho.com` | `https://content.zohoapis.com` |
| EU (.eu) | `https://www.zohoapis.eu` | `https://accounts.zoho.eu` | `https://content.zohoapis.eu` |
| India (.in) | `https://www.zohoapis.in` | `https://accounts.zoho.in` | `https://content.zohoapis.in` |
| Australia (.com.au) | `https://www.zohoapis.com.au` | `https://accounts.zoho.com.au` | `https://content.zohoapis.com.au` |
| Japan (.jp) | `https://www.zohoapis.jp` | `https://accounts.zoho.jp` | `https://content.zohoapis.jp` |
| Canada (.ca) | `https://www.zohoapis.ca` | `https://accounts.zohocloud.ca` | `https://content.zohoapis.ca` |
| China (.com.cn) | `https://www.zohoapis.com.cn` | `https://accounts.zoho.com.cn` | `https://content.zohoapis.com.cn` |
| Saudi Arabia (.sa) | `https://www.zohoapis.sa` | `https://accounts.zoho.sa` | `https://content.zohoapis.sa` |

> The CA accounts host is `accounts.zohocloud.ca` (not `accounts.zoho.ca`) — a common foot-gun.

---

## 2. Metadata APIs

Docs: [module-meta](https://www.zoho.com/crm/developer/docs/api/v8/module-meta.html), [field-meta](https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html), [layouts-meta](https://www.zoho.com/crm/developer/docs/api/v8/layouts-meta.html), [related-list-meta](https://www.zoho.com/crm/developer/docs/api/v8/related-list-meta.html), [custom-view-meta](https://www.zoho.com/crm/developer/docs/api/v8/custom-view-meta.html), [get-variables](https://www.zoho.com/crm/developer/docs/api/v8/get-variables.html), [get-users](https://www.zoho.com/crm/developer/docs/api/v8/get-users.html)

### 2.1 Modules
`GET /settings/modules` (all) and `GET /settings/modules/{module_api_name}` (one). Scope `ZohoCRM.settings.modules.READ`.
Key per-module fields: `api_name`, `module_name`, `id`, `singular_label`, `plural_label`, `generated_type` (`default | custom | linking | subform | web`), booleans `creatable / editable / deletable / viewable`, `business_card_field_limit`, `profiles[]`, `custom_view`, `fields[]`.

### 2.2 Fields
`GET /settings/fields?module={m}` (all) and `GET /settings/fields/{field_id}?module={m}` (one). Scope `ZohoCRM.settings.fields.READ`.
**`data_type` values:** `text`, `textarea`, `email`, `phone`, `website`, `picklist`, `multiselectpicklist`, `lookup`, `ownerlookup`, `multiselectlookup`, `multiuserlookup`, `integer`, `bigint`/`long`, `double`, `currency`, `percent`, `date`, `datetime`, `boolean`, `autonumber`, `formula`, `rollup_summary`, `subform`, `rich_text`, `fileupload`/`imageupload`, `consent_lookup`.
**Key attributes:** `api_name`, `field_label`, `display_label`, `data_type`, `json_type` (`string | integer | double | boolean | jsonobject | jsonarray`), `length`, `custom_field`, `field_read_only` (hard read-only) vs `read_only`, `system_mandatory`, `unique`, `visible`, `pick_list_values[]`, `lookup`, `currency` (precision/rounding), `decimal_place`, `profiles[]`.

### 2.3 Layouts
`GET /settings/layouts?module={m}` / `/settings/layouts/{layout_id}?module={m}`. Scope `ZohoCRM.settings.layouts.READ`. Returns `layouts[]` with `id`, `name`, `status`, `visible`, `profiles[]`, and `sections[]` (each containing `fields[]`).

### 2.4 Related lists
`GET /settings/related_lists?module={m}`. Scope `ZohoCRM.settings.related_lists.READ`. Returns `related_lists[]`: `api_name`, `module{api_name,id}`, `display_label`, `href` (e.g. `Leads/{ENTITYID}/Notes`), `type` (`default | multiselectlookup | grouped`), `connectedmodule`, `sequence_number`. The `api_name`/`href` is what you pass to the Get-Related-Records call (§6).

### 2.5 Custom views
`GET /settings/custom_views?module={m}` / `/settings/custom_views/{cvid}?module={m}`. Scope `ZohoCRM.settings.custom_views.READ`. Fields: `id`, `name`, `system_name`, `display_value`, `default`, `criteria`, `sort_by`, `category`. The `id` (cvid) feeds Get-Records `?cvid=` and COQL `FROM module#cvid`.

### 2.6 Users / Profiles / Roles
`GET /users?type={AllUsers|ActiveUsers|AdminUsers|ActiveConfirmedUsers|ConfirmedUsers|NotConfirmedUsers|DeletedUsers|CurrentUser}` and `GET /users/{user_id}`. Scope `ZohoCRM.users.READ`. Returns `users[]`: `id`, `full_name`, `email`, `role{name,id}`, `profile{name,id}`, `status`, plus `info{count,page,per_page,more_records}`. Profiles/roles metadata: `GET /settings/profiles` (scope `ZohoCRM.settings.profiles.READ`) and `GET /settings/roles` (scope `ZohoCRM.settings.roles.READ`).

### 2.7 Org info & currencies
`GET /org` (scope `ZohoCRM.org.READ`). Returns `org[]` with `id`/`zgid`, `company_name`, `primary_email`, `time_zone`, `country`, base `currency`/`iso_code`, `license_details`. Currencies: `GET /org/currencies` → `id`, `name`, `iso_code`, `symbol`, `is_base`, `exchange_rate`, `format`.

### 2.8 Variables
`GET /settings/variables` (all) / `/settings/variables/{id}?group={group_id}` (group id mandatory for one). Scope `ZohoCRM.settings.variables.READ`.

---

## 3. Core record APIs

Docs: [get-records](https://www.zoho.com/crm/developer/docs/api/v8/get-records.html), [insert-records](https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html), [update-records](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html), [upsert-records](https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html), [delete-records](https://www.zoho.com/crm/developer/docs/api/v8/delete-records.html)

### 3.1 Get records — `fields` is MANDATORY in v8
`GET /{m}` requires the **`fields`** query param (comma-separated, **max 50** field API names). This is the headline v8 change vs v2 — a bare `GET /Leads` returns `REQUIRED_PARAM_MISSING`.

| Param | Notes |
|---|---|
| `fields` | **Required.** ≤50 API names. |
| `per_page` | default & max **200**. |
| `page` | default 1. Plain `page` paging caps at **2000 records** (page 1–10 at 200). Mutually exclusive with `page_token`. |
| `page_token` | cursor for **>2000** records (up to 100k). Returned as `next_page_token` in `info`; valid 24h. Mutually exclusive with `page`. |
| `sort_by` | `id` (default) / `Created_Time` / `Modified_Time`. Incompatible with `cvid`. |
| `sort_order` | `asc` / `desc` (default `desc`). |
| `cvid` | custom-view id (incompatible with `sort_by`). |
| `ids` | specific record ids, comma-separated. |
| `converted` | `true` / `false` (default) / `both` (Leads). |
| `territory_id`, `include_child` | Deals/Contacts/Accounts territory filtering. |

Header `If-Modified-Since: <ISO8601>` → returns only records modified since; **HTTP 304** if none changed (incremental sync). Records carry `Modified_Time` for delta tracking.
```bash
curl "https://www.zohoapis.com/crm/v8/Leads?fields=Last_Name,Email,Modified_Time&per_page=200" \
  -H "Authorization: Zoho-oauthtoken 1000.xxxx"
```
```json
{ "data":[ { "Last_Name":"test","Email":null,"id":"3652397000009851001" } ],
  "info":{ "per_page":200,"count":200,"page":1,"more_records":true,
           "next_page_token":"c8582xx9e7c7","sort_by":"id","sort_order":"desc" } }
```
Paging loop: keep calling while `info.more_records == true`, passing the prior `next_page_token` as `page_token`.

### 3.2 Get a single record
`GET /{m}/{id}`. Here `fields` is **optional** (returns all accessible fields if omitted). Response is a `data` array with one element.

### 3.3 Insert
`POST /{m}`. **Max 100 records/call.**
```json
{
  "data": [ { "Last_Name":"Daly", "First_Name":"Paul", "Email":"p.daly@zylker.com" } ],
  "trigger": ["approval","workflow","blueprint"]
}
```
- `trigger`: which automations to fire. Pass `[]` to skip workflows/approval/blueprint. Omitting it fires all.
- `lar_id`: lead-assignment-rule id (optional, parallels `data`).

Success element:
```json
{ "code":"SUCCESS","status":"success","message":"record added",
  "details":{ "id":"5725767000000524157","Created_Time":"2023-05-10T01:10:47-07:00",
              "Modified_Time":"...","Created_By":{"name":"...","id":"..."} } }
```

### 3.4 Update
- Mass: `PUT /{m}` — each `data` element **must include `id`**.
- Single: `PUT /{m}/{id}` — no `id` needed in body.
- **Max 100 records/call.** Same `trigger` semantics as insert.
```json
{ "data":[ { "id":"3652397000003852095","Stage":"Closed Won" } ] }
```

### 3.5 Upsert
`POST /{m}/upsert`. **Max 100 records/call.** Decides insert vs update by matching `duplicate_check_fields` (falls back to system unique fields, e.g. Email on Leads, if omitted).
```json
{ "data":[ {"Last_Name":"X","Email":"a@z.com","Company":"abc"} ],
  "duplicate_check_fields":["Email","Mobile"], "trigger":["workflow"] }
```
Each response element adds `action` (`insert`|`update`) and `duplicate_field`.

### 3.6 Delete
- Mass: `DELETE /{m}?ids=id1,id2&wf_trigger=true` — **`ids` mandatory, max 100**, `wf_trigger` default `true`.
- Single: `DELETE /{m}/{id}`.

### 3.7 Envelope & partial success
- Write bodies use a top-level **`data`** array; **`trigger`** controls automation.
- Multi-record write/delete returns **HTTP 207 (Multi-Status)** on mixed results; the response `data` array is **positional** (element *i* maps to input *i*), each with its own `code`/`status`/`message`. Always inspect per-record `code`, not just the HTTP status.

---

## 4. Search

Docs: [search-records](https://www.zoho.com/crm/developer/docs/api/v8/search-records.html)

`GET /{m}/search`. Scope: module READ **+ `ZohoSearch.securesearch.READ`**. Exactly one of (priority `criteria > email > phone > word`):

| Param | Purpose |
|---|---|
| `criteria` | structured field conditions (below) |
| `email` | match across all email fields |
| `phone` | match across all phone fields |
| `word` | global free-text across searchable fields |

Plus `fields` (optional here), `page`, `per_page` (max 200), `converted`, `approved`.

**Criteria syntax:** `(field_api_name:operator:value)`, combined with `and`/`or` and parentheses:
```
((First_Name:starts_with:M) and (Company:equals:ABC))
(Created_Time:between:2024-02-01T18:52:56+00:00,2024-02-20T18:52:56+00:00)
(Full_Name:in:Patricia,Boyle,Kate)
```
Operators by type:
- Text/Email/Phone/Website: `equals`, `not_equal`, `starts_with`, `in`
- Picklist/Autonumber: `equals`, `not_equal`, `in`
- Number/Currency/Date/DateTime: `equals`, `not_equal`, `greater_than`, `greater_equal`, `less_than`, `less_equal`, `between`, `in`
- Boolean / Lookup: `equals`, `not_equal` (lookup also `in`)

Gotchas: `equals` behaves like *contains* for plain text fields (not picklists). `in` supports ≤100 values. **Max 10 criteria** per query. Date/DateTime values are ISO8601 with offset. Special chars (`{ } [ ] ^ : - / ! ? * _ @` and space) must be backslash-escaped **and** URL-encoded. **Max 2000 results** total (`LIMIT_REACHED` beyond) — use COQL/Bulk Read for larger sets. Newly written records may lag the search index; use COQL for read-after-write.

---

## 5. COQL (CRM Object Query Language)

Docs: [Get-Records-through-COQL-Query](https://www.zoho.com/crm/developer/docs/api/v8/Get-Records-through-COQL-Query.html)

`POST /coql`. Scope `ZohoCRM.coql.READ` (+ module READ). Body:
```json
{ "select_query": "select Last_Name, First_Name, Account_Name.Account_Name from Contacts where Last_Name = 'Boyle' and Account_Name.Account_Name = 'Zylker' limit 0, 200" }
```
Grammar: `SELECT <fields> FROM <module> [WHERE <conditions>] [GROUP BY <fields>] [ORDER BY <fields> ASC|DESC] [LIMIT [offset,] limit]`.

**Operators by type:**
- Text/Picklist: `=`, `!=`, `like`, `not like`, `in`, `not in`, `is null`, `is not null`
- Lookup: `=`, `!=`, `in`, `not in`, `is null`, `is not null`
- Number/Date/DateTime: `=`, `!=`, `>`, `>=`, `<`, `<=`, `between`, `not between`, `in`, `not in`, `is null`, `is not null`
- Boolean: `=`

`like` wildcards: `tech%` (starts), `%tech` (ends), `%tech%` (contains). Combine with `and`/`or` + parentheses.

**Joins / relations:** dot notation on lookup fields, **max 2 joins** — `Account_Name.Account_Name`, `Account_Name.Parent_Account.Account_Name`. Polymorphic lookups (Tasks/Calls/Events) use arrow form `What_Id->Accounts.Account_Name`. Custom view: `FROM Leads#1234`.

**Limits:**

| Constraint | Max |
|---|---|
| Fields per SELECT | 50 |
| Rows per call | 200 |
| Total via pagination | 100,000 |
| LIMIT offset cap | 100,000 |
| Joins | 2 |
| Values in `in`/`not in` | 100 |
| ORDER BY fields | 10 |
| GROUP BY fields | 4 |

Paginate by incrementing the `LIMIT` offset (`limit 200,200`, `limit 400,200`, …) while `more_records` is true. HTTP **204** = no rows matched.

---

## 6. Related records, Notes, Attachments, Files, Tags

Docs: [get-related-records](https://www.zoho.com/crm/developer/docs/api/v8/get-related-records.html), [create-notes](https://www.zoho.com/crm/developer/docs/api/v8/create-notes.html), [upload-attachment](https://www.zoho.com/crm/developer/docs/api/v8/upload-attachment.html), [upload-files-to-zfs](https://www.zoho.com/crm/developer/docs/api/v8/upload-files-to-zfs.html), [add-tags](https://www.zoho.com/crm/developer/docs/api/v8/add-tags.html)

### 6.1 Related records
- Get: `GET /{m}/{id}/{related_list_api_name}` — **`fields` mandatory**; supports `page`, `per_page` (≤200), `sort_by`, `ids`.
- Associate/update: `PUT /{m}/{id}/{related_list_api_name}` with a `data` array.
- De-link: `DELETE /{m}/{id}/{related_list_api_name}/{related_record_id}`.

### 6.2 Notes
`POST /Notes` or `POST /{m}/{id}/Notes`. Scope `ZohoCRM.modules.notes.CREATE`. **Max 100/call.** `Note_Content` mandatory; `Parent_Id` mandatory when posting to generic `/Notes`.
```json
{ "data":[ { "Parent_Id":{"module":{"api_name":"Leads"},"id":"...771297"},
             "Note_Title":"Follow-up","Note_Content":"Call back Tuesday" } ] }
```

### 6.3 Attachments (per record)
`POST /{m}/{id}/Attachments`, `multipart/form-data`. One of `file=@path` **or** `attachmentUrl=https://…` per call. Scope `ZohoCRM.modules.attachments.CREATE`. List/download/delete via the same path + `{att_id}`.

### 6.4 Files → ZFS (for file/image-upload fields)
`POST /files`, multipart `file`. Scope `ZohoCRM.Files.CREATE`. **Max 10 files/call, 20 MB each.** Returns an encrypted `id` you then set on a record's file/image upload field during create/update.

### 6.5 Tags
- Add: `POST /{m}/actions/add_tags` — `tags` array (by `name`/`id`) + `ids` array, optional `over_write`. **Max 500 records/call.**
- Remove: `POST /{m}/actions/remove_tags` (same shape).
- Create/list: `POST|GET /settings/tags?module={m}`.

---

## 7. Bulk APIs

Docs: [bulk-read](https://www.zoho.com/crm/developer/docs/api/v8/bulk-read/create-job.html), [bulk-write](https://www.zoho.com/crm/developer/docs/api/v8/bulk-write/upload-file.html)

> Path order is `/crm/bulk/v8/...` (note `bulk` precedes the version). Async, callback-capable.

### 7.1 Bulk Read
**Create job:** `POST /crm/bulk/v8/read`. Scope `ZohoCRM.bulk.READ` + module READ.
```json
{
  "query": {
    "module": { "api_name": "Leads" },
    "fields": ["Last_Name","Email","Created_Time"],
    "criteria": { "field": {"api_name":"Created_Time"}, "comparator":"greater_than",
                  "value":"2024-01-01T00:00:00+00:00" },
    "page": 1,
    "file_type": "csv"
  },
  "callback": { "url":"https://your.app/zoho/bulk-callback", "method":"post" }
}
```
- **Max 200,000 records per page/job**; use `page` or `page_token` (24h TTL) beyond 200k.
- `file_type`: `csv` (default) or `ics` (Events only).
- Response: `data[].details` with `id` (job id), `state:"ADDED"`.

**Poll:** `GET /crm/bulk/v8/read/{job_id}` → `state` = `ADDED → QUEUED → IN PROGRESS → COMPLETED` (or `FAILURE`). On completion `result` holds `{ page, count, download_url, more_records, next_page_token? }`.
**Download:** `GET /crm/bulk/v8/read/{job_id}/result` → a **ZIP** with the CSV/ICS (available 1 day).

### 7.2 Bulk Write (3 steps)
1. **Upload file:** `POST https://content.zohoapis.{dc}/crm/v8/upload`, `multipart/form-data` `file` = a **ZIP of CSV(s)**. Headers: `Authorization`, `feature: bulk-write`, `X-CRM-ORG: {zgid}`. Scope `ZohoFiles.files.ALL`. **Max 25,000 records/CSV, 25 MB.** Returns `details.file_id`.
2. **Create job:** `POST /crm/bulk/v8/write`. Scope `ZohoCRM.bulk.CREATE`.
   ```json
   { "operation":"insert",
     "resource":[ { "type":"data","module":{"api_name":"Leads"},"file_id":"...",
       "field_mappings":[ {"api_name":"Last_Name","index":0},{"api_name":"Email","index":1} ] } ],
     "callback":{ "url":"https://your.app/cb","method":"post" }, "ignore_empty":false }
   ```
   `operation` = `insert | update | upsert`. **Max 200 field mappings.** Returns `details.id` (job id).
3. **Poll:** `GET /crm/bulk/v8/write/{job_id}` → `status` (`ADDED → INPROGRESS → COMPLETED`) + `result.download_url` (ZIP result CSV, 7 days) + `file.{added_count, updated_count, skipped_count, total_count}`.

---

## 8. Notifications, Functions, Variables

- **Notifications (webhooks):** `POST /actions/watch` (scope `ZohoCRM.notifications.CREATE`); body: `channel_id`, `events` (e.g. `["Leads.create","Contacts.edit"]`), `notify_url`, `channel_expiry`, `token`. List `GET`, update `PATCH`, disable `DELETE`. Zoho POSTs change payloads to your `notify_url`.
- **Functions (serverless Deluge):** `GET|POST {host}/crm/v8/functions/{api_name}/actions/execute?auth_type=apikey` (or `oauth`). Args via form-data `arguments` JSON string.
- **Variables:** see §2.8 — reusable org-level config values.

---

## 9. Rate limits & API credits

Docs: [api-limits](https://www.zoho.com/crm/developer/docs/api/v8/api-limits.html)

v8 uses a **credit** model. Most calls cost **1 credit**; heavy ops cost more.

**Daily credits by edition (approx):** Free 5,000 · Standard 50,000 + users×250 (cap 100k) · Professional 50,000 + users×500 (cap 3M) · Enterprise/Zoho One 50,000 + users×1,000 (cap 5M) · Ultimate/CRM Plus 50,000 + users×2,000.

**Per-operation credit cost (selected):** standard GET/single = 1; COQL = 1 (≤200) / 2 (201–1000) / 3 (1001–2000); insert/update/upsert = 1 per 10 records; mass delete = 1 per 100; tags = 1 per 50; convert lead = 5; **Bulk Write initialize = 500**.

**Concurrency:** Free 5, Standard 10, Professional 15, Enterprise 20, Ultimate 25. A **sub-concurrency limit of 10** applies to heavy APIs (Convert Lead, multi-record bulk inserts/updates >10, COQL, composite) → `TOO_MANY_REQUESTS` if exceeded.

**Header:** `X-API-CREDITS-REMAINING` (sent once usage crosses ~50% of the daily limit). The v8 docs do **not** document `X-RATELIMIT-*` headers. **HTTP 429** when the 24-hour allowance or concurrency is exhausted.

---

## 10. Errors & gotchas

Docs: [status-codes](https://www.zoho.com/crm/developer/docs/api/v8/status-codes.html)

### 10.1 HTTP status codes
`200` OK · `201` created · `202` accepted · `204` no content (empty result) · `207` multi-status (partial success) · `304` not modified · `400` bad request · `401` invalid token/scope · `403` no permission · `404` invalid URL · `405` method not allowed · `413` payload too large · `415` unsupported media type · `429` rate/credit/concurrency · `500` server error.

### 10.2 Standard error envelope
```json
{ "code": "INVALID_DATA",
  "details": { "api_name": "Email", "expected_data_type": "email" },
  "message": "invalid data", "status": "error" }
```
In multi-record ops this appears **per element** inside `data` (positional), so a single call can mix `SUCCESS` and error elements under HTTP 207.

### 10.3 Common `code` strings
`INVALID_DATA` · `MANDATORY_NOT_FOUND` · `DUPLICATE_DATA` · `INVALID_TOKEN`/`AUTHENTICATION_FAILURE` · `OAUTH_SCOPE_MISMATCH` · `NO_PERMISSION` (403) · `INVALID_MODULE` · `INVALID_URL_PATTERN` (404) · `REQUIRED_PARAM_MISSING` (e.g. omitting `fields`) · `LIMIT_EXCEEDED`/`LIMIT_REACHED` · `RECORD_LOCKED` · `TOO_MANY_REQUESTS` (429) · `INTERNAL_ERROR` (500).

### 10.4 v8-specific gotchas
- **`fields` is mandatory** on `GET /{m}` and Get-Related-Records (≤50). Single-record GET is the exception.
- **Search needs `ZohoSearch.securesearch.READ`** in addition to the module scope.
- **Bulk path order** is `/crm/bulk/v8/...`; bulk **upload** goes to the separate `content.zohoapis.{dc}` host.
- **Partial success is the norm** for multi-record writes/deletes — parse per-record `code`.
- **Pagination ceilings:** plain `page` caps at 2,000; use `page_token` (Get Records) / `LIMIT` offset (COQL, ≤100k) / Bulk Read (≤200k/page). Search hard-caps at 2,000.
- **DC consistency:** mint and use tokens on the user's DC; trust `api_domain` from the refresh response. CA accounts host is `accounts.zohocloud.ca`.
- **Read-after-write:** the search index lags; use COQL (or fetch by id) immediately after a write.
- **Write limits:** 100 records/call for insert/update/upsert/delete/notes; 500 for tags; 10 files (20 MB) for ZFS; 25,000 records/CSV for Bulk Write.

---

### Primary sources
[v8 index](https://www.zoho.com/crm/developer/docs/api/v8/) · [OAuth](https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html) · [Refresh](https://www.zoho.com/crm/developer/docs/api/v8/refresh.html) · [Scopes](https://www.zoho.com/crm/developer/docs/api/v8/scopes.html) · [Get records](https://www.zoho.com/crm/developer/docs/api/v8/get-records.html) · [Search](https://www.zoho.com/crm/developer/docs/api/v8/search-records.html) · [COQL](https://www.zoho.com/crm/developer/docs/api/v8/Get-Records-through-COQL-Query.html) · [Field meta](https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html) · [Bulk Read](https://www.zoho.com/crm/developer/docs/api/v8/bulk-read/create-job.html) · [Bulk Write](https://www.zoho.com/crm/developer/docs/api/v8/bulk-write/upload-file.html) · [API limits](https://www.zoho.com/crm/developer/docs/api/v8/api-limits.html)
