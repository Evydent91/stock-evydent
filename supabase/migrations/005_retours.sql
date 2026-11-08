-- =====================================================================
-- 005_retours.sql — Retour d'articles d'un cabinet vers la réserve
-- Suppose : 001 à 004 déjà appliquées.
-- Ce que fait cette migration :
--  retour_reserve() : toute personne active renvoie des articles non utilisés d'un cabinet
--  vers la réserve. Quantités saisies dans l'unité de la réserve et en entiers :
--  boîtes fermées pour un article rangé en boîte (les unités en vrac restent au cabinet).
--  Un retour depuis un autre cabinet que le sien est marqué « hors cabinet ».
--  Si le stock enregistré du cabinet est plus bas que ce qui revient, il est mis à 0
--  et l'écart est noté sur le mouvement (le prochain inventaire du cabinet corrigera).
-- Rejouable : oui. Non destructive.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

create or replace function public.retour_reserve(p_cabinet smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
  v_hors boolean := public.hors_cabinet(p_cabinet);
  l jsonb; v_art bigint; q numeric; f numeric; r numeric; c numeric; manque numeric;
  n int := 0; n_ecart int := 0;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_cabinet is null or p_cabinet not between 1 and 8 then raise exception 'Cabinet invalide'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    v_art := (l->>'article_id')::bigint;
    q     := (l->>'quantite')::numeric;
    if v_art is null or q is null or q <= 0 then continue; end if;
    if q <> trunc(q) then raise exception 'Retour en boîtes ou unités entières seulement'; end if;
    f := public.facteur(v_art);
    if f is null then raise exception 'Article % introuvable', v_art; end if;
    c := public._stock(v_art, p_cabinet);
    r := public._stock(v_art, 0::smallint);
    manque := greatest(0, q * f - c);
    update public.stocks set quantite = greatest(0, round(c - q * f, 4)), modifie_le = now()
     where article_id = v_art and emplacement = p_cabinet;
    update public.stocks set quantite = round(r + q, 4), modifie_le = now()
     where article_id = v_art and emplacement = 0;
    insert into public.mouvements(type, lot, article_id, emplacement_de, emplacement_vers, quantite,
                                  quantite_reserve, avant, apres, ecart, hors_cabinet, motif)
    values ('retour', v_lot, v_art, p_cabinet, 0, q * f, q, r, round(r + q, 4),
            nullif(manque, 0), v_hors, 'Retour en réserve');
    n := n + 1;
    if manque > 0 then n_ecart := n_ecart + 1; end if;
  end loop;
  if n = 0 then raise exception 'Aucune quantité à retourner'; end if;
  return jsonb_build_object('lot', v_lot, 'retours', n, 'ecarts', n_ecart, 'hors_cabinet', v_hors);
end $$;

revoke all on function public.retour_reserve(smallint, jsonb) from public, anon;
grant execute on function public.retour_reserve(smallint, jsonb) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"005"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
