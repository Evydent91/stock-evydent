-- =====================================================================
-- INSTALLATION COMPLÈTE D'UNE BASE NEUVE (Evydent-Prod) : migrations 001 à 006 à la suite.
-- Fichier assemblé automatiquement à partir de supabase/migrations/ — ne pas modifier à la main.
-- À lancer UNE SEULE FOIS dans le SQL Editor d'Evydent-Prod.
-- =====================================================================

-- >>>>> supabase/migrations/001_init_schema.sql
-- =====================================================================
-- 001_init_schema.sql — Stock Evydent Val d'Yerres
-- Crée le schéma de départ : équipe, fournisseurs, articles, prix,
-- stock (réserve + 8 cabinets), mouvements, commandes, paramètres,
-- la sécurité (RLS) et les fonctions de sortie de stock.
-- Suppose : un projet Supabase vide (aucune de ces tables n'existe).
-- Rejouable : oui pour les tables, index et fonctions (if not exists /
-- create or replace) ; les politiques RLS sont supprimées puis recréées.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

-- ---------- Conventions ----------
-- emplacement : 0 = réserve, 1 à 8 = cabinets.
-- Réserve : comptée en boîtes pour les articles livrés en boîte, sinon en unités.
-- Cabinets : comptés en unités d'usage.
-- facteur(article) = nombre d'unités d'usage par boîte quand l'article est livré
-- en boîte mais consommé à l'unité ; 1 sinon.

-- ---------- Équipe ----------
create table if not exists public.profils (
  id           uuid primary key references auth.users(id) on delete cascade,
  identifiant  text not null unique,
  nom          text not null,
  role         text not null default 'assistante'
               check (role in ('assistante','referente','responsable')),
  cabinet      smallint check (cabinet between 1 and 8),
  actif        boolean not null default true,
  cree_le      timestamptz not null default now()
);

-- ---------- Fonctions d'aide pour les droits ----------
create or replace function public.mon_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profils where id = auth.uid() and actif
$$;

create or replace function public.est_gestion() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_role() in ('referente','responsable'), false)
$$;

create or replace function public.est_responsable() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_role() = 'responsable', false)
$$;

create or replace function public.est_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mon_role() is not null
$$;

-- ---------- Fournisseurs ----------
create table if not exists public.fournisseurs (
  id               bigserial primary key,
  nom              text not null,
  n_client         text,
  telephone        text,
  email            text,
  site_web         text,
  mode_commande    text,
  commercial_nom   text,
  commercial_tel   text,
  commercial_email text,
  franco           text,
  minimum_commande text,
  remises          text,
  paiement         text,
  notes            text,
  archive          boolean not null default false,
  cree_le          timestamptz not null default now()
);
create unique index if not exists fournisseurs_nom_unique on public.fournisseurs (lower(nom));

-- Identifiants des sites fournisseurs : table séparée, réservée à la gestion.
create table if not exists public.fournisseur_comptes (
  fournisseur_id bigint primary key references public.fournisseurs(id) on delete cascade,
  identifiant    text,
  mot_de_passe   text,
  modifie_le     timestamptz not null default now()
);

-- ---------- Articles ----------
create table if not exists public.articles (
  id              bigserial primary key,
  code            text unique,                 -- ancien identifiant (i001…) pour la reprise des données
  nom             text not null,
  reference       text,                        -- 'SR' = sans référence
  fournisseur_id  bigint references public.fournisseurs(id) on delete set null, -- vide = SF
  conditionnement text not null default 'Unité' check (conditionnement in ('BOITE','Unité')),
  qte_par_boite   numeric not null default 1 check (qte_par_boite > 0),
  consommation    text not null default 'Unité' check (consommation in ('BOITE','Unité')),
  conso_verifiee  boolean not null default false,
  seuil           numeric not null default 0 check (seuil >= 0),
  sans_seuil      boolean not null default false,
  cout_moyen      numeric not null default 0 check (cout_moyen >= 0),
  prix            numeric not null default 0 check (prix >= 0),
  archive         boolean not null default false,
  cree_le         timestamptz not null default now(),
  modifie_le      timestamptz not null default now()
);
create index if not exists articles_reference_idx on public.articles (upper(reference));

