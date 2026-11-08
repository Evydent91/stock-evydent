-- =====================================================================
-- 003_inventaire.sql — Inventaire en une seule opération + inventaire de départ (J0)
-- Suppose : 001 et 002 déjà appliquées.
-- Ce que fait cette migration :
--  1. compter_inventaire() : enregistre tout un inventaire d'un emplacement d'un coup
--     (quantités, écarts, motifs, date de l'inventaire), avec les mêmes droits que 002 :
--     tout cabinet pour toute personne active (mention « hors cabinet »), réserve pour
--     la gestion ou une assistante autorisée temporairement.
--  2. Inventaire de départ (J0) : quand il est actif, les comptages remplacent le stock
--     sans perte ni gain (valeur 0) ; au premier comptage de chaque emplacement pendant
--     le J0, les articles non comptés passent à 0.
--  3. regler_j0() : la gestion lance ou termine le J0 (7 jours par défaut).
-- Rejouable : oui. Non destructive.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

-- J0 actif ? (paramètre « j0 » : {"actif": true, "debut": "2026-11-09", "fin": "2026-11-15"})
create or replace function public.j0_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valeur->>'actif')::boolean and current_date <= (valeur->>'fin')::date
                     from public.parametres where cle = 'j0'), false)
$$;

-- Premier comptage de cet emplacement depuis le début du J0 ?
create or replace function public.j0_premier_comptage(p_emp smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.j0_actif() and not exists (
    select 1 from public.inventaires i, public.parametres p
     where p.cle = 'j0' and i.emplacement = p_emp and i.j0
       and i.date_inv::date >= (p.valeur->>'debut')::date)
$$;

create or replace function public.regler_j0(p_actif boolean, p_jours integer default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  v := case when p_actif
       then jsonb_build_object('actif', true, 'debut', current_date, 'fin', current_date + greatest(coalesce(p_jours, 7), 1) - 1)
       else jsonb_build_object('actif', false, 'fin', current_date - 1) end;
  insert into public.parametres(cle, valeur) values ('j0', v)
    on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
  return v;
end $$;

-- p_lignes : [{"article_id": 12, "quantite": 4, "motif": "Casse"}, …]
-- quantite : dans l'unité de l'emplacement (réserve : boîtes ou unités selon l'article ; cabinet : unités d'usage)
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
  if p_emplacement is null or p_emplacement not between 0 and 8 then raise exception 'Emplacement invalide'; end if;
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

revoke all on function public.compter_inventaire(smallint, jsonb) from public, anon;
revoke all on function public.regler_j0(boolean, integer) from public, anon;
grant execute on function public.compter_inventaire(smallint, jsonb), public.regler_j0(boolean, integer),
                          public.j0_actif(), public.j0_premier_comptage(smallint) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"003"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
