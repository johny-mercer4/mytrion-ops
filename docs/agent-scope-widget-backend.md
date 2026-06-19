# Backend brief — Agent Scope Widget (Zoho)

> Hand this file to the Zoho widget developer's Claude Code session. It is the complete
> backend contract for the **Agent Scope** widget. You are building **only the Zoho widget
> frontend**; the backend below already exists and is deployed.

## What you're building

A Zoho (Admin Console) widget that lets an admin:

1. **Upload knowledge files** (mainly `.md`, also `.txt`/`.json`/plain text) — they get chunked,
   embedded, and stored in a pgvector knowledge base ("training" the AI).
2. **See the embedded knowledge** — list ingested documents, view their status/chunk counts,
   and inspect the individual embedded chunks.

That's the whole scope of this widget: **upload + view**. (Chat, tools, etc. are other widgets.)

## The backend

- **Service**: "Mytrion Ops" — an internal AI engine (Fastify, TypeScript). Single-tenant,
  no user accounts. All endpoints are versioned under `/v1`.
- **Base URL**: `https://<MYTRION_OPS_HOST>` (production, on Render) or `http://localhost:3001` (dev).
  Get the exact host from the backend owner.
- **Content type**: JSON everywhere except `/knowledge/upload`, which is `multipart/form-data`.

## Authentication

Every `/v1/knowledge/*` endpoint requires the static **API key**. Send it as **either**:

```
Authorization: Bearer <API_KEY>
```
or
```
x-api-key: <API_KEY>
```

- The key is a **server secret** supplied out-of-band by the backend owner — **never hardcode it
  in client-side widget JS** (anyone could read it). In a Zoho widget, keep it server-side: use a
  Zoho **Connection**/credential or a thin proxy (e.g. a Catalyst/serverless function) that injects
  the header. The browser should talk to that proxy, not hold the key.
- Missing/blank key → `401`. Wrong key → `401`. (`503` means the server itself has no key configured.)

## RBAC: `department_access`

Knowledge is segmented by a single tag called **`department_access`** — a department name
**or any unique key** (e.g. a Zoho user id or carrier id). It's just a string.

- On **upload/ingest** you may pass a `department` for the doc. Omit/blank → the doc is
  **Global/shared** (visible to every scope).
- This admin widget can **see all docs** regardless of department — listing is not
  department-filtered (you may optionally filter with `?department=`).

### Canonical keys (free-string, not an enforced allowlist)

The backend **accepts any string** and does **not** reject unknown values. The well-known keys:

| `department_access` | Scope |
| :--- | :--- |
| `sales` | Sales |
| `billing` | Billing & Accounting |
| `verification` | Verification |
| `maintenance` | Maintenance |
| `customer-service` | Customer Service |
| `finance` | Finance |
| `c-level` | C-Level / Executives |
| `management` | Management |
| *(omitted/blank)* | **Global / shared** |

### Confirmed RBAC behavior (answers to the request brief)

1. **Allowlist vs free string** — **free string**, with **normalization**. The backend trims +
   lowercases every tag on **both** ingest and query (`"  Finance "` → `finance`, `"C-Level"` →
   `c-level`), so values can't drift. Send the keys above as written (lowercase-hyphenated) and
   they match. Unknown values are stored as-is (normalized).
2. **Global semantics** — confirmed: a blank/omitted `department_access` is **always included** in
   every scoped query result. Global is visible to all keys.
3. **Query scoping source of truth** — the **caller supplies** the allowed keys per request
   (`departmentAccess[]`, or `allDepartments: true`). The backend does not derive them from an
   identity (there are no user accounts). This admin widget sends `allDepartments: true`.
4. **Elevated/hierarchical roles** (`c-level` / `management` / `finance`) — **DECIDED: no
   server-side hierarchy.** These are ordinary department keys: a scoped query sees exactly the
   keys it passes **plus Global**. There is **no implicit cross-department expansion**. To grant
   broader visibility:
   - **See everything** → send a `profile` containing `Administrator` (or `allDepartments: true`).
   - **Partial elevation** → the caller passes multiple keys, e.g. `departmentAccess: ["finance","billing"]`.
   The same rule governs RAG and tools (one flag). For this admin widget it's moot (`allDepartments: true`).
5. **Constraints** — case-insensitive (normalized to lowercase); any characters allowed; at most
   **50** keys per `departmentAccess[]`; each key ≤ 60 chars.

## Endpoints

### 1. Upload files → ingest  `POST /v1/knowledge/upload`
`multipart/form-data`. One or more **file** parts + an optional **`department`** text field.

- Accepts: `.md`, `.markdown`, `.txt`, `.text`, `.json`, or any `text/*` mime. Other types → `415`.
- Limits: ≤ **10 MB** per file, ≤ **20 files** per request.
- All files in one request get the same `department`.

