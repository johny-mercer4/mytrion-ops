---
name: octane-kb
description: Grounded Octane facts (KB-0, mined from 2 years of real CS answers) — supported truck stops, out-of-network rules, money code B-codes and fees, card diagnostics, override, PIN, gallon limits, card orders, statements, mini-app registration, mobile app, role matrix. Invoke whenever a client asks a FACTUAL question about how Octane works. HARD RULE: state facts ONLY from this document or live tool results; anything marked ⚠️ is unconfirmed — say a human will confirm instead of asserting it.
license: MIT
compatibility: agent-gateway runtime; pairs with octane-customer-service.
---

# Skill: octane-kb

Usage rules:
1. Answer from the articles below or from live octane_* tool results — never from general
   knowledge about fuel cards.
2. ⚠️ marks an unconfirmed detail. NEVER assert those numbers/dates; say "aniq raqamni
   agentlar tasdiqlaydi" and offer to escalate.
3. Answer in the client's language (each article carries EN/UZ/RU variants).
4. Keep the reply 1-3 lines (octane-communication) — the article is background, not a script.

# Octane Support KB — v0 draft (KB-0)

**Manba:** 9 guruh / 54 433 xabar ichidan agent javoblari (intent bo'yicha qazilgan, eng ko'p
takrorlangan kanonik matnlar). **Maqsad:** CS review (KB-1) → Train tab'ga `client-facing` tag
bilan yuklash → bot `octane_kb_search` faqat shulardan javob beradi (KB-2).
⚠️ belgisi = data'da aniq raqam/tafsilot yo'q, CS tasdiqlashi shart.

