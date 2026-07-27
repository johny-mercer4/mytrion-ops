# Rejection Report → Mytrion webhook (Zoho Desk Deluge)

Drop-in addition to the existing "create the rejection ticket" Deluge function. It mirrors every
ticket into `mytrion_rejection_reports` so Sales → Data Center → Rejection Reports can show each
agent their own declines (the tab no longer scans Desk tickets).

## 1. Set the secret in Render

Add to the `octane-assistant-secrets` env group and redeploy:

```
REJECTION_WEBHOOK_SECRET=163f27e83dabb2edd280170e439cdefb5f928bff60f696fceb2836f5c3371d60
```

Until it is set the endpoint answers `503` and the Deluge's `catch` below swallows it — ticket
creation is never affected, you just get no rows.

## 2. Paste this into the Deluge

Insert it **immediately after** the existing line:

```javascript
createResponse = zoho.desk.create("871305344","tickets",ticketObject);
```

…and before the three `resultMap.put(...)` calls. It is wrapped in its own `try/catch` on purpose:
a webhook problem must never fail or roll back the ticket.

```javascript
// ---- Mirror the rejection into Mytrion Ops (mytrion_rejection_reports) ----
// Wrapped separately so a webhook failure can never break ticket creation.
try
{
	rejectionPayload = Map();
	rejectionPayload.put("ticketId",createResponse.get("id"));
	rejectionPayload.put("errorCode",errorCode);
	rejectionPayload.put("errorDescription",errorDescription);
	rejectionPayload.put("carrierId",carrierId);
	rejectionPayload.put("companyName",companyName);
	rejectionPayload.put("cardNumber",cardNumber);
	rejectionPayload.put("driverName",driverName);
	rejectionPayload.put("driverId",driverId);
	rejectionPayload.put("unitNumber",unitNumber);
	rejectionPayload.put("locationName",locationName);
	rejectionPayload.put("locationCity",locationCity);
	rejectionPayload.put("state",state);
	rejectionPayload.put("stationName",stationName);
	rejectionPayload.put("isNetwork",isNetwork);
	rejectionPayload.put("isFraud",isFraud);
	rejectionPayload.put("paymentType",paymentType);
	rejectionPayload.put("automatedResponse",responseSmsMessage);
	rejectionPayload.put("createdTime",zoho.currenttime.toString("yyyy-MM-dd HH:mm:ss"));
	rejectionHeaders = Map();
	rejectionHeaders.put("Content-Type","application/json");
	rejectionHeaders.put("x-rejection-secret","163f27e83dabb2edd280170e439cdefb5f928bff60f696fceb2836f5c3371d60");
	rejectionResponse = invokeurl
	[
		url :"https://octane-ops-ai.onrender.com/v1/rejection-reports/webhook"
		type :POST
		parameters:rejectionPayload.toString()
		headers:rejectionHeaders
	];
	info "mytrion rejection webhook: " + rejectionResponse.toString();
}
catch (webhookError)
{
	// Never rethrow — the Desk ticket is already created and is the source of record for the agent.
	info "mytrion rejection webhook failed: " + webhookError.toString();
}
```

## 3. What each field does

| Deluge variable | Column | Notes |
|---|---|---|
| `createResponse.get("id")` | `zoho_ticket_id` | **Idempotency key.** A retry updates nothing and returns the original row. |
| `errorCode` | `error_code` | Required. 12 / 17 / 18 / 25 / 3 / 787. |
| `carrierId` | `carrier_id` | Required — this is what resolves the owning agent. |
| `cardNumber` | `card_number` + `card_last4` | Last 4 derived on write; the full value never goes back out over the list API and is never audited. |
| `isNetwork`, `isFraud`, `paymentType` | same | The branch flags, so the SMS the automation chose stays explainable. |
| `responseSmsMessage` | `automated_response` | The exact text sent to the driver. |
| `zoho.currenttime` | `occurred_at` | Naive `yyyy-MM-dd HH:mm:ss`, parsed as UTC. |

`applicationId` is also accepted if you ever have it in scope — it is optional.

## 4. Ownership

The webhook resolves the owning Sales agent from `carrier_id` against `octane.dim_company` and stores
both `agent_zoho_user_id` and `agent_name`. Both are kept because a worker's session Zoho id and the
warehouse's `agent_zoho_user_id` carry different org prefixes — the list endpoint therefore matches
id-**or**-name, the same way `dwhClientRoster.buildOwnedCte` does for the Clients roster.

A carrier with no agent in the warehouse is **not dropped**: it is stored with
`owner_source = 'unresolved'` and is visible to admins (and via `rejectionReportRepo.listUnassigned`)
so it can be triaged rather than lost.

## 5. Verifying

```bash
curl -sS -X POST https://octane-ops-ai.onrender.com/v1/rejection-reports/webhook \
  -H 'content-type: application/json' \
  -H 'x-rejection-secret: 163f27e83dabb2edd280170e439cdefb5f928bff60f696fceb2836f5c3371d60' \
  -d '{"ticketId":"smoke-1","errorCode":"25","carrierId":"5806565","companyName":"SMOKE TEST","createdTime":"2026-07-27 12:00:00"}'
```

Expect `201 {"id":"mrr_…","ownerSource":"dim_company"}`. Posting the same `ticketId` again returns the
same `id` — that is the idempotency working, not a duplicate. Then open Sales → Data Center →
Rejection Reports as the agent who owns carrier 5806565.
