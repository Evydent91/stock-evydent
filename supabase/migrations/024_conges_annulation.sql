-- =====================================================================
-- 024 · Annulation de congés déjà acceptés, avec validation
--  1. demander_annulation_conges(id, mot) : l'assistante demande d'annuler des congés
--     acceptés qui n'ont pas encore commencé. Les congés restent acceptés tant que
--     la référente ou la responsable n'a pas répondu.
--  2. retirer_annulation_conges(id) : elle retire sa demande d'annulation.
--  3. repondre_annulation_conges(id, accepte, reponse) : la référente ou la responsable
--     accepte (les congés passent à « annulé ») ou refuse (les congés restent acceptés).
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.conges add column if not exists annul_demande timestamptz;
alter table public.conges add column if not exists annul_mot text;
alter table public.conges add column if not exists annul_reponse text;

create or replace function public.demander_annulation_conges(p_id bigint, p_mot text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.est_actif() then raise exception 'Compte non actif'; end if;
  update public.conges c set annul_demande = now(), annul_mot = nullif(trim(coalesce(p_mot, '')), ''), annul_reponse = null
   where c.id = p_id and c.statut = 'accepte' and c.annul_demande is null and c.du > current_date
     and c.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
  if not found then raise exception 'Ces congés ne peuvent pas être annulés (déjà commencés, ou demande déjà envoyée)'; end if;
end $$;

create or replace function public.retirer_annulation_conges(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conges c set annul_demande = null, annul_mot = null
   where c.id = p_id and c.statut = 'accepte' and c.annul_demande is not null
     and c.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
  if not found then raise exception 'Demande d''annulation introuvable ou déjà traitée'; end if;
end $$;

create or replace function public.repondre_annulation_conges(p_id bigint, p_accepte boolean, p_reponse text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  if p_accepte then
    update public.conges set statut = 'annule', annul_reponse = nullif(trim(coalesce(p_reponse, '')), ''), traite_par = auth.uid(), traite_le = now()
     where id = p_id and statut = 'accepte' and annul_demande is not null;
  else
    update public.conges set annul_demande = null, annul_reponse = coalesce(nullif(trim(coalesce(p_reponse, '')), ''), 'refusée'), traite_par = auth.uid(), traite_le = now()
     where id = p_id and statut = 'accepte' and annul_demande is not null;
  end if;
  if not found then raise exception 'Cette demande d''annulation a déjà reçu une réponse'; end if;
end $$;

revoke all on function public.demander_annulation_conges(bigint, text) from public;
revoke all on function public.retirer_annulation_conges(bigint) from public;
revoke all on function public.repondre_annulation_conges(bigint, boolean, text) from public;
grant execute on function public.demander_annulation_conges(bigint, text) to authenticated;
grant execute on function public.retirer_annulation_conges(bigint) to authenticated;
grant execute on function public.repondre_annulation_conges(bigint, boolean, text) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"024"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
