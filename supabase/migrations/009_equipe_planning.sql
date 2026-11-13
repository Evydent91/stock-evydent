-- =====================================================================
-- 009_equipe_planning.sql — Équipe (fiches planning), dentistes, congés, planning
-- Suppose : 001 à 008 déjà appliquées.
-- Ce que fait cette migration (rien n'est modifié dans le stock) :
--  1. dentistes : prénom, jours de présence habituels (lun → ven), spécificités, actif / ancien.
--  2. equipe : une fiche par personne du planning (assistante, assistant, intérimaire),
--     reliée si besoin à un compte de connexion (profils). Contient la semaine type :
--     pour chaque jour (1 = lundi … 5 = vendredi), le matin et l'après-midi :
--     affectation (« D:<n° dentiste> » ou un code : ADMIN, STE, ACCUEIL, ADMIN_ORTHO,
--     RANGEMENT, NETTOYAGE, ECOLE, OFF) et horaires.
--  3. conges : congés des assistantes et des dentistes (demande, réponse).
--  4. planning : une ligne par personne, par jour et par demi-journée (AM / PM).
-- Droits : la référente et la responsable lisent et modifient tout ; une assistante
-- lit sa propre fiche et ses propres congés (le reste viendra avec l'étape des congés).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.dentistes (
  id        bigint generated always as identity primary key,
  prenom    text not null,
  actif     boolean not null default true,
  jours     jsonb not null default '{}'::jsonb,     -- {"1":true,"2":true,...} jours de présence habituels
  note      text,                                   -- spécificités (ex. « + 1 mercredi par mois »)
  ordre     smallint not null default 0,
  cree_le   timestamptz not null default now()
);

create table if not exists public.equipe (
  id          bigint generated always as identity primary key,
  prenom      text not null,
  type        text not null default 'assistante' check (type in ('assistante','interimaire')),
  statut      text not null default 'qualifiee' check (statut in ('qualifiee','apprentie')),
  contrat_h   numeric(5,2) not null default 39,
  ecole_jour  smallint check (ecole_jour between 1 and 5),
  actif       boolean not null default true,
  profil_id   uuid unique references public.profils(id) on delete set null,
  trame       jsonb not null default '{}'::jsonb,   -- semaine type (voir en-tête)
  consigne    text,
  regles      jsonb not null default '{}'::jsonb,   -- heures particulières (étape planning)
  ordre       smallint not null default 0,
  cree_le     timestamptz not null default now()
);

create table if not exists public.conges (
  id           bigint generated always as identity primary key,
  equipe_id    bigint references public.equipe(id) on delete cascade,
  dentiste_id  bigint references public.dentistes(id) on delete cascade,
  du           date not null,
  au           date not null,
  type         text not null default 'CP' check (type in ('CP','ARRET','FORMATION','AUTRE')),
  statut       text not null default 'accepte' check (statut in ('attente','accepte','refuse','annule')),
  mot          text,
  reponse      text,
  demande_par  uuid references public.profils(id) on delete set null,
  traite_par   uuid references public.profils(id) on delete set null,
  traite_le    timestamptz,
  cree_le      timestamptz not null default now(),
  check (au >= du),
  check ((equipe_id is null) <> (dentiste_id is null))
);
create index if not exists conges_equipe on public.conges(equipe_id, du);
create index if not exists conges_dentiste on public.conges(dentiste_id, du);

create table if not exists public.planning (
  equipe_id   bigint not null references public.equipe(id) on delete cascade,
  jour        date not null,
  demi        text not null check (demi in ('AM','PM')),
  aff         text not null,          -- « D:<n° dentiste> » ou un code (ADMIN, STE, ECOLE, CP, ARRET, OFF…)
  debut       time,
  fin         time,
  modifie_par uuid references public.profils(id) on delete set null,
  modifie_le  timestamptz not null default now(),
  primary key (equipe_id, jour, demi)
);
create index if not exists planning_jour on public.planning(jour);

alter table public.dentistes enable row level security;
alter table public.equipe    enable row level security;
alter table public.conges    enable row level security;
alter table public.planning  enable row level security;

drop policy if exists lecture on public.dentistes;
drop policy if exists ecriture on public.dentistes;
create policy lecture  on public.dentistes for select to authenticated using (public.est_gestion());
create policy ecriture on public.dentistes for all to authenticated using (public.est_gestion()) with check (public.est_gestion());

drop policy if exists lecture on public.equipe;
drop policy if exists ecriture on public.equipe;
create policy lecture  on public.equipe for select to authenticated using (public.est_gestion() or profil_id = auth.uid());
create policy ecriture on public.equipe for all to authenticated using (public.est_gestion()) with check (public.est_gestion());

drop policy if exists lecture on public.conges;
drop policy if exists ecriture on public.conges;
create policy lecture  on public.conges for select to authenticated
  using (public.est_gestion() or equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid()));
create policy ecriture on public.conges for all to authenticated using (public.est_gestion()) with check (public.est_gestion());

drop policy if exists lecture on public.planning;
drop policy if exists ecriture on public.planning;
create policy lecture  on public.planning for select to authenticated using (public.est_gestion());
create policy ecriture on public.planning for all to authenticated using (public.est_gestion()) with check (public.est_gestion());

insert into public.parametres(cle, valeur) values ('schema_version', '"009"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
