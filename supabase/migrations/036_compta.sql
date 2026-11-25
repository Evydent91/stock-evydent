-- =====================================================================
-- 036_compta.sql — Comptabilité du cabinet (site /compta)
-- Suppose : 001 à 035 déjà appliquées.
-- Ce que fait cette migration :
--  1. Accès réservé : table compta_acces (comptes autorisés : directrice, comptable),
--     code à 6 chiffres propre à la comptabilité (haché), ouverture limitée dans le temps
--     (verrouillage après N minutes sans activité, 5 essais puis blocage 15 min).
--  2. Tables de la comptabilité : comptes (consommables, laboratoire, implants…), fournisseurs
--     (compte et entité par défaut), fichiers PDF, factures, paiements (un paiement peut régler
--     plusieurs factures), chiffre d'affaires du mois, charges du mois (saisie banque), réglages.
--  3. Sécurité (RLS) : tout est lisible seulement quand la comptabilité est ouverte avec le code ;
--     seule la directrice écrit ; le comptable lit. Aucune politique sur compta_acces (fonctions seulement).
--  4. Dossier privé « compta » (Storage) pour les PDF, mêmes règles.
--  5. Lien avec le stock : compta_depuis_stock() crée la facture « à vérifier » quand une facture
--     PDF est importée dans une commande (référente ou responsable), sans pouvoir lire la comptabilité.
-- Rejouable : oui. Non destructive : rien n'est supprimé ni modifié dans les tables existantes.
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après accord.
-- Après la migration, donner l'accès (une fois, dans l'éditeur SQL, avec l'identifiant réel) :
--   insert into public.compta_acces (user_id, role)
--   select id, 'directrice' from public.profils where identifiant = 'IDENTIFIANT'
--   on conflict (user_id) do nothing;
-- Le code à 6 chiffres se choisit ensuite dans le site, à la première ouverture.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 1. Accès ----------
create table if not exists public.compta_acces (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'directrice' check (role in ('directrice','comptable')),
  code_hash    text,
  essais       int not null default 0,
  bloque_jusqu timestamptz,
  ouvert_jusqu timestamptz,
  cree_le      timestamptz not null default now()
);
alter table public.compta_acces enable row level security;

create table if not exists public.compta_parametres (
  cle    text primary key,
  valeur jsonb
);

-- minutes avant verrouillage (réglage, 15 par défaut)
create or replace function public.compta_verrou_min() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (valeur #>> '{}')::int from public.compta_parametres where cle = 'verrou_min'), 15)
$$;

-- La comptabilité est-elle ouverte (compte autorisé + code tapé il y a moins de N minutes) ?
create or replace function public.compta_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.compta_acces a join public.profils p on p.id = a.user_id and p.actif
                 where a.user_id = auth.uid() and a.ouvert_jusqu > now())
$$;
-- … et peut-on y écrire (directrice) ?
create or replace function public.compta_ecrit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.compta_ok() and exists (select 1 from public.compta_acces where user_id = auth.uid() and role = 'directrice')
$$;

-- État pour l'écran d'accès : { acces, role, code, ouvert, bloque_jusqu, verrou_min }
create or replace function public.compta_etat() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when a.user_id is null then jsonb_build_object('acces', false)
    else jsonb_build_object('acces', true, 'role', a.role, 'code', a.code_hash is not null,
      'ouvert', coalesce(a.ouvert_jusqu > now(), false), 'bloque_jusqu', case when a.bloque_jusqu > now() then a.bloque_jusqu end,
      'verrou_min', public.compta_verrou_min()) end
  from (select 1) x left join public.compta_acces a on a.user_id = auth.uid()
$$;

