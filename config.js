/* Thuisbasis — instellingen per omgeving.
   Deze sleutels zijn publiek (ze staan in elke webpagina); de beveiliging zit in Supabase (enkel het gezinsaccount kan erbij). */
window.TB_CONFIG = {
  supabaseUrl: 'VUL_IN_PROJECT_URL',          // bv. https://abcd1234.supabase.co
  supabaseKey: 'VUL_IN_ANON_KEY',             // "anon public" sleutel
  vapidPublic: 'BCwJmmh6jsmr2uKlwLha5DxQGrlFxLpOPitqGWaDY7YWpyYbGIMGKs5LvoRurLom2efREUKbT5fNYEqhKOaLphs',         // publieke sleutel voor pushmeldingen
  env: 'live'                                 // 'live' of 'test' (de testversie krijgt automatisch 'test')
};
