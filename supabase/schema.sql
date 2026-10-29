-- Thuisbasis: databank-schema. Plak dit in Supabase → SQL Editor → Run.

-- 1. Alle gegevens van de app (agenda, lijstjes, ...) als documenten per collectie
create table if not exists public.docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs replica identity full;

-- velden samenvoegen (gedeeltelijk bijwerken)
create or replace function public.doc_merge(p_col text, p_id text, p_patch jsonb)
returns void language sql security invoker as $$
  insert into public.docs(col, id, data) values (p_col, p_id, p_patch)
  on conflict (col, id) do update set data = public.docs.data || excluded.data, updated_at = now();
$$;

-- 2. Pushmeldingen: één rij per toestel
create table if not exists public.push_subs (
  endpoint text primary key,
  member text not null,
  sub jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3. Welke meldingen al verstuurd zijn (geen dubbels)
create table if not exists public.push_sent (
  key text primary key,
  at timestamptz not null default now()
);

-- 4. Beveiliging: enkel ingelogde gezinsleden (het gezinsaccount) mogen erbij
alter table public.docs enable row level security;
alter table public.push_subs enable row level security;
alter table public.push_sent enable row level security;

drop policy if exists "gezin leest" on public.docs;
drop policy if exists "gezin schrijft" on public.docs;
create policy "gezin leest" on public.docs for select to authenticated using (true);
create policy "gezin schrijft" on public.docs for all to authenticated using (true) with check (true);

drop policy if exists "gezin toestellen" on public.push_subs;
create policy "gezin toestellen" on public.push_subs for all to authenticated using (true) with check (true);
-- push_sent: enkel de server (service role) gebruikt deze tabel

-- toegang voor ingelogde gebruikers (de rijbeveiliging hierboven bepaalt wat ze mogen)
grant select, insert, update, delete on public.docs to authenticated;
grant select, insert, update, delete on public.push_subs to authenticated;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;

-- 5. Live synchronisatie tussen toestellen
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
