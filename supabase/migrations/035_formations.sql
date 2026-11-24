-- =====================================================================
-- 035_formations.sql — Formations et diplômes des dentistes, rappels par mail
-- Suppose : 001 à 034 déjà appliquées.
-- Ce que fait cette migration :
--  1. table formations : une ligne par formation ou diplôme (nom, organisme, obtenu le,
--     validité en mois OU date d'expiration précise OU sans limite, délai de rappel propre,
--     justificatif). Rattachée à un dentiste (equipe_id prévu pour plus tard). Gestion seulement ;
--  2. dossier « justificatifs » (Storage, privé) pour les photos / PDF des diplômes ;
--  3. rappels par mail : réglage « formations_mail » (éteint par défaut), clé Brevo rangée
--     dans le coffre (Vault) depuis l'appli, jamais dans le code ; envoi chaque matin vers 7 h
--     (pg_cron + pg_net) ; journal des envois (un même rappel n'est jamais envoyé deux fois).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.formations (
  id bigint generated always as identity primary key,
  dentiste_id bigint references public.dentistes(id) on delete cascade,
  equipe_id bigint references public.equipe(id) on delete cascade,
  nom text not null,
  organisme text,
  obtenu_le date,
  validite_mois int check (validite_mois is null or validite_mois between 1 and 600),
  expire_le date,
  prevenir_jours int check (prevenir_jours is null or prevenir_jours between 1 and 730),
  justificatif text,
  justificatif_nom text,
  note text,
  archivee boolean not null default false,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  modifie_le timestamptz not null default now(),
  constraint formations_qui check (dentiste_id is not null or equipe_id is not null)
);
create index if not exists formations_dentiste on public.formations (dentiste_id);
create index if not exists formations_expire on public.formations (expire_le) where not archivee;

alter table public.formations enable row level security;
drop policy if exists gestion on public.formations;
create policy gestion on public.formations for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
grant select, insert, update, delete on public.formations to authenticated;

-- Journal des envois (un mail peut regrouper plusieurs rappels)
create table if not exists public.formation_envois (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  essai boolean not null default false,
  nb int not null default 0,
  a text,
  requete bigint,
  statut int,
  retour text
);
alter table public.formation_envois enable row level security;
drop policy if exists lecture on public.formation_envois;
create policy lecture on public.formation_envois for select to authenticated using (public.est_gestion());
grant select on public.formation_envois to authenticated;

-- Un rappel = une étape (premier, j30, jour, hebdo-N) pour une échéance donnée : jamais deux fois
create table if not exists public.formation_rappels (
  id bigint generated always as identity primary key,
  formation_id bigint not null references public.formations(id) on delete cascade,
  etape text not null,
  expire_le date not null,
  envoi_id bigint references public.formation_envois(id) on delete set null,
  envoye_le timestamptz not null default now(),
  unique (formation_id, etape, expire_le)
);
alter table public.formation_rappels enable row level security;
drop policy if exists lecture on public.formation_rappels;
create policy lecture on public.formation_rappels for select to authenticated using (public.est_gestion());
grant select on public.formation_rappels to authenticated;

-- Justificatifs : dossier privé, gestion seulement
insert into storage.buckets (id, name, public, file_size_limit)
  values ('justificatifs', 'justificatifs', false, 15728640)
  on conflict (id) do nothing;
drop policy if exists "justificatifs gestion" on storage.objects;
create policy "justificatifs gestion" on storage.objects for all to authenticated
  using (bucket_id = 'justificatifs' and public.est_gestion())
  with check (bucket_id = 'justificatifs' and public.est_gestion());

-- Réglage des rappels : éteint par défaut ; « on conflict do nothing » garde ce qui a été choisi
insert into public.parametres(cle, valeur) values
  ('formations_mail', '{"actif": false, "a": "", "cc": "", "delai": 90, "j30": true, "jour": true, "hebdo": false}')
  on conflict (cle) do nothing;

-- ---------- Petits outils ----------
create or replace function public._html(t text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;
create or replace function public._date_fr(d date) returns text language sql immutable as $$
  select extract(day from d)::int || case when extract(day from d) = 1 then 'er' else '' end || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from d)::int]
    || ' ' || extract(year from d)::int
$$;

-- ---------- Clé Brevo : rangée dans le coffre de Supabase, jamais relue par l'appli ----------
create or replace function public.formations_cle(p_cle text) returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if not public.est_gestion() then raise exception 'Réservé à la gestion'; end if;
  select id into v_id from vault.secrets where name = 'formations_brevo';
  if p_cle is null or trim(p_cle) = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
    return jsonb_build_object('ok', true, 'cle', false);
  end if;
  if v_id is null then perform vault.create_secret(trim(p_cle), 'formations_brevo', 'Clé API Brevo : rappels des formations');
  else perform vault.update_secret(v_id, trim(p_cle)); end if;
  return jsonb_build_object('ok', true, 'cle', true);
