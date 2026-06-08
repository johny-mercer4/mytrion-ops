# Backend brief — AI Chat Widget (Zoho)

> Hand this to the Zoho chat widget developer's Claude Code session. It's the complete
> backend contract for the **streaming AI chat** endpoint. You build the widget frontend;
> the backend below already exists.

## What it does

A streaming chat assistant for Mytrion Ops. Every turn it **first searches the pgvector
knowledge base** (RBAC-scoped to the caller's department) and answers grounded in what it
finds. Responses stream token-by-token over SSE.

## Auth

- Header **`x-api-key: <API_KEY>`** (or `Authorization: Bearer <API_KEY>`).
- The key is a **server secret** — **never put it in client-side widget JS**. Call through a
  Zoho server-side proxy (Connection / Catalyst function) that injects the header; the browser
  talks to the proxy.
- **Exception for live streaming:** true SSE needs a *direct* browser `fetch` (Zoho's proxy
  buffers and breaks streaming). For `/v1/chat/stream` the backend allows the widget origin via
  CORS (any `https://*.zappsusercontent.com`, reflected — not `*`), accepting `x-api-key`,
  `Authorization`, `Content-Type`. If you must avoid exposing the key in the browser, fall back to
  the buffered proxy path (`POST /v1/chat`); the live-streaming UX is the only thing lost.

## Base URL

`https://<MYTRION_OPS_API_URL>/v1` — get the exact host from the backend owner.

## Endpoints

### Streaming — `POST /v1/chat/stream`  (Server-Sent Events)

Request body (JSON):

| Field | Type | Required | Meaning |
| :--- | :--- | :--- | :--- |
| `message` | string | ✅ | The user's message (≤ 8000 chars). |
| `zoho_user_id` | string | recommended | Identifies the caller; conversation history is grouped per user. |
| `user_name` | string | fallback | Display name; used if `zoho_user_id` is absent, and to personalize replies. |
| `department_scope` | string \| string[] | recommended | The caller's department key(s) for RBAC (e.g. `"sales"` or `["sales","finance"]`). Scopes which knowledge the answer can use. |
| `profile` | string \| string[] | recommended | The caller's Zoho **profile**. If it contains **`Administrator`** (case-insensitive), the caller **bypasses all RBAC** — sees every department's knowledge (and, once enabled, every tool). |
| `role` | string \| string[] | optional | The caller's Zoho **role** — recorded for audit; not used for access decisions yet. |
| `conversationId` | string | optional | Omit on the first turn; reuse the value returned in `start`/`done` for follow-ups. |
| `allDepartments` | boolean | optional | `true` = ignore department scoping (managers/admins see all knowledge). Default `false`. |
| `model` | string | optional | Override the model id (default is the server's `gpt-4o-mini`). |

```json
{
  "message": "What's our refund window?",
  "zoho_user_id": "1520000000041001",
  "user_name": "Jane Operator",
  "department_scope": "sales",
  "profile": "Standard",
  "role": "Sales Rep"
}
```

#### SSE response — event sequence

The endpoint returns `text/event-stream`. Events (each `event:` + `data:` JSON):

| `event` | `data` | When |
| :--- | :--- | :--- |
| `start` | `{ "conversationId": "…" }` | once, first — save this id for follow-ups |
| `status` | `{ "state": "retrieving" \| "thinking" \| "tool", "label": "Searching the knowledge base…" }` | repeated — drive the dynamic "Thinking / Searching / Reviewing N sources…" indicator |
| `context` | `{ "passages": 3 }` | how many RBAC-scoped knowledge passages grounded this turn |
| `token` | `{ "text": "…" }` | repeated — append to the visible answer |
| `tool_call` / `tool_result` | `{ "name": "…", … }` | only once tool-calling is enabled (ignore for now) |
| `done` | `{ "conversationId", "message", "ragPassages", "usage", "iterations" }` | once, last — `message` is the full final text |
| `error` | `{ "message": "…" }` | on failure (stream then closes) |

**Dynamic status indicator.** Use `status` events to replace a plain spinner with live, truthful
stages. `state` is the stable machine value (`retrieving` → `thinking`/`tool`); `label` is a
ready-to-show string (e.g. *"Searching the knowledge base…"*, *"Reviewing 3 sources…"*,
*"Thinking…"*, *"Using knowledge.search…"*). Show the latest `label` until the first `token`
arrives, then switch to rendering the answer. (These come straight from the backend pipeline — no
extra model call.)

#### Consuming SSE from a POST (important)

The browser `EventSource` API only does GET, so use `fetch` + a stream reader:

```js
const res = await fetch(`${BASE}/v1/chat/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": API_KEY }, // injected server-side
  body: JSON.stringify({
    message,
    zoho_user_id: zohoUserId,
    user_name: userName,
    department_scope: departmentScope,   // "sales" | ["sales","finance"]
    conversationId,                      // omit on first turn
  }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\n\n");          // SSE frames are separated by a blank line
  buffer = frames.pop() ?? "";
  for (const frame of frames) {
    const ev = frame.match(/^event: (.*)$/m)?.[1];
    const data = JSON.parse(frame.match(/^data: (.*)$/m)?.[1] ?? "{}");
    if (ev === "start") conversationId = data.conversationId;
    else if (ev === "status") setStatus(data.label);     // e.g. "Searching the knowledge base…"
    else if (ev === "token") { clearStatus(); appendToBubble(data.text); }
    else if (ev === "done") finalize(data.message);
    else if (ev === "error") showError(data.message);
  }
}
```

### Non-streaming — `POST /v1/chat`

Same body; returns the whole result as JSON (no SSE) — handy for testing:
```json
{ "conversationId": "…", "message": "Refunds are issued within 30 days…", "toolCalls": [], "ragPassages": 3, "usage": { "promptTokens": 812, "completionTokens": 96, "totalCost": 0.0002 }, "iterations": 1 }
```

### History (optional)
- `GET /v1/chat/conversations?zohoUserId=<id>` → the user's conversations.
- `GET /v1/chat/conversations/:id/messages?zohoUserId=<id>` → messages in a conversation.

## RBAC / `department_scope`

- The answer is grounded **only** in knowledge the caller is allowed to see: documents tagged
  with one of the caller's `department_scope` keys, **plus** Global (untagged) documents.
- Keys are normalized (trim + lowercase) — send `"sales"`, `"finance"`, `"c-level"`, etc.
- `allDepartments: true` **or** a `profile` containing `Administrator` bypasses scoping entirely
  (sees all knowledge). The **same flag** governs tool access once tools are enabled — so an
  Administrator is unrestricted across RAG **and** tools, and a department user is confined to their
  scope (+ Global) for both. One rule, applied everywhere.
- The widget supplies identity/scope; the backend trusts it (no user accounts server-side).

## Errors

JSON shape on non-stream errors: `{ "error": { "code": "AUTH_ERROR", "message": "…" } }`.
On the stream, failures arrive as an `error` SSE event. `401` = bad/missing API key.

## Notes
- Conversation memory is automatic when you reuse `conversationId` (history is stored server-side,
  keyed to `zoho_user_id`).
- Tool calling (CRM/DWH/etc.) is **not enabled yet** — ignore `tool_call`/`tool_result` events for now.
