/**
 * Octane client-safe KB corpus (KB-2) — the searchable knowledge behind octane_kb_search.
 *
 * SCOPE RULE (same wall as the octane-kb skill): ONLY client-facing facts live here — supported
 * stations, fees, money-code rules/limits, gallon limits, card diagnostics, override/PIN, card
 * orders, statements, mini-app how-tos, troubleshooting. Internal SOPs (verification, credit
 * scoring, collections, agent gradation, competitor intel) are OUT OF SCOPE and never added.
 *
 * SOURCE: verified against OctaneFuel's authoritative client-facing docs (MoneyCodeRules, EFS OTR
 * Transaction Fee Description, ComData limits; April 2026), the client-communicable portions of
 * the Customer Support Operations Manual v1.0 (June 2026), and the octane-kb skill (KB-1).
 * Internal-only procedures, credentials, staff contacts, ticket codes, and exception criteria are
 * deliberately omitted. Anything not safe and confirmed is escalated to the client's agent.
 *
 * `en` is authoritative; `uz`/`ru` mirror it where provided. For a language with no variant, the
 * model translates the `en` fact (octane-communication) — it never invents new facts.
 */
export interface KbArticle {
  id: string;
  title: string;
  tags: string[];
  triggers: string[];
  en: string;
  uz?: string;
  ru?: string;
}

