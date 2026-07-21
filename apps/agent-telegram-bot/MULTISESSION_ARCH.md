# Multi-session arxitektura — 40 kompaniya, bitta bot, parallel savollar

## Muammo

Hamroh hozir: BITTA Claude Code sessiyasi, barcha chatlar bitta suhbatga tushadi, turnlar
ketma-ket. 10 guruh + ~30 yangi kompaniya bilan bu ikki joyda sinadi:
1. **Parallellik**: A guruh savoli javob olguncha B guruh kutadi (turn 5-30s → navbat).
2. **Izolyatsiya**: bitta sessiya kontekstida hamma kompaniya suhbatlari — sizish xavfi.
3. **Telegram cheklovi**: bitta bot token = bitta getUpdates consumer. Instance-per-carrier
   faqat har kompaniyaga ALOHIDA bot bilan ishlaydi (brend/ops jihatdan yomon). Bitta
   @octane_support_ai_bot bo'lishi uchun baribir YAGONA gateway kerak.

## Yechim: 1 gateway + per-chat sessiya pool

```
Telegram (1 bot token, webhook)
   │
   ▼
Gateway/Dispatcher ── access + rate limit (mavjud)
   │  chat_id bo'yicha marshrut
   ▼
SessionManager                     mytrion
   chat_id → CCWorker sessiya      /support-bot/chat-map: chat_id → carrier_id
   pool cap (masalan 12 warm)      (support_bot_chats jadvali, CRM'da boshqariladi)
   LRU evict + context restore     │
   │ per-chat SERIAL,              ▼
   │ cross-chat PARALLEL      har tool-chaqiriq: carrier = lookup(chat_id)
   ▼                          + registration.carrier == chat.carrier (ikki tomonlama)
CCWorker × N (claude subprocess'lar)
   │
   ▼ MCP tools (umumiy server, chat-scoped kontekst)
```

### Asosiy qarorlar

**S1 — Sessiya kaliti = chat_id.** Har guruh o'z Claude sessiyasiga ega: kontekst faqat o'z
guruhining xabarlari (DB per-chat filtr — dispatcher allaqachon chat_id bilan saqlaydi;
engine/restore.py digest'i chat bo'yicha chegaralanadi). Guruh ichida ketma-ketlik qoladi —
bu TO'G'RI (bitta suhbat), guruhlar ORASIDA parallel.

**S2 — Pool + LRU.** `CC_MAX_SESSIONS` (boshlang'ich 12) warm subprocess. Aktiv chat warm
sessiyada; sust chat idle-TTL'dan keyin evict — keyingi xabarda restore-digest bilan qayta
ochiladi (hamroh'da restore mexanizmi BOR, faqat per-chat qilinadi). 40 guruh × ~75 xabar/kun
o'rtacha — 12 warm yetarli; peak'da navbat per-chat bo'lgani uchun UX buzilmaydi.

**S3 — Carrier endi ENV emas, chat-map'dan.** Yangi mytrion jadvali `support_bot_chats`
(chat_id PK, carrier_id, enabled, created_by) + `GET /support-bot/chat-map` (+ CRM admin
bo'limi keyin). Octane toollari carrierni chat_id'dan oladi (5 daq keshlangan lookup).
Ikki tomonlama tekshiruv o'zgarmaydi:
- sender_spoke_recently: da'vo qilingan user AYNAN SHU chatda yaqinda yozgan (mavjud);
- backend: registration.carrier == chat-map(chat_id).carrier — model chat_id'ni ham,
  userni ham soxtalashtira olmaydi, ikkalasi bir nuqtaga kelishi shart.

**S4 — Webhook rejimi.** 40 guruhda long-poll ham ishlaydi, lekin webhook (secret token
bilan) latency va restartlarda barqarorroq. Gateway bitta bo'lgani uchun oddiy Fastify/
Starlette endpoint.

**S5 — Xotira/skills umumiy, sessiya-kontekst alohida.** prompts/skills/KB — bitta
(read-only, hamma sessiyaga bir xil). Har sessiyaning suhbat-xotirasi faqat o'z chat'i.
memories/ (o'rganilgan qoidalar) — global, lekin faqat operator tasdiqlagan self-reflection
orqali (mavjud oqim).

## Hamroh fork'idagi konkret ishlar (M-1)

1. `engine/` va `cc_worker/`ni klassga o'rash allaqachon bor — SessionManager yozish:
   dict[chat_id → (Engine, CCWorker)], get_or_spawn, idle_evict (TTL 15 daq), pool cap
   yetganda eng eski idle'ni evict.
2. dispatcher.submit → session_manager.route(msg.chat_id).submit(msg).
3. restore digest'ni chat_id bilan filtrlash (fetch_recent_messages allaqachon chat_id oladi).
4. tools/octane/_client: OCTANE_CARRIER_ID env o'rniga `carrier_for_chat(chat_id)` (backend
   chat-map, TTL-kesh; env qiymati fallback — bitta-kompaniya deploy rejimi saqlanadi).
5. MCP server umumiy qoladi (stateless toollar) — o'zgarish yo'q.
6. Config: CC_MAX_SESSIONS, SESSION_IDLE_TTL, WEBHOOK_URL/SECRET.

## mytrion tomonida (M-0, kichik)

- migratsiya: support_bot_chats (chat_id text PK, tenant_id, carrier_id, enabled bool,
  created_by, created_at) — qo'lda, 0034+.
- /v1/support-bot/chat-map (GET, internal key) + chat qo'shish endpoint (admin RBAC).
- supportBot.routes: har servis chaqirig'ida chatId ham keladi → carrier = chat-map lookup,
  so'ng registration.carrier bilan solishtirish (hozirgi carrierId param o'rnini bosadi).

## Bosqichlar

- **M-0 (0.5 kun):** chat-map jadval + endpointlar (mytrion) — hozirgi single-carrier bot
  bilan orqaga mos (env fallback).
- **M-1 (2-3 kun):** SessionManager fork + per-chat restore + tools chat-scoped carrier.
  Pilot: 2 guruh bitta instansiyada parallel.
- **M-2:** webhook, metrics (turn latency per chat, pool occupancy), 40 guruhga rollout;
  kerak bo'lsa gorizontal: k instansiya × pool, chat_id % k sharding (webhook router).

## Nima O'ZGARMAYDI

RBAC yuzasi (/v1/support-bot/*), rol-matritsa, driver own-card, registered-only qoidasi,
skills/KB, access sync — bularning hammasi sessiya modelidan mustaqil yozilgan edi.
