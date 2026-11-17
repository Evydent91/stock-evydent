-- =====================================================================
-- PASSAGE EN PROD : migrations 028 et 030 à la suite (base Evydent-Prod déjà en 027).
-- Fichier assemblé à partir de supabase/migrations/ — ne pas modifier à la main.
-- La 029 (module de test du pointage) ne concerne que le site de test : elle n'est pas reprise ici.
-- À lancer UNE SEULE FOIS dans le SQL Editor d'Evydent-Prod, pour la version 2.4.7.
-- Chaque migration est rejouable : si le script s'arrête sur une erreur, on peut le relancer en entier.
-- =====================================================================

-- >>>>> supabase/migrations/028_pointage_wifi.sql
-- =====================================================================
-- 028_pointage_wifi.sql — Pointage accepté seulement depuis le Wi-Fi du centre
-- Suppose : 001 à 027 déjà appliquées.
-- Principe : le serveur regarde l'adresse internet d'où arrive le pointage (celle de la box du centre).
--   On ne garde que le « réseau » (adresse IPv4, ou les 4 premiers groupes d'une IPv6), jamais une position.
-- Ce que fait cette migration :
--  1. Réglage parametres « pointage_wifi » = {mode: off | souple | strict, reseaux: [{cle, nom, le, par}]}.
--  2. pointages : arrivee_hc / sortie_hc (pointé hors du centre, à vérifier) et arrivee_res / sortie_res
--     (réseau vu, gardé seulement jusqu'à la vérification).
--  3. ip_client(), reseau_de() ; wifi_etat(), wifi_ajouter(), wifi_modifier() (nom, opérateur), wifi_retirer(), wifi_mode(), wifi_reinitialiser()
--     (référente / responsable seulement, chaque changement noté dans le journal du pointage).
--  4. pointer() : strict = refus hors du centre ; souple = pointage gardé et marqué « hors centre ».
-- Rejouable : oui. Non destructive. Sans réglage, rien ne change (mode « off »).
-- =====================================================================

alter table public.pointages add column if not exists arrivee_hc boolean not null default false;
alter table public.pointages add column if not exists sortie_hc boolean not null default false;
alter table public.pointages add column if not exists arrivee_res text;
alter table public.pointages add column if not exists sortie_res text;

-- Adresse internet de l'appareil qui appelle (transmise par la passerelle de Supabase)
create or replace function public.ip_client() returns text
language plpgsql stable security definer set search_path = public as $$
declare h json; v text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  v := coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''), nullif(h->>'x-real-ip', ''));
  return v;
end $$;

-- « Réseau » d'une adresse : l'adresse IPv4 elle-même, ou le préfixe /64 d'une IPv6 (commun aux appareils d'une même box)
create or replace function public.reseau_de(p_ip text) returns text
language plpgsql immutable as $$
begin
  if p_ip is null or p_ip = '' then return null; end if;
  if position(':' in p_ip) > 0 then return network(set_masklen(p_ip::inet, 64))::text; end if;
  return host(p_ip::inet);
exception when others then return null;
end $$;

create or replace function public.wifi_lire() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select valeur from public.parametres where cle = 'pointage_wifi'), '{"mode":"off","reseaux":[]}'::jsonb)
$$;
create or replace function public.wifi_ecrire(v jsonb, ev text, det text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into public.parametres(cle, valeur) values ('pointage_wifi', v)
    on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
  insert into public.pointage_journal(evenement, profil_id, detail) values (ev, auth.uid(), det);
  return v || jsonb_build_object('actuel', public.reseau_de(public.ip_client()));
end $$;

-- État pour la page de réglage : mode, réseaux enregistrés, réseau de l'appareil qui regarde
create or replace function public.wifi_etat() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  return public.wifi_lire() || jsonb_build_object('actuel', public.reseau_de(public.ip_client()));
end $$;

-- Ajouter un réseau : celui de l'appareil (p_cle vide) ou un réseau vu sur un pointage « hors centre »
create or replace function public.wifi_ajouter(p_nom text, p_cle text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.wifi_lire(); c text := coalesce(nullif(p_cle, ''), public.reseau_de(public.ip_client()));
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  if c is null then raise exception 'Adresse du réseau introuvable'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(w->'reseaux', '[]'::jsonb)) x where x->>'cle' = c) then
    return w || jsonb_build_object('actuel', public.reseau_de(public.ip_client()), 'deja', true);
  end if;
  w := jsonb_set(w, '{reseaux}', coalesce(w->'reseaux', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('cle', c, 'nom', coalesce(nullif(trim(p_nom), ''), 'Wi-Fi du centre'), 'le', now(), 'par', auth.uid())));
  return public.wifi_ecrire(w, 'WIFI_AJOUTE', coalesce(nullif(trim(p_nom), ''), 'Wi-Fi du centre'));
end $$;

create or replace function public.wifi_retirer(p_cle text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.wifi_lire(); n text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  select x->>'nom' into n from jsonb_array_elements(coalesce(w->'reseaux', '[]'::jsonb)) x where x->>'cle' = p_cle;
  w := jsonb_set(w, '{reseaux}', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(w->'reseaux', '[]'::jsonb)) x where x->>'cle' <> p_cle), '[]'::jsonb));
  if coalesce(w->>'mode', 'off') = 'strict' and jsonb_array_length(w->'reseaux') = 0 then w := jsonb_set(w, '{mode}', '"souple"'); end if;
  return public.wifi_ecrire(w, 'WIFI_RETIRE', coalesce(n, '?'));
