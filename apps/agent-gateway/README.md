# octane-agent-gateway (v2 MVP)

Claude Agent SDK asosidagi support-bot gateway — per-chat sessiyalar (MULTISESSION_ARCH).
MVP: BITTA guruh, long-poll. RBAC — mytrion /v1/support-bot (o'zgarmagan).

## Ishga tushirish (Mac)
```bash
cd apps/agent-gateway
cp .env.example .env    # to'ldiring (bot token, setup-token, OCTANE_*)
pnpm install
pnpm dev
```
Eslatma: v1 (hamroh) bot bilan BIR VAQTDA yurgizmang — bitta bot tokenni faqat bitta
consumer poll qila oladi. v1'ni to'xtatib v2'ni sinang (yoki alohida test-bot token bering).

## v1'dan farqlar (MVP kesimlari)
- Rasm o'qish hali yo'q (photo kelsa bot last-digits so'raydi) — keyingi qadam: Bot API
  getFile → SDK'ga image block.
- Skills alohida fayllar emas — persona bitta prompts/octane.md ichida (matn v1'dan).
- Multi-chat: allowed()/carrier'ni chat-map kesh bilan almashtirish (M-0 endpoint tayyor).
