-- Capture Telegram's language_code on the mini-app registration so the notification outbox can
-- render bot copy in the user's language (templates.ts is already 4-lang; the value was missing).
-- Hand-written like 0025-0033 (snapshot chain fork predates us). Idempotent — safe on fresh + existing.
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "language_code" text;