export const KB_ARTICLES: KbArticle[] = [
  {
    id: 'KB-01',
    title: 'Supported truck stops (in-network)',
    tags: ['stations', 'in-network', 'out-of-network', 'truck stop', 'pilot'],
    triggers: [
      'which stations',
      'qayerda ishlaydi',
      'Pilot?',
      'where does the card work',
      'in network stops',
      'unsupported stations',
    ],
    en: `Supported: TA/Petro, Love's, Casey's, Sapp Brothers, Speedway, 7-Eleven, SEI Fuels, RaceTrac, Raceway, and Maverick. Irving is supported only at Irving Fairfield #515289 and Irving Kittery #503256. The AmBest-covered network includes AmBest, participating Sunoco/7-Eleven, Onvo, Enmarket, Twice Daily, Stripes/7-Eleven, Toot'n Totum, Weigel's, Casey's General Store, Pump & Pantry, AC&T, and Break Time. Unsupported: Pilot/Flying J, Sheetz, McDonald's Fuel Stop, One9, and QuikTrip (Quick Trip).`,
    uz: `Qo‘llab-quvvatlanadi: TA/Petro, Love's, Casey's, Sapp Brothers, Speedway, 7-Eleven, SEI Fuels, RaceTrac, Raceway va Maverick. Irving’dan faqat Fairfield #515289 va Kittery #503256 ishlaydi. AmBest tarmog‘i: AmBest, qatnashuvchi Sunoco/7-Eleven, Onvo, Enmarket, Twice Daily, Stripes/7-Eleven, Toot'n Totum, Weigel's, Casey's General Store, Pump & Pantry, AC&T va Break Time. Qo‘llab-quvvatlanmaydi: Pilot/Flying J, Sheetz, McDonald's Fuel Stop, One9 va QuikTrip (Quick Trip).`,
    ru: `Поддерживаются: TA/Petro, Love's, Casey's, Sapp Brothers, Speedway, 7-Eleven, SEI Fuels, RaceTrac, Raceway и Maverick. Irving — только Fairfield №515289 и Kittery №503256. Сеть AmBest включает AmBest, участвующие Sunoco/7-Eleven, Onvo, Enmarket, Twice Daily, Stripes/7-Eleven, Toot'n Totum, Weigel's, Casey's General Store, Pump & Pantry, AC&T и Break Time. Не поддерживаются: Pilot/Flying J, Sheetz, McDonald's Fuel Stop, One9 и QuikTrip (Quick Trip).`,
  },
  {
    id: 'KB-02',
    title: 'Out-of-network rule (49-gallon cap)',
    tags: ['stations', 'limit', 'out-of-network', '49 gallon'],
    triggers: ['other station', 'boshqa zapravka', '49 gallon', 'out of network', 'card did not work'],
    en: `Due to EFS network policy, cards may not work at out-of-network stations. Where they do, the maximum is 49 gallons per fueling. To avoid being stuck, fuel at in-network stops (see supported stations).`,
    uz: `EFS siyosati sabab, tarmoqdan tashqari shaxobchalarda karta ishlamasligi mumkin. Ishlagan joyda ham bir quyishda maksimum 49 gallon. Qotib qolmaslik uchun tarmoq ichida quying.`,
    ru: `Вне сети карта может не работать; где работает — максимум 49 галлонов за заправку. Заправляйтесь в сети.`,
  },
  {
    id: 'KB-03',
    title: "Love's / SpeedCo service discounts",
    tags: ['service', 'repair', 'discounts', 'oil change', 'tires'],
    triggers: ['oil change', 'moy almashtirish', 'tires', 'PM', 'truck wash', 'repair discount'],
    en: `Truck service discounts at Love's & SpeedCo shops: Full PM (oil change) $40 off; new tires up to $75 off per tire; retread tires $30 off; labor $15-20/hr off. Box trucks: Full PM $20 off. Truck wash at Blue Beacon. Have the shop bill it to your Octane/EFS account.`,
    uz: `Love's va SpeedCo ustaxonalarida: Full PM (moy) $40 chegirma; yangi shina — $75 gacha; retread $30; ish haqi soatiga $15-20. Box truck: Full PM $20. Truck wash — Blue Beacon'da. To'lovni Octane/EFS hisobiga qildiring.`,
    ru: `Скидки в Love's/SpeedCo: ПМ (масло) −$40; новые шины до −$75/шт; retread −$30; работа −$15-20/час. Мойка — Blue Beacon.`,
  },
  {
    id: 'KB-04',
    title: 'Money code reasons (B-codes)',
    tags: ['money-code', 'reasons', 'b-code', 'efs check'],
    triggers: ['money code reason', 'kod kerak', 'efs check', 'what reason for money code'],
    en: `When requesting an EFS money code, state the purpose: B-1 Truck Service, B-2 Fuel, B-3 Personal Expenses, B-4 Towing, B-5 Cash Advance, B-6 Salary, B-7 Parking, B-8 Truck Wash, B-9 Truck Scale, B-10 Shower, B-11 Trailer, B-12 Lumper fee, B-13 Straps, B-14 Company Charge. Owners issue codes instantly in the mini-app (Money Code); drivers request and the owner confirms.`,
    uz: `Money code so'raganda maqsadini ayting: B-1 Truck Service, B-2 Fuel, B-3 Shaxsiy, B-4 Evakuator, B-5 Naqd avans, B-6 Oylik, B-7 Parking, B-8 Yuvish, B-9 Tarozi, B-10 Dush, B-11 Treyler, B-12 Lumper, B-13 Straps, B-14 Company Charge. Owner mini-app'da bir zumda chiqaradi; driver so'raydi, owner tasdiqlaydi.`,
  },
  {
    id: 'KB-05',
    title: 'Money code fee, limit and eligibility',
    tags: ['money-code', 'fee', 'limit', 'eligibility', 'komissiya'],
    triggers: ['money code fee', 'kod komissiyasi', 'how much money code can i get', 'qancha olsam boladi', 'money code limit'],
    en: `Fee (EFS/WEX program schedule on your statement): $3.50 per money code up to $500, plus $3.50 for each additional $500; $0.75 per additional use of the same code. Amount limit: owners can draw up to 20% of the last invoice on credit accounts, or up to the EFS balance on prepay. Not available on past-due (debtor) accounts, or on a card that has never been used. Owners issue instantly in the mini-app; a driver's request needs the owner's OK. Exact drawable amount right now comes from the mini-app / the bot's quote.`,
    uz: `Komissiya (statementdagi EFS/WEX jadvali): har money code'ga $500 gacha $3.50, keyingi har $500 uchun yana $3.50; bitta kodni qayta ishlatishga $0.75. Summa limiti: credit hisobda oxirgi invoice'ning 20% gacha, prepayda EFS balansigacha. Qarzi (debitor) bor hisobda yoki umuman ishlatilmagan kartada mavjud emas. Hozir aniq qancha olsa bo'lishini mini-app yoki bot aytadi.`,
    ru: `Комиссия (график EFS/WEX): $3.50 за money code до $500, плюс $3.50 за каждые следующие $500; $0.75 за повторное использование кода. Лимит: до 20% от последнего инвойса (кредит) или до баланса EFS (предоплата). Недоступно должникам и на неиспользованной карте.`,
  },
  {
    id: 'KB-06',
    title: 'Card declined — diagnostics',
    tags: ['card', 'declined', 'hold', 'troubleshooting'],
    triggers: ['declined', 'ishlamayapti', 'card not working', 'karta rad etdi', 'deklayn'],
    en: `If the card declines: 1) Inactive -> the owner can activate it, but the PIN resets to the card's last 4 digits and the driver must set it again. 2) Hold for Fraud -> it cannot be permanently reactivated without Verification approval; when the live card result explicitly says an override is available, an eligible one-time override may open it for about 30 minutes. 3) Daily gallon limit reached -> wait for the reset or have the owner raise it. 4) Out-of-network station -> move to an in-network stop. 5) Company balance empty -> the owner tops up. The bot or mini-app can show the current status and whether a temporary override is actually available.`,
    uz: `Karta rad etsa: 1) Inactive -> owner aktivlashtiradi, lekin PIN kartaning oxirgi 4 raqamiga qaytadi va driver uni qayta o'rnatadi. 2) Hold for Fraud -> Verification tasdig'isiz doimiy aktivlashtirib bo'lmaydi; live natija override mavjudligini aniq ko'rsatsa, mos bir martalik override kartani taxminan 30 daqiqaga ochishi mumkin. 3) Kunlik gallon limiti tugagan -> reset'ni kuting yoki owner oshiradi. 4) Tarmoqdan tashqari -> tarmoq ichiga o'ting. 5) Balans bo'sh -> owner to'ldiradi.`,
    ru: `Если карта отклонена: 1) Inactive — владелец активирует, но PIN сбрасывается на последние 4 цифры карты. 2) Hold for Fraud нельзя активировать постоянно без одобрения Verification; только если live-статус явно разрешает override, доступен разовый override примерно на 30 минут. Также проверьте дневной лимит, сеть станции и баланс.`,
  },
  {
    id: 'KB-07',
    title: 'Override — what it is',
    tags: ['override', 'hold', 'fraud'],
    triggers: ['override', 'ochib bering', 'unlock card', 'unlock my card'],
    en: `Override is an eligible one-time exception shown by the live card result. When available, it temporarily opens the held card for about 30 minutes — enough for one fueling — and EFS re-locks it automatically. It does not permanently reactivate a Hold for Fraud card; permanent restoration still requires Verification approval. Drivers can request an available override for their own card.`,
    uz: `Override — live karta natijasi ruxsat bergan bir martalik istisno. Mavjud bo'lsa, hold'dagi kartani taxminan 30 daqiqaga, bitta quyish uchun ochadi va EFS avtomatik qayta yopadi. Hold for Fraud kartani doimiy aktivlashtirmaydi; doimiy tiklash uchun Verification tasdig'i kerak. Driver faqat o'z kartasiga mavjud override'ni so'rashi mumkin.`,
    ru: `Override — разовое исключение, доступность которого показывает live-статус карты. Он открывает карту примерно на 30 минут, затем EFS снова блокирует её. Это не постоянная активация Hold for Fraud; для постоянного восстановления нужно одобрение Verification.`,
  },
  {
    id: 'KB-08',
    title: 'PIN at the pump',
    tags: ['pin', 'pump', 'driver id'],
    triggers: ['pin', 'kod so\'rayapti kolonka', 'pin at pump', 'driver id'],
    en: `At the pump, the PIN prompt is usually your Driver ID; if that fails, try the card's last 4 digits. Note: two cards CAN share the same last-4 — identify cards by the last 6 digits. Drivers can change their own Driver ID (=PIN) in the mini-app (PIN/Unit screen).`,
    uz: `Kolonkada PIN — odatda Driver ID; ishlamasa kartaning oxirgi 4 raqami. Diqqat: ikki kartaning last-4'i bir xil bo'lishi mumkin — kartani oxirgi 6 raqam bilan ajrating. Driver o'z Driver ID'sini mini-app'da o'zgartiradi.`,
    ru: `PIN на заправке — обычно Driver ID, иначе последние 4 цифры карты. Карты различайте по последним 6 цифрам.`,
  },
  {
    id: 'KB-09',
    title: 'Daily gallon limits',
    tags: ['limit', 'gallons', 'daily'],
    triggers: ['limit', '50 gallon', 'daily limit', 'gallon limit', 'limitim'],
    en: `Cards have a daily gallon limit — the standard default is 250 gal/day (some cards are set lower, e.g. 50). When you hit it, fueling stops until the daily reset, or the owner raises the limit in the mini-app (Card management -> Limits, ULSD/DEF).`,
    uz: `Kartada kunlik gallon limiti bor — standart default 250 gal/kun (ba'zilarida pastroq, masalan 50). Tugasa — kunlik reset'gacha to'xtaydi yoki owner mini-app'da oshiradi (Card management -> Limits).`,
    ru: `Дневной лимит — стандартный дефолт 250 гал/день (некоторые ниже, напр. 50). Исчерпан — ждать сброса или владелец поднимет в мини-аппе.`,
  },
  {
    id: 'KB-10',
    title: 'New / replacement card orders',
    tags: ['new-card', 'delivery', 'fedex', 'replace'],
    triggers: ['new card', 'yangi karta', 'when will card arrive', 'replacement card', 'qachon keladi'],
    en: `New/replacement cards: regular mail 7-10 business days, FREE (no tracking). FedEx Overnight: $21.50. Weather can delay FedEx. Owners order through their Octane agent; shipment status shows in the mini-app (Track my card).`,
    uz: `Yangi/almashtirish kartasi: oddiy pochta 7-10 ish kuni, BEPUL (trekingsiz). FedEx Overnight — $21.50. Ob-havo kechiktirishi mumkin. Owner Octane agenti orqali buyurtma qiladi; holatini mini-app'da (Track my card) ko'rasiz.`,
    ru: `Обычная почта 7-10 раб. дней (бесплатно, без трека), FedEx Overnight — $21.50.`,
  },
  {
    id: 'KB-11',
    title: 'Statements and billing',
    tags: ['statement', 'billing', 'invoice'],
    triggers: ['statement', 'invoice qachon', 'when is statement', 'billing form'],
    en: `Weekly statements go to the account email on the billing cycle. Repair/service invoices are added to your statement after you submit the billing form (you pay them together with fuel when the statement is issued). Owners can pull any-period transaction reports themselves in the mini-app (Reports) — Excel/PDF.`,
    uz: `Haftalik statement billing cycle bo'yicha email'ga boradi. Ta'mir/servis invoice'lari billing form topshirilgach statement'ga qo'shiladi — statement chiqqanda fuel bilan birga to'laysiz. Owner istalgan davr hisobotini mini-app'dan oladi (Reports, Excel/PDF).`,
    ru: `Еженедельный стейтмент — на email по циклу. Счета за сервис добавляются после billing form. Отчёты за любой период — в мини-аппе.`,
  },
  {
    id: 'KB-12',
    title: 'Mini-app registration',
    tags: ['mini-app', 'registration', 'invite', 'sign up'],
    triggers: ['how do i register', 'qanday kiraman', 'invite', 'sign up', 'registratsiya'],
    en: `The Telegram mini-app is invite-based. Owners: your Octane agent sends your invite link. Drivers: your company owner generates your link in the mini-app (Fleet screen) — it's tied to your card. After registering you can check status, funds, reports and more yourself.`,
    uz: `Mini-app invite bilan ochiladi. Owner: invite linkni Octane agentingiz yuboradi. Driver: linkni kompaniya egasi mini-app'ning Fleet ekranidan yaratadi — u kartangizga bog'langan. Ro'yxatdan o'tgach status, mablag', hisobotlarni o'zingiz ko'rasiz.`,
    ru: `Мини-апп по инвайту: владельцу — от агента Octane, водителю — владелец генерирует в Fleet. После регистрации всё self-service.`,
  },
  {
    id: 'KB-13',
    title: 'Octane Fuel mobile app',
    tags: ['mobile-app', 'stations', 'prices', 'cheapest fuel'],
    triggers: ['app', 'ilova', 'cheapest station', 'arzon zapravka', 'find fuel'],
    en: `The Octane Fuel app (iPhone: apps.apple.com/us/app/octane-fuel/id6744539302, Android: play.google.com/store/apps/details?id=com.tss.fuelapp) finds the cheapest in-network truck stops near you with live prices, plus dashboard, card management and AI voice navigation.`,
    uz: `Octane Fuel ilovasi (iPhone/Android) yaqin-atrofdagi eng arzon tarmoq shaxobchalarini jonli narxlar bilan topadi; dashboard, karta boshqaruvi va AI ovozli navigatsiya bor.`,
    ru: `Приложение Octane Fuel — самые дешёвые станции сети рядом, живые цены, управление картами, голосовая навигация.`,
  },
  {
    id: 'KB-14',
    title: 'Who can do what (role matrix)',
    tags: ['roles', 'rbac', 'driver', 'owner', 'permissions'],
    triggers: ['can a driver', 'driver qila oladimi', 'owner', 'what can i do', 'permissions'],
    en: `Drivers (their own card only): status, funds yes/no, own transactions/report (retail), PIN/Unit change, manual entry code, override, emergency money-code request (owner confirms). Owners: everything company-wide — balances with figures, all cards, activate/deactivate, limits, money codes, invoices, full reports (fleet or one card). The bot and mini-app enforce this automatically.`,
    uz: `Driver (faqat o'z kartasi): status, mablag' bor/yo'q, o'z tranzaksiyalari/hisoboti (retail), PIN/Unit, manual code, override, favqulodda money code so'rovi (owner tasdiqlaydi). Owner: butun kompaniya — raqamli balans, barcha kartalar, aktivlashtirish, limitlar, money code, invoice, to'liq hisobotlar (fleet yoki bitta karta).`,
    ru: `Водитель — только своя карта (без сумм); владелец — всё по компании. Бот/мини-апп следят за этим сами.`,
  },
  {
    id: 'KB-15',
    title: 'Transaction & account fees (EFS/WEX)',
    tags: ['fees', 'statement', 'charges', 'transaction fee'],
    triggers: ['what is this charge', 'why this fee', 'statementda nima', 'bu charge nima', 'fees'],
    en: `Common per-transaction fees on the EFS/WEX program schedule (may appear on your statement): funded fuel/product $1.50; funded fuel with cash $2.50; cash advance $3.50; terminal fuel $0.55; CAT Scale (app) $1.00; ATM withdrawal/inquiry/decline $1.00; ACH $1.00. Account-level: monthly account maintenance (MAMF) $7.95; account setup $75 (credit or self-fund only); wire under $2,500 $15; Western Union Quickpay $20; paper/third-party check $25. Money code fees: see the money-code article. The owner's statement shows the exact lines.`,
    uz: `EFS/WEX jadvali bo'yicha odatiy to'lovlar (statementda): funded fuel $1.50; fuel + naqd $2.50; cash advance $3.50; terminal fuel $0.55; CAT Scale $1.00; ATM $1.00; ACH $1.00. Hisob darajasida: oylik MAMF $7.95; account setup $75; wire ($2,500 dan kam) $15; Western Union $20; qog'oz check $25. Money code to'lovi — alohida maqolada.`,
    ru: `Типовые сборы EFS/WEX: топливо $1.50; топливо+нал $2.50; кэш-аванс $3.50; терминал $0.55; CAT Scale $1.00; ATM $1.00; ACH $1.00. По счёту: MAMF $7.95; открытие $75; wire до $2500 $15; Western Union $20; бумажный чек $25.`,
  },

  // ── Client-safe HOW-TO guides (procedural; describe using the mini-app / bot) ─────────────
  {
    id: 'KB-20',
    title: 'How to add a driver (owner)',
    tags: ['how-to', 'driver', 'add driver', 'invite', 'fleet'],
    triggers: ['add a driver', 'driver qoshish', 'invite driver', 'yangi driver', 'how to add driver'],
    en: `Owner: open the mini-app -> Fleet, pick the card the driver will use, and generate that driver's registration link (it is tied to that one card). Send the link to the driver; when they open it in Telegram they register and then see their own card's status, funds yes/no, and reports. One card = one driver link.`,
    uz: `Owner: mini-app -> Fleet, driver ishlatadigan kartani tanlang va o'sha driver uchun registratsiya linkini yarating (link bitta kartaga bog'lanadi). Linkni driverga yuboring; u Telegram'da ochib ro'yxatdan o'tadi va o'z kartasi statusini, mablag' bor/yo'qligini, hisobotlarini ko'radi.`,
  },
  {
    id: 'KB-21',
    title: 'How to pull a transaction report',
    tags: ['how-to', 'report', 'transactions', 'excel', 'single card'],
    triggers: ['how to get a report', 'report qanday olaman', 'transaction report', 'q2 report', 'report for one card', 'shu karta uchun report'],
    en: `Owner: mini-app -> Reports, choose the period (or exact dates) and format (Excel/PDF) — it covers the whole fleet. For ONE card, ask the bot for a report and name the card (its last digits) — the bot can scope a period report to a single card and send the file to your private chat. Driver: your report covers your own card only (retail prices).`,
    uz: `Owner: mini-app -> Reports, davr (yoki aniq sanalar) va format (Excel/PDF) tanlang — butun fleetni qamraydi. BITTA karta uchun botdan hisobot so'rang va kartani (oxirgi raqamlari) ayting — bot bitta karta bo'yicha davr hisobotini yasab, faylni shaxsiy chatingizga yuboradi. Driver: hisobot faqat o'z kartangizni qamraydi (retail narx).`,
  },
  {
    id: 'KB-22',
    title: 'How to raise a card gallon limit (owner)',
    tags: ['how-to', 'limit', 'raise limit', 'gallons'],
    triggers: ['raise the limit', 'limitni oshirish', 'increase gallon limit', 'change limit'],
    en: `Owner: mini-app -> Card management, pick the card, and set the daily gallon limit (ULSD/DEF). The new limit applies from the next fueling. You can also ask the bot to change a card's limit by naming the card's last digits.`,
    uz: `Owner: mini-app -> Card management, kartani tanlang va kunlik gallon limitini (ULSD/DEF) o'zgartiring. Yangi limit keyingi quyishdan amal qiladi. Kartaning oxirgi raqamlarini aytib, limitni botdan ham o'zgartirtira olasiz.`,
  },
  {
    id: 'KB-23',
    title: 'How to activate a card (owner)',
    tags: ['how-to', 'activate', 'card', 'deactivate', 'inactive'],
    triggers: ['activate card', 'kartani aktivlashtirish', 'card is inactive', 'turn card on'],
    en: `Owner: mini-app -> Card management, pick the card and toggle it active/inactive. Or ask the bot to activate/deactivate a card by its last digits (it confirms first). A card on Hold for Fraud cannot be permanently activated this way; permanent restoration requires Verification approval. If its live status explicitly offers a one-time override, that is temporary only.`,
    uz: `Owner: mini-app -> Card management, kartani tanlab active/inactive qiling. Yoki kartaning oxirgi raqamlarini aytib botdan aktivlashtiring (avval so'raydi). Hold for Fraud'dagi kartani bu yo'l bilan doimiy aktivlashtirib bo'lmaydi; Verification tasdig'i kerak. Live status bir martalik override'ni aniq ko'rsatsa, u faqat vaqtinchalik.`,
  },
  {
    id: 'KB-24',
    title: 'How to reach your Octane agent / support',
    tags: ['how-to', 'agent', 'support', 'contact', 'sales agent'],
    triggers: ['who is my agent', 'mani agentim kim', 'contact support', 'talk to a human', 'agentim'],
    en: `Your responsible Octane sales agent is shown when you ask the bot "who is my agent?". For anything the bot or mini-app can't do — card orders, disputes, account changes, unusual money-code cases — the bot can file a request ticket for Octane's team, who follow up. The support group here is monitored during business hours.`,
    uz: `Sizga biriktirilgan Octane sales agenti — botdan "mani agentim kim?" deb so'rasangiz ko'rsatiladi. Bot yoki mini-app qila olmaydigan ishlar uchun (karta buyurtma, nizolar, hisob o'zgarishlari, noodatiy money-code holatlari) bot Octane jamoasiga so'rov (ticket) ochadi, ular bog'lanadi.`,
  },

  // ── Client-safe TROUBLESHOOTING beyond the card-declined tree ─────────────────────────────
  {
    id: 'KB-30',
    title: 'Money code not working at checkout',
    tags: ['troubleshooting', 'money-code', 'declined', 'not working'],
    triggers: ['money code not working', 'kod ishlamayapti', 'money code declined', 'code rejected'],
    en: `If a money code is refused: 1) Make sure you entered the full code exactly, at an EFS-accepting point. 2) A code has a usage/amount limit — if it was already used up, that's why (each extra use also adds a $0.75 fee). 3) The code may have expired or been voided. 4) Confirm the amount was within the account's drawable limit. Ask the bot to check the code's status, or have the owner re-issue it.`,
    uz: `Money code qabul qilinmasa: 1) Kodni to'liq va aniq, EFS qabul qiladigan joyda kiritganingizga ishonch hosil qiling. 2) Kodning ishlatish/summa limiti bor — tugagan bo'lsa shu sabab (har qo'shimcha ishlatishga $0.75). 3) Kod muddati tugagan yoki bekor qilingan bo'lishi mumkin. 4) Summa hisob limitida bo'lganini tekshiring. Botdan kod statusini so'rang yoki owner qayta chiqarsin.`,
  },
  {
    id: 'KB-31',
    title: 'Card has not arrived yet',
    tags: ['troubleshooting', 'card', 'delivery', 'not received', 'shipping'],
    triggers: ['card not arrived', 'karta kelmadi', 'where is my card', 'card shipping'],
    en: `Regular-mail cards take 7-10 business days (free, no tracking); FedEx Overnight ($21.50) is faster but weather can delay it. Check the mini-app (Track my card) for status. If it's past 10 business days for regular mail, ask the bot to file a card-replace/track request to your Octane agent.`,
    uz: `Oddiy pochta kartasi 7-10 ish kuni (bepul, trekingsiz); FedEx Overnight ($21.50) tezroq, lekin ob-havo kechiktirishi mumkin. Holatini mini-app'da (Track my card) ko'ring. Oddiy pochtada 10 ish kunidan oshsa, botdan Octane agentingizga karta-replace/track so'rovini ochtiring.`,
  },
  {
    id: 'KB-32',
    title: 'Card statuses and PIN behavior',
    tags: ['card', 'status', 'active', 'hold', 'inactive', 'fraud', 'pin'],
    triggers: ['what does hold mean', 'card status', 'inactive pin', 'hold for fraud', 'karta statusi'],
    en: `Active means the card can be used and its PIN works normally. Standard Hold temporarily blocks the card but preserves the PIN for reactivation. Inactive blocks the card and disables its PIN; after reactivation the PIN resets to the card's last 4 digits and the driver must set it again. Hold for Fraud fully closes the card because of suspected or confirmed fraud and cannot be permanently reactivated without Verification approval. A temporary one-time override is separate and may be offered only when the live card result marks it available.`,
    uz: `Active — karta ishlaydi va PIN odatdagidek ishlaydi. Oddiy Hold kartani vaqtincha bloklaydi, lekin PIN saqlanadi. Inactive kartani bloklaydi va PIN'ni o'chiradi; qayta aktivlashtirilganda PIN kartaning oxirgi 4 raqamiga qaytadi va driver uni qayta o'rnatadi. Hold for Fraud — fraud sabab to'liq yopilish va Verification tasdig'isiz doimiy aktivlashtirib bo'lmaydi. Vaqtinchalik bir martalik override alohida bo'lib, faqat live natija mavjudligini ko'rsatsa taklif qilinadi.`,
    ru: `Active — карта работает. Обычный Hold временно блокирует карту, но сохраняет PIN. Inactive отключает PIN; после активации PIN сбрасывается на последние 4 цифры. Hold for Fraud нельзя активировать постоянно без одобрения Verification. Разовый временный override возможен только если live-статус карты явно показывает его доступность.`,
  },
  {
    id: 'KB-33',
    title: 'Account types and credit routing',
    tags: ['account type', 'line of credit', 'loc', 'deposit', 'prepay', 'credit'],
    triggers: ['what account type', 'line of credit', 'prepay or deposit', 'how is loc decided', '21 cards'],
    en: `Octane accounts use one of three structures: Line of Credit (Octane funds an approved spending limit and invoices the client afterward), Deposit 1:1 (the client provides a security deposit equal to the spending limit), or Prepay (the client funds the balance before card use). Credit checks, LOC decisions, and spending-limit assignments are made only by Verification, not Customer Support. Requests for 1-20 cards follow Octane's Verification review. Requests for 21 or more cards require a WEX-funded application; if that application is declined, the available structures are Prepay or Deposit 1:1.`,
  },
  {
    id: 'KB-34',
    title: 'Limit increase eligibility',
    tags: ['credit-limit', 'increase', 'eligibility', 'invoice', 'insurance', 'plaid'],
    triggers: ['increase my credit limit', 'limit increase requirements', 'why was increase declined', 'oshirish shartlari'],
    en: `Customer Support can collect a limit-increase request, but Verification makes the decision. Eligibility requires at least 5 fully paid invoices, active insurance shown on FMCSA, fewer than 10 late-payment occurrences, and fresh financial data through new bank statements or a refreshed Plaid/Stripe connection. The maximum increase in one review cycle is $5,000. Fleet expansion also requires proof such as a purchase, lease, or registration document.`,
  },
  {
    id: 'KB-35',
    title: 'Account reactivation requirements',
    tags: ['reactivation', 'inactive account', 'fmcsa', 'billing form', 'plaid'],
    triggers: ['reactivate account', 'account inactive 45 days', 'what do i need to reactivate', 'qayta aktivlashtirish'],
    en: `An account with no transactions, card use, or confirmed client activity for 45 consecutive days must complete the full reactivation process. Verification confirms active FMCSA authority and checks payment history; the client must sign a new Billing Form and reconnect the bank account through a new Plaid link. All steps are required, and Verification gives final approval. Ask Octane support to send the current form and secure reconnection link.`,
  },
  {
    id: 'KB-36',
    title: 'Plaid identity and financial verification',
    tags: ['plaid', 'identity', 'bank', 'selfie', 'verification'],
    triggers: ['what is plaid', 'plaid link', 'identity check', 'bank verification', 'selfie verification'],
    en: `Plaid is the third-party verification flow used by WEX and Octane for identity and, when required, financial data. WEX sends a direct secure link that the applicant opens on a mobile browser. The flow may request address, date of birth and the last 4 digits of SSN, a government-issued ID photo, a selfie, or a bank connection. Completion sends the result to WEX's Risk Platform for review; a completed check is not itself a credit approval. Use only the link sent for your application and contact Octane support if it fails.`,
  },
  {
    id: 'KB-37',
    title: 'Insurance status and FMCSA updates',
    tags: ['insurance', 'fmcsa', 'frozen', 'card block'],
    triggers: ['insurance expired', 'why is limit frozen', 'fmcsa update', 'insurance document'],
    en: `Octane verifies operating insurance status from the FMCSA public record. A certificate, screenshot, insurer email, or verbal confirmation does not replace an active FMCSA record. When an issue is detected, the spending limit may be frozen while the client updates the policy; if FMCSA still does not show the update after the notice period, cards may be blocked. Once FMCSA shows active insurance, Verification reviews restoration of cards and limits.`,
  },
  {
    id: 'KB-38',
    title: 'Lost, stolen, replacement, and additional cards',
    tags: ['card', 'lost', 'stolen', 'replace', 'new-card', 'fleet expansion'],
    triggers: ['lost card', 'stolen card', 'replacement', 'additional card', 'new driver card'],
    en: `For a lost or stolen card, deactivate the affected card immediately and ask Octane support to open a one-for-one replacement request. Requests for a new driver or fleet expansion are reviewed by Verification and may require proof of the added truck, such as a purchase document, lease agreement, or registration. Customer Support records and routes the request; it does not approve or issue additional cards directly.`,
  },
];