end $$;

create or replace function public.wifi_mode(p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.wifi_lire();
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  if p_mode not in ('off', 'souple', 'strict') then raise exception 'Mode inconnu'; end if;
  if p_mode = 'strict' and jsonb_array_length(coalesce(w->'reseaux', '[]'::jsonb)) = 0 then raise exception 'Enregistrez d''abord le Wi-Fi du centre'; end if;
  w := jsonb_set(w, '{mode}', to_jsonb(p_mode));
  return public.wifi_ecrire(w, 'WIFI_MODE', case p_mode when 'off' then 'désactivé' else p_mode end);
end $$;

-- Renommer un Wi-Fi enregistré et noter son opérateur (Free, Orange…)
create or replace function public.wifi_modifier(p_cle text, p_nom text, p_op text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.wifi_lire();
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  w := jsonb_set(w, '{reseaux}', coalesce((select jsonb_agg(case when x->>'cle' = p_cle
         then x || jsonb_build_object('nom', coalesce(nullif(trim(p_nom), ''), x->>'nom'), 'op', nullif(trim(coalesce(p_op, '')), ''))
         else x end) from jsonb_array_elements(coalesce(w->'reseaux', '[]'::jsonb)) x), '[]'::jsonb));
  return public.wifi_ecrire(w, 'WIFI_MODIFIE', coalesce(nullif(trim(p_nom), ''), '?') || coalesce(' · ' || nullif(trim(coalesce(p_op, '')), ''), ''));
end $$;

-- Changement de box : on efface les réseaux et on repasse en souple (sinon, en strict, plus personne ne pourrait pointer)
create or replace function public.wifi_reinitialiser() returns jsonb
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.wifi_lire();
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  w := jsonb_build_object('mode', case when coalesce(w->>'mode', 'off') = 'off' then 'off' else 'souple' end, 'reseaux', '[]'::jsonb);
  return public.wifi_ecrire(w, 'WIFI_REINITIALISE', 'réseaux effacés, mode ' || (w->>'mode'));
end $$;

create or replace function public.pointer(p_jeton text, p_sens text default null, p_quand timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now(); jour_p date; dernier timestamptz;
  sim boolean := false; ref text; res jsonb;
  w jsonb; w_mode text; w_res text; w_ok boolean := true;
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

  -- Wi-Fi du centre : le pointage doit venir du réseau du centre (adresse internet de la box)
  w := (select valeur from public.parametres where cle = 'pointage_wifi');
  w_mode := coalesce(w->>'mode', 'off');
  if w_mode in ('souple', 'strict') then
    w_res := public.reseau_de(public.ip_client());
    w_ok := w_res is not null and exists (select 1 from jsonb_array_elements(coalesce(w->'reseaux', '[]'::jsonb)) x where x->>'cle' = w_res);
    if not w_ok and w_mode = 'strict' then
      insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule, detail)
        values (maintenant, 'HORS_CENTRE_REFUSE', e.id, auth.uid(), jour_p, ref, sim, 'mode strict : pointage refusé hors du Wi-Fi du centre');
      return jsonb_build_object('etat', 'hors_centre', 'prenom', e.prenom);
    end if;
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
  -- mode souple : le pointage hors du centre est gardé, marqué « à vérifier »
  if not w_ok and res->>'etat' in ('arrivee', 'sortie') then
    if res->>'etat' = 'arrivee' then
      update public.pointages set arrivee_hc = true, arrivee_res = w_res where equipe_id = e.id and jour = jour_p;
    else
      update public.pointages set sortie_hc = true, sortie_res = w_res where equipe_id = e.id and jour = jour_p;
    end if;
    res := res || jsonb_build_object('hors_centre', true);
  end if;
  perform set_config('evy.source', '', true);
  insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule, detail)
    values (maintenant, upper(res->>'etat'), e.id, auth.uid(), jour_p, ref, sim,
      case when not w_ok then 'hors du Wi-Fi du centre : à vérifier'
           when p_sens = 'sortie' and res->>'etat' = 'sortie' and (res->>'sans_arrivee')::boolean then 'premier scan l''après-midi : « je pars » (arrivée non pointée)'
           when (res->>'sans_arrivee')::boolean then 'sortie sans arrivée'
           when p.id is not null and p.sortie is not null and res->>'etat' = 'sortie' then 'remplace la sortie de ' || to_char(p.sortie at time zone 'Europe/Paris', 'HH24:MI')
           else null end);
  return res;
end $$;


revoke all on function public.ip_client() from public, anon, authenticated;
revoke all on function public.wifi_lire() from public, anon, authenticated;
revoke all on function public.wifi_ecrire(jsonb, text, text) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['wifi_etat()', 'wifi_ajouter(text, text)', 'wifi_modifier(text, text, text)', 'wifi_retirer(text)', 'wifi_mode(text)', 'wifi_reinitialiser()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
revoke all on function public.pointer(text, text, timestamptz) from public, anon;
grant execute on function public.pointer(text, text, timestamptz) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"028"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();

-- >>>>> supabase/migrations/030_cabinets_dentistes.sql
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
