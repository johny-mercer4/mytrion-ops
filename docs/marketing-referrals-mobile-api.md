# Mobile API — Marketing Referrals (live calculation)

For mobile engineers. This is the keyed Octane endpoint that returns **one parent referrer’s** bonus for a date range. You do not need the CRM UI.

**Base URL:** `https://octane-ops-ai.onrender.com`

---

## Endpoint

```
GET https://octane-ops-ai.onrender.com/v1/marketing/referrals/live
```

| | |
| :--- | :--- |
| Method | `GET` |
| Auth | Static `API_KEY` (same key as other Octane machine APIs) |
| CRM workspace | Unchanged. This path is additive. |

---

## Auth

Send the server `API_KEY` on every request. Either header works:

```http
x-api-key: <API_KEY>
```

or

```http
Authorization: Bearer <API_KEY>
```

Do **not** put the key in the app binary or in query strings. Inject it from your backend / secrets store.

Missing or wrong key → `401` `{ "error": { "code": "AUTH_ERROR", "message": "..." } }`.

---

## Query parameters

All three are required.

| Param | Example | Notes |
| :--- | :--- | :--- |
| `referrer_id` | `REF-000322` | Zoho **Parent Referrer** `ReferrerId` (the human code, not the CRM record id). Exact match after trim. |
| `period_from` | `2026-07-01` | Inclusive start day (`YYYY-MM-DD`, real calendar date). |
| `period_to` | `2026-07-31` | Inclusive end day. Must be on or after `period_from`. |

Range cap: at most **12 calendar months** or **366 days**.

### Example request

```http
GET /v1/marketing/referrals/live?referrer_id=REF-000322&period_from=2026-07-01&period_to=2026-07-31
Host: octane-ops-ai.onrender.com
x-api-key: <API_KEY>
```

```bash
curl -sS \
  -H "x-api-key: $API_KEY" \
  "https://octane-ops-ai.onrender.com/v1/marketing/referrals/live?referrer_id=REF-000322&period_from=2026-07-01&period_to=2026-07-31"
```

---

## Success `200`

One parent, its child referrals, and one **row per measured carrier**. No pagination — a parent rarely has enough children to need it.

```json
{
  "referrerId": "REF-000322",
  "periodFrom": "2026-07-01",
  "periodTo": "2026-07-31",
  "generatedAt": "2026-08-18T00:12:00.000Z",
  "calculation": "Swipes (Legacy)",
  "calculationKey": "swipes_legacy",
  "bonusAmountUsd": "400.00",
  "payableAmountUsd": "400.00",
  "recurring": true,
  "rateUsd": 50,
  "thresholdGallons": null,
  "activity": {
    "kind": "swipes",
    "label": "New swipes",
    "value": 8
  },
  "parent": {
    "id": "zcrm_parent_id",
    "referrerId": "REF-000322",
    "name": "AL AZIZ EXPRESS INC",
    "company": "AL AZIZ EXPRESS INC"
  },
  "children": [
    { "id": "zcrm_child_id", "name": "Logixpress", "referrerId": "REF-000322" }
  ],
  "rows": [
    {
      "role": "child",
      "name": "Logixpress",
      "childId": "zcrm_child_id",
      "childName": "Logixpress",
      "dealId": "zcrm_deal_id",
      "dealName": "Logixpress",
      "carrierId": 5804841,
      "bonusAmountUsd": "100.00",
      "payableAmountUsd": "100.00",
      "periodGallons": 0,
      "periodSwipes": 2,
      "cumulativeGallons": 0,
      "state": "earned"
    },
    {
      "role": "parent_itself",
      "name": "AL AZIZ EXPRESS INC",
      "childId": "zcrm_child_id",
      "childName": "Logixpress",
      "dealId": "zcrm_deal_id",
      "dealName": "AL AZIZ EXPRESS INC",
      "carrierId": 5789458,
      "bonusAmountUsd": "300.00",
      "payableAmountUsd": "300.00",
      "periodGallons": 0,
      "periodSwipes": 6,
      "cumulativeGallons": 0,
      "state": "earned"
    }
  ]
}
```

### Fields you will render

| Field | Use |
| :--- | :--- |
| `bonusAmountUsd` | Total calculated bonus for the range (string, 2 decimals). |
| `activity` | The **one** number that matches this referrer’s calculation type. Use `activity.kind` + `activity.value` — do not pick swipes vs gallons yourself. |
| `calculation` / `calculationKey` | Which program this parent is on. |
| `rows[].role` | `"child"` = referred carrier / child deal. `"parent_itself"` = the parent’s own fleet. **Do not guess from names.** |
| `rows[].periodSwipes` / `periodGallons` / `cumulativeGallons` | Per-carrier breakdown. Still present on every row; `activity` is the rollup you should headline. |
| `children` | CRM child-referral records (may be empty if none are linked). |
| `state` | `tracking` · `earned` · `paid` |

