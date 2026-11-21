-- =====================================================================
-- 033_instruments.sql — Instruments rotatifs : fiches, envois en réparation, garanties
-- Suppose : 001 à 032 déjà appliquées.
-- Ce que fait cette migration :
--  1. table instruments : un instrument par numéro de série (type, date d'achat,
--     durée de garantie en mois, valeur TTC, fournisseur, cabinet, état : en service / en panne (à réparer) / en réparation / au rebut) ;
--  2. table instrument_envois : chaque envoi (date, problème, chez qui, en garantie ou non, n° de bon)
--     et son retour (date, travaux, prix TTC, garantie de la réparation en mois) ;
--  3. accès réservé à la référente et à la responsable (lecture et écriture).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.instruments (
  id bigserial primary key,
  type text not null check (type in ('turbine', 'ca20', 'ca11', 'ca15')),
  sn text not null,
  achat date,
  garantie_mois integer not null default 12 check (garantie_mois between 0 and 120),
  fournisseur text,
  cabinet integer check (cabinet between 1 and 9),
  statut text not null default 'service' check (statut in ('service', 'reparation', 'rebut')),
  note text,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  modifie_le timestamptz not null default now()
);
create unique index if not exists instruments_sn_unique on public.instruments (upper(trim(sn)));
-- valeur de l'instrument (prix d'achat TTC) : ajoutée après coup, la relancer suffit si la table existe déjà
alter table public.instruments add column if not exists valeur numeric(10,2) check (valeur is null or valeur >= 0);
-- « En panne » : l'instrument est au centre mais ne doit plus servir, il est à réparer (ajouté après coup, rejouable)
alter table public.instruments drop constraint if exists instruments_statut_check;
alter table public.instruments add constraint instruments_statut_check check (statut in ('service', 'panne', 'reparation', 'rebut'));
alter table public.instruments add column if not exists panne_le date;
alter table public.instruments add column if not exists panne_motif text;
alter table public.instruments add column if not exists panne_detail text;

create table if not exists public.instrument_envois (
  id bigserial primary key,
  instrument_id bigint not null references public.instruments(id) on delete cascade,
  envoye_le date not null default current_date,
  motif text,
  detail text,
  chez text,
  en_garantie boolean not null default false,
  bon text,
  retour_le date,
  travaux text,
  prix numeric(10,2),
  garantie_rep_mois integer check (garantie_rep_mois between 0 and 60),
  rebut boolean not null default false,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  modifie_le timestamptz not null default now()
);
-- date où la panne avait été signalée, gardée dans l'historique quand l'instrument part
alter table public.instrument_envois add column if not exists panne_le date;
create index if not exists instrument_envois_instr on public.instrument_envois (instrument_id, envoye_le desc);

alter table public.instruments enable row level security;
alter table public.instrument_envois enable row level security;
drop policy if exists gestion on public.instruments;
create policy gestion on public.instruments for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
drop policy if exists gestion on public.instrument_envois;
create policy gestion on public.instrument_envois for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
grant select, insert, update, delete on public.instruments, public.instrument_envois to authenticated;
grant usage, select on sequence public.instruments_id_seq, public.instrument_envois_id_seq to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"033"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