Har maqola: **EN** (asosiy) · **UZ** · **RU** (qisqa). ES keyin (KB-1'da tarjima).

---

## KB-01 · Supported truck stops (in-network)
tags: stations, discounts, in-network · triggers: "qayerda ishlaydi", "Pilot?", "which stations"

**EN:** Octane cards work in-network at: TA/Petro, Love's, Casey's, Sapp Brothers, Speedway,
7-Eleven, SEI Fuels, RaceTrac, Raceway, Maverick, Kum&Go, Circle K, and SC Fuels (100+ stations).
Irving: only Irving Fairfield #515289 and Irving Kittery #503256. AmBest network: AmBest
locations and participating Sunoco sites. Best discounts are at TA/Petro and Love's.
⚠️ CS: ro'yxatning 2026-07 holatini tasdiqlang (SC Fuels qo'shilgan, boshqa o'zgarishlar?).

**UZ:** Octane kartalari quyidagi tarmoqlarda ishlaydi: TA/Petro, Love's, Casey's, Sapp Brothers,
Speedway, 7-Eleven, SEI Fuels, RaceTrac, Raceway, Maverick, Kum&Go, Circle K va SC Fuels (100+
shaxobcha). Irving: faqat Fairfield #515289 va Kittery #503256. AmBest tarmog'i: AmBest va
qatnashuvchi Sunoco'lar. Eng yaxshi chegirmalar — TA/Petro va Love's'da.

**RU:** Карты работают в сети: TA/Petro, Love's, Casey's, Sapp Brothers, Speedway, 7-Eleven,
SEI Fuels, RaceTrac, Raceway, Maverick, Kum&Go, Circle K, SC Fuels. Irving — только №515289 и
№503256. Лучшие скидки — TA/Petro и Love's.

## KB-02 · Out-of-network qoidasi
tags: stations, limit, out-of-network · triggers: "boshqa zapravka", "49 gallon", "out of network"

**EN:** Due to EFS network policy, cards may not work at out-of-network stations. Where they do,
the maximum is 49 gallons per fueling. To avoid being stuck, fuel at in-network stops (KB-01).
⚠️ CS: is the 49-gal out-of-network cap still current, and which merchants allow it?

**UZ:** EFS siyosati sabab, tarmoqdan tashqari shaxobchalarda karta ishlamasligi mumkin.
Ishlagan joyda ham bir quyishda maksimum 49 gallon. Qotib qolmaslik uchun tarmoq ichida
(KB-01) quying.

**RU:** Вне сети карта может не работать; где работает — максимум 49 галлонов за заправку.
Заправляйтесь в сети (KB-01).

## KB-03 · Love's/SpeedCo servis chegirmalari
tags: service, repair, discounts · triggers: "moy almashtirish", "tires", "PM"

**EN:** Truck service discounts at Love's & SpeedCo shops: Full PM (oil change) $40 off; new
tires up to $75 off per tire; retread tires $30 off; labor $15–20/hr off. Box trucks: Full PM
$20 off. Truck wash available at Blue Beacon. Have the shop bill it to your Octane/EFS account.
⚠️ CS: aksiya amaldami, box-truck to'liq ro'yxati?

**UZ:** Love's va SpeedCo ustaxonalarida: Full PM (moy) $40 chegirma; yangi shina — shinasiga
$75 gacha; retread $30; ish haqi soatiga $15–20 chegirma. Box truck: Full PM $20. Truck wash —
Blue Beacon'da. To'lovni Octane/EFS hisobiga qildiring.

**RU:** Скидки в Love's/SpeedCo: ПМ (масло) −$40; новые шины до −$75/шт; retread −$30; работа
−$15–20/час. Мойка — Blue Beacon.

## KB-04 · Money code — nima uchun berilishi (B-kodlar)
tags: money-code, reasons · triggers: "kod kerak", "efs check"

**EN:** When requesting an EFS money code, state the purpose: B-1 Truck Service · B-2 Fuel ·
B-3 Personal Expenses · B-4 Towing · B-5 Cash Advance · B-6 Salary · B-7 Parking · B-8 Truck
Wash · B-9 Truck Scale · B-10 Shower · B-11 Trailer · B-12 Lumper fee · B-13 Straps · B-14
Company Charge. Owners can issue codes instantly in the mini-app (Money Code); drivers request
and the owner confirms.

**UZ:** Money code so'raganda maqsadini ayting: B-1 Truck Service · B-2 Fuel · B-3 Shaxsiy ·
B-4 Evakuator · B-5 Naqd avans · B-6 Oylik · B-7 Parking · B-8 Yuvish · B-9 Tarozi · B-10 Dush ·
B-11 Treyler · B-12 Lumper · B-13 Straps · B-14 Company Charge. Owner mini-app'da bir zumda
chiqaradi; driver so'raydi — owner tasdiqlaydi.

**RU:** При запросе money code укажите цель (B-1 сервис … B-14 company charge — полный список
в EN). Владелец выпускает код в мини-аппе мгновенно.

## KB-05 · Money code — komissiya va cheklovlar
tags: money-code, fee · triggers: "kod komissiyasi", "fee"

**EN:** Money codes carry a service fee added to your statement. ⚠️ CS: exact fee ($ or %),
per-code limits, and daily caps — the chats reference "$7 fee" in one case; confirm the
current schedule before publishing.

**UZ:** Money code uchun xizmat haqi statement'ga qo'shiladi. ⚠️ CS: aniq komissiya ($ yoki %),
bir kod limiti va kunlik cheklovlarni tasdiqlang (chatda bir joyda "$7 fee" uchraydi).

**RU:** За money code берётся комиссия (добавляется в стейтмент). ⚠️ Точную ставку подтвердит CS.

## KB-06 · Karta ishlamayapti — diagnostika
tags: card, declined, hold · triggers: "deklayn", "ishlamayapti", "declined"

**EN:** If the card declines: 1) Hold/fraud-lock → a 30-minute override unlocks it (drivers:
ask the bot or the mini-app; it re-locks automatically). 2) Inactive → the owner activates it
in the mini-app (Card management). 3) Daily gallon limit reached → wait for the daily reset or
the owner raises the limit. 4) Out-of-network station → move to an in-network stop (KB-01).
5) Company balance empty → owner tops up. The bot/mini-app shows which case yours is.

**UZ:** Karta rad etsa: 1) Hold/fraud → 30 daqiqalik override ochadi (driver: botdan yoki
mini-app'dan; o'zi qayta yopiladi). 2) Inactive → owner mini-app'da aktivlashtiradi. 3) Kunlik
gallon limiti tugagan → reset'ni kuting yoki owner limitni oshiradi. 4) Tarmoqdan tashqari
shaxobcha → tarmoq ichiga o'ting (KB-01). 5) Kompaniya balansi bo'sh → owner to'ldiradi.
Qaysi holat ekanini bot/mini-app ko'rsatadi.