`calculationKey` values: `swipes_legacy` · `gallons_legacy` · `gallons_parent` · `gallons_child`. `null` when Zoho `Calculation` is unset (`-None-`).

---

## Errors

Shape is always:

```json
{ "error": { "code": "AUTH_ERROR", "message": "Invalid or missing API key", "requestId": "…" } }
```

| HTTP | `error.code` | When |
| :--- | :--- | :--- |
| `401` | `AUTH_ERROR` | Missing / wrong `API_KEY`. |
| `400` | `VALIDATION_ERROR` | Missing `referrer_id`, missing `period_from`/`period_to`, impossible date (`2026-02-31`), `from` after `to`, or range longer than 12 months / 366 days. |
| `404` | `NOT_FOUND` | No Parent Referrer with that `ReferrerId`. |
| `500` | `INTERNAL_ERROR` | Unexpected server failure. Retry later. |
| `502` | `ZOHO_CRM_ERROR` | Zoho relationship read failed (rare; CRM graph is cached ~10 min). |

---

## Calculation context

Octane computes this server-side. Mobile should **display** the numbers, not reimplement the rules.

### What `referrer_id` is

Zoho Parent Referrers field **`ReferrerId`**, e.g. `REF-000322` (Al Aziz), `REF-000197` (YILKI). It is not a MART carrier id and not the Zoho record `id`.

### Date filter

`period_from` and `period_to` are **inclusive calendar days** (UTC dates, no time). Recurring bonuses still settle per calendar month; a partial month only counts fuel / first-use that landed on days inside the range.

### The four calculation types

Each parent has exactly one Zoho `Calculation` picklist value.

| `calculation` | `calculationKey` | Headline metric (`activity`) | Money |
| :--- | :--- | :--- | :--- |
| `Swipes (Legacy)` | `swipes_legacy` | New swipes (`activity.kind = "swipes"`) | **$50 per first-use card** in the window, monthly |
| `Gallons (Legacy)` | `gallons_legacy` | In Station gallons | **$0.01 per In Station gallon** in the window, monthly |
| `Gallons (Parent)` | `gallons_parent` | Cumulative gallons | **$50 once** when a target hits **500** cumulative gallons |
| `Gallons (Child)` | `gallons_child` | Cumulative gallons | **$50 once** when a target hits **1,000** cumulative gallons (pays the child) |

### First-use (legacy swipes)

A swipe is a **card’s first** eligible ULSD/ULSR fuel, ever. Counted when that first-use date falls inside `period_from`…`period_to`.

- Not “cards used this month”.
- Not transaction count.
- Station type does **not** apply to swipes.

**Parent fleet is included** for swipes: related child-deal carriers **plus** the parent company’s own unique MART carrier when `dim_company` has exactly one carrier for that name.

Al Aziz July example: Logixpress `5804841` = 2 new swipes (**Child**) + AL AZIZ EXPRESS INC `5789458` = 6 (**Parent Itself**) → `activity.value = 8`, `bonusAmountUsd = "400.00"`.

### In Station (legacy gallons)

Gallons (Legacy) sums **In Station** (`is_in_network`) ULSD/ULSR on **related Deal carriers only**. The parent’s own fleet is **not** added unless that fleet is itself a related Deal carrier.

YILKI-style example: three child deals’ In Station gallons, not YILKI LLC’s own carrier.

### Parent 500 / Child 1000

One-time awards on **cumulative** In Station gallons (ULSD / DSL / ULSR) through `period_to`. `thresholdGallons` is `500` or `1000`. `rows[].cumulativeGallons` is progress toward that threshold. `activity.value` is the sum of those cumulatives across rows.

### Parent Itself vs Child rows

| `rows[].role` | Meaning | Typical example |
| :--- | :--- | :--- |
| `child` | Referred carrier from a related Zoho Deal | Logixpress #5804841 |
| `parent_itself` | Parent’s own fleet, added only for **Swipes (Legacy)** | AL AZIZ EXPRESS INC #5789458 |

Use `role`. Do not compare `name` strings to decide which badge to show.

### Empty / setup cases

A known `referrer_id` still returns `200` with `rows: []` and `bonusAmountUsd: "0.00"` when Calculation is unset or no Deal / Carrier ID is linked. That is not a 404.
