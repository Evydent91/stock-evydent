-- =====================================================================
-- 008_lieux_ste.sql — Lieux d'utilisation des articles et emplacement « La Sté »
-- Suppose : 001 à 007 déjà appliquées.
-- Ce que fait cette migration :
--  1. Articles : 3 nouvelles colonnes
--       lieu_cabinets (oui/non, oui par défaut) : article utilisé dans les cabinets ;
--       lieu_ste      (oui/non, non par défaut) : article utilisé à la Sté (stérilisation) ;
--       type_soins    (texte libre pour l'instant, liste fixe plus tard).
--     Les articles existants : Cabinets = oui, Sté = non (rien ne change pour les cabinets).
--  2. Nouvel emplacement 9 = « La Sté » : sorties de la réserve vers la Sté et inventaire
--     de la Sté (comme un cabinet). Pas de retour Sté → réserve (retour_reserve reste 1 à 8).
--     Les contrôles « emplacement entre 0 et 8 » passent à « entre 0 et 9 ».
--  3. Classement des articles les plus sortis : compte aussi la Sté.
-- Rejouable : oui. Non destructive (ajout de colonnes et élargissement des contrôles).
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

alter table public.articles add column if not exists lieu_cabinets boolean not null default true;
alter table public.articles add column if not exists lieu_ste boolean not null default false;
alter table public.articles add column if not exists type_soins text;

-- Contrôles d'emplacement : 0 = réserve, 1 à 8 = cabinets, 9 = La Sté
alter table public.stocks drop constraint if exists stocks_emplacement_check;
alter table public.stocks add constraint stocks_emplacement_check check (emplacement between 0 and 9);
alter table public.mouvements drop constraint if exists mouvements_emplacement_de_check;
alter table public.mouvements add constraint mouvements_emplacement_de_check check (emplacement_de between 0 and 9);
alter table public.mouvements drop constraint if exists mouvements_emplacement_vers_check;
alter table public.mouvements add constraint mouvements_emplacement_vers_check check (emplacement_vers between 0 and 9);
alter table public.inventaires drop constraint if exists inventaires_emplacement_check;
alter table public.inventaires add constraint inventaires_emplacement_check check (emplacement between 0 and 9);

-- Sortie : vers un cabinet (1 à 8) ou vers la Sté (9)
create or replace function public.faire_sortie(p_cabinet smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
  v_hors boolean := public.hors_cabinet(p_cabinet);
  l jsonb; v_art bigint; v_q numeric; f numeric; r numeric; c numeric;
  n_ok int := 0; n_att int := 0;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_cabinet is null or p_cabinet not between 1 and 9 then raise exception 'Cabinet invalide'; end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    v_art := (l->>'article_id')::bigint;
    v_q   := (l->>'quantite')::numeric;
    if v_art is null or v_q is null or v_q <= 0 then continue; end if;
    f := public.facteur(v_art);
    if f is null then raise exception 'Article % introuvable', v_art; end if;
    r := public._stock(v_art, 0::smallint);
    if v_q > r * f + 1e-9 then
      insert into public.mouvements(type, statut, lot, article_id, emplacement_de, emplacement_vers,
                                    quantite, avant, hors_cabinet)
      values ('demande', 'attente', v_lot, v_art, 0, p_cabinet, v_q, r, v_hors);
      n_att := n_att + 1;
    else
      c := public._stock(v_art, p_cabinet);
      update public.stocks set quantite = round(r - v_q / f, 4), modifie_le = now()
       where article_id = v_art and emplacement = 0;
      update public.stocks set quantite = round(c + v_q, 4), modifie_le = now()
       where article_id = v_art and emplacement = p_cabinet;
      insert into public.mouvements(type, lot, article_id, emplacement_de, emplacement_vers, quantite,
                                    quantite_reserve, avant, apres, hors_cabinet)
      values ('sortie', v_lot, v_art, 0, p_cabinet, v_q, round(v_q / f, 4), r, round(r - v_q / f, 4), v_hors);
      n_ok := n_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('lot', v_lot, 'sorties', n_ok, 'en_attente', n_att, 'hors_cabinet', v_hors);
end $$;

-- Correction / régularisation : la Sté aussi
create or replace function public.fixer_stock(p_article bigint, p_emplacement smallint, p_quantite numeric,
                                              p_type text default 'regul', p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a numeric; f numeric; cm numeric; ec numeric; v numeric; v_hors boolean;
begin
  if p_type not in ('inventaire','regul','correction') then raise exception 'Type invalide'; end if;
  if p_emplacement is null or p_emplacement not between 0 and 9 then raise exception 'Emplacement invalide'; end if;
  if p_type = 'inventaire' then
    if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
    if p_emplacement = 0 and not public.peut_compter_reserve() then
      raise exception 'Inventaire de la réserve : autorisation de la responsable ou de la référente nécessaire';
    end if;
  elsif not public.est_gestion() then
    raise exception 'Réservé à la référente ou à la responsable';
  end if;
  if p_quantite is null or p_quantite < 0 then raise exception 'Quantité invalide'; end if;
  a := public._stock(p_article, p_emplacement);
  if abs(a - p_quantite) < 1e-9 then return jsonb_build_object('change', false); end if;
  f := public.facteur(p_article);
  select cout_moyen into cm from public.articles where id = p_article;
  ec := round(p_quantite - a, 4);
  v := case when p_type = 'correction' then 0
            when p_emplacement = 0 then round(ec * coalesce(cm, 0), 2)
            else round(ec / f * coalesce(cm, 0), 2) end;
  v_hors := public.hors_cabinet(p_emplacement);
  update public.stocks set quantite = round(p_quantite, 4), modifie_le = now()
   where article_id = p_article and emplacement = p_emplacement;
  insert into public.mouvements(type, article_id, emplacement_de, quantite, avant, apres, ecart, valeur, motif, hors_cabinet)
  values (p_type, p_article, p_emplacement, ec, a, round(p_quantite, 4), ec, v, p_motif, v_hors);
  return jsonb_build_object('change', true, 'ecart', ec, 'valeur', v, 'hors_cabinet', v_hors);
end $$;

-- Inventaire : la Sté aussi (ce qui manque est « Utilisé à la Sté »)
create or replace function public.compter_inventaire(p_emplacement smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_j0 boolean := public.j0_actif();
  v_zero boolean := public.j0_premier_comptage(p_emplacement);
  v_hors boolean := public.hors_cabinet(p_emplacement);
  l jsonb; v_art bigint; v_q numeric; a numeric; f numeric; cm numeric; ec numeric; v numeric; mot text;
  n int := 0; n_chg int := 0; n_zero int := 0; tot numeric := 0;
  vus bigint[] := '{}';
  z record;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_emplacement is null or p_emplacement not between 0 and 9 then raise exception 'Emplacement invalide'; end if;
  if p_emplacement = 0 and not public.peut_compter_reserve() then
    raise exception 'Inventaire de la réserve : autorisation de la responsable ou de la référente nécessaire';
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    v_art := (l->>'article_id')::bigint;
    v_q   := (l->>'quantite')::numeric;
    if v_art is null or v_q is null or v_q < 0 then continue; end if;
    if v_art = any(vus) then continue; end if;
    vus := vus || v_art; n := n + 1;
    a := public._stock(v_art, p_emplacement);
    if abs(a - v_q) < 1e-9 then continue; end if;
    f := public.facteur(v_art);
    select cout_moyen into cm from public.articles where id = v_art;
    ec := round(v_q - a, 4);
    v := case when v_j0 then 0
              when p_emplacement = 0 then round(ec * coalesce(cm, 0), 2)
              else round(ec / f * coalesce(cm, 0), 2) end;
    mot := case when v_j0 then 'Inventaire de départ (J0)'
                when p_emplacement = 0 then nullif(l->>'motif', '')
                when p_emplacement = 9 then 'Utilisé à la Sté'
                else 'Utilisé au cabinet' end;
    update public.stocks set quantite = round(v_q, 4), modifie_le = now()
     where article_id = v_art and emplacement = p_emplacement;
    insert into public.mouvements(type, article_id, emplacement_de, quantite, avant, apres, ecart, valeur, motif, hors_cabinet)
    values ('inventaire', v_art, p_emplacement, ec, a, round(v_q, 4), ec, v, mot, v_hors);
    n_chg := n_chg + 1; tot := tot + coalesce(v, 0);
  end loop;

  -- J0, premier comptage : les articles non comptés de cet emplacement passent à 0
  if v_zero then
    for z in select s.article_id, s.quantite from public.stocks s
              where s.emplacement = p_emplacement and s.quantite <> 0 and not (s.article_id = any(vus))
              for update loop
      update public.stocks set quantite = 0, modifie_le = now()
       where article_id = z.article_id and emplacement = p_emplacement;
      insert into public.mouvements(type, article_id, emplacement_de, quantite, avant, apres, ecart, valeur, motif, hors_cabinet)
      values ('inventaire', z.article_id, p_emplacement, -z.quantite, z.quantite, 0, -z.quantite, 0,
              'Inventaire de départ (J0) : non compté', v_hors);
      n_zero := n_zero + 1;
    end loop;
  end if;

  insert into public.inventaires(emplacement, j0, nb_comptes, nb_mis_a_zero, hors_cabinet)
  values (p_emplacement, v_j0, n, n_zero, v_hors);

  return jsonb_build_object('comptes', n, 'modifies', n_chg, 'mis_a_zero', n_zero,
                            'valeur', tot, 'j0', v_j0, 'hors_cabinet', v_hors);
end $$;

-- Classement des articles les plus sortis : la Sté aussi
create or replace function public.classement_sorties(p_jours int default 365)
returns table(article_id bigint, cabinet smallint, total numeric, nb bigint)
language sql stable security invoker set search_path = public as $$
  select m.article_id, m.emplacement_vers, sum(m.quantite), count(*)
    from public.mouvements m
   where m.type in ('sortie', 'demande') and m.statut = 'ok'
     and m.article_id is not null and m.emplacement_vers between 1 and 9
     and m.cree_le >= now() - make_interval(days => greatest(coalesce(p_jours, 365), 1))
   group by m.article_id, m.emplacement_vers
$$;

insert into public.parametres(cle, valeur) values ('schema_version', '"008"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