create or replace function public.facteur(p_article bigint) returns numeric
language sql stable set search_path = public as $$
  select case when conditionnement = 'BOITE' and consommation = 'Unité' and qte_par_boite > 1
              then qte_par_boite else 1 end
  from public.articles where id = p_article
$$;

-- Prix de chaque article chez chaque fournisseur (rang 0 = principal).
create table if not exists public.article_fournisseurs (
  article_id     bigint not null references public.articles(id) on delete cascade,
  fournisseur_id bigint not null references public.fournisseurs(id) on delete cascade,
  prix           numeric not null default 0 check (prix >= 0),
  reference      text,
  rang           smallint not null default 0,
  primary key (article_id, fournisseur_id)
);

create table if not exists public.prix_historique (
  id             bigserial primary key,
  article_id     bigint not null references public.articles(id) on delete cascade,
  fournisseur_id bigint references public.fournisseurs(id) on delete set null,
  date_prix      date not null,
  prix           numeric not null check (prix >= 0),
  source         text,                        -- n° de facture ou de commande
  unique (article_id, fournisseur_id, date_prix, prix)
);

-- ---------- Stock ----------
create table if not exists public.stocks (
  article_id  bigint not null references public.articles(id) on delete cascade,
  emplacement smallint not null check (emplacement between 0 and 8),
  quantite    numeric not null default 0 check (quantite >= 0),
  modifie_le  timestamptz not null default now(),
  primary key (article_id, emplacement)
);

-- ---------- Mouvements : journal unique de tout ce qui bouge ----------
create table if not exists public.mouvements (
  id               bigserial primary key,
  cree_le          timestamptz not null default now(),
  auteur           uuid references public.profils(id) on delete set null default auth.uid(),
  auteur_nom       text,
  type             text not null check (type in
                   ('sortie','demande','transfert','retour','reception',
                    'inventaire','regul','correction','annulation')),
  statut           text not null default 'ok' check (statut in ('ok','attente','refuse','annule','corrige')),
  lot              uuid,                       -- regroupe les lignes d'une même sortie / réception
  article_id       bigint references public.articles(id) on delete set null,
  emplacement_de   smallint check (emplacement_de between 0 and 8),
  emplacement_vers smallint check (emplacement_vers between 0 and 8),
  quantite         numeric not null default 0, -- en unités d'usage pour les cabinets
  quantite_reserve numeric,                    -- part prise ou rendue à la réserve (boîtes si réserve en boîtes)
  avant            numeric,
  apres            numeric,
  ecart            numeric,                    -- écart de réserve (sortie au-delà du stock, inventaire…)
  valeur           numeric,                    -- impact en euros TTC (0 pour une correction)
  motif            text,
  commande_id      bigint,
  lie_a            bigint references public.mouvements(id) on delete set null,
  commentaire      text
);
create index if not exists mouvements_date_idx    on public.mouvements (cree_le desc);
create index if not exists mouvements_article_idx on public.mouvements (article_id, cree_le desc);
create index if not exists mouvements_lot_idx     on public.mouvements (lot);
create index if not exists mouvements_attente_idx on public.mouvements (statut) where statut = 'attente';

create or replace function public.mouvement_auteur() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auteur is null then new.auteur := auth.uid(); end if;
  if new.auteur_nom is null then
    select nom into new.auteur_nom from public.profils where id = new.auteur;
  end if;
  return new;
end $$;
drop trigger if exists mouvements_auteur on public.mouvements;
create trigger mouvements_auteur before insert on public.mouvements
  for each row execute function public.mouvement_auteur();

-- ---------- Commandes ----------
create table if not exists public.commandes (
  id             bigserial primary key,
  fournisseur_id bigint references public.fournisseurs(id) on delete set null,
  numero         text,
  date_commande  date not null default current_date,
  statut         text not null default 'attente' check (statut in ('attente','partielle','recue','close')),
  manuelle       boolean not null default false,
  notes          text,
  cree_le        timestamptz not null default now()
);