**RU:** Отказ: 1) Hold → override на 30 мин; 2) Inactive → владелец активирует; 3) дневной
лимит; 4) станция вне сети; 5) пустой баланс компании. Что именно — покажет бот/мини-апп.

## KB-07 · Override nima
tags: override, hold · triggers: "override", "ochib bering"

**EN:** Override temporarily unlocks a fraud-held card for ~30 minutes — enough for one
fueling — then EFS re-locks it automatically. It does NOT change the card's status
permanently and only works on held cards. Drivers can trigger it for their own card.

**UZ:** Override — fraud-hold'dagi kartani ~30 daqiqaga ochadi (bitta quyishga yetadi), keyin
EFS avtomatik qayta yopadi. Statusni doimiy o'zgartirmaydi, faqat hold'dagi kartada ishlaydi.
Driver o'z kartasiga o'zi qila oladi.

**RU:** Override открывает карту на ~30 минут (одна заправка), потом EFS сам закрывает.

## KB-08 · PIN qo'llanma
tags: pin, pump · triggers: "pin", "kod so'rayapti kolonka"

**EN:** At the pump, the PIN prompt is usually your Driver ID; if that fails, try the card's
last 4 digits. Note: two cards CAN share the same last-4 — identify cards by the last 6
digits. Drivers can change their own Driver ID (=PIN) in the mini-app (PIN/Unit screen).

**UZ:** Kolonkada PIN — odatda Driver ID; ishlamasa kartaning oxirgi 4 raqami. Diqqat: ikki
kartaning last-4'i bir xil bo'lishi mumkin — kartani oxirgi 6 raqam bilan ajrating. Driver
o'z Driver ID'sini (=PIN) mini-app'da o'zi o'zgartiradi (PIN/Unit ekrani).

**RU:** PIN на заправке — обычно Driver ID, иначе последние 4 цифры карты. Карты различайте
по последним 6 цифрам. Driver ID меняется в мини-аппе.

## KB-09 · Kunlik gallon limitlari
tags: limit, gallons · triggers: "limit", "50 gallon"

**EN:** Cards have daily gallon limits (commonly 250/day; some set to 50). When you hit it,
fueling stops until the daily reset, or the owner raises the limit in the mini-app (Card
management → Limits, ULSD/DEF). ⚠️ CS: default limits per plan and reset time (midnight ET?).

**UZ:** Kartalarda kunlik gallon limiti bor (ko'pincha 250/kun; ba'zilarida 50). Tugasa —
kunlik reset'gacha to'xtaydi yoki owner mini-app'da oshiradi (Card management → Limits).
⚠️ CS: default limitlar va reset vaqti.

**RU:** Дневной лимит галлонов (обычно 250). Исчерпан — ждать сброса или владелец поднимет
в мини-аппе.

## KB-10 · Yangi karta buyurtma va yetkazish
tags: new-card, delivery, fedex · triggers: "yangi karta", "qachon keladi"

**EN:** New/replacement cards: regular mail 7–10 business days, FREE (no tracking). FedEx
Overnight: $21.50. Weather can delay FedEx. Owners order through their Octane agent; shipment
status shows in the mini-app (Track my card).

**UZ:** Yangi/almashtirish kartasi: oddiy pochta 7–10 ish kuni, BEPUL (trekingsiz). FedEx
Overnight — $21.50. Ob-havo kechiktirishi mumkin. Owner Octane agenti orqali buyurtma qiladi;
holatini mini-app'da (Track my card) ko'rasiz.

**RU:** Обычная почта 7–10 раб. дней (бесплатно, без трека), FedEx Overnight — $21.50.

## KB-11 · Statement va billing
tags: statement, billing, invoice · triggers: "statement", "invoice qachon"

