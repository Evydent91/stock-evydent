-- =====================================================================
-- 018_pointage_journal.sql — Journal du pointage (tout ce qui se passe) et référence du QR code
-- Suppose : 001 à 017 déjà appliquées.
-- Ce que fait cette migration :
--  1. pointage_cle.numero : numéro du QR code (1, 2, 3… à chaque régénération) ; la référence d'un QR
--     est « n° <numero> · <6 premiers caractères du jeton> ».
--  2. Table pointage_journal : une ligne par événement, jamais modifiée :
--       scans (arrivée, sortie, doublon, QR périmé, non soumis, compte non relié, simulation coupée),
--       corrections et effacements faits par la référente / responsable (avant → après),
--       régénération du QR code.
--     Lecture : référente / responsable. Écriture : seulement par la base elle-même.
--  3. pointer() et regenerer_qr() écrivent dans ce journal ; un déclencheur sur « pointages »
--     journalise les corrections manuelles.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.pointage_cle add column if not exists numero int not null default 1;

create table if not exists public.pointage_journal (
  id          bigserial primary key,
  quand       timestamptz not null default now(),   -- moment réel de l'événement
  heure_pt    timestamptz,                           -- heure enregistrée (différente si simulée)
  evenement   text not null,                         -- ARRIVEE, SORTIE, DOUBLON, QR_PERIME, NON_SOUMIS, SANS_FICHE, SIMULATION_COUPEE, CORRECTION, EFFACEMENT, QR_REGENERE
  equipe_id   bigint,
  profil_id   uuid,
  jour        date,
  qr_ref      text,
  simule      boolean not null default false,
  detail      text
);
create index if not exists pointage_journal_quand on public.pointage_journal(quand);
alter table public.pointage_journal enable row level security;
drop policy if exists lecture on public.pointage_journal;
create policy lecture on public.pointage_journal for select to authenticated using (public.est_gestion());

create or replace function public.qr_ref_actuelle() returns text
language sql stable security definer set search_path = public as $$
  select 'n° ' || numero || ' · ' || left(jeton, 6) from public.pointage_cle where id = 1
$$;

create or replace function public.regenerer_qr() returns text
language plpgsql security definer set search_path = public as $$
declare j text; ancien text := public.qr_ref_actuelle();
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  j := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.pointage_cle(id, jeton, cree_le, numero) values (1, j, now(), 1)
    on conflict (id) do update set jeton = excluded.jeton, cree_le = now(), numero = public.pointage_cle.numero + 1;
  insert into public.pointage_journal(evenement, profil_id, qr_ref, detail)
    values ('QR_REGENERE', auth.uid(), public.qr_ref_actuelle(), 'remplace ' || coalesce(ancien, '—'));
  return j;
end $$;

