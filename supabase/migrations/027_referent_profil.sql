-- =====================================================================
-- 027 · Référent(e) d'un profil (ex. « Référente administratif »)
-- Suppose : 001 à 026 déjà appliquées.
--  1. profils.referent_de : code du profil d'équipe que ce compte encadre (ex. « administratif »).
--     Vide pour tout le monde sauf le ou la référent(e). Réglé par la référente ou la responsable
--     (fonction definir_referent).
--  2. Droits du rôle : parametres « ref_droits » (planning_voir, planning_modif, conges_voir,
--     conges_valider, pointage, stock). Par défaut : voir et modifier le planning, voir les congés.
--  3. Le ou la référent(e) ne lit que les fiches, le planning, les congés (et le pointage si activé)
--     des personnes de SON profil. Rien sur les autres personnes ni sur les dentistes.
--  4. Table fermetures : qui ferme le centre chaque soir (désignation à la main ; sans ligne,
--     l'application propose la personne qui finit la dernière).
--  5. prenoms_fermeture() : prénoms de l'équipe, pour désigner quelqu'un d'un autre profil.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.profils add column if not exists referent_de text;
alter table public.profils drop constraint if exists profils_referent_de_check;
alter table public.profils add constraint profils_referent_de_check check (referent_de is null or referent_de ~ '^[a-z0-9_]{1,40}$');

create or replace function public.ref_de() returns text
language sql stable security definer set search_path = public as $$
  select referent_de from public.profils where id = auth.uid() and actif
$$;

create or replace function public.ref_droit(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ref_de() is not null and coalesce(
    (select (valeur->>k)::boolean from public.parametres where cle = 'ref_droits'),
    k in ('planning_voir', 'planning_modif', 'conges_voir'))
$$;

create or replace function public.ref_sur(eid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipe e where e.id = eid and e.type = public.ref_de())
$$;

create or replace function public.definir_referent(p_profil uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  update public.profils set referent_de = nullif(p_code, '') where id = p_profil and role = 'assistante';
  if not found then raise exception 'Compte introuvable (ou compte de gestion)'; end if;
end $$;
grant execute on function public.definir_referent(uuid, text) to authenticated;

-- Fiches de son profil
drop policy if exists lecture_ref on public.equipe;
create policy lecture_ref on public.equipe for select to authenticated
  using (public.ref_de() is not null and type = public.ref_de());

-- Planning de son profil
drop policy if exists lecture_ref on public.planning;
create policy lecture_ref on public.planning for select to authenticated
  using (public.ref_droit('planning_voir') and public.ref_sur(equipe_id));
drop policy if exists ecriture_ref on public.planning;
create policy ecriture_ref on public.planning for all to authenticated
  using (public.ref_droit('planning_modif') and public.ref_sur(equipe_id))
  with check (public.ref_droit('planning_modif') and public.ref_sur(equipe_id));

-- Congés de son profil : lecture ; réponse seulement si l'option est activée
drop policy if exists lecture_ref on public.conges;
create policy lecture_ref on public.conges for select to authenticated
  using (public.ref_droit('conges_voir') and equipe_id is not null and public.ref_sur(equipe_id));
drop policy if exists ecriture_ref on public.conges;
create policy ecriture_ref on public.conges for update to authenticated
  using (public.ref_droit('conges_valider') and equipe_id is not null and public.ref_sur(equipe_id))
  with check (public.ref_droit('conges_valider') and equipe_id is not null and public.ref_sur(equipe_id));

-- Pointage de son profil (option, coupée par défaut)
drop policy if exists lecture_ref on public.pointages;
create policy lecture_ref on public.pointages for select to authenticated
  using (public.ref_droit('pointage') and public.ref_sur(equipe_id));

-- Fermeture du centre
create table if not exists public.fermetures (
  jour date primary key,
  equipe_id bigint references public.equipe(id) on delete set null,
  nom text,
  heure text,
  modifie_par uuid default auth.uid(),
  modifie_le timestamptz not null default now()
);
alter table public.fermetures enable row level security;
drop policy if exists lecture on public.fermetures;
create policy lecture on public.fermetures for select to authenticated
  using (public.est_gestion() or public.ref_droit('planning_voir'));
drop policy if exists ecriture on public.fermetures;
create policy ecriture on public.fermetures for all to authenticated
  using (public.est_gestion() or public.ref_droit('planning_modif'))
  with check (public.est_gestion() or public.ref_droit('planning_modif'));
grant select, insert, update, delete on public.fermetures to authenticated;

create or replace function public.prenoms_fermeture() returns table (id bigint, prenom text, type text)
language sql stable security definer set search_path = public as $$
  select e.id, e.prenom, e.type from public.equipe e
   where e.actif and (public.est_gestion() or public.ref_de() is not null)
   order by e.ordre, e.prenom
$$;
grant execute on function public.prenoms_fermeture() to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"027"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
