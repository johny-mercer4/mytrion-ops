---
name: zoho-workdrive-api
description: Zoho WorkDrive API v1 reference — OAuth/scopes, teams, workspaces (team folders), files/folders, upload/download, permissions, external links, search, JSON:API conventions, multi-DC hosts. Use when designing or debugging WorkDrive integrations (not yet wired in Mytrion Ops — no ZOHO_WORKDRIVE_* env / wrapper today).
---

# Zoho WorkDrive API — skill

**Using this in Mytrion Ops (our codebase):**
- **Not integrated yet.** There is no `zoho_workdrive` service in `src/integrations/zoho.ts`, no
  `ZOHO_WORKDRIVE_*` env keys, and no ToolManifest tools. When you add it, follow the same pattern
  as People/CRM: refresh token per service → `Authorization: Zoho-oauthtoken <token>` → wrapper →
  `toolDispatcher`.
- **Planned base URL:** `https://www.zohoapis.com/workdrive/api/v1` (US). Other DCs use
  `https://www.zohoapis.{dc}/workdrive/api/v1` (`.eu`, `.in`, `.com.au`, `.jp`, `.ca`, …).
- **Upload host** (rclone / Zoho clients): often `https://upload.zoho.com/workdrive-api/v1/upload`
  (DC-specific). **Download host:** `https://download.zoho.com/v1/workdrive/download/{id}` or
  `GET {api}/download/{file_id}` depending on edition — verify against your DC docs.
