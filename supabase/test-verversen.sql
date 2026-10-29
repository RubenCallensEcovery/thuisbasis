-- Testversie verversen: gooit de testgegevens weg en zet er een verse kopie van de echte gegevens in.
-- Supabase → SQL Editor → Run. De echte gegevens worden NIET aangeraakt.
begin;
delete from public.docs where col like 'test~%';
insert into public.docs(col, id, data)
  select 'test~' || col, id, data from public.docs where col not like 'test~%' and col <> 'notifs';
commit;
