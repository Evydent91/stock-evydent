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
