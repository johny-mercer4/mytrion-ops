# Handoff: Notification tizimi — 2-bosqich (limit/receipt/statement + approval)

> Claude Code uchun. Ishlashdan oldin WORKING_NOTES.md dagi 2026-07-20 yozuvlarini va
> Analitika/notification_system_ultraplan.md ni o'qi. Bu hujjat NIMA qilishni, mavjud kod
> QAYERDA ekanini va buzib bo'lmaydigan invariantlarni beradi.

## HOLAT (2026-07-21 — oxirgi sessiya) — keyingi promt shu yerdan davom etsin

- **T1 limit poller — DEFER.** Per-card kunlik gallon limiti hech qayerda o'qilmaydi (servercrm
  getCards={card_number,status} / `/efs`=status,unit,driver / limits GET yo'q; DWH `dim_card`da
  gallon cap yo'q, faqat carrier `credit_limit` $). Yo'llar: configured threshold (env) YOKI
  servercrm'ga yangi EFS-policy read endpoint. Owner qaror qilmaguncha parked.
- **T2 receipt poller — DONE.** `pollers.ts runReceiptPoll` (listDwhTransactions/day → txn boshiga
  bitta receipt, watermark `receipt:<carrier>`, baseline-first, dedupe txnId, narx yo'q, cap 20).
  `notification.poll` cron ichida ketma-ket. Mini-app `notifToInbox` receipt + i18n 4 til.
- **T3 weekly statement — SKIP (hozircha).** Blokersiz: buildTxnReport + sendDocument tayyor.
- **T4 money code + owner confirm — DEFER.** MVP qarori: money code company owner uchun DISABLED
  (`FF_MINIAPP_MONEY_CODE_ENABLED=0`, ship default). Qayta boshlanganda AVVAL owner-confirm
  mexanizmini hal qil: Telegram inline tugma → bot `callback_query` kerak, lekin carrier bot token
  agent-gateway `getUpdates` bilan poll qilinyapti va `setWebhook` uni o'chiradi. Yechim: mini-app
  approve endpoint (webhook yo'q — TAVSIYA) yoki alohida approval bot token.

**Migratsiya raqami:** endi **0041+** (0031-0040 build merge'dan keyin ishlatilgan). agent-gateway'ga
TEGMA (boshqa sessiya, gitignore). Feature branch, savol chiqsa to'xtab yoz.

## Nima allaqachon bor (tegma, foydalanaman de)

- **Outbox:** `mini_app_notifications` (+`_prefs`, +`_state` watermark) — migratsiyalar 0031-0033.
  Yozish FAQAT `notifyMiniApp()` orqali (src/modules/notifications/service.ts) — hech qachon
  chaqiruvchini yiqitmaydi, dedupe_key UNIQUE.
- **Dispatcher:** pg-boss `notification.dispatch` (workers/index.ts) — rol-matritsa
  `registry.ts`dan, driver nusxasi faqat `payload.cardId === registration.cardId` (fail-closed),
  prefs, 0-yetkazishda retry. Muvaffaqiyatdan keyin realtime hub'ga publish
  (`inbox:miniapp:<telegramUserId>`).
- **Poller naqshi:** `pollers.ts` `runCardStatusPoll` — `NOTIFY_POLL_CARRIERS` (env, bo'sh=no-op),
  watermark `mini_app_notification_state`, birinchi o'tish faqat baseline. Cron:
  `notification.poll` (*/2 daq, singleton) — YANGI pollerlarni SHU job ichiga qo'sh (alohida
  cron ochma), ketma-ket chaqir.
- **Templates:** `templates.ts` — 4 til, `limit`/`receipt`/`statement`/`approval` matnlari
  ALLAQACHON bor. Payload kalitlari template'dagi {var}larga mos bo'lsin.
- **News:** client_news + CRM editor (apps/mytrion-crm .../ClientNews.tsx) — bu bosqichga tegmaydi.
- **Mini-app Inbox:** real feed + WS (App.tsx feedToInbox/notifToInbox) — yangi turlar uchun
  `notifToInbox`ga title/body case + i18n kalitlari qo'shish kerak bo'ladi (4 tilda!).

## Qoidalar (buzilmaydi)

1. Migratsiyalar QO'LDA yoziladi (0034+ raqam, IF NOT EXISTS, meta/_journal.json'ga entry) —
   `drizzle-kit generate` ISHLAMAYDI (snapshot fork 0022/0023, bizdan oldingi muammo).
2. Yozuvlar: gate + audit (CLAUDE.md 7). Hech qanday yangi endpoint driver scope'ini kengaytirmasin.
3. Driver'ga $ summalar KO'RSATILMAYDI (gallon mumkin); money code QIYMATI hech qachon
   xabar/payload'da bo'lmaydi; karta doim last-6.
4. tsc (root + apps/mini-app) va eslint toza bo'lishi shart. Testlar faqat Mac'da
   (`corepack pnpm test`) — vitest VM'da ishlamaydi.
5. build/main'ga push yo'q — feature branch.

## T1 — Limit poller (talab: 190 limit-so'rov + "49 gallon" shikoyatlari)

`pollers.ts`ga `runLimitPoll()`:
- Har pilot carrier: `serverCrmWrapper.getTransactions(carrierId, { range: 'day' })` YOKI DWH
  fast path (`listDwhTransactions`) bilan bugungi gallon SUM per karta; limitlar
  `efsWrapper`/servercrm card/efs o'qishidan (ULSD limiti).
- ≥80% → `limit` event (payload: last6, used, limit, pct, cardId); 100% alohida dedupe.
- Dedupe: `limit:<carrier>:<last6>:<day>:<80|100>` — kuniga bir marta har bosqich.
- Watermark shart emas (dedupe yetadi), lekin qimmat so'rovlarni carrier boshiga 1 chaqiriqda tut.

## T2 — Receipt poller (talab: 128 kvitansiya)

`runReceiptPoll()`:
- DWH mart'dan yangi txn qatorlari (watermark: oxirgi ko'rilgan txn timestamp/id per carrier,
  `receipt:<carrierId>` scope).
- Har yangi txn → `receipt` event (payload: last6, gallons, location, city, state, cardId).
  Narx payload'ga YOZILMAYDI (driver oladi!). Owner uchun ham shu event yetadi.
- Birinchi o'tish baseline (portlatma!). Kuniga karta boshiga cheklov qo'y (masalan 20) —
  backfill anomaliyasidan himoya.

## T3 — Haftalik statement scheduler (talab: 488 hisobot + statement shikoyatlari)

- Yangi job `notification.statement` (cron: dushanba 08:00 ET yoki billing_cycle'dan kelib
  chiqib — birinchi versiyada hafta boshi yetadi), pilot carrier'lar uchun.
- `buildTxnReport` (modules/carrier/txnReport.ts) bilan o'tgan hafta XLSX; `sendDocument`
  (telegramCarrierBot) bilan OWNER'larga (roles: owner-only!). Outbox'dan `statement` event
  ham yoz (hujjatsiz, Inbox tarixi uchun) — hujjatning o'zi to'g'ridan-to'g'ri sendDocument.
- Xato bir carrier'da qolganlarini to'xtatmasin.

## T4 — Faza-3.3: Driver emergency money code + owner tasdig'i (talab: 2251)

Eng katta ish. Oqim:
1. Yangi jadval `mini_app_approvals` (0034): id, tenant_id, carrier_id, driver_telegram_user_id,
   amount, unit_number, reason, status pending|approved|denied|expired, decided_by, decided_at,
   expires_at (~30 daq), created_at. Qo'lda migratsiya.
2. Driver endpoint: `POST /carrier/mini-app/money-code/request` (driver, rate-limit,
   FF_MINIAPP_MONEY_CODE_ENABLED ostida) → approval qatori + `approval` notification owner'ga.
   Owner xabari INLINE TUGMALAR bilan: sendPlainReply o'rniga telegramCarrierBot'ga
   `sendInlineKeyboard` qo'shish kerak (reply_markup: Approve/Deny, callback_data:
   `mca:<approvalId>:ok|no`).
