---
name: zoho-desk-api
description: Zoho Desk REST API v1 reference — OAuth/scopes, the mandatory orgId header, metadata (departments/agents/fields/layouts), tickets CRUD + actions, threads/conversations/comments, send reply, contacts/accounts, tasks/calls/events, search, attachments, counts, rate-limits, errors, pagination. Use when building or debugging Zoho Desk tool integrations in this repo (the `zoho_desk` wrapper + ToolManifest tools).
---

# Zoho Desk API (v1) — skill

**Using this in Mytrion Ops (our codebase):**
- **Auth:** `wrapper.authHeaders('zoho_desk')` ([src/integrations/wrapper.ts](../../../src/integrations/wrapper.ts)) → `Authorization: Zoho-oauthtoken <token>` **plus** the `orgId` header (auto-attached from env `ZOHO_DESK_ORG_ID`). Token cached per service.
- **Base URL:** `zoho.baseUrl('zoho_desk')` → env `ZOHO_DESK_BASE_URL` (default `https://desk.zoho.com/api/v1`).
- **Scopes:** `ZOHO_DESK_REFRESH_TOKEN` minted with the scopes in §1.3 (min for a reply bot: `Desk.tickets.ALL,Desk.contacts.READ,Desk.basic.READ,Desk.search.READ`).
- **Our org's live fields/departments:** `pnpm meta:zoho-desk` → `metadataScripts/output/zoho-desk.{json,md}` (git-ignored).
- **Gotchas baked in (don't relearn the hard way):** update = **PATCH** (not PUT); delete = **POST `…/moveToTrash`** (not HTTP DELETE); empty list = **HTTP 204** (not `{data:[]}`); IDs are **strings** (never parse as JS number); `departmentId` is **required** on ticket/task/call/event lists.
- **Wiring:** expose as `ToolManifest` tools → `toolDispatcher` (RBAC + department/`Administrator` gating). Use Count APIs (§8.3) instead of paging to totals.

---

# Zoho Desk REST API (v1) — Backend Engineering Reference

> Built from the official Zoho Desk API docs (`https://desk.zoho.com/DeskAPIDocument`, `https://www.zoho.com/desk/developer-guide/`) and Zoho's **official OpenAPI spec** repo [`github.com/zoho/zohodesk-oas`](https://github.com/zoho/zohodesk-oas) (`v1.0/*.json`), the source of truth for exact methods/paths/params/bodies. Where a value is the *default* vs the *hard max*, both are noted (the OAS `maximum` is authoritative over prose docs, which often quote the default of 50).

---

## 0. Conventions (read first)

- **Base URL:** `https://desk.zoho.com/api/v1` (US DC). Swap host per data center — see §1.4.
- **Every request** carries two headers; **`orgId` is mandatory on every endpoint except `/organizations` and `/accessibleOrganizations`**:
  ```
  Authorization: Zoho-oauthtoken <access_token>
  orgId: <org_id>
  ```
  `orgId` may also be a query param; mismatch with the token's portal → `OAUTH_ORG_MISMATCH`.
- **Content type:** `application/json` for JSON; `multipart/form-data` for uploads.
- **IDs are strings** (large 64-bit — never parse as JS `number`).
- **Update = `PATCH`** (partial). PUT on a record → `405 METHOD_NOT_ALLOWED`. The only `PUT` in v1 is time-entry update.
- **Delete of records = `POST .../moveToTrash`** (soft delete, body of IDs). HTTP `DELETE` is only for sub-resources (a comment, attachment, layout, thread attachment).
- **List responses** are `{ "data": [ ... ] }`. No matches → **HTTP 204 (empty body)**, not an empty array — handle 204 explicitly.
- Ticket/contact/account/task fields are **dynamic** (profile-based field-level security strips fields per user).

---

## 1. Authentication & Scopes
*Docs: `DeskAPIDocument#Introduction`; OAS `Common.json`; OAuth `www.zoho.com/accounts/protocol/oauth.html`*

### 1.1 OAuth 2.0 token flow
Authorization-code grant; access token **1 hour**, refresh token **non-expiring** until revoked.
**Token endpoint (per DC):** `https://accounts.zoho.{dc}/oauth/v2/token`.
**Refresh (the call your backend makes):**
```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "refresh_token=<refresh_token>" -d "client_id=<client_id>" \
  -d "client_secret=<client_secret>" -d "grant_type=refresh_token"
```
```json
{ "access_token":"1000.xxxx.yyyy", "expires_in":3600, "api_domain":"https://www.zohoapis.com", "token_type":"Bearer" }
```
Refresh does **not** return a new refresh token. Revoke: `POST https://accounts.zoho.{dc}/oauth/v2/token/revoke?token=<refresh_token>`.

### 1.2 Authenticated request shape
```bash
curl "https://desk.zoho.com/api/v1/tickets?limit=50&from=1" \
  -H "Authorization: Zoho-oauthtoken 1000.67013ab3....c8b5ef6" \
  -H "orgId: 2389290"
```

### 1.3 OAuth scopes
Pattern: **`Desk.<area>.<OP>`** where `OP ∈ {READ, CREATE, UPDATE, DELETE, ALL}`. Comma-separate scopes in the authorize request.

| Area scope prefix | Covers |
|---|---|
| `Desk.tickets.*` | Tickets, threads, conversations, comments, attachments, time entries, ticket actions |
| `Desk.contacts.*` | Contacts **and** Accounts |
| `Desk.tasks.*` / `Desk.calls.*` / `Desk.events.*` / `Desk.activities.*` | Activities |
| `Desk.basic.*` | Org metadata: agents, departments, teams, roles, profiles, fields, layouts, mail-reply addresses |
| `Desk.settings.*` | Settings/admin config (statuses, business hours, …) |
| `Desk.search.*` | All `/search` endpoints |
| `Desk.articles.*` / `Desk.community.*` / `Desk.products.*` | KB / community / products |
| `Desk.exports.*` / `Desk.imports.*` | Bulk export/import |

> Practical minimum for a read/reply bot: `Desk.tickets.ALL,Desk.contacts.READ,Desk.basic.READ,Desk.search.READ`. Add `Desk.settings.READ` to read statuses/admin config.

### 1.4 Data-center hosts (same DC for token + API)
| DC | Desk API base | Accounts (OAuth) |
|---|---|---|
| US | `https://desk.zoho.com/api/v1` | `https://accounts.zoho.com` |
| EU | `https://desk.zoho.eu/api/v1` | `https://accounts.zoho.eu` |
| India | `https://desk.zoho.in/api/v1` | `https://accounts.zoho.in` |
| Australia | `https://desk.zoho.com.au/api/v1` | `https://accounts.zoho.com.au` |
| Japan | `https://desk.zoho.jp/api/v1` | `https://accounts.zoho.jp` |
| Canada | `https://desk.zohocloud.ca/api/v1` | `https://accounts.zohocloud.ca` |

### 1.5 List & mark organizations (the only orgId-free endpoints)
```
GET /api/v1/organizations
GET /api/v1/accessibleOrganizations
GET /api/v1/organizations/{organizationId}
PATCH /api/v1/organizations/{organizationId}
POST  /api/v1/organizations/markDefault     # body: { "id": <orgId> }
```

---

## 2. Metadata / Settings
*OAS `Department.json`, `Agent.json`, `Team.json`, `Profile.json`, `Role.json`, `Field.json`, `Layout.json`, `MailReplyAddress.json`. Scope mostly `Desk.basic.READ`.*

### 2.1 Departments
```
GET /api/v1/departments                 # params: isEnabled, searchStr, chatStatus, from, limit (max 200)
GET /api/v1/departments/{departmentId}
GET /api/v1/departments/count
GET /api/v1/departmentsByIds?departmentIds=<csv>
GET /api/v1/departments/{departmentId}/agents   # status[ACTIVE|DISABLED], searchStr, limit (max 200), from
POST /api/v1/departments/{departmentId}/associateAgents | /dissociateAgents   # { agentIds:[...] }
POST /api/v1/departments/{departmentId}/enable | /disable
```

### 2.2 Agents
```
GET   /api/v1/agents       # status, searchStr, departmentIds, roleIds, profileIds, include, from, limit (max 200)
GET   /api/v1/agents/{agentId}
GET   /api/v1/agentsByIds?agentIds=<csv>
GET   /api/v1/agents/count
GET   /api/v1/myinfo       # current agent (token owner)
POST  /api/v1/agents       # create
PATCH /api/v1/agents/{agentId}
```
> No `/agents/email/{email}` path — resolve by email via `GET /agents?searchStr=<email>`.

### 2.3 Teams, Profiles, Roles
```
GET /api/v1/teams · /teams/{teamId} · /teams/{teamId}/members · /agents/{agentId}/teams
GET /api/v1/profiles · /profiles/{profileId} · /myProfile · /myProfilePermissions
GET /api/v1/roles    # searchStr, isDefault, isVisible, from, limit (max 500)
```

### 2.4 Fields & layouts
```
GET /api/v1/organizationFields?module=<m>[&departmentId=<id>]
GET /api/v1/organizationFields/{fieldId}
GET /api/v1/customFieldCount?module=<m>
     # module enum: tickets | contacts | accounts | tasks | calls | events | contracts | products
GET /api/v1/layouts?module=<m>[&departmentId=<id>]
GET /api/v1/layouts/{layoutId}     # full section/field structure
```
```json
// GET /api/v1/organizationFields?module=tickets
{ "data": [ { "id":"100...","apiName":"priority","displayLabel":"Priority","type":"PickList",
              "isCustomField":false,"isMandatory":false,"allowedValues":["High","Medium","Low"] } ] }
```
> **Statuses:** no top-level `/statuses` endpoint. Ticket status options come from the **Status field** in `organizationFields?module=tickets` (its `allowedValues`). Status *types* / counts: `GET /ticketsCountByFieldValues?field=statusType|status`.

### 2.5 Mail / reply addresses
```
GET  /api/v1/mailReplyAddress?departmentId=<id>[&isActive=true]   # departmentId required
POST /api/v1/mailReplyAddress/{id}/sendVerification
```
Use the returned `mailReplyAddressId` / `fromEmailAddress` in `sendReply` (§4).

---

## 3. Tickets (core)
*OAS `Ticket.json`, `TicketComment.json`, `TicketHistory.json`, `blueprints.json`*

### 3.1 List tickets
```
GET /api/v1/tickets
```
**Params:** `departmentId` **(required)**, `status`, `assignee`, `channel`, `teamIds`, `include`, `from`, `limit`, `sortBy`, `dueDate`, `receivedInDays`, `closedTime`.
- `sortBy` enum: `dueDate | createdTime | recentThread` (prefix `-` = descending).
- `dueDate` enum: `overdue | today | tomorrow | currentWeek | currentMonth`.
- `include` (csv): `contacts, assignee, departments, team, isRead, products`.
```bash
curl "https://desk.zoho.com/api/v1/tickets?departmentId=10678&status=Open&include=contacts,assignee&sortBy=-createdTime&from=1&limit=50" \
  -H "Authorization: Zoho-oauthtoken <t>" -H "orgId: 2389290"
```
> Related-list variants: `GET /contacts/{id}/tickets`, `/accounts/{id}/tickets`, `/products/{id}/tickets`, `/associatedTickets`, `/tickets/archivedTickets`.

### 3.2 Get / Create / Update / Delete
```
GET   /api/v1/tickets/{ticketId}          # params: include
POST  /api/v1/tickets                      # create
PATCH /api/v1/tickets/{ticketId}           # update (partial)
POST  /api/v1/tickets/moveToTrash          # body: { "ticketIds":[ "1","2" ] }  (soft delete)
POST  /api/v1/closeTickets                 # body: { "ids":[...] }
```
**Create body (key fields):** `subject`*, `departmentId`* (effectively required), `contactId` **or** `contact{lastName,email,...}` (inline create), `description`, `email`, `phone`, `priority`, `status`, `channel`, `assigneeId`, `category`, `productId`, `cf{}` (custom fields by **API name** `cf_*`), `customFields{}` (legacy, by display label).
```bash
curl -X POST "https://desk.zoho.com/api/v1/tickets" \
  -H "Authorization: Zoho-oauthtoken <t>" -H "orgId: 2389290" -H "Content-Type: application/json" \
  -d '{ "subject":"Cannot log in","departmentId":"10678","contactId":"54000",
        "priority":"High","status":"Open","channel":"Email","cf":{ "cf_severity":"S2" } }'
```
**Update:**
```bash
curl -X PATCH "https://desk.zoho.com/api/v1/tickets/68900000123" \
  -H "Authorization: Zoho-oauthtoken <t>" -H "orgId: 2389290" \
  -d '{ "status":"On Hold","assigneeId":"5400055" }'
```

### 3.3 Ticket actions
```
POST /api/v1/tickets/{id}/markAsRead | /markAsUnRead
POST /api/v1/tickets/{id}/move        # { "departmentId": <id> }
POST /api/v1/tickets/{id}/merge       # { "ids":[<secondaryIds>], "source":{...} }
POST /api/v1/tickets/markSpam         # { "ids":[...], "isSpam": true }
POST /api/v1/tickets/updateMany       # bulk field update: { "ids":[...], "fieldName":"status", "fieldValue":{...} }
POST /api/v1/tickets/{id}/threads/{threadId}/split
GET  /api/v1/tickets/{id}/history · /metrics · /resolution
GET  /api/v1/agentsTicketsCount?agentIds=<csv>&departmentId=<id>
```

### 3.4 Ticket history
`GET /api/v1/tickets/{ticketId}/history` (params `from`, `limit`) — ordered audit trail; entries have `eventName`, `source`, `actor`, `time`, `data`.

### 3.5 Comments (private/public agent notes)
```
GET    /api/v1/tickets/{id}/comments              # include, from, limit, sortBy=commentedTime
GET    /api/v1/tickets/{id}/comments/{commentId}
POST   /api/v1/tickets/{id}/comments              # add
PATCH  /api/v1/tickets/{id}/comments/{commentId}   # body: { "content": "..." } ONLY
DELETE /api/v1/tickets/{id}/comments/{commentId}
```
Add-comment body: `content`*, `contentType` (`html`/`plainText`), `isPublic` (bool — `false`=private note, `true`=customer-visible), `attachmentIds`* (pass `[]` if none).

### 3.6 Blueprint
```
GET  /api/v1/tickets/{id}/blueprint            # current state + available transitions
POST /api/v1/tickets/{id}/revokeBlueprint
GET  /api/v1/blueprints?module=tickets
```

---

## 4. Threads & Conversations
*OAS `Thread.json`*

- **Conversation** = unified timeline (threads + comments). **Thread** = one channel message.
```
GET /api/v1/tickets/{id}/conversations              # include, from, limit  (threads + comments merged)
GET /api/v1/tickets/{id}/threads                    # from, limit, sortBy=sendDateTime
GET /api/v1/tickets/{id}/threads/{threadId}
GET /api/v1/tickets/{id}/threads/{threadId}/originalContent   # full raw email body
```
> The "latest thread" comes via ticket detail `include=lastThread` (and inside `conversations`); no standalone `/latestThread` path in v1.

### 4.2 Send reply / draft
```
POST   /api/v1/tickets/{id}/sendReply       # optional ?parentConversationId=<threadId>
POST   /api/v1/tickets/{id}/draftReply
PATCH  /api/v1/tickets/{id}/draftReply/{threadId}
DELETE /api/v1/tickets/{id}/threads/{threadId}/attachments/{attachmentId}
```
Body is a **`oneOf` discriminated on `channel`**. Common required: `channel`*, `content`*. `channel` enum: `EMAIL | FACEBOOK | TWITTER | FORUMS | PHONE | WEB | FEEDBACK | TWITTER_DM | ONLINE_CHAT | OFFLINE_CHAT | CUSTOMERPORTAL`.
**EMAIL extras:** `fromEmailAddress`*, `to`, `cc`, `bcc`, `contentType` (`html|plainText`), `isForward`, `mailReplyAddressId`, `attachmentIds[]`, `ticketStatus`.
```bash
curl -X POST "https://desk.zoho.com/api/v1/tickets/68900000123/sendReply" \
  -H "Authorization: Zoho-oauthtoken <t>" -H "orgId: 2389290" -H "Content-Type: application/json" \
  -d '{ "channel":"EMAIL","fromEmailAddress":"support@acme.com","to":"customer@example.com",
        "contentType":"html","content":"<p>Hi, we have reset your password.</p>","isForward":false }'
```

---

## 5. Contacts & Accounts
*OAS `Contact.json`, `Account.json`*

### 5.1 Contacts
```
GET   /api/v1/contacts                  # include, viewId, from, limit (max 99), sortBy
GET   /api/v1/contacts/{contactId}      # include
GET   /api/v1/contacts/contactsByIds?ids=<csv>
POST  /api/v1/contacts                   # create — lastName* required
PATCH /api/v1/contacts/{contactId}
POST  /api/v1/contacts/moveToTrash       # { "contactIds":[...] }
GET   /api/v1/contacts/{id}/tickets · /accounts · /history
POST  /api/v1/contacts/{id}/associateAccounts | /dissociateAccounts
POST  /api/v1/contacts/{id}/merge · /contacts/markSpam · /contacts/updateMany
```
`sortBy`: `firstName|lastName|phone|email|account|createdTime|modifiedTime`.

### 5.2 Accounts
```
GET   /api/v1/accounts                   # from, limit (max 99), sortBy
GET   /api/v1/accounts/{accountId}       # include
GET   /api/v1/accounts/{id}/contacts · /tickets · /statistics
POST  /api/v1/accounts                    # create — accountName* required
PATCH /api/v1/accounts/{accountId}
POST  /api/v1/accounts/moveToTrash · /accounts/{id}/merge · /accounts/updateMany
```

---

## 6. Tasks / Calls / Events (Activities)
*OAS `Task.json`, `Call.json`, `Event.json`* — identical CRUD shape; **`departmentId` required** on list; delete = `moveToTrash`; update = `PATCH`.
```
GET   /api/v1/tasks | /calls | /events            # departmentId*, include, from, limit (max 99), sortBy
POST  /api/v1/tasks | /calls | /events            # create
PATCH /api/v1/{module}/{id}
POST  /api/v1/{module}/moveToTrash                 # { "entityIds":[...] }
GET   /api/v1/tickets/{id}/tasks | /calls | /events
```
**Ticket time-entry** (the lone `PUT`):
```
GET    /api/v1/tickets/{id}/timeEntry
POST   /api/v1/tickets/{id}/timeEntry
PUT    /api/v1/tickets/{id}/timeEntry/{teId}       # update (PUT here, not PATCH)
DELETE /api/v1/tickets/{id}/timeEntry/{teId}
```

---

## 7. Search
*OAS `Search.json`. Scope `Desk.search.READ`.*

**A. Per-module field search (recommended):** `GET /api/v1/{module}/search` (`tickets|contacts|accounts|articles|products|tasks|calls|events|activities`). Criteria are individual query params (AND-combined); `_all` = free text.
- `tickets/search`: `_all, subject, description, ticketNumber, status, priority, channel, category, assigneeId, departmentId, contactId, accountId, productId, createdTimeRange, modifiedTimeRange, sortBy(relevance|modifiedTime|createdTime)`.
- `contacts/search`: `_all, firstName, lastName, fullName, accountName, createdTimeRange, …`.
```bash
curl "https://desk.zoho.com/api/v1/tickets/search?_all=refund&status=Open&priority=High&departmentId=10678&limit=50&from=1" \
  -H "Authorization: Zoho-oauthtoken <t>" -H "orgId: 2389290"
```
> Time-range format: `createdTimeRange=2026-06-01T00:00:00Z,2026-06-19T00:00:00Z`.

**B. Generic cross search:** `GET /api/v1/search?searchStr=<q>&module=tickets[&departmentId=&from=&limit=]`.

Search pagination: `from`+`limit` only; capped at **~2,000 results** total. Narrow with criteria/time ranges rather than deep paging.

---

## 8. Attachments, Uploads, Count & Bulk

### 8.1 Generic upload → reusable attachment id
```
POST /api/v1/uploads      # multipart/form-data, field: file
```
```bash
curl -X POST "https://desk.zoho.com/api/v1/uploads" -H "Authorization: Zoho-oauthtoken <t>" -H "orgId: 2389290" -F "file=@/path/report.pdf"
```
→ `{ "id":"68900000777","name":"report.pdf",... }`. Use `id` in `attachmentIds` for `sendReply`/comments.

### 8.2 Ticket attachments
```
GET    /api/v1/tickets/{id}/attachments    # isPublic, include, from, limit (max 100)
POST   /api/v1/tickets/{id}/attachments     # multipart field: file ; query: isPublic
PATCH  /api/v1/tickets/{id}/attachments/{attId}   # { "isPublic": bool }
DELETE /api/v1/tickets/{id}/attachments/{attId}
```

### 8.3 Count APIs (cheap aggregates — avoid full paging)
```
GET /api/v1/ticketsCount                 # departmentId, assigneeId, createdTimeRange, …
GET /api/v1/ticketsCountByFieldValues    # field=statusType|status|priority|channel|spam|overDue|escalated
GET /api/v1/agentsTicketsCount?agentIds=<csv>&departmentId=<id>
GET /api/v1/{agents|departments|contacts|tasks|profiles|roles}/count · /customFieldCount?module=
```
```json
// GET /api/v1/ticketsCountByFieldValues?field=status&departmentId=10678
{ "data": [ { "value":"Open","count":42 }, { "value":"On Hold","count":7 } ] }
```

### 8.4 Bulk write
- Bulk field update: `POST /api/v1/<module>/updateMany` — `{ "ids":[...], "fieldName":"status", "fieldValue":{...} }`.
- Bulk soft-delete: `POST /api/v1/<module>/moveToTrash`.
- Large import: Desk Bulk Import APIs (`Desk.imports.*`).

---

## 9. Rate Limits & Errors
*Docs: `DeskAPIDocument#APIThrottling`, `#StatusCodes`*

### 9.1 API credits (per org, per 24h)
| Edition | Daily credits |
|---|---|
| Free/Trial | 5,000 |
| Express | 25,000 (+100/user) |
| Standard | 50,000 (+250/user) |
| Professional | 75,000 (+500/user) |
| Enterprise/Zoho One/CRM Plus | 100,000 (+1,000/user) |

Credit cost: single fetch/action = **1**; bulk update = 1 per 2 records; bulk delete/restore = 6/record; range fetch (lists) = 3 (≤2k) / 10 (≤10k) / 50 (≤100k) / 100 (>100k).

### 9.2 Concurrency
Free/Trial 5 · Express/Standard 10 · Professional 15 · Enterprise/Zoho One/CRM Plus 25.

### 9.3 Throttle headers
```
X-Rate-Limit-Request-Weight-v3 : credits consumed by this call
X-Rate-Limit-Remaining-v3      : credits remaining today
Retry-After                    : seconds to wait (present once limited)
```

### 9.4 HTTP status codes
`200` OK · `201` created · `204` no content (**also empty list results**) · `400` bad request · `401` unauthorized · `403` forbidden (scope/permission) · `404` not found · `405` method not allowed (e.g. PUT on a record) · `422` unprocessable (validation) · `429` too many requests · `500` server error.

### 9.5 Error body & codes
```json
{ "errorCode": "INVALID_DATA", "message": "The data you have provided is invalid." }
```
Common: `UNAUTHORIZED`, `INVALID_OAUTH`, `SCOPE_MISMATCH`, `OAUTH_ORG_MISMATCH`, `FORBIDDEN`, `URL_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `RESOURCE_SIZE_EXCEEDED`, `INVALID_DATA`, `UNPROCESSABLE_ENTITY`, `THRESHOLD_EXCEEDED` (daily credits — wait for reset), `TOO_MANY_REQUESTS` (concurrency — throttle worker pool), `INTERNAL_SERVER_ERROR`.
- **429**: back off using `Retry-After`; distinguish `THRESHOLD_EXCEEDED` (daily) vs `TOO_MANY_REQUESTS` (concurrency).
- **422**: validation/business-rule failure — inspect `message`, don't blind-retry.

---

## 10. Pagination model
- **Offset-based only:** `from` (1-based, default 1) + `limit` (page size).
- **`limit` maxima differ** (from OAS): record lists (tickets/contacts/accounts/tasks/calls/events) **max 99** (default 10); ticket attachments **100**; agents/departments **200**; roles **500**; search ~**2,000** total window.
- **No cursor** in v1 — page by `from = from + limit`. Stop on HTTP 204 or a short page.

---

## Endpoint cheat-sheet

| Area | Method + Path | Notes |
|---|---|---|
| Orgs | `GET /organizations` | no `orgId` header |
| Tickets list | `GET /tickets` | `departmentId` required |
| Ticket CRUD | `GET/POST /tickets`, `PATCH /tickets/{id}`, `POST /tickets/moveToTrash` | update=PATCH, delete=moveToTrash |
| Ticket actions | `POST /tickets/{id}/{markAsRead\|move\|merge}` | |
| Bulk update | `POST /tickets/updateMany` | `{ids,fieldName,fieldValue}` |
| Conversations | `GET /tickets/{id}/conversations` | threads+comments |
| Threads | `GET /tickets/{id}/threads` · `/threads/{tid}` | |
| Send reply | `POST /tickets/{id}/sendReply` | body `oneOf` by `channel` |
| Comments | `GET/POST /tickets/{id}/comments` | `content,isPublic,attachmentIds` |
| Contacts | `GET/POST /contacts`, `PATCH /contacts/{id}` | `lastName` req |
| Accounts | `GET/POST /accounts`, `PATCH /accounts/{id}` | `accountName` req |
| Tasks/Calls/Events | `GET/POST /tasks\|/calls\|/events` | `departmentId` req on list |
| Search | `GET /{module}/search` | field params + `_all` |
| Uploads | `POST /uploads` | → attachment id |
| Counts | `GET /ticketsCount`, `/ticketsCountByFieldValues` | cheap aggregates |
| Metadata | `GET /departments`, `/agents`, `/profiles`, `/roles` | `Desk.basic.READ` |
| Fields | `GET /organizationFields?module=tickets` | statuses live in status field |
| Mail-from | `GET /mailReplyAddress?departmentId=` | for `fromEmailAddress` |

---

### Sources (official)
- Zoho Desk API — https://desk.zoho.com/DeskAPIDocument · Developer guide — https://www.zoho.com/desk/developer-guide/
- **Official OpenAPI spec (authoritative)** — https://github.com/zoho/zohodesk-oas (`v1.0/*.json`)
- Zoho OAuth 2.0 — https://www.zoho.com/accounts/protocol/oauth.html · Multi-DC — https://www.zoho.com/accounts/protocol/oauth/multi-dc.html

### Cross-checks worth remembering
1. **Update = `PATCH`** for every record type; only `PUT` is `timeEntry/{teId}`. PUT on a record → 405.
2. **Delete = soft via `POST .../moveToTrash`** (body of IDs); HTTP DELETE only for sub-resources.
3. **Reply = `POST /tickets/{id}/sendReply`** with a `oneOf` body keyed on `channel` (no per-channel paths).
4. **`limit` max generally 99** (not 50); `from`+`limit` only, no cursor.
5. **`departmentId` required** on ticket/task/call/event lists.
6. **Empty results = HTTP 204**, not `{"data":[]}`.
7. **No `/statuses` endpoint** — statuses come from `organizationFields?module=tickets`; counts via `/ticketsCountByFieldValues?field=status`.
8. **Count APIs exist** — use instead of paging to totals.
