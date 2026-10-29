# Thuisbasis — werkafspraken voor Claude

Gezinsapp van Ruben Callens (Tielt). Communiceer in het Nederlands (Vlaams), kort en concreet.

## Werkwijze (altijd volgen)
1. Elke aanpassing gebeurt op branch **`test`**. Nooit rechtstreeks op `main`.
2. Na elke aanpassing: `node tests/check.mjs` lokaal draaien, dan committen en `test` pushen.
   GitHub Actions controleert (Controle) en publiceert (Publiceren) automatisch naar
   https://rubencallensecovery.github.io/thuisbasis/test/ (eigen testgegevens, geen pushmeldingen).
3. Vraag Ruben de testversie na te kijken.
4. Pas als Ruben uitdrukkelijk zegt **"zet live"**: `test` fast-forward samenvoegen in `main` en pushen.
   Live: https://rubencallensecovery.github.io/thuisbasis/
5. Wijzigingen aan Supabase (schema, functies in `supabase/functions`) gaan meteen naar het ene Supabase-project
   (`yuuswitngpoxitlycvzb`), dus enkel na akkoord en achterwaarts compatibel houden; zet de code ook in de repo.

## Opbouw
- `index.html`: de volledige app (één bestand). Data via `window.claude.use('db')`, dat in `runtime.js` naar Supabase gaat
  (tabel `docs`: col, id, data). In de testversie krijgen collecties het voorvoegsel `test~`.
- Jonah: `sample()` in `runtime.js` → edge function `jonah` → Anthropic API.
- Weer: Open-Meteo via de `mcp`-shim in `runtime.js`. Meldingen: `sw.js` + edge function `notify` (cron elke 5 min).
- Stijl: standaard Bauhaus (`html[data-style="bauhaus"]`), ook Strak en Glas.
- Geheimen staan enkel in Supabase → Edge Functions → Secrets; nooit in deze (publieke) repo.