create or replace function public.compta_ouvrir(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.compta_acces;
begin
  select * into a from public.compta_acces where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  if a.code_hash is null then return jsonb_build_object('ok', false, 'erreur', 'code_a_definir'); end if;
  if a.bloque_jusqu > now() then return jsonb_build_object('ok', false, 'erreur', 'bloque', 'jusqu', a.bloque_jusqu); end if;
  if crypt(coalesce(p_code, ''), a.code_hash) = a.code_hash then
    update public.compta_acces set essais = 0, bloque_jusqu = null,
      ouvert_jusqu = now() + make_interval(mins => public.compta_verrou_min()) where user_id = a.user_id;
    return jsonb_build_object('ok', true);
  end if;
  update public.compta_acces set essais = a.essais + 1,
    bloque_jusqu = case when a.essais + 1 >= 5 then now() + interval '15 minutes' end,
    ouvert_jusqu = null where user_id = a.user_id;
  return jsonb_build_object('ok', false, 'erreur', case when a.essais + 1 >= 5 then 'bloque' else 'code' end, 'reste', greatest(0, 4 - a.essais));
end $$;

-- Premier code (sans ancien code) ou changement (ancien code obligatoire)
create or replace function public.compta_definir_code(p_ancien text, p_nouveau text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a public.compta_acces;
begin
  select * into a from public.compta_acces where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  if coalesce(p_nouveau, '') !~ '^[0-9]{6}$' then return jsonb_build_object('ok', false, 'erreur', 'format'); end if;
  if a.code_hash is not null and crypt(coalesce(p_ancien, ''), a.code_hash) <> a.code_hash then
    return jsonb_build_object('ok', false, 'erreur', 'ancien');
  end if;
  update public.compta_acces set code_hash = crypt(p_nouveau, gen_salt('bf')), essais = 0, bloque_jusqu = null,
    ouvert_jusqu = now() + make_interval(mins => public.compta_verrou_min()) where user_id = a.user_id;
  return jsonb_build_object('ok', true);
end $$;

-- Activité : repousse le verrouillage (seulement si encore ouvert)
create or replace function public.compta_prolonger() returns boolean
language sql security definer set search_path = public as $$
  update public.compta_acces set ouvert_jusqu = now() + make_interval(mins => public.compta_verrou_min())
  where user_id = auth.uid() and ouvert_jusqu > now() returning true
$$;

create or replace function public.compta_fermer() returns void
language sql security definer set search_path = public as $$
  update public.compta_acces set ouvert_jusqu = null where user_id = auth.uid()
$$;

-- ---------- 2. Tables ----------
-- Comptes : groupe dentaire (compté dans le repère de 12 %), facture (autres factures), charge (saisie banque)
create table if not exists public.compta_comptes (
  code   text primary key,
  nom    text not null,
  groupe text not null check (groupe in ('dentaire','facture','charge')),
  ordre  int not null default 0,
  repere numeric,                 -- repère en % du CA (facultatif)
  actif  boolean not null default true
);
insert into public.compta_comptes (code, nom, groupe, ordre, repere) values
  ('conso',    'Consommables & matériel',           'dentaire', 1, 5),
  ('labo',     'Laboratoire (prothèses + Invisalign)', 'dentaire', 2, 10),
  ('implant',  'Implants',                          'dentaire', 3, null),
  ('prlvt',    'Prélèvements et contrats annuels',  'facture', 10, null),
  ('divers',   'Frais divers',                      'facture', 11, null),
  ('cb',       'Frais CB',                          'facture', 12, null),
  ('ndf',      'Notes de frais',                    'facture', 13, null),
  ('pret',     'Prêts',                             'charge', 20, null),
  ('loyer',    'Loyer',                             'charge', 21, null),
  ('assur',    'Assurances',                        'charge', 22, null),
  ('leasing',  'Leasings',                          'charge', 23, null),
  ('salaires', 'Salaires',                          'charge', 24, null),
  ('impots',   'Impôts et cotisations',             'charge', 25, null)
on conflict (code) do nothing;

insert into public.compta_parametres (cle, valeur) values
  ('seuil_dentaire', '12'), ('verrou_min', '15'),
  ('repere_sal_salaries', '15'), ('repere_sal_praticiens', '45')
on conflict (cle) do nothing;

-- Fournisseurs : compte et entité proposés par défaut (appris au fil des saisies)
create table if not exists public.compta_fournisseurs (
  id          bigserial primary key,
  nom         text not null,
  compte_code text references public.compta_comptes(code) on update cascade,
  entite      text not null default 'ASSO' check (entite in ('ASSO','SAS')),
  mode        text check (mode in ('virement','cheque','cb','prelevement')),
  cree_le     timestamptz not null default now()
);
create unique index if not exists compta_fournisseurs_nom on public.compta_fournisseurs (lower(nom));

-- Fichiers déposés (un PDF peut contenir plusieurs factures : chaque facture garde ses pages)
create table if not exists public.compta_fichiers (
  id       bigserial primary key,
  chemin   text not null unique,       -- dans le dossier privé « compta »
  nom      text,
  pages    int,
  origine  text not null default 'depot' check (origine in ('depot','photo','stock','mail')),
  cree_par uuid default auth.uid(),
  cree_le  timestamptz not null default now()
);

create table if not exists public.compta_paiements (
  id            bigserial primary key,
  mode          text not null check (mode in ('virement','cheque','cb','prelevement')),
  n_cheque      text,
  date_paiement date not null default current_date,
  entite        text not null default 'ASSO' check (entite in ('ASSO','SAS')),
  montant       numeric not null default 0,
  note          text,
  cree_le       timestamptz not null default now()
);

create table if not exists public.compta_factures (
  id           bigserial primary key,
  fournisseur  text,
  numero       text,
  date_facture date,
  mois         date,                   -- mois de rattachement (1er du mois), par défaut celui de la facture
  compte_code  text references public.compta_comptes(code) on update cascade,
  entite       text not null default 'ASSO' check (entite in ('ASSO','SAS')),
  montant_ttc  numeric,
  paiement_id  bigint references public.compta_paiements(id) on delete set null,
  fichier_id   bigint references public.compta_fichiers(id) on delete set null,
  page_debut   int,
  page_fin     int,
  source       text not null default 'manuel' check (source in ('manuel','stock','depot','photo','excel','mail')),
  a_verifier   boolean not null default false,
  note         text,
  cree_le      timestamptz not null default now(),
  modifie_le   timestamptz not null default now()
);
create index if not exists compta_factures_mois on public.compta_factures (mois);
create index if not exists compta_factures_paiement on public.compta_factures (paiement_id);
create unique index if not exists compta_factures_unique on public.compta_factures (lower(fournisseur), numero)
  where numero is not null and numero <> '';

create or replace function public.compta_factures_avant() returns trigger
language plpgsql as $$
begin
  if new.mois is null and new.date_facture is not null then new.mois := date_trunc('month', new.date_facture)::date; end if;
  if new.mois is not null then new.mois := date_trunc('month', new.mois)::date; end if;
  new.modifie_le := now();
  return new;
end $$;
drop trigger if exists compta_factures_avant on public.compta_factures;
create trigger compta_factures_avant before insert or update on public.compta_factures
  for each row execute function public.compta_factures_avant();

create table if not exists public.compta_ca (
  mois    date primary key,
  montant numeric not null default 0,
  note    text
);

-- Charges du mois (relevés bancaires) : une ligne = un libellé ; les salaires ont brut + charges
create table if not exists public.compta_charges (
  id          bigserial primary key,
  mois        date not null,
  compte_code text not null references public.compta_comptes(code) on update cascade,
  libelle     text not null default '',
  entite      text not null default 'ASSO' check (entite in ('ASSO','SAS')),
  mode        text check (mode in ('virement','cheque','cb','prelevement')),
  date_op     date,
  montant     numeric,
  brut        numeric,
  charges     numeric,
  ordre       int not null default 0,
  cree_le     timestamptz not null default now()
);
create index if not exists compta_charges_mois on public.compta_charges (mois);

-- ---------- 3. Sécurité ----------
do $$ declare t text; begin
  foreach t in array array['compta_parametres','compta_comptes','compta_fournisseurs','compta_fichiers','compta_paiements','compta_factures','compta_ca','compta_charges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('drop policy if exists ecriture on public.%I', t);
    execute format('drop policy if exists modif on public.%I', t);
    execute format('drop policy if exists suppr on public.%I', t);
    execute format('create policy lecture on public.%I for select to authenticated using (public.compta_ok())', t);
    execute format('create policy ecriture on public.%I for insert to authenticated with check (public.compta_ecrit())', t);
    execute format('create policy modif on public.%I for update to authenticated using (public.compta_ecrit()) with check (public.compta_ecrit())', t);
    execute format('create policy suppr on public.%I for delete to authenticated using (public.compta_ecrit())', t);
  end loop;
end $$;

-- ---------- 4. Dossier privé des PDF ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('compta', 'compta', false, 52428800)
on conflict (id) do nothing;
drop policy if exists "compta lecture" on storage.objects;
drop policy if exists "compta ecriture" on storage.objects;
drop policy if exists "compta modif" on storage.objects;
drop policy if exists "compta suppr" on storage.objects;
drop policy if exists "compta depot stock" on storage.objects;
create policy "compta lecture" on storage.objects for select to authenticated
  using (bucket_id = 'compta' and public.compta_ok());
create policy "compta ecriture" on storage.objects for insert to authenticated
  with check (bucket_id = 'compta' and public.compta_ecrit());
create policy "compta modif" on storage.objects for update to authenticated
  using (bucket_id = 'compta' and public.compta_ecrit()) with check (bucket_id = 'compta' and public.compta_ecrit());
create policy "compta suppr" on storage.objects for delete to authenticated
  using (bucket_id = 'compta' and public.compta_ecrit());
-- la gestion du stock peut déposer (sans relire) le PDF d'une facture importée dans une commande
create policy "compta depot stock" on storage.objects for insert to authenticated
  with check (bucket_id = 'compta' and name like 'stock/%' and public.est_gestion());

-- ---------- 5. Lien avec le stock ----------
-- Facture importée dans une commande : ligne « à vérifier » (compte et entité du fournisseur s'ils sont connus).
-- Renvoie l'id de la facture (nouvelle ou déjà présente). Ne renvoie rien d'autre de la comptabilité.
create or replace function public.compta_depuis_stock(p_fournisseur text, p_numero text, p_date date, p_montant numeric)
returns bigint language plpgsql security definer set search_path = public as $$
declare f public.compta_fournisseurs; v_id bigint;
begin
  if not public.est_gestion() then raise exception 'Action non autorisée'; end if;
  if coalesce(trim(p_fournisseur), '') = '' then return null; end if;
  if coalesce(trim(p_numero), '') <> '' then
    select id into v_id from public.compta_factures where lower(fournisseur) = lower(trim(p_fournisseur)) and numero = trim(p_numero);
    if v_id is not null then return v_id; end if;
  end if;
  select * into f from public.compta_fournisseurs where lower(nom) = lower(trim(p_fournisseur));
  insert into public.compta_factures (fournisseur, numero, date_facture, compte_code, entite, montant_ttc, source, a_verifier)
  values (coalesce(f.nom, trim(p_fournisseur)), nullif(trim(p_numero), ''), p_date, coalesce(f.compte_code, 'conso'),
          coalesce(f.entite, 'ASSO'), p_montant, 'stock', true)
  returning id into v_id;
  return v_id;
end $$;

-- PDF de cette facture déposé par la gestion du stock (chemin stock/…)
create or replace function public.compta_stock_pdf(p_facture bigint, p_chemin text, p_nom text, p_pages int)
returns void language plpgsql security definer set search_path = public as $$
declare v_f bigint;
begin
  if not public.est_gestion() then raise exception 'Action non autorisée'; end if;
  if p_chemin not like 'stock/%' then raise exception 'Chemin non autorisé'; end if;
  if exists (select 1 from public.compta_factures where id = p_facture and fichier_id is null) then
    insert into public.compta_fichiers (chemin, nom, pages, origine) values (p_chemin, p_nom, p_pages, 'stock')
    on conflict (chemin) do update set nom = excluded.nom returning id into v_f;
    update public.compta_factures set fichier_id = v_f, page_debut = 1, page_fin = p_pages where id = p_facture;
  end if;
end $$;

revoke all on function public.compta_depuis_stock(text, text, date, numeric) from public, anon;
revoke all on function public.compta_stock_pdf(bigint, text, text, int) from public, anon;
revoke all on function public.compta_ouvrir(text) from public, anon;
revoke all on function public.compta_definir_code(text, text) from public, anon;
grant execute on function public.compta_depuis_stock(text, text, date, numeric) to authenticated;
grant execute on function public.compta_stock_pdf(bigint, text, text, int) to authenticated;
grant execute on function public.compta_ouvrir(text) to authenticated;
grant execute on function public.compta_definir_code(text, text) to authenticated;