- **Accept header:** `application/vnd.api+json` on JSON:API calls.
- **Official explorer:** [WorkDrive API docs](https://workdrive.zoho.com/apidocs/v1/introduction/overview).

---

# Zoho WorkDrive REST API v1 — Backend Engineering Reference

WorkDrive uses **JSON:API** (`data` / `attributes` / `type` / `id`). Resource type names are plural
(`files`, `workspaces`, `teams`, `permissions`, `links`).

> Naming: product UI says **Team Folder**; the API resource is usually **`workspaces`**. Private
> user space is **`privatespace`**. Do not invent `/teamfolders` unless your org’s explorer shows it.

---

## 1. Authentication & scopes

- OAuth 2.0 authorization-code; access token ~1 hour; refresh offline.
- Header on every call: `Authorization: Zoho-oauthtoken <access_token>`.
- Recommended: `Accept: application/vnd.api+json` (and `Content-Type: application/vnd.api+json` on
  write bodies).

### Common scopes
| Scope | Use |
|---|---|
| `WorkDrive.files.ALL` / `.READ` / `.CREATE` / `.UPDATE` | Files & folders CRUD, upload, download |
| `WorkDrive.workspace.ALL` / `.READ` | Team folders (workspaces) |
| `WorkDrive.team.READ` | List / read teams |
| `WorkDrive.users.READ` | User / current-user context |
| `WorkDrive.settings.ALL` | Org / settings surfaces |

Mint a **dedicated** refresh token with only the scopes you need (same pattern as People/CRM).

### Multi-DC
Match accounts + API hosts to the org DC (US `.com`, EU `.eu`, IN `.in`, AU `.com.au`, JP `.jp`,
CA `zohocloud.ca`, etc.). Never mix an EU refresh token with a US API host.

---

## 2. Teams & current user

| Action | Method | Path | Scope (typical) |
|---|---|---|---|
| Teams for a user | GET | `/users/{user_id}/teams` | `WorkDrive.team.READ` |
| Team info | GET | `/teams/{team_id}` | `WorkDrive.team.READ` |
| Current user in team | GET | `/teams/{team_id}/currentuser` | `WorkDrive.users.READ` |
| Org for user | GET | `/users/{user_id}/organization` | `WorkDrive.team.READ` |

`user_id` is often obtainable from the OAuth / currentuser payloads once you have a team context.

---

## 3. Workspaces (Team Folders)

| Action | Method | Path |
|---|---|---|
| List team folders in a team | GET | `/teams/{team_id}/workspaces` |
| Create team folder | POST | `/workspaces` |
| Get / patch / delete | GET/PATCH/DELETE | `/workspaces/{workspace_id}` |
| List members | GET | `/workspaces/{workspace_id}/permissions` |

**Create body (JSON:API):**
```json
{
  "data": {
    "type": "workspaces",
    "attributes": {
      "name": "Project Alpha",
      "parent_id": "{team_id}",
      "is_public_within_team": true
    }
  }
}
```
Attribute names vary slightly by doc revision — prefer the explorer’s sample for your DC.

### Private space (“My Folders”)
| Action | Method | Path |
|---|---|---|
| Resolve private space id | GET | `/users/{team_member_id}/privatespace` |
| List children | GET | `/privatespace/{privatespace_id}/files` |

---

## 4. Files & folders

| Action | Method | Path | Notes |
|---|---|---|---|
| List children | GET | `/files/{folder_id}/files` | Pagination: `page[offset]`, `page[limit]`; filter `filter[type]=all\|folder\|file` |
| Get metadata | GET | `/files/{resource_id}` | File or folder |
| Create folder | POST | `/files` | `attributes.name`, `attributes.parent_id`, `type: "files"` |
| Create native Zoho file | POST | `/files` | `service_type`: `zw` (Writer), `zohosheet`, `zohoshow` |
| Rename / move | PATCH | `/files/{id}` or bulk `PATCH /files` | `name` and/or `parent_id` |
| Copy | POST | `/files/{id}/copy` | destination in attributes |
| Trash | PATCH | `/files` or `/files/{id}` | status codes for trash (e.g. `51`) — confirm in explorer |
| Hard delete | DELETE | `/files/{id}` | often only after trash |

**List pagination example:**
```
GET /files/{folder_id}/files?page[offset]=0&page[limit]=50&filter[type]=all
```

---

## 5. Upload & download

### Upload
```
POST /upload
Content-Type: multipart/form-data
```
Fields (common):
- `filename` — destination name
- `parent_id` — folder / workspace id
- `override-name-exist` — `true` \| `false`
- `content` — file binary

Large files may require the dedicated **upload.** host for your DC (see rclone WorkDrive backend).

### Download
```
GET /download/{file_id}
```
Returns raw bytes. **Folders cannot be downloaded** as a single blob via this endpoint.

---

## 6. Permissions & sharing

### Internal share (permissions)
```
POST /permissions
GET  /files/{id}/permissions
PATCH /permissions/{permission_id}
DELETE /permissions/{permission_id}
```
Role ids differ for files vs folders (examples from public docs — verify in explorer):

| Context | role_id examples |
|---|---|
| File | View `34`, Edit `5`, Share `4`, Comment `6`, Fill `33` |
| Folder | View `6`, Edit `5`, Organize `3`, Upload `7` |
| Workspace member | Admin `1`, Organizer `2`, Editor `5`, Viewer `6` |

`shared_type` values seen in docs: `personal`, `workspacemembers`, `teammembers`, `everyone`,
`publish`, `groupmembers`, `organisation`, `workspace`.

### External links
```
POST   /links
GET    /files/{id}/links
PATCH  /links/{link_id}
DELETE /links/{link_id}
```
Body includes `resource_id`, `role_id`, optional expiry / download limits / `request_user_data`.

---

## 7. Search

```
GET /teams/{team_id}/records?search[all]=<query>
```
Used for filename / content / template search depending on query shape. Encode brackets in URLs
(`search%5Ball%5D=`).

---

## 8. Data templates & custom fields (metadata on files)

| Action | Path |
|---|---|
| List templates for team | `GET /teams/{team_id}/datatemplates` |
| CRUD template | `POST/PATCH/DELETE /datatemplates[/{id}]` |
| Custom fields on template | `GET /datatemplates/{id}/customfields` |
| Associate metadata to file | `POST/PATCH/DELETE /custommetadata` |
| Metadata on a file | `GET /files/{id}/custommetadata` |

Useful when WorkDrive is used as a structured document store (contracts, KYC packs, etc.).

---

## 9. Errors & rate limits

| HTTP | Meaning |
|---|---|
| 400 | Bad JSON:API payload / attributes |
| 401 | Expired / invalid token — refresh |
| 403 | Scope or role insufficient |
| 404 | Unknown resource id |
| 429 | Rate limit — exponential backoff |
| 5xx | Retry with jitter |

Plan-tier ceilings apply (Free / Starter / Team / Business). Treat 429 as expected under bulk sync.

---

## 10. Implementation notes for Mytrion Ops

1. **Add env** when wiring: `ZOHO_WORKDRIVE_REFRESH_TOKEN`, `ZOHO_WORKDRIVE_API_DOMAIN` (full
   `…/workdrive/api/v1` root), extend `ZohoService` + `REFRESH_TOKEN_BY_SERVICE`.
2. **JSON:API client:** always send `Accept: application/vnd.api+json`; parse `data.attributes`.
3. **IDs are opaque strings** (not Zoho People form record ids) — store as text.
4. **Pagination** uses `page[offset]` / `page[limit]`, not People-style `sIndex`.
5. **Do not confuse** WorkDrive with Zoho Docs / WorkDrive classic file APIs (`ZohoFiles.*` scopes
   in some third-party clients) — stick to `workdrive/api/v1` for Team Folders.

---

### Sources
[WorkDrive API overview](https://workdrive.zoho.com/apidocs/v1/introduction/overview) ·
Zoho API Console (OAuth clients) · community / rclone WorkDrive backend (upload/download hosts)
