-- =====================================================================
-- 011_planning.sql — Planning : affichage pour les assistantes (option), réglages des heures
-- Suppose : 001 à 010 déjà appliquées.
-- Ce que fait cette migration :
--  1. Paramètres par défaut (table parametres) — école 7 h depuis la 014 :
--       regles_heures : heures comptées pour une journée de congés, maladie, école, formation,
--                       jour férié (9 h chacun), règle du jour férié, date de départ du reliquat ;
--       planning_visible : ce que voient les assistantes (planning, reliquat) — coupé par défaut.
--  2. Une assistante peut lire SES lignes de planning et la liste des dentistes
--     seulement si la référente / responsable a activé « Leur planning ».
-- Rejouable : oui (les paramètres déjà réglés ne sont pas écrasés). Non destructive.
-- =====================================================================

insert into public.parametres(cle, valeur) values
  ('regles_heures', '{"CP":9,"ARRET":9,"ECOLE":7,"FORMATION":9,"FERIE":9,"ferie":"habituel","depuis":"2026-11-02"}'::jsonb),
  ('planning_visible', '{"planning":false,"reliquat":false}'::jsonb)
on conflict (cle) do nothing;

create or replace function public.planning_visible() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valeur->>'planning')::boolean from public.parametres where cle = 'planning_visible'), false)
$$;

drop policy if exists lecture on public.planning;
create policy lecture on public.planning for select to authenticated
  using (public.est_gestion()
         or (public.planning_visible() and equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid())));

drop policy if exists lecture on public.dentistes;
create policy lecture on public.dentistes for select to authenticated
  using (public.est_gestion() or (public.est_actif() and public.planning_visible()));

insert into public.parametres(cle, valeur) values ('schema_version', '"011"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
