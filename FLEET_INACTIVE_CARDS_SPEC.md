# Spec: Fleet ro'yxatida BARCHA kartalar, link faqat aktivlarga

> Parallel Claude Code sessiyasi uchun — u hozir `dwhCards.ts` / `inviteService.ts` /
> `carrierMiniApp.routes.ts` ustida ishlayapti, shu fayllarga tegishli. App.tsx'dagi so'nggi
> holat: ProfileSheet fix + BackButton wiring + index.html theme pre-paint allaqachon tree'da.

**Talab (feedback):** owner (company auth) driver registratsiya qilayotganda kartalar ro'yxati
TO'LIQ ko'rinsin (inaktivlar ham), lekin invite-link faqat AKTIV kartalar uchun generatsiya
qilinsin.

**Muhim fakt:** server tomonda enforcement ALLAQACHON bor — `inviteService.assertDriverCardAvailable`
→ `isActiveCardOfCarrier` inaktiv kartaga `400 CARD_NOT_ACTIVE` qaytaradi. Ya'ni bu UI/ro'yxat
masalasi, xavfsizlik teshigi emas. Qilinadigan ish:

## 1. `src/integrations/dwhCards.ts`

`listDwhCards` hozir `where is_active = true` bilan cheklangan. Variant qo'shish (mavjud
chaqiruvchilarni buzmasdan):

```ts
export interface DwhCardWithStatus extends DwhCard {
  isActive: boolean;
}

/** ALL current cards of a carrier — active AND inactive — with the flag surfaced. The fleet
 *  screen lists everything (the owner must SEE inactive cards), while invite generation stays
 *  active-only (assertDriverCardAvailable enforces it server-side). */
export async function listDwhCardsAll(carrierId: string, limit = FLEET_CARD_LIMIT): Promise<DwhCardWithStatus[]>
```
SQL: hozirgi select + `is_active` ustuni, `where`dan `is_active = true` olib tashlanadi,
`order by is_active desc, card_number` (aktivlar tepada).

## 2. `src/routes/v1/carrierMiniApp.routes.ts` — `/carrier/mini-app/fleet`

- `listDwhCards(carrierId, FLEET_CARD_LIMIT)` → `listDwhCardsAll(carrierId, FLEET_CARD_LIMIT)`
- Fleet mapping'iga `cardActive: card.isActive` maydoni qo'shiladi.
- Inaktiv karta uchun `status` hisoblanishi o'zgarmaydi (registered/pending bo'lishi mumkin —
  eski driver bog'langan bo'lsa ko'rinaversin), lekin `link`/`expiresAt` inaktivda doim `null`.

## 3. `/carrier/mini-app/driver-invites` route'ida hech narsa o'zgarmaydi
(`createCarrierInvite` → `CARD_NOT_ACTIVE` allaqachon rad etadi). Xohlasa xatoni foydalanuvchiga
chiroyliroq surface qilish uchun frontend catch kifoya.

## 4. Frontend — `apps/mini-app/src/lib/api.ts` + `App.tsx` FleetView

- `FleetCard` interfeysiga `cardActive?: boolean`.
- `fleetRow`/render: `cardActive === false` bo'lsa qator xira (opacity .55) + kichik "Inactive"
  badge (`--muted-fg` rangda; i18n: `fleet.inactive` en/ru/uz/es).
- "Generate link" / "Invite driver" tugmasi inaktiv kartada disabled + bosilganda toast:
  `fleet.inactiveNoInvite` ("Bu karta aktiv emas — link faqat aktiv kartalar uchun").
- Filter chiplar soni (`FILTERS` countlari) aktiv/inaktivni qanday sanashini tekshirib moslash —
  "Open" chip'i inaktivlarni sanamasligi kerak.

## 5. Test (tests/unit/carrier-mini-app.test.ts)

- fleet: inaktiv karta ro'yxatda `cardActive: false` bilan keladi, `link: null`.
- driver-invite inaktiv kartaga → `400 CARD_NOT_ACTIVE` (mavjud xato oqimi assert).
