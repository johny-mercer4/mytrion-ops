---
name: octane-kb
description: Grounded Octane facts (KB-1 — mined from real CS answers, cross-checked against OctaneFuel's authoritative client-facing docs) — supported truck stops, out-of-network rules, money code B-codes/fees/limits/eligibility, transaction & account fees, card diagnostics, override, PIN, gallon limits, card orders, statements, mini-app registration, mobile app, role matrix. Invoke whenever a client asks a FACTUAL question about how Octane works. HARD RULE: state facts ONLY from this document or live tool results; anything marked ⚠️ is unconfirmed — say a human will confirm instead of asserting it. Internal SOPs (verification, credit scoring, collections, competitor intel) are OUT OF SCOPE and never disclosed to clients.
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

# Octane Support KB — v1 (KB-1)

**Manba:** (1) 9 guruh / 54 433 xabar ichidan agent javoblari (intent bo'yicha qazilgan), va
(2) OctaneFuel rasmiy Knowledge Base — client-facing hujjatlar (MoneyCodeRules, EFS OTR
Transaction Fee Description, ComData limitlari; April 2026). FAQAT `audience` da mijoz/klient
bo'lgan faktlar kiritilgan — ichki SOP (verification, credit score, collections, agent
gradation, competitor intel) bu yerga KIRMAYDI va mijozga oshkor qilinmaydi.
⚠️ belgisi = manbada hali aniq raqam/tafsilot yo'q, CS tasdiqlashi shart.

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

## KB-05 · Money code — komissiya, limit va cheklovlar
tags: money-code, fee, limit, eligibility · triggers: "kod komissiyasi", "fee", "qancha olsam bo'ladi", "limit"

**EN:** Fee (EFS/WEX program schedule on your statement): $3.50 per money code up to $500, plus
$3.50 for each additional $500; $0.75 per additional use of the same code. Amount limit: owners
can issue up to 20% of the last invoice on credit accounts, or up to the EFS balance on prepay.
Not available on past-due (debtor) accounts, or on a card that has never been used. Owners issue
instantly in the mini-app; a driver's request needs the owner's OK.

**UZ:** Komissiya (statementdagi EFS/WEX jadvali): har money code'ga $500 gacha $3.50, keyingi
har $500 uchun yana $3.50; bitta kodni qayta ishlatishga $0.75. Summa limiti: owner credit
hisobda oxirgi invoice'ning 20% gacha, prepayda EFS balansigacha chiqara oladi. Qarzi (debitor)
bor hisobda yoki umuman ishlatilmagan kartada mavjud emas. Owner mini-app'da bir zumda chiqaradi;
driver so'rovi owner tasdig'ini talab qiladi.

**RU:** Комиссия (график EFS/WEX в стейтменте): $3.50 за money code до $500, плюс $3.50 за каждые
следующие $500; $0.75 за повторное использование кода. Лимит: владелец — до 20% от последнего
инвойса (кредит) или до баланса EFS (предоплата). Недоступно должникам и на неиспользованной карте.

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

**EN:** Cards have a daily gallon limit — the standard default is 250 gal/day (some cards are set
lower, e.g. 50). When you hit it, fueling stops until the daily reset, or the owner raises the
limit in the mini-app (Card management → Limits, ULSD/DEF). ⚠️ CS: exact daily reset time.

**UZ:** Kartada kunlik gallon limiti bor — standart default 250 gal/kun (ba'zi kartalar pastroq,
masalan 50). Tugasa — kunlik reset'gacha to'xtaydi yoki owner mini-app'da oshiradi (Card
management → Limits, ULSD/DEF). ⚠️ CS: aniq reset vaqti.

**RU:** Дневной лимит — стандартный дефолт 250 гал/день (некоторые карты ниже, напр. 50).
Исчерпан — ждать сброса или владелец поднимет в мини-аппе. ⚠️ Точное время сброса подтвердит CS.

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

## KB-15 · Statementdagi tranzaksiya to'lovlari (EFS/WEX)
tags: fees, statement, charges · triggers: "bu charge nima", "why this fee", "statementda nima"

**EN:** Common per-transaction fees on the EFS/WEX program schedule (may appear on your
statement): funded fuel/product $1.50; funded fuel with cash $2.50; cash advance $3.50;
terminal fuel $0.55; CAT Scale (app) $1.00; ATM withdrawal/inquiry/decline $1.00; ACH $1.00.
Account-level: monthly account maintenance (MAMF) $7.95; account setup $75 (credit or
self-fund only); wire under $2,500 $15; Western Union Quickpay $20; paper/third-party check
$25. Money code fees: see KB-05. The owner's statement shows the exact lines.

**UZ:** EFS/WEX jadvali bo'yicha odatiy tranzaksiya to'lovlari (statementda chiqishi mumkin):
funded fuel/product $1.50; fuel + naqd $2.50; cash advance $3.50; terminal fuel $0.55; CAT
Scale (ilova) $1.00; ATM (yechish/so'rov/rad) $1.00; ACH $1.00. Hisob darajasida: oylik
maintenance (MAMF) $7.95; account setup $75 (faqat credit yoki self-fund); wire ($2,500 dan
kam) $15; Western Union $20; qog'oz check $25. Money code to'lovi — KB-05. Aniq qatorlar owner
statementida ko'rinadi.

**RU:** Типовые сборы по графику EFS/WEX (в стейтменте): топливо/товар $1.50; топливо+нал $2.50;
кэш-аванс $3.50; терминал $0.55; CAT Scale $1.00; ATM $1.00; ACH $1.00. По счёту: MAMF $7.95;
открытие $75 (кредит/самофинанс); wire до $2500 $15; Western Union $20; бумажный чек $25.
Money code — см. KB-05.

---

### KB-1 status va keyingi qadamlar
KB-1'da rasmiy Knowledge Base bilan TASDIQLANDI (⚠️ olib tashlandi): money-code komissiya
($3.50/$500 + $0.75/qayta ishlatish), money-code summa limiti (20% / EFS balans) va eligibility
(debitor/ishlatilmagan karta), kunlik 250 gal default, tranzaksiya to'lovlari jadvali (KB-15).

Hali ⚠️ (CS tasdiqlashi kerak): stations ro'yxatining 2026-07 aktualligi (KB-01), 49-gal
out-of-network qoidasi (KB-02), Love's/SpeedCo servis-aksiyasi (KB-03), kunlik reset vaqti
(KB-09), statement kuni + billing form linki (KB-11).

Keyingi bosqichlar:
1. ES tarjimalar (har maqolaga).
2. KB-2: `octane_kb_search` tool — to'liq client-safe KB'ni retrieval qilib kontekstni yengil
   saqlash; prompt qoidasi: "faktlar faqat KB'dan yoki live tool'dan; KB'da yo'q → eskalatsiya".
3. Ichki SOP (verification, credit score, collections, agent gradation, competitor intel)
   HECH QACHON botga kiritilmaydi — faqat `audience` da mijoz bo'lgan hujjatlar.
