# Thuisbasis

Gezinsplanner van de familie Callens — agenda, eten, huishouden, opvang, rugzak en Jonah.

## Twee versies
| Versie | Branch | Adres | Gegevens |
|---|---|---|---|
| **Live** (voor het gezin) | `main` | `https://rubencallensecovery.github.io/thuisbasis/` | echte gegevens |
| **Test** | `test` | `https://rubencallensecovery.github.io/thuisbasis/test/` | eigen kopie (`test~…`) |

Werkwijze: aanpassingen gaan eerst naar `test`. Bij elke wijziging draait automatisch een controle
(`tests/check.mjs`: code geldig, `tests/smoke.mjs`: app start en alle schermen werken). Faalt die, dan wordt er niets gepubliceerd.
Live zetten = `test` samenvoegen in `main` (pull request), opnieuw met controle. Elke versie blijft bewaard: terugdraaien kan altijd.

## Onderdelen
- `index.html` — de app
- `runtime.js` — verbindt de app met Supabase (gegevens, live sync, inloggen), Jonah en het weer (Open-Meteo)
- `config.js` — publieke instellingen (Supabase-adres, anon-sleutel, publieke push-sleutel)
- `sw.js`, `manifest.webmanifest`, `icons/` — installeerbare app + pushmeldingen
- `supabase/schema.sql` — databank en beveiliging
- `supabase/functions/jonah` — Jonah via de Claude API (sleutel als geheim in Supabase)
- `supabase/functions/notify` — pushmeldingen, elke 5 minuten via `supabase/cron.sql`
- `supabase/test-verversen.sql` — testgegevens vervangen door een kopie van de echte gegevens

## Geheimen (enkel in Supabase → Edge Functions → Secrets, nooit in deze repo)
`ANTHROPIC_API_KEY`, `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT`, `CRON_SECRET` (optioneel `JONAH_MODEL`).

## Emoji
Vlakke emoji via het Twemoji-lettertype (`fonts/twemoji.woff2`, twemoji-colr-font 15.0.3). Grafiek © Twitter/X en medewerkers, CC-BY 4.0; lettertype onder SIL OFL (zie `fonts/LICENSE-twemoji.txt`).
