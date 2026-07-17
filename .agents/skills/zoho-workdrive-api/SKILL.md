---
name: zoho-workdrive-api
description: Zoho WorkDrive API reference — OAuth/scopes, team folders, files, upload, download, sharing, and permissions. Use when building or debugging Zoho WorkDrive tool integrations in this repo.
---

# Zoho WorkDrive API — skill

**Using this in Mytrion Ops (our codebase):**
- **Auth:** `wrapper.authHeaders('zoho_workdrive')` → `Authorization: Zoho-oauthtoken <token>`.
- **Base URL:** `zoho.baseUrl('zoho_workdrive')` → env `ZOHO_WORKDRIVE_API_DOMAIN` (default `https://www.zohoapis.com/workdrive/api/v1`).
- **Scopes:** `WorkDrive.files.ALL`, `WorkDrive.teamfolders.ALL`, `WorkDrive.workspace.ALL`.
- **Content-Type:** Most endpoints expect standard JSON or `application/vnd.api+json`.
- **Wiring:** expose calls as `ToolManifest` tools dispatched through `toolDispatcher`.

---

# Zoho WorkDrive REST API — Backend Engineering Reference

> Scope: Zoho WorkDrive API v1. All endpoints are relative to `https://www.zohoapis.com/workdrive/api/v1`. Authentication on every call: header `Authorization: Zoho-oauthtoken <access_token>`. Header `Accept: application/vnd.api+json` is recommended.

---

## 1. Authentication & Scopes

- **OAuth 2.0**: Authorization-code grant. Access token valid for 1 hour.
- **Scopes**: `WorkDrive.workspace.ALL`, `WorkDrive.teamfolders.ALL`, `WorkDrive.files.ALL`, `WorkDrive.users.ALL`, `WorkDrive.settings.ALL`.
- **Multi-DC**: Domain matches the user's DC (`.com`, `.eu`, `.in`, `.com.au`, `.jp`, `zohocloud.ca`).

---

## 2. Team Folders

### 2.1 List Team Folders
```
GET /teamfolders
```
Returns a list of all team folders the authenticated user is a part of.

### 2.2 Get Team Folder Details
```
GET /teamfolders/{team_folder_id}
```
Returns the metadata for a specific team folder.

### 2.3 Create a Team Folder
```
POST /teamfolders
```
**Body (JSON API format):**
```json
{
  "data": {
    "attributes": {
      "name": "Project Alpha",
      "description": "All files for Project Alpha",
      "is_public": true
    },
    "type": "teamfolders"
  }
}
```

---

## 3. Files and Folders

### 3.1 List Files inside a Folder
```
GET /files/{folder_id}/files
```
Returns children (files and subfolders) inside a given `folder_id` (this can be a team folder ID or a regular folder ID).

### 3.2 Get File/Folder Details
```
GET /files/{file_id}
```

### 3.3 Create a Folder
```
POST /files
```
**Body:**
```json
{
  "data": {
    "attributes": {
      "name": "New Subfolder",
      "parent_id": "{parent_folder_id}"
    },
    "type": "files"
  }
}
```

### 3.4 Rename/Move File or Folder
```
PATCH /files/{file_id}
```
**Body to rename:**
```json
{
  "data": {
    "attributes": {
      "name": "Updated_Name.pdf"
    },
    "type": "files"
  }
}
```
**Body to move:**
```json
{
  "data": {
    "attributes": {
      "parent_id": "{new_parent_folder_id}"
    },
    "type": "files"
  }
}
```

### 3.5 Delete File or Folder (Move to Trash)
```
PATCH /files/{file_id}
```
**Body to delete:**
```json
{
  "data": {
    "attributes": {
      "status": "51"
    },
    "type": "files"
  }
}
```
*(Status 51 moves it to trash).*

---

## 4. Upload and Download

### 4.1 Upload a File
```
POST /upload
```
This is a `multipart/form-data` request.
**Headers:**
- `Authorization: Zoho-oauthtoken <token>`
**Fields:**
- `filename`: The name of the file (e.g. `report.pdf`)
- `parent_id`: The ID of the folder where the file will be uploaded.
- `override-name-exist`: `true` to overwrite, `false` to keep both (adds a suffix).
- `content`: The file content binary.

### 4.2 Download a File
```
GET /download/{file_id}
```
Returns the raw binary content of the file.

---

## 5. Sharing and Permissions

### 5.1 Create a Share Link (External Sharing)
```
POST /files/{file_id}/links
```
**Body:**
```json
{
  "data": {
    "attributes": {
      "role_id": "14",
      "link_name": "Public Link"
    },
    "type": "links"
  }
}
```
*(role_id 14 = view, 13 = view and download, 33 = edit)*

### 5.2 Add Members to a Team Folder
```
POST /teamfolders/{team_folder_id}/members
```
**Body:**
```json
{
  "data": [
    {
      "attributes": {
        "email": "user@example.com",
        "role_id": "12"
      },
      "type": "members"
    }
  ]
}
```
*(role_id: 10 = Admin, 11 = Organizer, 12 = Editor, 13 = Viewer)*

---

## 6. Rate Limits & Errors

- **Rate Limits**: Governed by the organization's plan (Free, Starter, Team, Business). Standard OAuth API limits apply per user/org.
- **Response Format**: Uses JSON API standard (`"data"`, `"attributes"`, `"type"`).
- **Error Codes**:
  - `400 Bad Request` (Invalid payload)
  - `401 Unauthorized` (Invalid/expired token)
  - `404 Not Found` (File or folder does not exist)
  - `429 Too Many Requests` (Rate limit hit)
