
### 2026-07-20 — PIN/Unit tahriri, sheet-kesh, copy tugma, tarjima tuzatishlar

- /card/info: endi DRIVER ham o'z kartasida unitNumber+driverId (=pump PIN prompt) o'zgartiradi;
  driverName owner-only (DRIVER_NAME_OWNER_ONLY 403). Testlar mos yangilandi (403-loop'dan chiqdi,
  2 yangi test). cardId schema'da optional (driver yubormaydi).
- pinunit sheet: Unit + Driver ID endi TAHRIRLANADIGAN, Save (dirty-check bilan); saqlashda
  pinunit/cardops/status keshlari invalidatsiya.
- Sheet-kesh: 60s TTL modul-darajali SHEET_CACHE — har ochilishdagi spinner yo'qoldi; txns fast
  fazasi keshdan chiqib live-merge'ga baribir boradi; mutatsiyalar o'z kalitlarini o'chiradi.
- manualcode: Copy tugma; svc.manualcode kaliti 4 tilda yo'q edi — qo'shildi (xom kalit ko'rinardi).
- Missing-key skaner ishlatildi: boshqa yetishmayotgan kalit topilmadi.
