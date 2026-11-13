-- =====================================================================
-- 010_conges.sql — Demandes de congés des assistantes, réponse de la référente / responsable
-- Suppose : 001 à 009 déjà appliquées.
-- Ce que fait cette migration :
--  1. demander_conges(du, au, mot) : une assistante demande des congés depuis son téléphone.
--     La demande est rattachée à SA fiche planning (equipe.profil_id = son compte), statut « attente ».
--  2. annuler_conges(id) : elle peut annuler sa demande tant qu'elle est en attente.
--  3. repondre_conges(id, accepte, reponse) : la référente ou la responsable accepte ou refuse.
--     La première qui répond décide : une demande déjà traitée n'est plus modifiable par ce chemin.
-- Les congés saisis directement par la référente / responsable passent par la table (droits de 009).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create or replace function public.demander_conges(p_du date, p_au date, p_mot text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_eq bigint; v_id bigint;
begin
  if not public.est_actif() then raise exception 'Compte non actif'; end if;
  select id into v_eq from public.equipe where profil_id = auth.uid() and actif;
  if v_eq is null then raise exception 'Votre compte n''est pas relié à une fiche du planning : demandez à la référente'; end if;
  if p_du is null or p_au is null or p_au < p_du then raise exception 'Dates invalides'; end if;
  if p_du < current_date then raise exception 'La date de début est déjà passée'; end if;
  if p_au > p_du + 120 then raise exception 'Période trop longue (plus de 4 mois)'; end if;
  insert into public.conges(equipe_id, du, au, type, statut, mot, demande_par)
  values (v_eq, p_du, p_au, 'CP', 'attente', nullif(trim(coalesce(p_mot, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.annuler_conges(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conges c set statut = 'annule'
   where c.id = p_id and c.statut = 'attente'
     and c.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
  if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;
end $$;

create or replace function public.repondre_conges(p_id bigint, p_accepte boolean, p_reponse text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  update public.conges set statut = case when p_accepte then 'accepte' else 'refuse' end,
         reponse = nullif(trim(coalesce(p_reponse, '')), ''), traite_par = auth.uid(), traite_le = now()
   where id = p_id and statut = 'attente';
  if not found then raise exception 'Cette demande a déjà reçu une réponse'; end if;
end $$;

revoke all on function public.demander_conges(date, date, text) from public;
revoke all on function public.annuler_conges(bigint) from public;
revoke all on function public.repondre_conges(bigint, boolean, text) from public;
grant execute on function public.demander_conges(date, date, text) to authenticated;
grant execute on function public.annuler_conges(bigint) to authenticated;
grant execute on function public.repondre_conges(bigint, boolean, text) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"010"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