create table if not exists public.commande_lignes (
  id          bigserial primary key,
  commande_id bigint not null references public.commandes(id) on delete cascade,
  article_id  bigint references public.articles(id) on delete set null,
  quantite    numeric not null default 0 check (quantite >= 0),
  prix        numeric not null default 0 check (prix >= 0),
  recu        numeric not null default 0 check (recu >= 0),
  gratuit     numeric not null default 0 check (gratuit >= 0),
  reliquat_abandonne boolean not null default false
);
create index if not exists commande_lignes_cmd_idx on public.commande_lignes (commande_id);

alter table public.mouvements drop constraint if exists mouvements_commande_fk;
alter table public.mouvements add constraint mouvements_commande_fk
  foreign key (commande_id) references public.commandes(id) on delete set null;

-- ---------- Inventaires et paramètres ----------
create table if not exists public.inventaires (
  id          bigserial primary key,
  emplacement smallint not null check (emplacement between 0 and 8),
  date_inv    timestamptz not null default now(),
  auteur      uuid references public.profils(id) on delete set null default auth.uid(),
  j0          boolean not null default false,
  nb_comptes  integer,
  nb_mis_a_zero integer
);
create index if not exists inventaires_emp_idx on public.inventaires (emplacement, date_inv desc);

create table if not exists public.parametres (
  cle        text primary key,
  valeur     jsonb not null,
  modifie_le timestamptz not null default now()
);

-- =====================================================================
-- Sécurité : RLS sur toutes les tables
-- Lecture : toute personne connectée et active.
-- Écriture : référente et responsable (gestion), sauf indication contraire.
-- Les assistantes ne modifient le stock qu'au travers des fonctions ci-dessous.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['profils','fournisseurs','fournisseur_comptes','articles',
    'article_fournisseurs','prix_historique','stocks','mouvements','commandes',
    'commande_lignes','inventaires','parametres']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('drop policy if exists ecriture on public.%I', t);
  end loop;
end $$;

-- Lecture pour toute l'équipe active
create policy lecture on public.profils              for select to authenticated using (public.est_actif() or id = auth.uid());
create policy lecture on public.fournisseurs         for select to authenticated using (public.est_actif());
create policy lecture on public.articles             for select to authenticated using (public.est_actif());
create policy lecture on public.article_fournisseurs for select to authenticated using (public.est_actif());
create policy lecture on public.prix_historique      for select to authenticated using (public.est_actif());
create policy lecture on public.stocks               for select to authenticated using (public.est_actif());
create policy lecture on public.mouvements           for select to authenticated using (public.est_actif());
create policy lecture on public.commandes            for select to authenticated using (public.est_actif());
create policy lecture on public.commande_lignes      for select to authenticated using (public.est_actif());
create policy lecture on public.inventaires          for select to authenticated using (public.est_actif());
create policy lecture on public.parametres           for select to authenticated using (public.est_actif());
-- Comptes fournisseurs : lecture réservée à la gestion
create policy lecture on public.fournisseur_comptes  for select to authenticated using (public.est_gestion());

-- Écriture : gestion (référente + responsable)
create policy ecriture on public.fournisseurs         for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.fournisseur_comptes  for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.articles             for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.article_fournisseurs for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.prix_historique      for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.stocks               for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.mouvements           for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.commandes            for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.commande_lignes      for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.inventaires          for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
create policy ecriture on public.parametres           for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
-- Équipe : seule la responsable crée ou modifie les profils
create policy ecriture on public.profils              for all to authenticated using (public.est_responsable()) with check (public.est_responsable());

-- Aucun accès sans connexion
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- =====================================================================
-- Fonctions de stock (exécutées par la base, en une seule opération)
-- =====================================================================

-- Verrouille et renvoie la ligne de stock (créée à 0 si absente).
create or replace function public._stock(p_article bigint, p_emp smallint) returns numeric
language plpgsql security definer set search_path = public as $$
declare q numeric;
begin
  insert into public.stocks(article_id, emplacement, quantite) values (p_article, p_emp, 0)
    on conflict do nothing;
  select quantite into q from public.stocks
   where article_id = p_article and emplacement = p_emp for update;
  return q;
end $$;

