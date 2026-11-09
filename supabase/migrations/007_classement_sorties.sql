-- =====================================================================
-- 007_classement_sorties.sql — Classement des articles les plus sortis
-- Suppose : 001 à 006 déjà appliquées.
-- Ce que fait cette migration :
--  classement_sorties() : total des sorties (validées) par article et par cabinet sur les
--  derniers mois, pour afficher les listes Sortie et Inventaire du plus au moins sorti.
--  Lecture seule ; chacun ne voit que ce que les règles d'accès lui permettent déjà de lire.
-- Rejouable : oui. Non destructive.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

create or replace function public.classement_sorties(p_jours int default 365)
returns table(article_id bigint, cabinet smallint, total numeric, nb bigint)
language sql stable security invoker set search_path = public as $$
  select m.article_id, m.emplacement_vers, sum(m.quantite), count(*)
    from public.mouvements m
   where m.type in ('sortie', 'demande') and m.statut = 'ok'
     and m.article_id is not null and m.emplacement_vers between 1 and 8
     and m.cree_le >= now() - make_interval(days => greatest(coalesce(p_jours, 365), 1))
   group by m.article_id, m.emplacement_vers
$$;

revoke all on function public.classement_sorties(int) from public, anon;
grant execute on function public.classement_sorties(int) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"007"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
