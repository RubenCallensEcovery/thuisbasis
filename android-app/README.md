# Thuisbasis Android

Android-app rond de bestaande webapp. **Staat volledig los van de webapp**: niets in `index.html`, `runtime.js`,
`sw.js` of de workflows Controle/Publiceren is hiervoor aangepast.

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
| `test` | Thuisbasis test (rode TEST-band) | https://github.com/RubenCallensEcovery/thuisbasis/releases/download/android-test/thuisbasis-test.apk |
| `main` | Thuisbasis | https://github.com/RubenCallensEcovery/thuisbasis/releases/download/android/thuisbasis.apk |

Beide apps kunnen naast elkaar geïnstalleerd zijn. Een nieuwe APK installeert gewoon over de vorige.

Ondertekening: enkel via GitHub-secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. Bewaar een reservekopie van de sleutel buiten GitHub: zonder dezelfde sleutel kan een
update niet over de bestaande app geïnstalleerd worden.

Lokaal: `npm ci && TB_VARIANT=test npm run sync`, daarna `cd android && ./gradlew assembleProefRelease` (Java 21, Android SDK).
Iconen en beltoon opnieuw maken: `python3 tools/assets.py`.

## Beperking (nu)
Zonder pushdienst ziet de gsm nieuwe of gewijzigde herinneringen pas als de app eens geopend werd
(bv. een alarm dat Charlotte voor Ruben zet). Wat al gesynchroniseerd is, gaat altijd af.
