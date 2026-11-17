-- 030 : cabinet de chaque dentiste (occupation des cabinets)
--   cabinet    : cabinet habituel du dentiste (1 à 8), vide si non renseigné
--   cab_jours  : cabinet pour un jour précis, quand il diffère de l'habituel — {"2026-11-18": 4}
-- À lancer dans l'éditeur SQL de Supabase : d'abord sur Evydent-Dev, puis sur Evydent-Prod à la validation.

alter table public.dentistes add column if not exists cabinet smallint;
alter table public.dentistes add column if not exists cab_jours jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dentistes_cabinet_1_8') then
    alter table public.dentistes add constraint dentistes_cabinet_1_8 check (cabinet is null or cabinet between 1 and 8);
  end if;
end $$;

insert into public.parametres(cle, valeur) values ('schema_version', '"030"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