**EN:** Weekly statements go to the account email on the billing cycle. Repair/service invoices
are added to your statement after you submit the billing form ("statement chiqganda fuel bilan
birga to'laysiz"). Owners can pull any-period transaction reports themselves in the mini-app
(Reports) — Excel/PDF/CSV. ⚠️ CS: statement kuni (dushanba?) va billing form linki.

**UZ:** Haftalik statement billing cycle bo'yicha email'ga boradi. Ta'mir/servis invoice'lari
billing form topshirilgach statement'ga qo'shiladi — statement chiqqanda fuel bilan birga
to'laysiz. Owner istalgan davr hisobotini mini-app'dan o'zi oladi (Reports, Excel/PDF/CSV).
⚠️ CS: statement kuni va billing form manzili.

**RU:** Еженедельный стейтмент уходит на email. Счета за сервис добавляются в стейтмент после
billing form. Отчёты за любой период — в мини-аппе.

## KB-12 · Mini-app'ga ro'yxatdan o'tish
tags: mini-app, registration, invite · triggers: "qanday kiraman", "invite"

**EN:** The Telegram mini-app is invite-based. Owners: your Octane agent sends your invite
link. Drivers: your company owner generates your link in the mini-app (Fleet screen) — it's
tied to your card. After registering you can check status, funds, reports and more yourself.

**UZ:** Mini-app invite bilan ochiladi. Owner: invite linkni Octane agentingiz yuboradi.
Driver: linkni kompaniya egasi mini-app'ning Fleet ekranidan yaratadi — u kartangizga
bog'langan. Ro'yxatdan o'tgach status, mablag', hisobotlarni o'zingiz ko'rasiz.

**RU:** Мини-апп по инвайту: владельцу — от агента Octane, водителю — владелец генерирует в
Fleet. После регистрации всё self-service.

## KB-13 · Octane Fuel mobil ilova
tags: mobile-app, stations, prices · triggers: "ilova", "arzon zapravka"

**EN:** The Octane Fuel app (iPhone: apps.apple.com/us/app/octane-fuel/id6744539302 · Android:
play.google.com/store/apps/details?id=com.tss.fuelapp) finds the cheapest in-network truck
stops near you with live prices, plus dashboard, card management and AI voice navigation.

**UZ:** Octane Fuel ilovasi (iPhone/Android — havolalar EN'da) yaqin-atrofdagi eng arzon
tarmoq shaxobchalarini jonli narxlar bilan topadi; dashboard, karta boshqaruvi va AI ovozli
navigatsiya bor.

**RU:** Приложение Octane Fuel — самые дешёвые станции сети рядом, живые цены, управление
картами, голосовая навигация.

## KB-14 · Kimga qaysi amal (rol qisqacha)
tags: roles, rbac · triggers: "driver qila oladimi", "owner"

**EN:** Drivers (their own card only): status, funds yes/no, own transactions/report (retail),
PIN/Unit change, manual entry code, override, emergency money-code request (owner confirms).
Owners: everything company-wide — balances with figures, all cards, activate/deactivate,
limits, money codes, invoices, full reports. The bot and mini-app enforce this automatically.

**UZ:** Driver (faqat o'z kartasi): status, mablag' bor/yo'q, o'z tranzaksiyalari/hisoboti
(retail), PIN/Unit, manual code, override, favqulodda money code so'rovi (owner tasdiqlaydi).
Owner: butun kompaniya — raqamli balans, barcha kartalar, aktivlashtirish, limitlar, money
code, invoice, to'liq hisobotlar. Bot va mini-app buni avtomatik ta'minlaydi.

**RU:** Водитель — только своя карта (без сумм); владелец — всё по компании. Бот/мини-апп
следят за этим сами.

---

### KB-1 uchun keyingi qadamlar
1. ⚠️ belgilangan joylarni CS tasdiqlaydi (5 ta: stations ro'yxati aktualligi, 49-gal qoida,
   servis-aksiya, money-code komissiya, limit/reset, statement kuni).
2. ES tarjimalar.
3. Train tab orqali yuklash — har maqola alohida doc, tag: `client-facing` + intent taglari.
4. KB-2: `octane_kb_search` tool + prompt: "faktlar faqat KB'dan; KB'da yo'q → eskalatsiya".
