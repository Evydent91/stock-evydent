-- =====================================================================
-- 006_suppression_article.sql — Suppression définitive d'une fiche article
-- Suppose : 001 à 005 déjà appliquées.
-- Ce que fait cette migration :
--  1. Garde le nom de l'article dans l'historique (mouvements et lignes de commande)
--     quand la fiche est supprimée.
--  2. supprimer_article() : réservée à la référente et à la responsable. Refuse si l'article
--     a encore du stock (réserve ou cabinets) ou s'il figure dans une commande en cours.
--     Supprime aussi ses prix par fournisseur, son historique de prix et ses lignes de stock à 0.
-- Rejouable : oui. Non destructive pour les données existantes.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

alter table public.mouvements add column if not exists article_nom text;
alter table public.commande_lignes add column if not exists article_nom text;

create or replace function public.supprimer_article(p_article bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nom text; v_stock text; v_cmd text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  select nom into v_nom from public.articles where id = p_article for update;
  if not found then raise exception 'Article introuvable'; end if;

  select string_agg(case when emplacement = 0 then 'réserve : ' else 'cabinet ' || emplacement || ' : ' end
                    || trim(to_char(quantite, 'FM999999990.####')), ', ' order by emplacement)
    into v_stock from public.stocks where article_id = p_article and abs(quantite) > 1e-9;
  if v_stock is not null then
    raise exception 'Suppression impossible : « % » a encore du stock (%). Mettez-le à 0 par un inventaire ou une correction.', v_nom, v_stock;
  end if;

  select string_agg(distinct coalesce(c.numero, 'n° ' || c.id), ', ') into v_cmd
    from public.commande_lignes l join public.commandes c on c.id = l.commande_id
   where l.article_id = p_article and c.statut in ('attente', 'partielle')
     and l.recu < l.quantite and not l.reliquat_abandonne;
  if v_cmd is not null then
    raise exception 'Suppression impossible : « % » est attendu dans une commande en cours (%).', v_nom, v_cmd;
  end if;

  update public.mouvements set article_nom = v_nom where article_id = p_article;
  update public.commande_lignes set article_nom = v_nom where article_id = p_article;
  delete from public.articles where id = p_article;   -- stocks, prix fournisseurs et historique des prix suivent
  return jsonb_build_object('supprime', v_nom);
end $$;

revoke all on function public.supprimer_article(bigint) from public, anon;
grant execute on function public.supprimer_article(bigint) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"006"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
