-- =====================================================================
-- 022_pointage_oublis.sql — Oubli de pointage signalé par l'assistante
-- Suppose : 001 à 021 déjà appliquées.
-- Ce que fait cette migration :
--   1. Table pointage_oublis : l'assistante indique l'heure d'une arrivée ou d'une sortie
--      qu'elle a oublié de pointer (14 jours en arrière au plus), avec un petit mot.
--   2. signaler_oubli(jour, sens, heure, mot) : par l'assistante, pour elle-même seulement.
--      annuler_oubli(id) : tant que ce n'est pas traité.
--   3. repondre_oubli(id, accepte, reponse) : référente / responsable. Accepté = l'heure est
--      écrite dans le pointage du jour (correction signée, notée dans le journal).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.pointage_oublis (
  id          bigserial primary key,
  equipe_id   bigint not null references public.equipe(id) on delete cascade,
  jour        date not null,
  sens        text not null check (sens in ('arrivee', 'sortie')),
  heure       time not null,
  mot         text,
  statut      text not null default 'attente' check (statut in ('attente', 'accepte', 'refuse', 'annule')),
  cree_par    uuid references public.profils(id) on delete set null default auth.uid(),
  cree_le     timestamptz not null default now(),
  repondu_par uuid references public.profils(id) on delete set null,
  repondu_le  timestamptz,
  reponse     text
);
create unique index if not exists pointage_oublis_un_en_attente on public.pointage_oublis(equipe_id, jour, sens) where statut = 'attente';
alter table public.pointage_oublis enable row level security;
drop policy if exists lecture on public.pointage_oublis;
create policy lecture on public.pointage_oublis for select to authenticated
  using (public.est_gestion() or equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid()));

create or replace function public.signaler_oubli(p_jour date, p_sens text, p_heure time, p_mot text) returns bigint
language plpgsql security definer set search_path = public as $$
declare e record; aujourdhui date := (now() at time zone 'Europe/Paris')::date; n bigint;
begin
  select q.id, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;
  if e.id is null then raise exception 'Votre compte n''est relié à aucune fiche'; end if;
  if not e.pointage then raise exception 'Vous n''êtes pas soumise au pointage'; end if;
  if p_sens not in ('arrivee', 'sortie') then raise exception 'Arrivée ou sortie ?'; end if;
  if p_jour > aujourdhui or p_jour < aujourdhui - 14 then raise exception 'Jour trop ancien ou à venir (14 jours au plus)'; end if;
  delete from public.pointage_oublis where equipe_id = e.id and jour = p_jour and sens = p_sens and statut = 'attente';
  insert into public.pointage_oublis(equipe_id, jour, sens, heure, mot) values (e.id, p_jour, p_sens, p_heure, nullif(trim(p_mot), ''))
    returning id into n;
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
    values ('OUBLI_SIGNALE', e.id, auth.uid(), p_jour, case when p_sens = 'arrivee' then 'arrivée' else 'sortie' end || ' à ' || to_char(p_heure, 'HH24:MI') || coalesce(' · « ' || nullif(trim(p_mot), '') || ' »', ''));
  return n;
end $$;

create or replace function public.annuler_oubli(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pointage_oublis o set statut = 'annule', repondu_le = now()
   where o.id = p_id and o.statut = 'attente' and o.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
end $$;

create or replace function public.repondre_oubli(p_id bigint, p_accepte boolean, p_reponse text) returns void
language plpgsql security definer set search_path = public as $$
declare o record; t timestamptz; qui text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  select * into o from public.pointage_oublis where id = p_id for update;
  if o.id is null or o.statut <> 'attente' then raise exception 'Ce signalement a déjà été traité'; end if;
  update public.pointage_oublis set statut = case when p_accepte then 'accepte' else 'refuse' end, repondu_par = auth.uid(), repondu_le = now(), reponse = nullif(trim(p_reponse), '') where id = p_id;
  if p_accepte then
    t := (o.jour + o.heure) at time zone 'Europe/Paris';
    select prenom into qui from public.equipe where id = o.equipe_id;
    insert into public.pointages(equipe_id, jour, arrivee, sortie, note, corrige_par, corrige_le)
      values (o.equipe_id, o.jour, case when o.sens = 'arrivee' then t end, case when o.sens = 'sortie' then t end, 'oubli signalé par ' || coalesce(qui, '?'), auth.uid(), now())
      on conflict (equipe_id, jour) do update set
        arrivee = case when o.sens = 'arrivee' then t else public.pointages.arrivee end,
        sortie  = case when o.sens = 'sortie'  then t else public.pointages.sortie end,
        note = 'oubli signalé par ' || coalesce(qui, '?'), corrige_par = auth.uid(), corrige_le = now();
  else
    insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
      values ('OUBLI_REFUSE', o.equipe_id, auth.uid(), o.jour, case when o.sens = 'arrivee' then 'arrivée' else 'sortie' end || ' à ' || to_char(o.heure, 'HH24:MI') || coalesce(' · motif : ' || nullif(trim(p_reponse), ''), ''));
  end if;
end $$;

grant select on public.pointage_oublis to authenticated;
grant execute on function public.signaler_oubli(date, text, time, text) to authenticated;
grant execute on function public.annuler_oubli(bigint) to authenticated;
grant execute on function public.repondre_oubli(bigint, boolean, text) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"022"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
