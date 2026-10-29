-- Meldingen elke 5 minuten laten controleren.
-- Vervang PROJECT_URL (bv. https://abcd1234.supabase.co) en CRON_SECRET (zelfde waarde als het geheim CRON_SECRET bij Edge Functions).
-- Vooraf: Database → Extensions → zet "pg_cron" en "pg_net" aan.
select cron.schedule(
  'thuisbasis-meldingen',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'PROJECT_URL/functions/v1/notify',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
       body := '{}'::jsonb
     ); $$
);