Response `200`:
```json
{
  "department": "sales",
  "uploaded": [
    { "filename": "refund-policy.md", "docId": "abc123", "chunkCount": 7, "status": "ready" }
  ]
}
```
`status` is `"ready"` (embedded) or `"skipped"` (identical content already ingested — idempotent by checksum).

### 2. Ingest raw text  `POST /v1/knowledge/embed`
JSON alternative to file upload (e.g. paste-in editor):
```json
{ "title": "Refund policy", "content": "# Refunds...", "department": "sales", "source": "widget", "mimeType": "text/markdown" }
```
Response: `{ "docId": "abc123", "chunkCount": 7, "status": "ready" }`.

### 3. List ingested docs  `GET /v1/knowledge/docs`
Query params (all optional): `limit` (1–200, default 50), `offset` (≥0), `department` (filter).
Response `200`:
```json
{
  "docs": [
    {
      "id": "abc123",
      "title": "refund-policy.md",
      "departmentAccess": "sales",
      "source": "upload:refund-policy.md",
      "mimeType": "text/markdown",
      "status": "ready",
      "chunkCount": 7,
      "checksum": "…",
      "error": null,
      "createdAt": "2026-06-05T…Z",
      "updatedAt": "2026-06-05T…Z"
    }
  ]
}
```

### 4. Knowledge totals  `GET /v1/knowledge/stats`
For the widget header. Response: `{ "docs": 12, "chunks": 480 }`.

### 5. One doc  `GET /v1/knowledge/docs/:id`
Response: `{ "doc": { …same shape as a list item… } }`. Unknown id → `404`.

### 6. A doc's embedded chunks  `GET /v1/knowledge/docs/:id/chunks`
This is "see the embedded knowledge vector files." Query: `limit` (1–500, default 50), `offset`.
The raw 1536-float embedding is **not** returned (too large); `hasEmbedding` tells you a vector is stored.
```json
{
  "docId": "abc123",
  "chunks": [
    { "id": "ch_1", "chunkIndex": 0, "content": "Refunds are issued within 30 days…", "tokenCount": 142, "departmentAccess": "sales", "hasEmbedding": true }
  ]
}
```

### 7. Delete a doc (cascade)  `DELETE /v1/knowledge/docs/:id`
Removes the doc **and all its chunks/embeddings**. Because the doc row (incl. its checksum) is
hard-deleted, **re-uploading the same file re-ingests fresh** (`status: "ready"`, not `"skipped"`).
- **POST alias** (Zoho proxy can't always DELETE): `POST /v1/knowledge/docs/:id/delete` — identical.
- Unknown id → `404 NOT_FOUND`. Admin key may delete any doc (not department-scoped).
- `GET /v1/knowledge/stats` reflects the lower counts immediately after.
```json
{ "deleted": { "id": "abc123", "title": "refund-policy.md", "chunkCount": 7 } }
```

### 8. Bulk delete  `POST /v1/knowledge/docs/delete`
Body: `{ "ids": ["abc123","def456"] }` (1–100 ids). Per-id cascade; missing ids are reported, not fatal.
```json
{ "deleted": [ { "id": "abc123", "title": "refund-policy.md", "chunkCount": 7 } ], "notFound": ["def456"] }
```

### 9. (Optional) Test retrieval  `POST /v1/knowledge/query`
Useful to verify embeddings work. Body: `{ "query": "refund window", "limit": 6, "departmentAccess": ["sales"], "allDepartments": false }`.
Response: `{ "passages": [{ "id", "docId", "chunkIndex", "content", "score" }] }`.
`allDepartments: true` ignores department scoping (sees everything).

## Error shape

All errors are JSON:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…" } }
```
Codes you'll see: `AUTH_ERROR` (401), `VALIDATION_ERROR` (400), `NOT_FOUND` (404),
`UNSUPPORTED_MEDIA_TYPE` (415), `FEATURE_DISABLED` (503), `NO_FILES` (400).

## CORS

If the widget calls the API **directly from the browser**, the backend must allow the widget's
origin (backend `CORS_ORIGINS`). Tell the backend owner your origin (e.g. the Zoho widget domain).
If you call via a **server-side proxy** (recommended, see Auth), CORS doesn't apply.

## Example (through your server-side proxy)

```js
// Upload an .md tagged to a department
const fd = new FormData();
fd.append("file", mdBlob, "refund-policy.md");
fd.append("department", "sales");
await fetch(`${BASE}/v1/knowledge/upload`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}` }, // injected server-side
  body: fd,
});

// List + inspect
const { docs } = await (await fetch(`${BASE}/v1/knowledge/docs`, { headers: auth })).json();
const { chunks } = await (await fetch(`${BASE}/v1/knowledge/docs/${docs[0].id}/chunks`, { headers: auth })).json();
```

## Out of scope / notes

- No user login, no roles — the API key **is** the access. Single org.
- No delete endpoint yet — ask the backend owner if the widget needs to remove docs.
- Re-uploading identical content is a no-op (`status: "skipped"`), so an "upload" button is safe to retry.
