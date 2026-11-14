-- =====================================================================
-- 019_pointage_ignorer.sql — « Ne pas compter ce pointage » (correction)
-- Suppose : 001 à 018 déjà appliquées.
-- Ce que fait cette migration :
--   pointages.ignorer : la journée garde les heures prévues au planning dans le reliquat
--   (le pointage reste visible et dans le journal). Le journal note le changement.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.pointages add column if not exists ignorer boolean not null default false;

create or replace function public.journal_pointages() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text := 'HH24:MI'; avant text; apres text;
begin
  if coalesce(current_setting('evy.source', true), '') = 'qr' then return null; end if;
  avant := case when tg_op = 'INSERT' then '—' else coalesce(to_char(old.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(old.sortie at time zone 'Europe/Paris', h), '—') || case when old.ignorer then ' (non compté)' else '' end end;
  apres := case when tg_op = 'DELETE' then '—' else coalesce(to_char(new.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(new.sortie at time zone 'Europe/Paris', h), '—') || case when new.ignorer then ' (non compté)' else '' end end;
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
    values (case when tg_op = 'DELETE' then 'EFFACEMENT' else 'CORRECTION' end,
            coalesce(new.equipe_id, old.equipe_id), auth.uid(), coalesce(new.jour, old.jour),
            'avant ' || avant || ' · après ' || apres ||
            case when tg_op <> 'DELETE' and new.note is not null then ' · note : ' || new.note else '' end);
  return null;
end $$;

insert into public.parametres(cle, valeur) values ('schema_version', '"019"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
