# octane-agent-gateway

Claude Agent SDK asosidagi Telegram customer-service gateway. Har bir `(chat, user)` uchun
alohida session/queue ishlaydi: bitta userning so'rovlari tartib bilan, boshqa userlar parallel.
Mapped kompaniya guruhlari va mini-app orqali tasdiqlangan owner/manager private chatlari
qo'llab-quvvatlanadi. RBAC manbasi — Mytrion `/v1/support-bot`.

## Ishga tushirish (Mac)
```bash
cd apps/agent-gateway
cp .env.example .env    # to'ldiring (bot token, setup-token, OCTANE_*)
pnpm install
pnpm dev
```
Eslatma: v1 (hamroh) bot bilan BIR VAQTDA yurgizmang — bitta bot tokenni faqat bitta
consumer poll qila oladi. v1'ni to'xtatib v2'ni sinang (yoki alohida test-bot token bering).

## Access modeli

- Group: chat-map orqali carrier aniqlanadi; ro'yxatdan o'tgan owner/manager/driver botni tag qiladi.
- Private DM: carrier Telegram user id bo'yicha ACTIVE mini-app registrationdan olinadi; faqat
  `owner` va `manager`. Driverlar kompaniya support guruhida ishlaydi.
- Model `carrierId`, role yoki haqiqiy Telegram identity'ni tanlamaydi — gateway/backend context
  ularni server-side bog'laydi.
- Confirmation buttonlar `(chatId, messageId, userId)` ga bog'langan, 10 daqiqada eskiradi va
  faqat bir marta ishlaydi.

## Offline stress test

Bu harness real client, Telegram, Mytrion API, EFS yoki Claude'ga request yubormaydi. Process
ichida `fetch` bloklanadi va token failover faqat fake tokenlar bilan tekshiriladi.

```bash
cd apps/agent-gateway
pnpm stress:offline --users 100 --messages 10 --concurrency 12 \
  --delay-ms 20 --progress-ms 250
```

Terminalda progress real-time ko'rinadi:

```text
LIVE 480/1000 (48.0%) · active=12 · queued=... · rate=.../s · elapsed=... · rss=...MB
```

CI yoki natijani faylga olish uchun progresssiz JSON:

```bash
pnpm --silent stress:offline --users 100 --messages 10 --concurrency 12 --json
```

Bir run maksimum 1,000,000 synthetic turn bilan cheklangan. Yakuniy `PASS` user queue tartibi,
global concurrency limiti, button ownership/replay/expiry, write-risk classification va fake-token
rotation invariantlari buzilmaganini bildiradi.
