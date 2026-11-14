-- =====================================================================
-- 025 · Semaine type avec date d'effet (versions)
--  1. Table equipe_trames : une version de semaine type par personne et par date de départ (un lundi).
--     La version en vigueur une semaine donnée est la dernière dont la date de départ est
--     avant ou égale à ce lundi. Les semaines d'avant gardent l'ancienne version.
--     equipe.trame reste la copie de la dernière version (compatibilité).
--     Avant la première version, c'est la première version qui s'applique.
--  2. Protection : on ne peut ni créer, ni modifier, ni supprimer une version si cela changerait
--     une semaine déjà clôturée (sauf la toute première version, copie de la semaine type actuelle).
-- Lecture : comptes actifs. Écriture : référente et responsable.
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.equipe_trames (
  id bigint generated always as identity primary key,
  equipe_id bigint not null references public.equipe(id) on delete cascade,
  depuis date not null,
  trame jsonb not null default '{}'::jsonb,
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  unique (equipe_id, depuis)
);

alter table public.equipe_trames enable row level security;
drop policy if exists lecture on public.equipe_trames;
create policy lecture on public.equipe_trames for select to authenticated using (public.est_actif());
drop policy if exists ecriture on public.equipe_trames;
create policy ecriture on public.equipe_trames for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
grant select, insert, update, delete on public.equipe_trames to authenticated;

-- Une version couvre les semaines de « depuis » jusqu'à la version suivante (exclue).
create or replace function public.proteger_trame_cloturee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_eq bigint; v_de date; v_suiv date;
begin
  if tg_op = 'DELETE' then v_eq := old.equipe_id; v_de := old.depuis;
  else v_eq := new.equipe_id; v_de := new.depuis; end if;
  if tg_op = 'UPDATE' and old.depuis < v_de then v_de := old.depuis; end if;
  -- Première version d'une personne, identique à sa semaine type actuelle : rien ne change, toujours permis
  if tg_op = 'INSERT' and not exists (select 1 from public.equipe_trames t where t.equipe_id = v_eq)
     and new.trame = coalesce((select e.trame from public.equipe e where e.id = v_eq), '{}'::jsonb) then return new; end if;
  select min(t.depuis) into v_suiv from public.equipe_trames t
   where t.equipe_id = v_eq and t.depuis > v_de and (tg_op = 'INSERT' or t.id <> coalesce(old.id, -1));
  if exists (select 1 from public.semaines_cloturees s where s.lundi >= v_de and (v_suiv is null or s.lundi < v_suiv)) then
    raise exception 'Une semaine clôturée serait modifiée : choisissez une date après la dernière semaine clôturée';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists proteger_trame_cloturee on public.equipe_trames;
create trigger proteger_trame_cloturee before insert or update or delete on public.equipe_trames
  for each row execute function public.proteger_trame_cloturee();

insert into public.parametres(cle, valeur) values ('schema_version', '"025"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
