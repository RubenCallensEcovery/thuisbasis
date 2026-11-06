# Planner (Android-app van Thuisbasis)

Android-app rond de bestaande webapp. **Staat volledig los van de webapp**: niets in `index.html`, `runtime.js`,
`sw.js` of de workflows Controle/Publiceren is hiervoor aangepast.

## Gegevens
De app laadt dezelfde site en gebruikt dezelfde Supabase-databank: alle gegevens zijn dezelfde als in de webapp
(Planner test → testgegevens, Planner → echte gegevens). Er wordt niets gekopieerd.

## Hoe het werkt
- **Capacitor-omhulsel** dat de site laadt: de testapp laadt `…/thuisbasis/test/`, de live-app `…/thuisbasis/`.
  Gewone updates van de webapp zijn dus meteen in de app, zonder nieuwe APK.
- **Koppelscript** `android/app/src/main/assets/thuis-app.js`: wordt enkel in de app in de pagina geladen.
  Leest om de 20 s (zolang de app open is) de herinneringen en machines van het gekozen gezinslid uit Supabase
  (alleen lezen, met de bestaande sessie) en geeft ze door aan Android.
- **Eigen plugin** (`android/app/src/main/java/be/callens/thuisbasis/`):
  - exacte alarmen via `AlarmManager.setAlarmClock` — ook als de app dicht is, na herstarten opnieuw ingepland;
  - eigen beltoon op het **alarmvolume** (werkt ook als de gsm op stil staat), trilt, volledig scherm op het vergrendelscherm;
    knoppen Gedaan / 10 min later / Stop (gaan rechtstreeks naar Supabase, of later als er geen netwerk is);
  - gewone herinneringen als melding op het juiste uur;
  - draaiende machine als blijvende melding die zelf aftelt, en een melding als ze klaar is.
- Snelkoppeling **Proefalarm**: lang drukken op het app-icoon.

## Bouwen
GitHub Actions (`.github/workflows/android.yml`) bouwt bij elke wijziging in `android-app/`:
| Branch | App | Download |
|---|---|---|
| `test` | Planner test (rode TEST-band) | https://github.com/RubenCallensEcovery/thuisbasis/releases/download/android-test/planner-test.apk |
| `main` | Planner | https://github.com/RubenCallensEcovery/thuisbasis/releases/download/android/planner.apk |

Beide apps kunnen naast elkaar geïnstalleerd zijn. Een nieuwe APK installeert gewoon over de vorige.

Ondertekening: enkel via GitHub-secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. Bewaar een reservekopie van de sleutel buiten GitHub: zonder dezelfde sleutel kan een
update niet over de bestaande app geïnstalleerd worden.

Lokaal: `npm ci && TB_VARIANT=test npm run sync`, daarna `cd android && ./gradlew assembleProefRelease` (Java 21, Android SDK).
Iconen en beltoon opnieuw maken: `python3 tools/assets.py`.

## Pushmeldingen (Firebase)
- Planner schrijft zijn Firebase-code in `push_subs` (`endpoint = fcm:…`, `sub = {fcm, env, app}`).
- `supabase/functions/notify` stuurt naar die toestellen via Firebase (geheim `FCM_SERVICE_ACCOUNT` in Supabase):
  gewone meldingen (wat anderen deden, afspraken, afval, voorraad, ochtend) én een **plan** per gezinslid
  (alarmen, herinneringen, machines) zodra er iets verandert. De app plant dat meteen exact in, ook als ze dicht is.
- De webapp krijgt nog altijd gewone webpush, ongewijzigd.
- Planner test krijgt meldingen uit de testgegevens.
- Bouwen: geheim `GOOGLE_SERVICES_JSON` (inhoud van `google-services.json`) in GitHub. Zonder dat geheim werkt de app, maar zonder push.