create or replace function public.pointer(p_jeton text, p_sens text default null, p_quand timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now(); jour_p date; dernier timestamptz;
  sim boolean := false; ref text; res jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('etat', 'non_connecte'); end if;
  select 'n° ' || k.numero || ' · ' || left(k.jeton, 6) into ref from public.pointage_cle k where k.id = 1 and k.jeton = p_jeton;
  if ref is null then ref := 'inconnu · ' || left(coalesce(p_jeton, ''), 6); end if;
  select q.id, q.prenom, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;

  if p_quand is not null then
    if coalesce((select (valeur)::text = 'true' from public.parametres where cle = 'simulation_pointage'), false) then
      maintenant := p_quand; sim := true;
    else
      insert into public.pointage_journal(evenement, equipe_id, profil_id, qr_ref, simule, detail) values ('SIMULATION_COUPEE', e.id, auth.uid(), ref, true, 'heure demandée ' || p_quand);
      return jsonb_build_object('etat', 'simulation_coupee');
    end if;
  end if;
  jour_p := (maintenant at time zone 'Europe/Paris')::date;

  if ref like 'inconnu%' then
    insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule) values (maintenant, 'QR_PERIME', e.id, auth.uid(), jour_p, ref, sim);
    return jsonb_build_object('etat', 'qr_perime');
  end if;
  if e.id is null then
    insert into public.pointage_journal(heure_pt, evenement, profil_id, jour, qr_ref, simule) values (maintenant, 'SANS_FICHE', auth.uid(), jour_p, ref, sim);
    return jsonb_build_object('etat', 'sans_fiche');
  end if;
  if not e.pointage then
    insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule) values (maintenant, 'NON_SOUMIS', e.id, auth.uid(), jour_p, ref, sim);
    return jsonb_build_object('etat', 'non_soumis', 'prenom', e.prenom);
  end if;

  perform set_config('evy.source', 'qr', true);   -- le déclencheur ne journalise pas ces changements (déjà fait ici)
  select * into p from public.pointages where equipe_id = e.id and jour = jour_p for update;
  if p.id is null then
    if p_sens = 'sortie' then
      insert into public.pointages(equipe_id, jour, sortie) values (e.id, jour_p, maintenant);
      res := jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'sans_arrivee', true);
    else
      insert into public.pointages(equipe_id, jour, arrivee) values (e.id, jour_p, maintenant);
      res := jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
    end if;
  else
    dernier := coalesce(p.sortie, p.arrivee);
    if dernier is not null and abs(extract(epoch from maintenant - dernier)) < 60 then
      res := jsonb_build_object('etat', 'doublon', 'prenom', e.prenom, 'arrivee', p.arrivee, 'sortie', p.sortie);
    elsif p.arrivee is null and p.sortie is null then
      update public.pointages set arrivee = maintenant where id = p.id;
      res := jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
    else
      update public.pointages set sortie = maintenant where id = p.id;
      res := jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'arrivee', p.arrivee, 'sans_arrivee', p.arrivee is null);
    end if;
  end if;
  perform set_config('evy.source', '', true);
  insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule, detail)
    values (maintenant, upper(res->>'etat'), e.id, auth.uid(), jour_p, ref, sim,
      case when p_sens = 'sortie' and res->>'etat' = 'sortie' and (res->>'sans_arrivee')::boolean then 'premier scan l''après-midi : « je pars » (arrivée non pointée)'
           when (res->>'sans_arrivee')::boolean then 'sortie sans arrivée'
           when p.id is not null and p.sortie is not null and res->>'etat' = 'sortie' then 'remplace la sortie de ' || to_char(p.sortie at time zone 'Europe/Paris', 'HH24:MI')
           else null end);
  return res;
end $$;

-- Corrections manuelles (outil Pointage) : avant → après
create or replace function public.journal_pointages() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text := 'HH24:MI'; avant text; apres text;
begin
  if coalesce(current_setting('evy.source', true), '') = 'qr' then return null; end if;
  avant := case when tg_op = 'INSERT' then '—' else coalesce(to_char(old.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(old.sortie at time zone 'Europe/Paris', h), '—') end;
  apres := case when tg_op = 'DELETE' then '—' else coalesce(to_char(new.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(new.sortie at time zone 'Europe/Paris', h), '—') end;
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
    values (case when tg_op = 'DELETE' then 'EFFACEMENT' else 'CORRECTION' end,
            coalesce(new.equipe_id, old.equipe_id), auth.uid(), coalesce(new.jour, old.jour),
            'avant ' || avant || ' · après ' || apres ||
            case when tg_op <> 'DELETE' and new.note is not null then ' · note : ' || new.note else '' end);
  return null;
end $$;
drop trigger if exists journal_pointages on public.pointages;
create trigger journal_pointages after insert or update or delete on public.pointages
  for each row execute function public.journal_pointages();

revoke all on function public.pointer(text, text, timestamptz) from public, anon;
grant execute on function public.pointer(text, text, timestamptz) to authenticated;
revoke all on function public.regenerer_qr() from public, anon;
grant execute on function public.regenerer_qr() to authenticated;
revoke all on function public.qr_ref_actuelle() from public, anon, authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"018"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
