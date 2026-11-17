-- =====================================================================
-- 029_pointage_test.sql — Module de test du pointage (site de test)
-- Suppose : 001 à 028 déjà appliquées.
-- À passer sur Evydent-Dev. Sans danger sur Evydent-Prod (le module reste fermé : il faut le réglage
-- « pointage_test » = true, que seule l'appli du site de test propose), mais inutile.
-- Ce que fait cette migration :
--  1. pointer() : identique à la 028, avec des crochets de test (personne, Wi-Fi et réseau simulés)
--     qui ne peuvent être posés que par pointer_test(), dans la même transaction.
--  2. pointer_test() : la référente ou la responsable pointe « à la place » d'une personne,
--     à l'heure, depuis le réseau et avec le mode Wi-Fi choisis, avec un QR valide ou périmé.
--     Passe par le vrai pointer() : ce qui est testé est exactement ce que font les téléphones.
--  3. pointage_test_effacer() : efface le pointage d'une personne pour un jour (nettoyage des essais).
-- Tout est noté dans le journal du pointage (simulé, « module de test »).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create or replace function public.pointer(p_jeton text, p_sens text default null, p_quand timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now(); jour_p date; dernier timestamptz;
  sim boolean := false; ref text; res jsonb;
  w jsonb; w_mode text; w_res text; w_ok boolean := true;
  t_eq bigint := nullif(current_setting('evy.test_eq', true), '')::bigint;   -- module de test (posé seulement par pointer_test)
begin
  if auth.uid() is null then return jsonb_build_object('etat', 'non_connecte'); end if;
  select 'n° ' || k.numero || ' · ' || left(k.jeton, 6) into ref from public.pointage_cle k where k.id = 1 and k.jeton = p_jeton;
  if ref is null then ref := 'inconnu · ' || left(coalesce(p_jeton, ''), 6); end if;
  if t_eq is not null then
    select q.id, q.prenom, q.pointage into e from public.equipe q where q.id = t_eq;
    sim := true;
  else
    select q.id, q.prenom, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;
  end if;

  if p_quand is not null then
    if t_eq is not null or coalesce((select (valeur)::text = 'true' from public.parametres where cle = 'simulation_pointage'), false) then
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
  w := coalesce(nullif(current_setting('evy.test_wifi', true), '')::jsonb, (select valeur from public.parametres where cle = 'pointage_wifi'));
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
      case when t_eq is not null then 'module de test' || case when not w_ok then ' · hors centre' else '' end
           when not w_ok then 'hors du Wi-Fi du centre : à vérifier'
           when p_sens = 'sortie' and res->>'etat' = 'sortie' and (res->>'sans_arrivee')::boolean then 'premier scan l''après-midi : « je pars » (arrivée non pointée)'
           when (res->>'sans_arrivee')::boolean then 'sortie sans arrivée'
           when p.id is not null and p.sortie is not null and res->>'etat' = 'sortie' then 'remplace la sortie de ' || to_char(p.sortie at time zone 'Europe/Paris', 'HH24:MI')
           else null end);
  return res;
end $$;

create or replace function public.pointer_test(p_equipe_id bigint, p_quand timestamptz default null, p_sens text default null,
  p_reseau text default 'reel', p_wifi_mode text default null, p_qr text default 'valide') returns jsonb
language plpgsql security definer set search_path = public as $$
declare j text; w jsonb; ip text; res jsonb; h0 text := current_setting('request.headers', true);
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  if not coalesce((select (valeur)::text = 'true' from public.parametres where cle = 'pointage_test'), false) then
    raise exception 'Module de test fermé (réglage pointage_test)';
  end if;
  if not exists (select 1 from public.equipe where id = p_equipe_id) then raise exception 'Personne introuvable'; end if;
  if coalesce(p_qr, 'valide') = 'perime' then j := 'qr-perime-module-test';
  else select k.jeton into j from public.pointage_cle k where k.id = 1; end if;
  w := coalesce((select valeur from public.parametres where cle = 'pointage_wifi'), '{"mode":"off","reseaux":[]}'::jsonb);
  if p_wifi_mode in ('off', 'souple', 'strict') then w := jsonb_set(w, '{mode}', to_jsonb(p_wifi_mode)); end if;
  if p_reseau = 'centre' then
    if jsonb_array_length(coalesce(w->'reseaux', '[]'::jsonb)) = 0 then
      w := jsonb_set(w, '{reseaux}', '[{"cle":"192.0.2.10","nom":"Wi-Fi de test"}]'::jsonb);
    end if;
    ip := host((w->'reseaux'->0->>'cle')::inet);
  elsif p_reseau = 'hors' then
    ip := '203.0.113.77';   -- adresse réservée aux essais, jamais celle d'une vraie box
  end if;
  perform set_config('evy.test_eq', p_equipe_id::text, true);
  perform set_config('evy.test_wifi', w::text, true);
  if ip is not null then perform set_config('request.headers', jsonb_build_object('cf-connecting-ip', ip)::text, true); end if;
  res := public.pointer(j, nullif(p_sens, ''), p_quand);
  perform set_config('evy.test_eq', '', true);
  perform set_config('evy.test_wifi', '', true);
  res := res || jsonb_build_object('test', jsonb_build_object('ip', coalesce(ip, public.ip_client()), 'reseau', public.reseau_de(coalesce(ip, public.ip_client())), 'mode', coalesce(w->>'mode', 'off')));
  perform set_config('request.headers', coalesce(h0, ''), true);   -- la vraie adresse revient pour la suite
  return res;
end $$;

create or replace function public.pointage_test_effacer(p_equipe_id bigint, p_jour date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  if not coalesce((select (valeur)::text = 'true' from public.parametres where cle = 'pointage_test'), false) then
    raise exception 'Module de test fermé (réglage pointage_test)';
  end if;
  perform set_config('evy.source', 'qr', true);
  delete from public.pointages where equipe_id = p_equipe_id and jour = p_jour;
  perform set_config('evy.source', '', true);
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, simule, detail)
    values ('TEST_EFFACE', p_equipe_id, auth.uid(), p_jour, true, 'module de test : pointage du jour effacé');
end $$;

revoke all on function public.pointer(text, text, timestamptz) from public, anon;
grant execute on function public.pointer(text, text, timestamptz) to authenticated;
revoke all on function public.pointer_test(bigint, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.pointer_test(bigint, timestamptz, text, text, text, text) to authenticated;
revoke all on function public.pointage_test_effacer(bigint, date) from public, anon;
grant execute on function public.pointage_test_effacer(bigint, date) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"029"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
