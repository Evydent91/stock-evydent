-- =====================================================================
-- 002_remplacements.sql — Remplacements entre cabinets
-- Suppose : 001_init_schema.sql déjà appliqué.
-- Ce que fait cette migration :
--  1. Une assistante peut faire les sorties ET les inventaires de n'importe quel
--     cabinet (remplacement, absence). Tout ce qu'elle fait hors de son cabinet
--     par défaut est marqué « hors cabinet » pour la responsable.
--  2. La référente a les mêmes droits que la responsable sur l'équipe
--     (créer, modifier les rôles et cabinets, désactiver).
--  3. L'inventaire de la réserve est réservé à la responsable et à la référente,
--     qui peuvent l'autoriser temporairement à une assistante (jusqu'à une date).
-- Rejouable : oui. Non destructive.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

-- ---------- Nouvelles colonnes ----------
alter table public.profils     add column if not exists reserve_jusquau date;   -- autorisation temporaire d'inventaire de la réserve
alter table public.mouvements  add column if not exists hors_cabinet boolean not null default false;
alter table public.inventaires add column if not exists hors_cabinet boolean not null default false;

-- ---------- Fonctions d'aide ----------
-- Cabinet par défaut de la personne connectée
create or replace function public.mon_cabinet() returns smallint
language sql stable security definer set search_path = public as $$
  select cabinet from public.profils where id = auth.uid() and actif
$$;

-- Vrai si l'emplacement n'est pas le cabinet par défaut de la personne connectée
create or replace function public.hors_cabinet(p_emp smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_cabinet() is not null and p_emp between 1 and 8
                  and p_emp <> public.mon_cabinet(), false)
$$;

-- Peut compter la réserve : gestion, ou assistante autorisée jusqu'à une date
create or replace function public.peut_compter_reserve() returns boolean
language sql stable security definer set search_path = public as $$
  select public.est_gestion() or exists (
    select 1 from public.profils
     where id = auth.uid() and actif and reserve_jusquau >= current_date)
$$;

-- ---------- Équipe : la référente a les mêmes droits que la responsable ----------
drop policy if exists ecriture on public.profils;
create policy ecriture on public.profils for all to authenticated
  using (public.est_gestion()) with check (public.est_gestion());

-- ---------- Sorties : marquer « hors cabinet » ----------
create or replace function public.faire_sortie(p_cabinet smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
  v_hors boolean := public.hors_cabinet(p_cabinet);
  l jsonb; v_art bigint; v_q numeric; f numeric; r numeric; c numeric;
  n_ok int := 0; n_att int := 0;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_cabinet is null or p_cabinet not between 1 and 8 then raise exception 'Cabinet invalide'; end if;
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

-- ---------- Demandes : la sortie confirmée garde la mention « hors cabinet » ----------
create or replace function public.traiter_demande(p_mouvement bigint, p_accepter boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.mouvements; f numeric; r numeric; c numeric; pris numeric; ec numeric; cm numeric;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  select * into m from public.mouvements where id = p_mouvement and type = 'demande' and statut = 'attente' for update;
  if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;
  if not p_accepter then
    update public.mouvements set statut = 'refuse' where id = m.id;
    return jsonb_build_object('statut', 'refuse');
  end if;
  f := public.facteur(m.article_id);
  r := public._stock(m.article_id, 0::smallint);
  c := public._stock(m.article_id, m.emplacement_vers);
  pris := least(r, m.quantite / f);
  ec := round(m.quantite / f - pris, 4);
  select cout_moyen into cm from public.articles where id = m.article_id;
  update public.stocks set quantite = round(r - pris, 4), modifie_le = now()
   where article_id = m.article_id and emplacement = 0;
  update public.stocks set quantite = round(c + m.quantite, 4), modifie_le = now()
   where article_id = m.article_id and emplacement = m.emplacement_vers;
  update public.mouvements set statut = 'ok' where id = m.id;
  insert into public.mouvements(type, lot, article_id, emplacement_de, emplacement_vers, quantite,
                                quantite_reserve, avant, apres, ecart, valeur, lie_a, motif, auteur, auteur_nom, hors_cabinet)
  values ('sortie', m.lot, m.article_id, 0, m.emplacement_vers, m.quantite, round(pris, 4), r,
          round(r - pris, 4), nullif(ec, 0), case when ec > 0 then round(-ec * coalesce(cm, 0), 2) end,
          m.id, case when ec > 0 then 'Sortie au-delà de la réserve confirmée' end, m.auteur, m.auteur_nom, m.hors_cabinet);
  return jsonb_build_object('statut', 'ok', 'ecart', ec);
end $$;

-- ---------- Inventaire : tout cabinet pour toute personne active ; réserve selon autorisation ----------
create or replace function public.fixer_stock(p_article bigint, p_emplacement smallint, p_quantite numeric,
                                              p_type text default 'regul', p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a numeric; f numeric; cm numeric; ec numeric; v numeric; v_hors boolean;
begin
  if p_type not in ('inventaire','regul','correction') then raise exception 'Type invalide'; end if;
  if p_emplacement is null or p_emplacement not between 0 and 8 then raise exception 'Emplacement invalide'; end if;
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

-- Enregistrer la fin d'un inventaire (date, nombre d'articles) : toute personne active,
-- réserve selon autorisation.
create or replace function public.terminer_inventaire(p_emplacement smallint, p_nb integer, p_j0 boolean default false,
                                                      p_nb_zero integer default 0)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_emplacement = 0 and not public.peut_compter_reserve() then
    raise exception 'Inventaire de la réserve : autorisation nécessaire';
  end if;
  insert into public.inventaires(emplacement, j0, nb_comptes, nb_mis_a_zero, hors_cabinet)
  values (p_emplacement, coalesce(p_j0, false), p_nb, p_nb_zero, public.hors_cabinet(p_emplacement))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.terminer_inventaire(smallint, integer, boolean, integer) from public, anon;
grant execute on function public.terminer_inventaire(smallint, integer, boolean, integer) to authenticated;
revoke all on function public.hors_cabinet(smallint) from public, anon;
grant execute on function public.hors_cabinet(smallint), public.mon_cabinet(), public.peut_compter_reserve() to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"002"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
