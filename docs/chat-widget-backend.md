# Backend brief — AI Chat Widget (Zoho)

> Hand this to the Zoho chat widget developer's Claude Code session. It's the complete
> backend contract for the **streaming AI chat** endpoint. You build the widget frontend;
> the backend below already exists.

## What it does

A streaming chat assistant for Mytrion Ops — and the **single, unified entry point** for the
widget. Every turn it **first searches the pgvector knowledge base** (RBAC-scoped) and can also
**call tools** into our systems (e.g. look up Zoho People employees) when the user's message calls
for it. Responses stream token-by-token over SSE; tool activity surfaces as `status`/`tool_call`/
`tool_result` events (see below).

**There is no separate per-feature endpoint.** The widget always sends a chat message + the caller's
Zoho context to `/v1/chat/stream`; the assistant decides whether to answer from knowledge, call a
tool, or both. New capabilities (more tools) light up here automatically — the widget contract does
not change.

> **Always send the Zoho context** (`zoho_user_id`, `user_name`, `profile`, `role`,
> `department_scope`) on **every** call — it drives RBAC (what knowledge/tools the caller may use),
> ownership scoping for sales agents, and personalization. Treat it as required.

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
| `tool_call` | `{ "name": "zoho_people.search_employees" }` | the assistant invoked a tool (optional: show "Looking up…") |
| `tool_result` | `{ "name": "…", "status": "ok" \| "error" \| "denied" }` | that tool finished. The data is **not** in this event — the assistant uses it and continues streaming `token`s with the answer. |
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
    // Zoho context — ALWAYS send all of these (from the widget's onLoad user context):
    zoho_user_id: zohoUserId,
    user_name: userName,
    profile: userProfile,                // e.g. "Administrator" → unrestricted; else scoped
    role: userRole,
    department_scope: departmentScope,   // "sales" | ["sales","finance"]
    conversationId,                      // omit on first turn; reuse from `start`/`done`
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

## Tools / actions (live)

The assistant calls these automatically when the message warrants it — **the widget does nothing
special**, it just chats. Tool access obeys the same RBAC as knowledge (`Administrator` profile →
all; otherwise department-scoped).

| Tool | Fires when the user asks… | Honors |
| :--- | :--- | :--- |
| `zoho_people.search_employees` | "list all employees", "who's in the Sales department", "find employee Jane Doe" | Zoho People (employees by all / name / department) |

Front-end handling: just render the `status` label (e.g. *"Using zoho_people.search_employees…"*)
while the tool runs, then the streamed `token`s contain the assistant's answer (it summarizes the
tool's data for you). You don't parse tool data yourself. More tools will appear here over time with
**no widget change**.

Example: user types *"Who works in Verification?"* → stream: `start` → `status`(retrieving) →
`context` → `status`(tool, "Using zoho_people.search_employees…") → `tool_call` → `tool_result` →
`token`…(the answer) → `done`.

## RBAC / `department_scope`

- The answer is grounded **only** in knowledge the caller is allowed to see: documents tagged
  with one of the caller's `department_scope` keys, **plus** Global (untagged) documents.
- Keys are normalized (trim + lowercase) — send `"sales"`, `"finance"`, `"c-level"`, etc.
- `allDepartments: true` **or** a `profile` containing `Administrator` bypasses scoping entirely
  (sees all knowledge). The **same flag** governs **tool access** — so an Administrator is
  unrestricted across RAG **and** tools, and a department user is confined to their scope (+ Global)
  for both. One rule, applied everywhere.
- The widget supplies identity/scope; the backend trusts it (no user accounts server-side).

## Errors

JSON shape on non-stream errors: `{ "error": { "code": "AUTH_ERROR", "message": "…" } }`.
On the stream, failures arrive as an `error` SSE event. `401` = bad/missing API key.

## Notes
- Conversation memory is automatic when you reuse `conversationId` (history is stored server-side,
  keyed to `zoho_user_id`).
- **Tool calling is live** (see Tools / actions). The widget renders `status`/`tool_call`/
  `tool_result` for UX but never needs to parse tool data — the answer arrives as `token`s. More
  tools (CRM, DWH, Desk, …) will be added behind this same unified endpoint with no widget change.
