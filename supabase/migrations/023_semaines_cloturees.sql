-- =====================================================================
-- 023_semaines_cloturees.sql — Clôture de semaine (heures figées)
-- Suppose : 001 à 022 déjà appliquées.
-- Ce que fait cette migration :
--   1. Table semaines_cloturees : une ligne par semaine clôturée (lundi), qui l'a clôturée et quand,
--      et les heures figées de chaque personne (heures retenues et reliquat en fin de semaine).
--   2. cloturer_semaine(lundi, figes) et rouvrir_semaine(lundi) : référente et responsable,
--      notées dans le journal du pointage.
--   3. Une semaine clôturée ne se modifie plus : le planning et les pointages de ces jours-là
--      sont protégés (message « Semaine clôturée : rouvrez-la pour la modifier »).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.semaines_cloturees (
  lundi       date primary key check (extract(isodow from lundi) = 1),
  cloture_par uuid references public.profils(id) on delete set null,
  cloture_le  timestamptz not null default now(),
  figes       jsonb not null default '{}'::jsonb
);
alter table public.semaines_cloturees enable row level security;
drop policy if exists lecture on public.semaines_cloturees;
create policy lecture on public.semaines_cloturees for select to authenticated using (public.est_actif());
grant select on public.semaines_cloturees to authenticated;

create or replace function public.semaine_cloturee(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select d is not null and exists (select 1 from public.semaines_cloturees s where s.lundi = d - (extract(isodow from d)::int - 1));
$$;

create or replace function public.proteger_semaine_cloturee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.semaine_cloturee(case when tg_op = 'DELETE' then old.jour else new.jour end)
     or (tg_op = 'UPDATE' and public.semaine_cloturee(old.jour)) then
    raise exception 'Semaine clôturée : rouvrez-la pour la modifier';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists semaine_cloturee_planning on public.planning;
create trigger semaine_cloturee_planning before insert or update or delete on public.planning
  for each row execute function public.proteger_semaine_cloturee();
drop trigger if exists semaine_cloturee_pointages on public.pointages;
create trigger semaine_cloturee_pointages before insert or update or delete on public.pointages
  for each row execute function public.proteger_semaine_cloturee();

create or replace function public.cloturer_semaine(p_lundi date, p_figes jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  if extract(isodow from p_lundi) <> 1 then raise exception 'La semaine doit commencer un lundi'; end if;
  insert into public.semaines_cloturees(lundi, cloture_par, cloture_le, figes) values (p_lundi, auth.uid(), now(), coalesce(p_figes, '{}'::jsonb))
    on conflict (lundi) do update set cloture_par = auth.uid(), cloture_le = now(), figes = excluded.figes;
  insert into public.pointage_journal(evenement, profil_id, jour, detail) values ('SEMAINE_CLOTUREE', auth.uid(), p_lundi, 'semaine du ' || to_char(p_lundi, 'DD/MM/YYYY'));
end $$;

create or replace function public.rouvrir_semaine(p_lundi date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  delete from public.semaines_cloturees where lundi = p_lundi;
  insert into public.pointage_journal(evenement, profil_id, jour, detail) values ('SEMAINE_ROUVERTE', auth.uid(), p_lundi, 'semaine du ' || to_char(p_lundi, 'DD/MM/YYYY'));
end $$;

grant execute on function public.cloturer_semaine(date, jsonb) to authenticated;
grant execute on function public.rouvrir_semaine(date) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"023"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