3. Bot webhook: mavjud bot integratsiyasida webhook route bormi tekshir
   (telegramCarrierBot.ts / bot update handling — YO'Q bo'lsa `POST /v1/telegram/carrier-webhook`
   yarat, secret token bilan). `callback_query` kelganda: approval'ni topish, owner ekanini
   TEKSHIRISH (callback yuborgan telegram_user_id carrier'ning active OWNER registrationi
   bo'lishi shart — fail-closed), status update, approve bo'lsa C-17 draw
   (`serverCrmWrapper.drawMoneyCode`, requestedBy'da driver id), natija: driver'ga notification
   ("kod tayyor — mini-app'ni oching"), owner xabarini editMessageText bilan yangilash.
4. Mini-app UI: driver moneycode sheet'ida so'rov formasi (amount/unit/reason) + "owner
   tasdig'i kutilmoqda" holati; owner Inbox'da approval ko'rinishi. i18n 4 tilda.
5. Audit: har qadam (request, approve, deny, draw) auditFromContext bilan.

## Testlar (Mac'da yoziladi/yuritiladi)

- pollers: watermark birinchi o'tishda event yo'q; diff'da bitta event; dedupe takror emas.
- dispatcher routing regressi buzilmagani (mavjud testlar o'tsin).
- approval: driver so'rovi → owner'ga event; BEGONA telegram_user_id callback → rad;
  expired approval approve bo'lmaydi; approve → drawMoneyCode chaqirildi (mock), qiymat
  driver xabarida YO'Q.

## Tekshiruv ro'yxati (har T'dan keyin)

[ ] tsc root + mini-app toza  [ ] eslint toza  [ ] yangi env'lar .env.example'da izoh bilan
[ ] WORKING_NOTES.md'ga yozuv  [ ] migratsiya jurnal entry to'g'ri  [ ] i18n 4 tilda to'liq
