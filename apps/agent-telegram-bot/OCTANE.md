> **DEPRECATED (2026-07-22).** hamroh v1 is retired for Octane. The live bot is
> `apps/agent-gateway` (Claude Agent SDK, per-chat sessions). This folder stays only as the
> source of the skills/prompts that were ported. Do NOT run it: it shares the bot token with
> the gateway, and two getUpdates pollers on one token spam the client group with 409-Conflict
> tracebacks (observed live). The token in `.env` is commented out for this reason.

# agent-telegram-bot — Octane integratsiyasi

Hamroh (https://github.com/Rustam-Z/hamroh) asosidagi agentic Telegram bot, mytrion
monorepo'siga ko'chirilgan. HOZIRGI rejim: mini-app targ'ibot + tor RBAC servislar;
KEYIN: to'liq support agent.

## Arxitektura qarori: instance-per-carrier

Hamroh'da BITTA Claude sessiyasi barcha allowed chatlarga xizmat qiladi — shuning uchun
har klient guruhiga ALOHIDA konteyner ko'tariladi (cross-client izolyatsiya mutlaq).
Har instansiya o'z env'i bilan:

```
TELEGRAM_BOT_TOKEN=        # har guruh-bot uchun alohida bot yoki bitta bot? — alohida tavsiya
HAMROH_MODEL=claude-...
OCTANE_API_BASE=https://<mytrion-backend>
OCTANE_INTERNAL_API_KEY=   # mytrion .env'dagi OCTANE_INTERNAL_API_KEY
OCTANE_CARRIER_ID=5809710  # SHU instansiya xizmat qiladigan yagona carrier
OCTANE_GROUP_CHAT_ID=-100…# klient guruhi
```

## mytrion bilan bog'lanish nuqtalari

| Qatlam | Nima | Qayerda |
|---|---|---|
| RBAC + servislar | /v1/support-bot/{whoami,card-status,funds,txn-report,override,access} | mytrion src/routes/v1/supportBot.routes.ts — ROL registration'dan, carrier env'dan, javob rolga qarab kesilgan |
| Identity | registered_mini_app_companies — mini-app bilan BITTA manba | scripts/sync_octane_access.py access.json'ni shu bilan yangilaydi (boot + har 10 daq) |
| Mini-app deep-linklar | t.me/<bot>/<shortname>?startapp=go-<action> | prompts/project.md.octane dagi Actions bo'limi |
| CRM | Client News (targ'ibot e'lonlari CRM'dan chiqadi) | bot news YOZMAYDI — faqat og'zaki yo'naltiradi |
| Bot toollari | hamroh/tools/octane/* (5 ta) | model argumentiga ishonmaydi: sender oxirgi 5 daqiqada shu chatda yozganini o'z DB'sidan tekshiradi |

## Ishga tushirish (pilot: bitta guruh)

1. `cp prompts/project.md.octane prompts/project.md` — placeholderlarni to'ldiring
   ({BOT_USERNAME}, {MINIAPP_SHORT_NAME}).
2. `cp plugins.json.example plugins.json` — bash/code/subagents OFF qoladi (public bot!).
3. `python scripts/sync_octane_access.py` — access.json generatsiya (env'lar bilan).
4. `docker compose up -d --build` (compose fayliga OCTANE_* env passthrough qo'shing).
5. Sinov: guruhda driver "kartam ochilmayapti" desa → bot tasdiq so'raydi → override;
   owner "report kerak" desa → fayl owner'ning shaxsiy bot chatiga.

## Xavfsizlik invariantlari (qisqa)

- Rol HECH QACHON modeldan kelmaydi — registration'dan (server).
- Carrier HECH QACHON modeldan kelmaydi — instansiya env'idan.
- Driver: o'z kartasi, $ raqamlar yo'q, retail-only report. Owner: to'liq, lekin fayllar
  faqat shaxsiy chatga.
- Tool sender-verify: da'vo qilingan user shu chatda yaqinda yozgan bo'lishi shart.
- bash/code/subagents o'chiq; writes faqat override (flag ostida, 5/daq limit).

## Upstream'dan farqlar

- + hamroh/tools/octane/ (5 tool + _client.py)
- + scripts/sync_octane_access.py
- + prompts/project.md.octane, skills/octane-promo/
- .env, access.json, data/ nusxalanmagan (runtime; .example'lardan yarating)
- Upstream yangilanishlari: git subtree/manual diff bilan (bu nusxa 2026-07 holati)