-- Sortie de la réserve vers un cabinet, par toute personne active.
-- p_lignes : [{"article_id": 12, "quantite": 3}, …]  (quantités en unités d'usage)
-- Une ligne qui dépasse la réserve devient une demande « en attente », sans toucher au stock.
create or replace function public.faire_sortie(p_cabinet smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
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
      insert into public.mouvements(type, statut, lot, article_id, emplacement_de, emplacement_vers, quantite, avant)
      values ('demande', 'attente', v_lot, v_art, 0, p_cabinet, v_q, r);
      n_att := n_att + 1;
    else
      c := public._stock(v_art, p_cabinet);
      update public.stocks set quantite = round(r - v_q / f, 4), modifie_le = now()
       where article_id = v_art and emplacement = 0;
      update public.stocks set quantite = round(c + v_q, 4), modifie_le = now()
       where article_id = v_art and emplacement = p_cabinet;
      insert into public.mouvements(type, lot, article_id, emplacement_de, emplacement_vers, quantite,
                                    quantite_reserve, avant, apres)
      values ('sortie', v_lot, v_art, 0, p_cabinet, v_q, round(v_q / f, 4), r, round(r - v_q / f, 4));
      n_ok := n_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('lot', v_lot, 'sorties', n_ok, 'en_attente', n_att);
end $$;

-- La gestion confirme (avec écart si la réserve ne suffit pas) ou refuse une demande.
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
                                quantite_reserve, avant, apres, ecart, valeur, lie_a, motif, auteur, auteur_nom)
  values ('sortie', m.lot, m.article_id, 0, m.emplacement_vers, m.quantite, round(pris, 4), r,
          round(r - pris, 4), nullif(ec, 0), case when ec > 0 then round(-ec * coalesce(cm, 0), 2) end,
          m.id, case when ec > 0 then 'Sortie au-delà de la réserve confirmée' end, m.auteur, m.auteur_nom);
  return jsonb_build_object('statut', 'ok', 'ecart', ec);
end $$;

-- Gestion : fixe la quantité d'un emplacement (inventaire, régularisation, correction).
-- p_type : 'inventaire' | 'regul' | 'correction' (correction = sans impact financier, valeur 0).
create or replace function public.fixer_stock(p_article bigint, p_emplacement smallint, p_quantite numeric,
                                              p_type text default 'regul', p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a numeric; f numeric; cm numeric; ec numeric; v numeric;
begin
  if not public.est_gestion() and not (p_type = 'inventaire' and public.est_actif()) then
    raise exception 'Droits insuffisants';
  end if;
  if p_type not in ('inventaire','regul','correction') then raise exception 'Type invalide'; end if;
  -- une assistante ne compte que son propre cabinet
  if not public.est_gestion() and p_emplacement is distinct from
     (select cabinet from public.profils where id = auth.uid()) then
    raise exception 'Inventaire limité à votre cabinet';
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
  update public.stocks set quantite = round(p_quantite, 4), modifie_le = now()
   where article_id = p_article and emplacement = p_emplacement;
  insert into public.mouvements(type, article_id, emplacement_de, quantite, avant, apres, ecart, valeur, motif)
  values (p_type, p_article, p_emplacement, ec, a, round(p_quantite, 4), ec, v, p_motif);
  return jsonb_build_object('change', true, 'ecart', ec, 'valeur', v);
end $$;

-- Droits d'exécution : connecté uniquement
revoke all on function public.faire_sortie(smallint, jsonb)                      from public, anon;
revoke all on function public.traiter_demande(bigint, boolean)                   from public, anon;
revoke all on function public.fixer_stock(bigint, smallint, numeric, text, text) from public, anon;
revoke all on function public._stock(bigint, smallint)                           from public, anon, authenticated;
grant execute on function public.faire_sortie(smallint, jsonb)                      to authenticated;
grant execute on function public.traiter_demande(bigint, boolean)                   to authenticated;
grant execute on function public.fixer_stock(bigint, smallint, numeric, text, text) to authenticated;

-- Version du schéma
insert into public.parametres(cle, valeur) values ('schema_version', '"001"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();

-- >>>>> supabase/migrations/002_remplacements.sql
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

-- >>>>> supabase/migrations/003_inventaire.sql
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

-- >>>>> supabase/migrations/004_receptions.sql
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

-- >>>>> supabase/migrations/005_retours.sql
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

-- >>>>> supabase/migrations/006_suppression_article.sql
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
