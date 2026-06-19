# Backend brief — Automation Logs (Zoho widget → Mytrion Ops)

> For the front-end dev. One endpoint: log an automation trigger into the Mytrion Ops DB.

## Endpoint

`POST https://<MYTRION_OPS_API_URL>/v1/automation/logs`

**Auth:** header `x-api-key: <API_KEY>` (or `Authorization: Bearer <API_KEY>`). The key is a
server secret — inject it server-side (Zoho Connection / proxy), never in client JS.

**Body (JSON):**

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| `automationType` | string | ✅ | What ran (e.g. `"deal_followup"`, `"welcome_email"`). |
| `agentName` | string | optional | The agent the automation ran for / by. |
| `triggerTime` | string | optional | Stored as-sent (e.g. `"14:30:00"` or `"2:30 PM"`). |
| `triggerDate` | string | optional | Stored as-sent (e.g. `"2026-06-19"`). |

```json
{ "automationType": "deal_followup", "agentName": "Jane Operator", "triggerTime": "14:30:00", "triggerDate": "2026-06-19" }
```

**Response `200`:**
```json
{ "id": "ckp...", "createdAt": "2026-06-19T17:40:00.000Z" }
```
`createdAt` is the authoritative server insert time (always recorded); `triggerTime`/`triggerDate`
are your supplied values, stored verbatim.

**Errors:** `401` (`AUTH_ERROR`) bad/missing key · `400` (`VALIDATION_ERROR`) missing `automationType`
or a field over its length limit. Shape: `{ "error": { "code": "...", "message": "..." } }`.

## Example (through a server-side proxy)
```js
await fetch(`${BASE}/v1/automation/logs`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": API_KEY }, // injected server-side
  body: JSON.stringify({ automationType, agentName, triggerTime, triggerDate }),
});
```

## Notes
- Fire-and-forget is fine; the response just confirms the row id.
- It's a plain insert into `automation_logs` (single-tenant). No read/list endpoint yet — ask if you need one.
