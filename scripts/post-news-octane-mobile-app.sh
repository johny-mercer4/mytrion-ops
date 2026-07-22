#!/usr/bin/env bash
# Publishes the "Octane Fuel mobile app" announcement to ALL clients (owners + drivers),
# pinned, 4 languages, with the App Store artwork. One-shot; safe to re-run only if you
# want a second copy — /v1/client-news has no dedupe (each POST is a new post).
#
# Usage:  BASE=http://localhost:3000 API_KEY=$OCTANE_INTERNAL_API_KEY ./scripts/post-news-octane-mobile-app.sh
set -euo pipefail
: "${BASE:?BASE (backend url) kerak}"
: "${API_KEY:?API_KEY (OCTANE_INTERNAL_API_KEY) kerak}"

IMG="https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/65/01/62/650162fd-5cbc-6560-2381-f16afd920885/Placeholder.mill/1200x630wa.jpg"
GP="https://play.google.com/store/apps/details?id=com.tss.fuelapp&pcampaignid=web_share"
AS="https://apps.apple.com/us/app/octane-fuel/id6744539302"

curl -sS -X POST "$BASE/v1/client-news" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "audience_scope": "all",
  "roles": ["owner", "driver"],
  "severity": "info",
  "pinned": true,
  "title": {
    "en": "📱 The Octane Fuel mobile app is here",
    "ru": "📱 Мобильное приложение Octane Fuel уже доступно",
    "uz": "📱 Octane Fuel mobil ilovasi tayyor",
    "es": "📱 La app móvil de Octane Fuel ya está disponible"
  },
  "body": {
    "en": "<img src=\"$IMG\" alt=\"Octane Fuel app\"><p><b>Fuel discounts, truck stop search, card management and AI voice navigation</b> — now in one app.</p><ul><li>Dashboard &amp; wallet for owners and drivers</li><li>Find the cheapest truck stops nearby</li><li>Manage cards and fraud protection on the go</li></ul><p>📲 <a href=\"$AS\">Download for iPhone (App Store)</a><br>🤖 <a href=\"$GP\">Download for Android (Google Play)</a></p>",
    "ru": "<img src=\"$IMG\" alt=\"Octane Fuel app\"><p><b>Скидки на топливо, поиск трак-стопов, управление картами и голосовая AI-навигация</b> — теперь в одном приложении.</p><ul><li>Дашборд и кошелёк для владельцев и водителей</li><li>Самые дешёвые трак-стопы рядом</li><li>Управление картами и защитой от фрода на ходу</li></ul><p>📲 <a href=\"$AS\">Скачать для iPhone (App Store)</a><br>🤖 <a href=\"$GP\">Скачать для Android (Google Play)</a></p>",
    "uz": "<img src=\"$IMG\" alt=\"Octane Fuel app\"><p><b>Yoqilg'i chegirmalari, truck stop qidiruv, karta boshqaruvi va AI ovozli navigatsiya</b> — endi bitta ilovada.</p><ul><li>Owner va driver uchun dashboard va hamyon</li><li>Yaqin-atrofdagi eng arzon truck stoplar</li><li>Kartalar va fraud himoyasini yo'lda boshqarish</li></ul><p>📲 <a href=\"$AS\">iPhone uchun yuklab olish (App Store)</a><br>🤖 <a href=\"$GP\">Android uchun yuklab olish (Google Play)</a></p>",
    "es": "<img src=\"$IMG\" alt=\"Octane Fuel app\"><p><b>Descuentos de combustible, búsqueda de truck stops, gestión de tarjetas y navegación por voz con IA</b> — ahora en una sola app.</p><ul><li>Panel y billetera para dueños y conductores</li><li>Los truck stops más baratos cerca de usted</li><li>Gestione tarjetas y protección antifraude en el camino</li></ul><p>📲 <a href=\"$AS\">Descargar para iPhone (App Store)</a><br>🤖 <a href=\"$GP\">Descargar para Android (Google Play)</a></p>"
  },
  "carrier_ids": []
}
JSON
echo
echo "OK — news e'lon qilindi (mini-app Inbox → News tabda, pinned)."
