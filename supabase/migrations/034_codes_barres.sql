-- =====================================================================
-- 034_codes_barres.sql — Sortie par scan (fonction en essai)
-- Suppose : 001 à 033 déjà appliquées.
-- Ce que fait cette migration :
--  1. table article_codes : les codes-barres / DataMatrix reliés à un article
--     (un code = un seul article ; un article peut avoir plusieurs codes).
--     Un code scanné par l'équipe peut être « à vérifier » par la référente,
--     ou « en attente » (sans article) quand seule la gestion peut associer ;
--  2. mouvements.lot_fab : le n° de lot du fabricant lu au scan (facultatif) ;
--  3. faire_sortie garde ce n° de lot quand l'appli l'envoie ;
--  4. réglages de la fonction (éteinte par défaut) : scan_actif, scan_qui, scan_lot.
-- Tant que cette migration n'est pas passée sur une base, la fonction y reste invisible.
-- Rejouable : oui. Non destructive. Ne rallume jamais la fonction si elle a été éteinte.
-- =====================================================================

create table if not exists public.article_codes (
  id bigserial primary key,
  code text not null,
  article_id bigint references public.articles(id) on delete cascade,
  source text not null default 'scan' check (source in ('scan', 'main')),
  a_verifier boolean not null default false,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  cree_par_nom text,
  verifie_le timestamptz
);
create unique index if not exists article_codes_code_unique on public.article_codes (code);
create index if not exists article_codes_article on public.article_codes (article_id);

create or replace function public.article_codes_auteur() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cree_par is null then new.cree_par := auth.uid(); end if;
  if new.cree_par_nom is null then
    select nom into new.cree_par_nom from public.profils where id = new.cree_par;
  end if;
  return new;
end $$;
drop trigger if exists article_codes_auteur on public.article_codes;
create trigger article_codes_auteur before insert on public.article_codes
  for each row execute function public.article_codes_auteur();

-- L'équipe peut-elle associer un code inconnu ? (réglage « scan_qui »)
create or replace function public.scan_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valeur #>> '{}' from public.parametres where cle = 'scan_qui'), 'equipe') = 'equipe'
$$;

alter table public.article_codes enable row level security;
drop policy if exists lecture on public.article_codes;
create policy lecture on public.article_codes for select to authenticated using (public.est_actif());
drop policy if exists ajout on public.article_codes;
-- la gestion ajoute librement ; le reste de l'équipe seulement « à vérifier », et avec un article seulement si le réglage le permet
create policy ajout on public.article_codes for insert to authenticated
  with check (public.est_gestion() or (public.est_actif() and a_verifier and (article_id is null or public.scan_equipe())));
drop policy if exists gestion on public.article_codes;
create policy gestion on public.article_codes for update to authenticated using (public.est_gestion()) with check (public.est_gestion());
drop policy if exists suppression on public.article_codes;
create policy suppression on public.article_codes for delete to authenticated using (public.est_gestion());
grant select, insert, update, delete on public.article_codes to authenticated;
grant usage, select on sequence public.article_codes_id_seq to authenticated;

alter table public.mouvements add column if not exists lot_fab text;

-- Sortie : identique à 008, avec en plus le n° de lot du fabricant (clé « lot_fab » de chaque ligne)
create or replace function public.faire_sortie(p_cabinet smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
  v_hors boolean := public.hors_cabinet(p_cabinet);
  l jsonb; v_art bigint; v_q numeric; f numeric; r numeric; c numeric; v_lf text;
  n_ok int := 0; n_att int := 0;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_cabinet is null or p_cabinet not between 1 and 9 then raise exception 'Cabinet invalide'; end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    v_art := (l->>'article_id')::bigint;
    v_q   := (l->>'quantite')::numeric;
    v_lf  := nullif(left(trim(coalesce(l->>'lot_fab', '')), 60), '');
    if v_art is null or v_q is null or v_q <= 0 then continue; end if;
    f := public.facteur(v_art);
    if f is null then raise exception 'Article % introuvable', v_art; end if;
    r := public._stock(v_art, 0::smallint);
    if v_q > r * f + 1e-9 then
      insert into public.mouvements(type, statut, lot, article_id, emplacement_de, emplacement_vers,
                                    quantite, avant, hors_cabinet, lot_fab)
      values ('demande', 'attente', v_lot, v_art, 0, p_cabinet, v_q, r, v_hors, v_lf);
      n_att := n_att + 1;
    else
      c := public._stock(v_art, p_cabinet);
      update public.stocks set quantite = round(r - v_q / f, 4), modifie_le = now()
       where article_id = v_art and emplacement = 0;
      update public.stocks set quantite = round(c + v_q, 4), modifie_le = now()
       where article_id = v_art and emplacement = p_cabinet;
      insert into public.mouvements(type, lot, article_id, emplacement_de, emplacement_vers, quantite,
                                    quantite_reserve, avant, apres, hors_cabinet, lot_fab)
      values ('sortie', v_lot, v_art, 0, p_cabinet, v_q, round(v_q / f, 4), r, round(r - v_q / f, 4), v_hors, v_lf);
      n_ok := n_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('lot', v_lot, 'sorties', n_ok, 'en_attente', n_att, 'hors_cabinet', v_hors);
end $$;
revoke all on function public.faire_sortie(smallint, jsonb) from public, anon;
grant execute on function public.faire_sortie(smallint, jsonb) to authenticated;

-- Réglages : la fonction démarre ÉTEINTE ; « on conflict do nothing » garde le choix déjà fait
insert into public.parametres(cle, valeur) values
  ('scan_actif', 'false'), ('scan_qui', '"equipe"'), ('scan_lot', 'false')
  on conflict (cle) do nothing;

insert into public.parametres(cle, valeur) values ('schema_version', '"034"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
