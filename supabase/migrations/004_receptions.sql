-- =====================================================================
-- 004_receptions.sql — Réception des commandes (et annulation d'une réception)
-- Suppose : 001, 002 et 003 déjà appliquées.
-- Ce que fait cette migration :
--  1. recevoir_commande() : enregistre une réception (partielle ou complète) en une
--     seule opération : stock de la réserve, coût moyen pondéré, quantités reçues et
--     offertes (gratuités : quantité sans valeur), historique des prix, statut de la commande.
--  2. annuler_reception() : remet tout en arrière pour une réception donnée.
--  3. statut_commande() : recalcule le statut (attente / partielle / recue / close).
-- Quantités de commande : dans l'unité de la réserve (boîtes pour un article livré en boîte).
-- Rejouable : oui. Non destructive.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

alter table public.mouvements add column if not exists gratuit numeric not null default 0;
alter table public.mouvements add column if not exists commande_ligne_id bigint;

-- Stock total d'un article exprimé dans l'unité de la réserve (réserve + cabinets convertis)
create or replace function public.stock_total(p_article bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when s.emplacement = 0 then s.quantite else s.quantite / public.facteur(p_article) end), 0)
  from public.stocks s where s.article_id = p_article
$$;

create or replace function public.statut_commande(p_commande bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v text; n_lignes int; n_finies int; n_recues int;
begin
  select count(*),
         count(*) filter (where recu >= quantite or reliquat_abandonne),
         count(*) filter (where recu > 0 or gratuit > 0)
    into n_lignes, n_finies, n_recues
    from public.commande_lignes where commande_id = p_commande;
  v := case when n_lignes > 0 and n_finies = n_lignes then 'recue'
            when n_recues > 0 then 'partielle'
            else 'attente' end;
  update public.commandes set statut = v where id = p_commande and statut <> 'close';
  return v;
end $$;

-- p_lignes : [{"ligne_id": 5, "quantite": 2, "gratuit": 1}, …]
create or replace function public.recevoir_commande(p_commande bigint, p_lignes jsonb, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid(); c public.commandes; l jsonb; li public.commande_lignes;
  q numeric; g numeric; r numeric; t numeric; cm numeric; n int := 0; tot numeric := 0; v_statut text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  select * into c from public.commandes where id = p_commande for update;
  if not found then raise exception 'Commande introuvable'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    q := coalesce((l->>'quantite')::numeric, 0); g := coalesce((l->>'gratuit')::numeric, 0);
    if q < 0 or g < 0 then raise exception 'Quantité invalide'; end if;
    if q = 0 and g = 0 then continue; end if;
    select * into li from public.commande_lignes where id = (l->>'ligne_id')::bigint and commande_id = p_commande for update;
    if not found or li.article_id is null then raise exception 'Ligne de commande introuvable'; end if;
    -- coût moyen pondéré : les gratuités entrent en quantité sans valeur
    t := public.stock_total(li.article_id);
    select cout_moyen into cm from public.articles where id = li.article_id for update;
    if t + q + g > 0 then
      update public.articles set cout_moyen = round((greatest(t, 0) * coalesce(cm, 0) + q * li.prix) / (greatest(t, 0) + q + g), 4),
                                 prix = case when li.prix > 0 then li.prix else prix end, modifie_le = now()
       where id = li.article_id;
    end if;
    r := public._stock(li.article_id, 0::smallint);
    update public.stocks set quantite = round(r + q + g, 4), modifie_le = now()
     where article_id = li.article_id and emplacement = 0;
    update public.commande_lignes set recu = recu + q, gratuit = gratuit + g where id = li.id;
    insert into public.mouvements(type, lot, article_id, emplacement_vers, quantite, gratuit, avant, apres, valeur,
                                  commande_id, commande_ligne_id, motif)
    values ('reception', v_lot, li.article_id, 0, q + g, g, r, round(r + q + g, 4), round(q * li.prix, 2),
            p_commande, li.id, coalesce('Commande ' || c.numero, 'Commande'));
    if li.prix > 0 then
      insert into public.prix_historique(article_id, fournisseur_id, date_prix, prix, source)
      values (li.article_id, c.fournisseur_id, coalesce(p_date, current_date), li.prix, c.numero)
      on conflict do nothing;
      update public.article_fournisseurs set prix = li.prix
       where article_id = li.article_id and fournisseur_id = c.fournisseur_id;
    end if;
    n := n + 1; tot := tot + q * li.prix;
  end loop;
  if n = 0 then raise exception 'Aucune quantité reçue'; end if;
  v_statut := public.statut_commande(p_commande);
  return jsonb_build_object('lot', v_lot, 'lignes', n, 'valeur', round(tot, 2), 'statut', v_statut);
end $$;

-- Annule une réception (toutes ses lignes) : stock, coût moyen, quantités reçues, statut.
create or replace function public.annuler_reception(p_lot uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m record; li public.commande_lignes; r numeric; t numeric; cm numeric; q numeric; g numeric; v_cmd bigint; n int := 0; manque text := '';
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  for m in select * from public.mouvements where lot = p_lot and type = 'reception' and statut = 'ok' for update loop
    select * into li from public.commande_lignes where id = m.commande_ligne_id for update;
    g := coalesce(m.gratuit, 0); q := m.quantite - g; v_cmd := m.commande_id;
    r := public._stock(m.article_id, 0::smallint);
    if r < m.quantite - 1e-9 then manque := manque || (select nom from public.articles where id = m.article_id) || ', '; end if;
    t := public.stock_total(m.article_id);
    select cout_moyen into cm from public.articles where id = m.article_id for update;
    if t - q - g > 1e-9 then
      update public.articles set cout_moyen = greatest(0, round((t * coalesce(cm, 0) - q * coalesce(li.prix, 0)) / (t - q - g), 4)), modifie_le = now()
       where id = m.article_id;
    end if;
    update public.stocks set quantite = greatest(0, round(r - m.quantite, 4)), modifie_le = now()
     where article_id = m.article_id and emplacement = 0;
    if li.id is not null then
      update public.commande_lignes set recu = greatest(0, recu - q), gratuit = greatest(0, gratuit - g) where id = li.id;
    end if;
    update public.mouvements set statut = 'annule' where id = m.id;
    insert into public.mouvements(type, lot, article_id, emplacement_de, quantite, gratuit, avant, apres, valeur, commande_id, commande_ligne_id, lie_a, motif)
    values ('annulation', p_lot, m.article_id, 0, -m.quantite, g, r, greatest(0, round(r - m.quantite, 4)), -coalesce(m.valeur, 0), m.commande_id, m.commande_ligne_id, m.id, 'Annulation de réception');
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Réception introuvable ou déjà annulée'; end if;
  if v_cmd is not null then perform public.statut_commande(v_cmd); end if;
  return jsonb_build_object('lignes', n, 'reserve_insuffisante', nullif(rtrim(manque, ', '), ''));
end $$;

revoke all on function public.recevoir_commande(bigint, jsonb, date) from public, anon;
revoke all on function public.annuler_reception(uuid) from public, anon;
revoke all on function public.statut_commande(bigint) from public, anon;
grant execute on function public.recevoir_commande(bigint, jsonb, date), public.annuler_reception(uuid),
                          public.statut_commande(bigint), public.stock_total(bigint) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"004"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