end $$;
revoke all on function public.formations_cle(text) from public, anon;
grant execute on function public.formations_cle(text) to authenticated;

create or replace function public.formations_cle_ok() returns boolean
language sql stable security definer set search_path = public, vault as $$
  select public.est_gestion() and exists (select 1 from vault.secrets where name = 'formations_brevo')
$$;
revoke all on function public.formations_cle_ok() from public, anon;
grant execute on function public.formations_cle_ok() to authenticated;

-- ---------- Le mail des rappels (appelé chaque matin, ou en essai depuis l'appli) ----------
create or replace function public._formations_rappels(p_essai boolean default false) returns jsonb
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  cfg jsonb; v_cle text; v_a text; v_cc text; v_de text; v_url text;
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  v_delai int; r record; d int; st text; n int := 0; lignes text := '';
  ids bigint[] := '{}'; etapes text[] := '{}'; exps date[] := '{}';
  v_sujet text; v_un text; v_html text; v_req bigint; v_env bigint; i int; quand text; dest jsonb;
begin
  select valeur into cfg from public.parametres where cle = 'formations_mail';
  cfg := coalesce(cfg, '{}'::jsonb);
  if not p_essai and not coalesce((cfg->>'actif')::boolean, false) then
    return jsonb_build_object('ok', true, 'envoye', 0, 'msg', 'Rappels éteints');
  end if;
  v_a := nullif(trim(coalesce(cfg->>'a', '')), '');
  if v_a is null then return jsonb_build_object('ok', false, 'msg', 'Renseignez l’adresse qui reçoit les rappels'); end if;
  select decrypted_secret into v_cle from vault.decrypted_secrets where name = 'formations_brevo' limit 1;
  if v_cle is null then return jsonb_build_object('ok', false, 'msg', 'Enregistrez d’abord la clé Brevo'); end if;
  v_cc := nullif(trim(coalesce(cfg->>'cc', '')), '');
  v_de := coalesce(nullif(trim(coalesce(cfg->>'de', '')), ''), v_a);
  v_url := nullif(trim(coalesce(cfg->>'url', '')), '');
  v_delai := greatest(1, coalesce((cfg->>'delai')::int, 90));

  for r in
    select f.*, coalesce('Dr ' || de.prenom, eq.prenom, '?') as qui
    from public.formations f
    left join public.dentistes de on de.id = f.dentiste_id
    left join public.equipe eq on eq.id = f.equipe_id
    where not f.archivee and f.expire_le is not null and coalesce(de.actif, eq.actif, false)
    order by f.expire_le, f.id
  loop
    d := r.expire_le - v_auj; st := null;
    if d < 0 and coalesce((cfg->>'hebdo')::boolean, false) and -d >= 7 then st := 'hebdo-' || (-d / 7);
    elsif d <= 0 then if coalesce((cfg->>'jour')::boolean, true) then st := 'jour'; end if;
    elsif d <= 30 and coalesce((cfg->>'j30')::boolean, true) and coalesce(r.prevenir_jours, v_delai) > 30 then st := 'j30';
    elsif d <= coalesce(r.prevenir_jours, v_delai) then st := 'premier';
    end if;
    if p_essai then
      -- mail d'essai : tout ce qui arrive dans le délai, ou est déjà expiré
      if d > coalesce(r.prevenir_jours, v_delai) then continue; end if;
    else
      if st is null then continue; end if;
      if exists (select 1 from public.formation_rappels x where x.formation_id = r.id and x.etape = st and x.expire_le = r.expire_le) then continue; end if;
      ids := ids || r.id; etapes := etapes || st; exps := exps || r.expire_le;
    end if;
    n := n + 1;
    quand := case when d < 0 then 'expirée depuis ' || (-d) || ' jour' || case when -d > 1 then 's' else '' end
                  when d = 0 then 'expire aujourd’hui'
                  else 'dans ' || d || ' jour' || case when d > 1 then 's' else '' end end;
    if n = 1 then v_un := public._html(r.qui) || ' · ' || public._html(r.nom); end if;
    lignes := lignes
      || '<tr><td style="padding:12px 14px;border-top:1px solid #ebe7dc"><b>' || public._html(r.qui) || '</b> · ' || public._html(r.nom)
      || '<br><span style="color:#555f68;font-size:14px">'
      || case when r.obtenu_le is not null then 'Obtenue le ' || public._date_fr(r.obtenu_le) || ' · ' else '' end
      || case when r.validite_mois is not null then 'valable ' || case when r.validite_mois % 12 = 0 then (r.validite_mois / 12) || ' an' || case when r.validite_mois > 12 then 's' else '' end else r.validite_mois || ' mois' end else 'date d’expiration fixée' end
      || case when nullif(trim(coalesce(r.organisme, '')), '') is not null then ' · ' || public._html(r.organisme) else '' end
      || '</span></td><td style="padding:12px 14px;border-top:1px solid #ebe7dc;white-space:nowrap;text-align:right"><b style="color:' || case when d < 0 then '#a3231b' when d <= 30 then '#8a3d0c' else '#1f2a33' end || '">'
      || public._date_fr(r.expire_le) || '</b><br><span style="font-size:14px;color:#555f68">' || quand || '</span></td></tr>';
  end loop;

  if n = 0 and not p_essai then return jsonb_build_object('ok', true, 'envoye', 0); end if;

  v_sujet := case when p_essai then '[Essai] ' else '' end
    || case when n = 0 then 'Rappels des formations : aucune échéance proche'
            when n = 1 then 'Formation à renouveler : ' || replace(replace(replace(v_un, '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
            else n || ' formations à renouveler' end;
  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2a33;max-width:640px;margin:0 auto">'
    || '<div style="background:#2b3e4c;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:20px">Evydent · formations à renouveler</div>'
    || '<div style="background:#fff;border:1px solid #ebe7dc;border-top:0;border-radius:0 0 12px 12px;padding:18px 20px">'
    || case when p_essai then '<p style="background:#f6f3ec;border-radius:8px;padding:10px 12px;margin:0 0 14px">Mail d’essai envoyé depuis les réglages : si vous le lisez, les rappels arrivent bien.</p>' else '' end
    || '<p style="margin:0 0 12px">Bonjour,</p>'
    || case when n = 0 then '<p>Aucune formation n’arrive à échéance dans les ' || v_delai || ' prochains jours.</p>'
            else '<p style="margin:0 0 12px">' || case when n = 1 then 'Cette formation arrive' else 'Ces formations arrivent' end || ' à échéance :</p>'
              || '<table style="width:100%;border-collapse:collapse;font-size:15px">' || lignes || '</table>' end
    || case when v_url is not null then '<p style="margin:18px 0 6px"><a href="' || public._html(v_url) || '" style="display:inline-block;background:#2b3e4c;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:22px">Ouvrir l’appli</a></p>' else '' end
    || '<p style="color:#555f68;font-size:13px;margin:14px 0 0">Pour arrêter les rappels d’une formation, enregistrez son renouvellement dans la fiche du dentiste (onglet Formations).</p>'
    || '</div></div>';

  dest := jsonb_build_object('sender', jsonb_build_object('name', 'Evydent', 'email', v_de),
    'to', jsonb_build_array(jsonb_build_object('email', v_a)), 'subject', v_sujet, 'htmlContent', v_html);
  if v_cc is not null then dest := dest || jsonb_build_object('cc', jsonb_build_array(jsonb_build_object('email', v_cc))); end if;

  select net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    body := dest,
    headers := jsonb_build_object('api-key', v_cle, 'Content-Type', 'application/json', 'Accept', 'application/json'),
    timeout_milliseconds := 15000) into v_req;

  insert into public.formation_envois (essai, nb, a, requete) values (p_essai, n, v_a || coalesce(', ' || v_cc, ''), v_req) returning id into v_env;
  if not p_essai then
    for i in 1 .. coalesce(array_length(ids, 1), 0) loop
      insert into public.formation_rappels (formation_id, etape, expire_le, envoi_id) values (ids[i], etapes[i], exps[i], v_env)
        on conflict (formation_id, etape, expire_le) do nothing;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'envoye', n, 'envoi', v_env);
end $$;
revoke all on function public._formations_rappels(boolean) from public, anon, authenticated;

-- Mail d'essai, depuis Réglages › Rappels des formations
create or replace function public.formations_mail_essai() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la gestion'; end if;
  return public._formations_rappels(true);
end $$;
revoke all on function public.formations_mail_essai() from public, anon;
grant execute on function public.formations_mail_essai() to authenticated;

-- Derniers envois avec la réponse de Brevo (201 = accepté ; 401 = clé refusée ; 400 = expéditeur non validé…)
create or replace function public.formations_envois_etat() returns setof public.formation_envois
language plpgsql security definer set search_path = public, net as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la gestion'; end if;
  update public.formation_envois e set statut = coalesce(h.status_code, 0), retour = left(coalesce(h.error_msg, h.content::text, ''), 400)
    from net._http_response h where h.id = e.requete and e.statut is null;
  return query select * from public.formation_envois order by le desc limit 10;
end $$;
revoke all on function public.formations_envois_etat() from public, anon;
grant execute on function public.formations_envois_etat() to authenticated;

-- Chaque matin à 6 h UTC (7 h l'hiver, 8 h l'été à Paris)
select cron.schedule('rappels-formations', '0 6 * * *', 'select public._formations_rappels(false)');

insert into public.parametres(cle, valeur) values ('schema_version', '"035"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
