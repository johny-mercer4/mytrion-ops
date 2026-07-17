---
name: ringcentral-api
description: RingCentral API reference — REST API, authentication (OAuth, JWT), SDKs, Embeddable widget, WebRTC, Voice/SMS endpoints. Use when building or debugging RingCentral integrations in this repo.
---

# RingCentral API — skill

**Using this in Mytrion Ops (our codebase):**
- **Auth:** Standard RingCentral OAuth 2.0 (JWT for server-to-server or Authorization Code with PKCE for user-facing).
- **Base URL:** `https://platform.ringcentral.com` (for production) or `https://platform.devtest.ringcentral.com` (for sandbox).
- **Wiring:** Expose RingCentral capabilities (SMS, voice dialing, call logs) as `ToolManifest` tools dispatched through `toolDispatcher`.

---

# RingCentral REST API — Backend Engineering Reference

> Scope: RingCentral REST APIs, SDKs, and Embeddable widgets.
> Authentication: Header `Authorization: Bearer <access_token>`

## 1. Authentication & Scopes

- **OAuth 2.0 Flows**: 
  - **JWT Flow**: For server-to-server apps (no user UI).
  - **Authorization Code with PKCE**: For web/mobile apps with UI.
- **Token Endpoint**: `POST /restapi/oauth/token`
  - Needs `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` & `assertion=<JWT>` for JWT flow.
  - Returns `access_token`, `expires_in`, `refresh_token`.
- **Tilde (`~`) Shortcut**: In URLs, `~` refers to the authenticated user's `accountId` or `extensionId`. e.g., `/restapi/v1.0/account/~/extension/~`.

## 2. Core API Endpoints

### 2.1 SMS and MMS
```
POST /restapi/v1.0/account/~/extension/~/sms
```
**Body:**
```json
{
  "from": { "phoneNumber": "+15551234567" },
  "to": [ { "phoneNumber": "+15559876543" } ],
  "text": "Hello from RingCentral API!"
}
```

### 2.2 Call RingOut (Initiate a call)
```
POST /restapi/v1.0/account/~/extension/~/ring-out
```
**Body:**
```json
{
  "from": { "phoneNumber": "+15551234567" },
  "to": { "phoneNumber": "+15559876543" },
  "playPrompt": false
}
```

### 2.3 Call Logs
```
GET /restapi/v1.0/account/~/extension/~/call-log
```
Params: `view=Detailed`, `dateFrom`, `dateTo`, `page`, `perPage`.

### 2.4 Webhooks (Push Notifications)
```
POST /restapi/v1.0/subscription
```
Subscribe to events like `["/restapi/v1.0/account/~/extension/~/message-store"]`.

---

## 3. SDKs (Software Development Kits)

RingCentral provides official SDKs for major languages to simplify authentication and API requests:
- **JavaScript/Node.js:** `@ringcentral/sdk`
- **Python:** `ringcentral` (pip install ringcentral)
- **C#/.NET:** `RingCentral.Net`
- **PHP:** `ringcentral/ringcentral-php`
- **Ruby:** `ringcentral-ruby`

**Node.js Example:**
```javascript
const { SDK } = require('@ringcentral/sdk');
const rcsdk = new SDK({ server: 'https://platform.ringcentral.com', clientId: '...', clientSecret: '...' });
const platform = rcsdk.platform();
await platform.login({ jwt: 'YOUR_JWT' });
const resp = await platform.get('/restapi/v1.0/account/~/extension/~');
```

---

## 4. RingCentral Embeddable (Voice Widget)

**RingCentral Embeddable** provides a drop-in web softphone and messaging widget (built on WebRTC).

### 4.0 App registration (required — fixes OAU-113)

In [developers.ringcentral.com](https://developers.ringcentral.com/) → your app → **Auth**:

| Setting | Value |
|---|---|
| Auth flow | 3-legged OAuth (authorization code) |
| App type | Client-side web app (SPA / JavaScript) |
| **OAuth Redirect URI** | `https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html` |

This is **not** your Render/app URL. Embeddable hosts the OAuth callback.  
`invalid_client` / **OAU-113** (“No redirect URI is registered”) means that field is empty — add the URI above and save.

Scopes typically needed for the softphone: **VoIP Calling**, **WebSocket Subscriptions** (plus any messaging scopes you use).

Mytrion Ops wires Embeddable via `GET /v1/ringcentral/embed-config` → `apps/mytrion-crm/.../RingCentralPhone.tsx` (adapter URL from `src/integrations/ringcentral.ts`).

### 4.1 Quick Integration
Inject the adapter into the DOM (requires HTTPS):
```html
<script>
  (function() {
    var rcs = document.createElement("script");
    rcs.src = "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js?clientId=YOUR_CLIENT_ID";
    var rcs0 = document.getElementsByTagName("script")[0];
    rcs0.parentNode.insertBefore(rcs, rcs0);
  })();
</script>
```

### 4.2 Interaction via JavaScript
The widget emits messages over the `window.postMessage` API, allowing your frontend to react to calls or dial numbers programmatically.

**Dialing a number:**
```javascript
document.querySelector("#rc-widget-adapter-frame").contentWindow.postMessage({
  type: 'rc-adapter-new-call',
  phoneNumber: '+15551234567',
  toCall: true
}, '*');
```

**Listening for Call Events:**
```javascript
window.addEventListener('message', (e) => {
  const data = e.data;
  if (data && data.type === 'rc-call-ring-notify') {
    console.log('Incoming call from:', data.call.from);
  }
});
```

### 4.3 Customization
- Supports passing `stylesUri` for custom CSS.
- Can pop out as a separate window.
- Can pre-fill contact lists by responding to `rc-adapter-contacts-request`.

---

## 5. Rate Limits

- Measured via headers: `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Window`.
- Returning `429 Too Many Requests` when limits are exceeded. Backoff using `Retry-After`.
- Limits are based on the endpoint group (Light, Medium, Heavy) and the app's tier.
