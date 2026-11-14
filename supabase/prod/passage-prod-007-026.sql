-- =====================================================================
-- PASSAGE EN PROD : migrations 007 à 026 à la suite (base Evydent-Prod déjà en 006).
-- Fichier assemblé automatiquement à partir de supabase/migrations/ — ne pas modifier à la main.
-- À lancer UNE SEULE FOIS dans le SQL Editor d'Evydent-Prod, AVANT la mise en ligne du nouveau site.
-- Chaque migration est rejouable : si le script s'arrête sur une erreur, on peut le relancer en entier.
-- =====================================================================

-- >>>>> supabase/migrations/007_classement_sorties.sql
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


-- >>>>> supabase/migrations/008_lieux_ste.sql
-- =====================================================================
-- 008_lieux_ste.sql — Lieux d'utilisation des articles et emplacement « La Sté »
-- Suppose : 001 à 007 déjà appliquées.
-- Ce que fait cette migration :
--  1. Articles : 3 nouvelles colonnes
--       lieu_cabinets (oui/non, oui par défaut) : article utilisé dans les cabinets ;
--       lieu_ste      (oui/non, non par défaut) : article utilisé à la Sté (stérilisation) ;
--       type_soins    (texte libre pour l'instant, liste fixe plus tard).
--     Les articles existants : Cabinets = oui, Sté = non (rien ne change pour les cabinets).
--  2. Nouvel emplacement 9 = « La Sté » : sorties de la réserve vers la Sté et inventaire
--     de la Sté (comme un cabinet). Pas de retour Sté → réserve (retour_reserve reste 1 à 8).
--     Les contrôles « emplacement entre 0 et 8 » passent à « entre 0 et 9 ».
--  3. Classement des articles les plus sortis : compte aussi la Sté.
-- Rejouable : oui. Non destructive (ajout de colonnes et élargissement des contrôles).
-- À appliquer sur Evydent-Dev d'abord, puis sur Evydent-Prod après validation.
-- =====================================================================

alter table public.articles add column if not exists lieu_cabinets boolean not null default true;
alter table public.articles add column if not exists lieu_ste boolean not null default false;
alter table public.articles add column if not exists type_soins text;

-- Contrôles d'emplacement : 0 = réserve, 1 à 8 = cabinets, 9 = La Sté
alter table public.stocks drop constraint if exists stocks_emplacement_check;
alter table public.stocks add constraint stocks_emplacement_check check (emplacement between 0 and 9);
alter table public.mouvements drop constraint if exists mouvements_emplacement_de_check;
alter table public.mouvements add constraint mouvements_emplacement_de_check check (emplacement_de between 0 and 9);
alter table public.mouvements drop constraint if exists mouvements_emplacement_vers_check;
alter table public.mouvements add constraint mouvements_emplacement_vers_check check (emplacement_vers between 0 and 9);
alter table public.inventaires drop constraint if exists inventaires_emplacement_check;
alter table public.inventaires add constraint inventaires_emplacement_check check (emplacement between 0 and 9);

-- Sortie : vers un cabinet (1 à 8) ou vers la Sté (9)
create or replace function public.faire_sortie(p_cabinet smallint, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot uuid := gen_random_uuid();
  v_hors boolean := public.hors_cabinet(p_cabinet);
  l jsonb; v_art bigint; v_q numeric; f numeric; r numeric; c numeric;
  n_ok int := 0; n_att int := 0;
begin
  if not public.est_actif() then raise exception 'Compte inactif ou inconnu'; end if;
  if p_cabinet is null or p_cabinet not between 1 and 9 then raise exception 'Cabinet invalide'; end if;
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

-- Correction / régularisation : la Sté aussi
create or replace function public.fixer_stock(p_article bigint, p_emplacement smallint, p_quantite numeric,
                                              p_type text default 'regul', p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a numeric; f numeric; cm numeric; ec numeric; v numeric; v_hors boolean;
begin
  if p_type not in ('inventaire','regul','correction') then raise exception 'Type invalide'; end if;
  if p_emplacement is null or p_emplacement not between 0 and 9 then raise exception 'Emplacement invalide'; end if;
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

-- Inventaire : la Sté aussi (ce qui manque est « Utilisé à la Sté »)
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
  if p_emplacement is null or p_emplacement not between 0 and 9 then raise exception 'Emplacement invalide'; end if;
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
                when p_emplacement = 9 then 'Utilisé à la Sté'
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

-- Classement des articles les plus sortis : la Sté aussi
create or replace function public.classement_sorties(p_jours int default 365)
returns table(article_id bigint, cabinet smallint, total numeric, nb bigint)
language sql stable security invoker set search_path = public as $$
  select m.article_id, m.emplacement_vers, sum(m.quantite), count(*)
    from public.mouvements m
   where m.type in ('sortie', 'demande') and m.statut = 'ok'
     and m.article_id is not null and m.emplacement_vers between 1 and 9
     and m.cree_le >= now() - make_interval(days => greatest(coalesce(p_jours, 365), 1))
   group by m.article_id, m.emplacement_vers
$$;

insert into public.parametres(cle, valeur) values ('schema_version', '"008"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/009_equipe_planning.sql
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


-- >>>>> supabase/migrations/010_conges.sql
-- =====================================================================
-- 010_conges.sql — Demandes de congés des assistantes, réponse de la référente / responsable
-- Suppose : 001 à 009 déjà appliquées.
-- Ce que fait cette migration :
--  1. demander_conges(du, au, mot) : une assistante demande des congés depuis son téléphone.
--     La demande est rattachée à SA fiche planning (equipe.profil_id = son compte), statut « attente ».
--  2. annuler_conges(id) : elle peut annuler sa demande tant qu'elle est en attente.
--  3. repondre_conges(id, accepte, reponse) : la référente ou la responsable accepte ou refuse.
--     La première qui répond décide : une demande déjà traitée n'est plus modifiable par ce chemin.
-- Les congés saisis directement par la référente / responsable passent par la table (droits de 009).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create or replace function public.demander_conges(p_du date, p_au date, p_mot text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_eq bigint; v_id bigint;
begin
  if not public.est_actif() then raise exception 'Compte non actif'; end if;
  select id into v_eq from public.equipe where profil_id = auth.uid() and actif;
  if v_eq is null then raise exception 'Votre compte n''est pas relié à une fiche du planning : demandez à la référente'; end if;
  if p_du is null or p_au is null or p_au < p_du then raise exception 'Dates invalides'; end if;
  if p_du < current_date then raise exception 'La date de début est déjà passée'; end if;
  if p_au > p_du + 120 then raise exception 'Période trop longue (plus de 4 mois)'; end if;
  insert into public.conges(equipe_id, du, au, type, statut, mot, demande_par)
  values (v_eq, p_du, p_au, 'CP', 'attente', nullif(trim(coalesce(p_mot, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.annuler_conges(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conges c set statut = 'annule'
   where c.id = p_id and c.statut = 'attente'
     and c.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
  if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;
end $$;

create or replace function public.repondre_conges(p_id bigint, p_accepte boolean, p_reponse text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  update public.conges set statut = case when p_accepte then 'accepte' else 'refuse' end,
         reponse = nullif(trim(coalesce(p_reponse, '')), ''), traite_par = auth.uid(), traite_le = now()
   where id = p_id and statut = 'attente';
  if not found then raise exception 'Cette demande a déjà reçu une réponse'; end if;
end $$;

revoke all on function public.demander_conges(date, date, text) from public;
revoke all on function public.annuler_conges(bigint) from public;
revoke all on function public.repondre_conges(bigint, boolean, text) from public;
grant execute on function public.demander_conges(date, date, text) to authenticated;
grant execute on function public.annuler_conges(bigint) to authenticated;
grant execute on function public.repondre_conges(bigint, boolean, text) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"010"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/011_planning.sql
-- =====================================================================
-- 011_planning.sql — Planning : affichage pour les assistantes (option), réglages des heures
-- Suppose : 001 à 010 déjà appliquées.
-- Ce que fait cette migration :
--  1. Paramètres par défaut (table parametres) — école 7 h depuis la 014 :
--       regles_heures : heures comptées pour une journée de congés, maladie, école, formation,
--                       jour férié (9 h chacun), règle du jour férié, date de départ du reliquat ;
--       planning_visible : ce que voient les assistantes (planning, reliquat) — coupé par défaut.
--  2. Une assistante peut lire SES lignes de planning et la liste des dentistes
--     seulement si la référente / responsable a activé « Leur planning ».
-- Rejouable : oui (les paramètres déjà réglés ne sont pas écrasés). Non destructive.
-- =====================================================================

insert into public.parametres(cle, valeur) values
  ('regles_heures', '{"CP":9,"ARRET":9,"ECOLE":7,"FORMATION":9,"FERIE":9,"ferie":"habituel","depuis":"2026-11-02"}'::jsonb),
  ('planning_visible', '{"planning":false,"reliquat":false}'::jsonb)
on conflict (cle) do nothing;

create or replace function public.planning_visible() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valeur->>'planning')::boolean from public.parametres where cle = 'planning_visible'), false)
$$;

drop policy if exists lecture on public.planning;
create policy lecture on public.planning for select to authenticated
  using (public.est_gestion()
         or (public.planning_visible() and equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid())));

drop policy if exists lecture on public.dentistes;
create policy lecture on public.dentistes for select to authenticated
  using (public.est_gestion() or (public.est_actif() and public.planning_visible()));

insert into public.parametres(cle, valeur) values ('schema_version', '"011"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/012_planning_heures.sql
-- =====================================================================
-- 012_planning_heures.sql — Heures comptées ajustables pour une absence dans une case du planning
-- Suppose : 001 à 011 déjà appliquées.
-- Ce que fait cette migration :
--   planning.heures : heures comptées pour la demi-journée quand c'est une absence
--   (congés, maladie, école, formation, férié). Vide = la règle générale (Réglages › Règles des heures).
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.planning add column if not exists heures numeric(4,2);
alter table public.planning drop constraint if exists planning_heures_check;
alter table public.planning add constraint planning_heures_check check (heures is null or (heures >= 0 and heures <= 24));

insert into public.parametres(cle, valeur) values ('schema_version', '"012"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/013_dentistes_jours_en_plus.sql
-- =====================================================================
-- 013_dentistes_jours_en_plus.sql — Jours de présence ponctuels d'un dentiste
-- Suppose : 001 à 012 déjà appliquées.
-- Ce que fait cette migration :
--   dentistes.extra : liste de dates (AAAA-MM-JJ) où le dentiste vient en plus de ses jours habituels
--   (ex. Dr Sacha, un mercredi par mois choisi au cas par cas). Saisie dans sa fiche › « Jours en plus ».
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.dentistes add column if not exists extra jsonb not null default '[]'::jsonb;

insert into public.parametres(cle, valeur) values ('schema_version', '"013"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/014_ecole_7h.sql
-- =====================================================================
-- 014_ecole_7h.sql — Le jour d'école des apprenties compte 7 h (et non 9 h)
-- Suppose : 001 à 013 déjà appliquées.
-- Ce que fait cette migration :
--   Règles des heures : ECOLE passe à 7 h (9 h–13 h + 14 h–17 h, comme dans le planning Excel du centre).
--   Les autres réglages (congés, arrêt, formation, férié, règles par personne) ne changent pas.
--   Ensuite, la valeur reste modifiable dans l'application (Réglages › Heures).
-- Rejouable : oui. Non destructive.
-- =====================================================================

update public.parametres set valeur = jsonb_set(valeur, '{ECOLE}', '7'::jsonb), modifie_le = now()
 where cle = 'regles_heures';

insert into public.parametres(cle, valeur) values ('schema_version', '"014"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/015_equipe_jours_off.sql
-- =====================================================================
-- 015_equipe_jours_off.sql — Jours off récurrents des assistantes
-- Suppose : 001 à 014 déjà appliquées.
-- Ce que fait cette migration :
--   equipe.offs : liste des jours off d'une personne (fiche › « Jours off »).
--   Chaque élément : { id, jours: [1..5], demi: J|AM|PM, rec: une|sem|2sem|mois, rang: 1..4 ou -1 (dernier),
--                      du: AAAA-MM-JJ (date ou départ), au: AAAA-MM-JJ ou null }
--   Dans le planning, ces demi-journées passent en « OFF » (0 h), sauf case modifiée à la main.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.equipe add column if not exists offs jsonb not null default '[]'::jsonb;

insert into public.parametres(cle, valeur) values ('schema_version', '"015"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/016_pointage.sql
-- =====================================================================
-- 016_pointage.sql — Pointage journalier par QR code
-- Suppose : 001 à 015 déjà appliquées.
-- Ce que fait cette migration :
--  1. equipe.pointage : la personne est soumise (ou non) au pointage journalier (fiche › case à cocher).
--  2. Table pointages : une ligne par personne et par jour (arrivée, sortie, note, correction).
--  3. Table pointage_cle : le jeton secret contenu dans le QR code du centre (lisible et
--     régénérable seulement par la référente / responsable).
--  4. pointer(jeton) : appelée quand une assistante scanne le QR code avec son compte.
--       1er scan du jour = arrivée ; scan suivant = sortie (un nouveau scan plus tard remplace la sortie) ;
--       un scan dans la minute qui suit le précédent est ignoré (double scan).
--     regenerer_qr() : crée un nouveau jeton (l'ancien QR code ne fonctionne plus).
--  Heure et jour : heure de Paris.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.equipe add column if not exists pointage boolean not null default false;

create table if not exists public.pointages (
  id          bigserial primary key,
  equipe_id   bigint not null references public.equipe(id) on delete cascade,
  jour        date not null,
  arrivee     timestamptz,
  sortie      timestamptz,
  note        text,
  corrige_par uuid references public.profils(id) on delete set null,
  corrige_le  timestamptz,
  cree_le     timestamptz not null default now(),
  unique (equipe_id, jour)
);
alter table public.pointages enable row level security;

drop policy if exists lecture on public.pointages;
create policy lecture on public.pointages for select to authenticated
  using (public.est_gestion() or equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid()));
drop policy if exists ecriture on public.pointages;
create policy ecriture on public.pointages for all to authenticated
  using (public.est_gestion()) with check (public.est_gestion());

create table if not exists public.pointage_cle (
  id        int primary key default 1 check (id = 1),
  jeton     text not null,
  cree_le   timestamptz not null default now()
);
alter table public.pointage_cle enable row level security;
drop policy if exists lecture on public.pointage_cle;
create policy lecture on public.pointage_cle for select to authenticated using (public.est_gestion());

insert into public.pointage_cle(id, jeton) values (1, replace(gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;

create or replace function public.regenerer_qr() returns text
language plpgsql security definer set search_path = public as $$
declare j text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  j := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.pointage_cle(id, jeton, cree_le) values (1, j, now())
    on conflict (id) do update set jeton = excluded.jeton, cree_le = now();
  return j;
end $$;

create or replace function public.pointer(p_jeton text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now();
  jour_p date := (now() at time zone 'Europe/Paris')::date;
begin
  if auth.uid() is null then return jsonb_build_object('etat', 'non_connecte'); end if;
  if not exists (select 1 from public.pointage_cle k where k.id = 1 and k.jeton = p_jeton) then
    return jsonb_build_object('etat', 'qr_perime');
  end if;
  select q.id, q.prenom, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;
  if e.id is null then return jsonb_build_object('etat', 'sans_fiche'); end if;
  if not e.pointage then return jsonb_build_object('etat', 'non_soumis', 'prenom', e.prenom); end if;

  select * into p from public.pointages where equipe_id = e.id and jour = jour_p for update;
  if p.id is null then
    insert into public.pointages(equipe_id, jour, arrivee) values (e.id, jour_p, maintenant);
    return jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
  end if;
  if maintenant - coalesce(p.sortie, p.arrivee, maintenant - interval '1 hour') < interval '1 minute' then
    return jsonb_build_object('etat', 'doublon', 'prenom', e.prenom, 'arrivee', p.arrivee, 'sortie', p.sortie);
  end if;
  if p.arrivee is null then
    update public.pointages set arrivee = maintenant where id = p.id;
    return jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
  end if;
  update public.pointages set sortie = maintenant where id = p.id;
  return jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'arrivee', p.arrivee);
end $$;

revoke all on function public.pointer(text) from public, anon;
grant execute on function public.pointer(text) to authenticated;
revoke all on function public.regenerer_qr() from public, anon;
grant execute on function public.regenerer_qr() to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"016"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/017_pointage_sens_simulation.sql
-- =====================================================================
-- 017_pointage_sens_simulation.sql — Pointage : « arrivée ou sortie ? » et simulation (site de test)
-- Suppose : 001 à 016 déjà appliquées.
-- Ce que fait cette migration :
--  1. pointer(jeton, sens, quand) remplace pointer(jeton) :
--       sens = 'sortie' pour un premier scan de la journée fait au moment de partir (l'assistante a
--       oublié de pointer son arrivée) : la sortie est enregistrée, l'arrivée reste à compléter.
--       quand = heure simulée : acceptée seulement si le paramètre « simulation_pointage » est activé
--       (à n'activer que sur la base de test, depuis l'outil Pointage du site de test).
--  2. Paramètre simulation_pointage (coupé par défaut).
-- Rejouable : oui. Non destructive.
-- =====================================================================

insert into public.parametres(cle, valeur) values ('simulation_pointage', 'false'::jsonb)
  on conflict (cle) do nothing;

drop function if exists public.pointer(text);
drop function if exists public.pointer(text, text, timestamptz);

create or replace function public.pointer(p_jeton text, p_sens text default null, p_quand timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now(); jour_p date; dernier timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('etat', 'non_connecte'); end if;
  if p_quand is not null then
    if coalesce((select (valeur)::text = 'true' from public.parametres where cle = 'simulation_pointage'), false) then
      maintenant := p_quand;
    else
      return jsonb_build_object('etat', 'simulation_coupee');
    end if;
  end if;
  jour_p := (maintenant at time zone 'Europe/Paris')::date;
  if not exists (select 1 from public.pointage_cle k where k.id = 1 and k.jeton = p_jeton) then
    return jsonb_build_object('etat', 'qr_perime');
  end if;
  select q.id, q.prenom, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;
  if e.id is null then return jsonb_build_object('etat', 'sans_fiche'); end if;
  if not e.pointage then return jsonb_build_object('etat', 'non_soumis', 'prenom', e.prenom); end if;

  select * into p from public.pointages where equipe_id = e.id and jour = jour_p for update;
  if p.id is null then
    if p_sens = 'sortie' then
      insert into public.pointages(equipe_id, jour, sortie) values (e.id, jour_p, maintenant);
      return jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'sans_arrivee', true);
    end if;
    insert into public.pointages(equipe_id, jour, arrivee) values (e.id, jour_p, maintenant);
    return jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
  end if;
  dernier := coalesce(p.sortie, p.arrivee);
  if dernier is not null and abs(extract(epoch from maintenant - dernier)) < 60 then
    return jsonb_build_object('etat', 'doublon', 'prenom', e.prenom, 'arrivee', p.arrivee, 'sortie', p.sortie);
  end if;
  if p.arrivee is null and p.sortie is null then
    update public.pointages set arrivee = maintenant where id = p.id;
    return jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
  end if;
  update public.pointages set sortie = maintenant where id = p.id;
  return jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'arrivee', p.arrivee, 'sans_arrivee', p.arrivee is null);
end $$;

revoke all on function public.pointer(text, text, timestamptz) from public, anon;
grant execute on function public.pointer(text, text, timestamptz) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"017"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/018_pointage_journal.sql
-- =====================================================================
-- 018_pointage_journal.sql — Journal du pointage (tout ce qui se passe) et référence du QR code
-- Suppose : 001 à 017 déjà appliquées.
-- Ce que fait cette migration :
--  1. pointage_cle.numero : numéro du QR code (1, 2, 3… à chaque régénération) ; la référence d'un QR
--     est « n° <numero> · <6 premiers caractères du jeton> ».
--  2. Table pointage_journal : une ligne par événement, jamais modifiée :
--       scans (arrivée, sortie, doublon, QR périmé, non soumis, compte non relié, simulation coupée),
--       corrections et effacements faits par la référente / responsable (avant → après),
--       régénération du QR code.
--     Lecture : référente / responsable. Écriture : seulement par la base elle-même.
--  3. pointer() et regenerer_qr() écrivent dans ce journal ; un déclencheur sur « pointages »
--     journalise les corrections manuelles.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.pointage_cle add column if not exists numero int not null default 1;

create table if not exists public.pointage_journal (
  id          bigserial primary key,
  quand       timestamptz not null default now(),   -- moment réel de l'événement
  heure_pt    timestamptz,                           -- heure enregistrée (différente si simulée)
  evenement   text not null,                         -- ARRIVEE, SORTIE, DOUBLON, QR_PERIME, NON_SOUMIS, SANS_FICHE, SIMULATION_COUPEE, CORRECTION, EFFACEMENT, QR_REGENERE
  equipe_id   bigint,
  profil_id   uuid,
  jour        date,
  qr_ref      text,
  simule      boolean not null default false,
  detail      text
);
create index if not exists pointage_journal_quand on public.pointage_journal(quand);
alter table public.pointage_journal enable row level security;
drop policy if exists lecture on public.pointage_journal;
create policy lecture on public.pointage_journal for select to authenticated using (public.est_gestion());

create or replace function public.qr_ref_actuelle() returns text
language sql stable security definer set search_path = public as $$
  select 'n° ' || numero || ' · ' || left(jeton, 6) from public.pointage_cle where id = 1
$$;

create or replace function public.regenerer_qr() returns text
language plpgsql security definer set search_path = public as $$
declare j text; ancien text := public.qr_ref_actuelle();
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  j := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.pointage_cle(id, jeton, cree_le, numero) values (1, j, now(), 1)
    on conflict (id) do update set jeton = excluded.jeton, cree_le = now(), numero = public.pointage_cle.numero + 1;
  insert into public.pointage_journal(evenement, profil_id, qr_ref, detail)
    values ('QR_REGENERE', auth.uid(), public.qr_ref_actuelle(), 'remplace ' || coalesce(ancien, '—'));
  return j;
end $$;

create or replace function public.pointer(p_jeton text, p_sens text default null, p_quand timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now(); jour_p date; dernier timestamptz;
  sim boolean := false; ref text; res jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('etat', 'non_connecte'); end if;
  select 'n° ' || k.numero || ' · ' || left(k.jeton, 6) into ref from public.pointage_cle k where k.id = 1 and k.jeton = p_jeton;
  if ref is null then ref := 'inconnu · ' || left(coalesce(p_jeton, ''), 6); end if;
  select q.id, q.prenom, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;

  if p_quand is not null then
    if coalesce((select (valeur)::text = 'true' from public.parametres where cle = 'simulation_pointage'), false) then
      maintenant := p_quand; sim := true;
    else
      insert into public.pointage_journal(evenement, equipe_id, profil_id, qr_ref, simule, detail) values ('SIMULATION_COUPEE', e.id, auth.uid(), ref, true, 'heure demandée ' || p_quand);
      return jsonb_build_object('etat', 'simulation_coupee');
    end if;
  end if;
  jour_p := (maintenant at time zone 'Europe/Paris')::date;

  if ref like 'inconnu%' then
    insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule) values (maintenant, 'QR_PERIME', e.id, auth.uid(), jour_p, ref, sim);
    return jsonb_build_object('etat', 'qr_perime');
  end if;
  if e.id is null then
    insert into public.pointage_journal(heure_pt, evenement, profil_id, jour, qr_ref, simule) values (maintenant, 'SANS_FICHE', auth.uid(), jour_p, ref, sim);
    return jsonb_build_object('etat', 'sans_fiche');
  end if;
  if not e.pointage then
    insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule) values (maintenant, 'NON_SOUMIS', e.id, auth.uid(), jour_p, ref, sim);
    return jsonb_build_object('etat', 'non_soumis', 'prenom', e.prenom);
  end if;

  perform set_config('evy.source', 'qr', true);   -- le déclencheur ne journalise pas ces changements (déjà fait ici)
  select * into p from public.pointages where equipe_id = e.id and jour = jour_p for update;
  if p.id is null then
    if p_sens = 'sortie' then
      insert into public.pointages(equipe_id, jour, sortie) values (e.id, jour_p, maintenant);
      res := jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'sans_arrivee', true);
    else
      insert into public.pointages(equipe_id, jour, arrivee) values (e.id, jour_p, maintenant);
      res := jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
    end if;
  else
    dernier := coalesce(p.sortie, p.arrivee);
    if dernier is not null and abs(extract(epoch from maintenant - dernier)) < 60 then
      res := jsonb_build_object('etat', 'doublon', 'prenom', e.prenom, 'arrivee', p.arrivee, 'sortie', p.sortie);
    elsif p.arrivee is null and p.sortie is null then
      update public.pointages set arrivee = maintenant where id = p.id;
      res := jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
    else
      update public.pointages set sortie = maintenant where id = p.id;
      res := jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'arrivee', p.arrivee, 'sans_arrivee', p.arrivee is null);
    end if;
  end if;
  perform set_config('evy.source', '', true);
  insert into public.pointage_journal(heure_pt, evenement, equipe_id, profil_id, jour, qr_ref, simule, detail)
    values (maintenant, upper(res->>'etat'), e.id, auth.uid(), jour_p, ref, sim,
      case when p_sens = 'sortie' and res->>'etat' = 'sortie' and (res->>'sans_arrivee')::boolean then 'premier scan l''après-midi : « je pars » (arrivée non pointée)'
           when (res->>'sans_arrivee')::boolean then 'sortie sans arrivée'
           when p.id is not null and p.sortie is not null and res->>'etat' = 'sortie' then 'remplace la sortie de ' || to_char(p.sortie at time zone 'Europe/Paris', 'HH24:MI')
           else null end);
  return res;
end $$;

-- Corrections manuelles (outil Pointage) : avant → après
create or replace function public.journal_pointages() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text := 'HH24:MI'; avant text; apres text;
begin
  if coalesce(current_setting('evy.source', true), '') = 'qr' then return null; end if;
  avant := case when tg_op = 'INSERT' then '—' else coalesce(to_char(old.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(old.sortie at time zone 'Europe/Paris', h), '—') end;
  apres := case when tg_op = 'DELETE' then '—' else coalesce(to_char(new.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(new.sortie at time zone 'Europe/Paris', h), '—') end;
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
    values (case when tg_op = 'DELETE' then 'EFFACEMENT' else 'CORRECTION' end,
            coalesce(new.equipe_id, old.equipe_id), auth.uid(), coalesce(new.jour, old.jour),
            'avant ' || avant || ' · après ' || apres ||
            case when tg_op <> 'DELETE' and new.note is not null then ' · note : ' || new.note else '' end);
  return null;
end $$;
drop trigger if exists journal_pointages on public.pointages;
create trigger journal_pointages after insert or update or delete on public.pointages
  for each row execute function public.journal_pointages();

revoke all on function public.pointer(text, text, timestamptz) from public, anon;
grant execute on function public.pointer(text, text, timestamptz) to authenticated;
revoke all on function public.regenerer_qr() from public, anon;
grant execute on function public.regenerer_qr() to authenticated;
revoke all on function public.qr_ref_actuelle() from public, anon, authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"018"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/019_pointage_ignorer.sql
-- =====================================================================
-- 019_pointage_ignorer.sql — « Ne pas compter ce pointage » (correction)
-- Suppose : 001 à 018 déjà appliquées.
-- Ce que fait cette migration :
--   pointages.ignorer : la journée garde les heures prévues au planning dans le reliquat
--   (le pointage reste visible et dans le journal). Le journal note le changement.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.pointages add column if not exists ignorer boolean not null default false;

create or replace function public.journal_pointages() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text := 'HH24:MI'; avant text; apres text;
begin
  if coalesce(current_setting('evy.source', true), '') = 'qr' then return null; end if;
  avant := case when tg_op = 'INSERT' then '—' else coalesce(to_char(old.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(old.sortie at time zone 'Europe/Paris', h), '—') || case when old.ignorer then ' (non compté)' else '' end end;
  apres := case when tg_op = 'DELETE' then '—' else coalesce(to_char(new.arrivee at time zone 'Europe/Paris', h), '—') || ' → ' || coalesce(to_char(new.sortie at time zone 'Europe/Paris', h), '—') || case when new.ignorer then ' (non compté)' else '' end end;
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
    values (case when tg_op = 'DELETE' then 'EFFACEMENT' else 'CORRECTION' end,
            coalesce(new.equipe_id, old.equipe_id), auth.uid(), coalesce(new.jour, old.jour),
            'avant ' || avant || ' · après ' || apres ||
            case when tg_op <> 'DELETE' and new.note is not null then ' · note : ' || new.note else '' end);
  return null;
end $$;

insert into public.parametres(cle, valeur) values ('schema_version', '"019"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/020_types_personnel.sql
-- =====================================================================
-- 020_types_personnel.sql — Types de personnel et postes réglables
-- Suppose : 001 à 019 déjà appliquées.
-- Ce que fait cette migration :
--   equipe.type n'est plus limité à « assistante » / « interimaire » : les types ajoutés dans
--   Réglages › Types de personnel (ex. secrétaire) peuvent être enregistrés dans les fiches.
--   (Les listes elles-mêmes sont dans la table parametres : « postes » et « types_personnel ».)
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.equipe drop constraint if exists equipe_type_check;
alter table public.equipe add constraint equipe_type_check check (type ~ '^[a-z0-9_]{1,40}$');

insert into public.parametres(cle, valeur) values ('schema_version', '"020"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/021_roles_equipe.sql
-- =====================================================================
-- 021_roles_equipe.sql — Rôles d'équipe personnalisés
-- Suppose : 001 à 020 déjà appliquées.
-- Ce que fait cette migration :
--   profils.fonction : le rôle d'équipe choisi dans Réglages › Rôles et droits
--   (ex. « administratif »). Vide = le rôle de base (assistante, référente, responsable).
--   Les droits de chaque rôle (pointage, stock, planning, congés, cabinet) sont dans la
--   table parametres, clé « roles ». Le niveau d'accès à la base reste profils.role.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.profils add column if not exists fonction text;
alter table public.profils drop constraint if exists profils_fonction_check;
alter table public.profils add constraint profils_fonction_check check (fonction is null or fonction ~ '^[a-z0-9_]{1,40}$');

insert into public.parametres(cle, valeur) values ('schema_version', '"021"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/022_pointage_oublis.sql
-- =====================================================================
-- 022_pointage_oublis.sql — Oubli de pointage signalé par l'assistante
-- Suppose : 001 à 021 déjà appliquées.
-- Ce que fait cette migration :
--   1. Table pointage_oublis : l'assistante indique l'heure d'une arrivée ou d'une sortie
--      qu'elle a oublié de pointer (14 jours en arrière au plus), avec un petit mot.
--   2. signaler_oubli(jour, sens, heure, mot) : par l'assistante, pour elle-même seulement.
--      annuler_oubli(id) : tant que ce n'est pas traité.
--   3. repondre_oubli(id, accepte, reponse) : référente / responsable. Accepté = l'heure est
--      écrite dans le pointage du jour (correction signée, notée dans le journal).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.pointage_oublis (
  id          bigserial primary key,
  equipe_id   bigint not null references public.equipe(id) on delete cascade,
  jour        date not null,
  sens        text not null check (sens in ('arrivee', 'sortie')),
  heure       time not null,
  mot         text,
  statut      text not null default 'attente' check (statut in ('attente', 'accepte', 'refuse', 'annule')),
  cree_par    uuid references public.profils(id) on delete set null default auth.uid(),
  cree_le     timestamptz not null default now(),
  repondu_par uuid references public.profils(id) on delete set null,
  repondu_le  timestamptz,
  reponse     text
);
create unique index if not exists pointage_oublis_un_en_attente on public.pointage_oublis(equipe_id, jour, sens) where statut = 'attente';
alter table public.pointage_oublis enable row level security;
drop policy if exists lecture on public.pointage_oublis;
create policy lecture on public.pointage_oublis for select to authenticated
  using (public.est_gestion() or equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid()));

create or replace function public.signaler_oubli(p_jour date, p_sens text, p_heure time, p_mot text) returns bigint
language plpgsql security definer set search_path = public as $$
declare e record; aujourdhui date := (now() at time zone 'Europe/Paris')::date; n bigint;
begin
  select q.id, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;
  if e.id is null then raise exception 'Votre compte n''est relié à aucune fiche'; end if;
  if not e.pointage then raise exception 'Vous n''êtes pas soumise au pointage'; end if;
  if p_sens not in ('arrivee', 'sortie') then raise exception 'Arrivée ou sortie ?'; end if;
  if p_jour > aujourdhui or p_jour < aujourdhui - 14 then raise exception 'Jour trop ancien ou à venir (14 jours au plus)'; end if;
  delete from public.pointage_oublis where equipe_id = e.id and jour = p_jour and sens = p_sens and statut = 'attente';
  insert into public.pointage_oublis(equipe_id, jour, sens, heure, mot) values (e.id, p_jour, p_sens, p_heure, nullif(trim(p_mot), ''))
    returning id into n;
  insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
    values ('OUBLI_SIGNALE', e.id, auth.uid(), p_jour, case when p_sens = 'arrivee' then 'arrivée' else 'sortie' end || ' à ' || to_char(p_heure, 'HH24:MI') || coalesce(' · « ' || nullif(trim(p_mot), '') || ' »', ''));
  return n;
end $$;

create or replace function public.annuler_oubli(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pointage_oublis o set statut = 'annule', repondu_le = now()
   where o.id = p_id and o.statut = 'attente' and o.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
end $$;

create or replace function public.repondre_oubli(p_id bigint, p_accepte boolean, p_reponse text) returns void
language plpgsql security definer set search_path = public as $$
declare o record; t timestamptz; qui text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  select * into o from public.pointage_oublis where id = p_id for update;
  if o.id is null or o.statut <> 'attente' then raise exception 'Ce signalement a déjà été traité'; end if;
  update public.pointage_oublis set statut = case when p_accepte then 'accepte' else 'refuse' end, repondu_par = auth.uid(), repondu_le = now(), reponse = nullif(trim(p_reponse), '') where id = p_id;
  if p_accepte then
    t := (o.jour + o.heure) at time zone 'Europe/Paris';
    select prenom into qui from public.equipe where id = o.equipe_id;
    insert into public.pointages(equipe_id, jour, arrivee, sortie, note, corrige_par, corrige_le)
      values (o.equipe_id, o.jour, case when o.sens = 'arrivee' then t end, case when o.sens = 'sortie' then t end, 'oubli signalé par ' || coalesce(qui, '?'), auth.uid(), now())
      on conflict (equipe_id, jour) do update set
        arrivee = case when o.sens = 'arrivee' then t else public.pointages.arrivee end,
        sortie  = case when o.sens = 'sortie'  then t else public.pointages.sortie end,
        note = 'oubli signalé par ' || coalesce(qui, '?'), corrige_par = auth.uid(), corrige_le = now();
  else
    insert into public.pointage_journal(evenement, equipe_id, profil_id, jour, detail)
      values ('OUBLI_REFUSE', o.equipe_id, auth.uid(), o.jour, case when o.sens = 'arrivee' then 'arrivée' else 'sortie' end || ' à ' || to_char(o.heure, 'HH24:MI') || coalesce(' · motif : ' || nullif(trim(p_reponse), ''), ''));
  end if;
end $$;

grant select on public.pointage_oublis to authenticated;
grant execute on function public.signaler_oubli(date, text, time, text) to authenticated;
grant execute on function public.annuler_oubli(bigint) to authenticated;
grant execute on function public.repondre_oubli(bigint, boolean, text) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"022"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/023_semaines_cloturees.sql
-- =====================================================================
-- 023_semaines_cloturees.sql — Clôture de semaine (heures figées)
-- Suppose : 001 à 022 déjà appliquées.
-- Ce que fait cette migration :
--   1. Table semaines_cloturees : une ligne par semaine clôturée (lundi), qui l'a clôturée et quand,
--      et les heures figées de chaque personne (heures retenues et reliquat en fin de semaine).
--   2. cloturer_semaine(lundi, figes) et rouvrir_semaine(lundi) : référente et responsable,
--      notées dans le journal du pointage.
--   3. Une semaine clôturée ne se modifie plus : le planning et les pointages de ces jours-là
--      sont protégés (message « Semaine clôturée : rouvrez-la pour la modifier »).
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.semaines_cloturees (
  lundi       date primary key check (extract(isodow from lundi) = 1),
  cloture_par uuid references public.profils(id) on delete set null,
  cloture_le  timestamptz not null default now(),
  figes       jsonb not null default '{}'::jsonb
);
alter table public.semaines_cloturees enable row level security;
drop policy if exists lecture on public.semaines_cloturees;
create policy lecture on public.semaines_cloturees for select to authenticated using (public.est_actif());
grant select on public.semaines_cloturees to authenticated;

create or replace function public.semaine_cloturee(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select d is not null and exists (select 1 from public.semaines_cloturees s where s.lundi = d - (extract(isodow from d)::int - 1));
$$;

create or replace function public.proteger_semaine_cloturee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.semaine_cloturee(case when tg_op = 'DELETE' then old.jour else new.jour end)
     or (tg_op = 'UPDATE' and public.semaine_cloturee(old.jour)) then
    raise exception 'Semaine clôturée : rouvrez-la pour la modifier';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists semaine_cloturee_planning on public.planning;
create trigger semaine_cloturee_planning before insert or update or delete on public.planning
  for each row execute function public.proteger_semaine_cloturee();
drop trigger if exists semaine_cloturee_pointages on public.pointages;
create trigger semaine_cloturee_pointages before insert or update or delete on public.pointages
  for each row execute function public.proteger_semaine_cloturee();

create or replace function public.cloturer_semaine(p_lundi date, p_figes jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  if extract(isodow from p_lundi) <> 1 then raise exception 'La semaine doit commencer un lundi'; end if;
  insert into public.semaines_cloturees(lundi, cloture_par, cloture_le, figes) values (p_lundi, auth.uid(), now(), coalesce(p_figes, '{}'::jsonb))
    on conflict (lundi) do update set cloture_par = auth.uid(), cloture_le = now(), figes = excluded.figes;
  insert into public.pointage_journal(evenement, profil_id, jour, detail) values ('SEMAINE_CLOTUREE', auth.uid(), p_lundi, 'semaine du ' || to_char(p_lundi, 'DD/MM/YYYY'));
end $$;

create or replace function public.rouvrir_semaine(p_lundi date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  delete from public.semaines_cloturees where lundi = p_lundi;
  insert into public.pointage_journal(evenement, profil_id, jour, detail) values ('SEMAINE_ROUVERTE', auth.uid(), p_lundi, 'semaine du ' || to_char(p_lundi, 'DD/MM/YYYY'));
end $$;

grant execute on function public.cloturer_semaine(date, jsonb) to authenticated;
grant execute on function public.rouvrir_semaine(date) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"023"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/024_conges_annulation.sql
-- =====================================================================
-- 024 · Annulation de congés déjà acceptés, avec validation
--  1. demander_annulation_conges(id, mot) : l'assistante demande d'annuler des congés
--     acceptés qui n'ont pas encore commencé. Les congés restent acceptés tant que
--     la référente ou la responsable n'a pas répondu.
--  2. retirer_annulation_conges(id) : elle retire sa demande d'annulation.
--  3. repondre_annulation_conges(id, accepte, reponse) : la référente ou la responsable
--     accepte (les congés passent à « annulé ») ou refuse (les congés restent acceptés).
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.conges add column if not exists annul_demande timestamptz;
alter table public.conges add column if not exists annul_mot text;
alter table public.conges add column if not exists annul_reponse text;

create or replace function public.demander_annulation_conges(p_id bigint, p_mot text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.est_actif() then raise exception 'Compte non actif'; end if;
  update public.conges c set annul_demande = now(), annul_mot = nullif(trim(coalesce(p_mot, '')), ''), annul_reponse = null
   where c.id = p_id and c.statut = 'accepte' and c.annul_demande is null and c.du > current_date
     and c.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
  if not found then raise exception 'Ces congés ne peuvent pas être annulés (déjà commencés, ou demande déjà envoyée)'; end if;
end $$;

create or replace function public.retirer_annulation_conges(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conges c set annul_demande = null, annul_mot = null
   where c.id = p_id and c.statut = 'accepte' and c.annul_demande is not null
     and c.equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid());
  if not found then raise exception 'Demande d''annulation introuvable ou déjà traitée'; end if;
end $$;

create or replace function public.repondre_annulation_conges(p_id bigint, p_accepte boolean, p_reponse text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente et à la responsable'; end if;
  if p_accepte then
    update public.conges set statut = 'annule', annul_reponse = nullif(trim(coalesce(p_reponse, '')), ''), traite_par = auth.uid(), traite_le = now()
     where id = p_id and statut = 'accepte' and annul_demande is not null;
  else
    update public.conges set annul_demande = null, annul_reponse = coalesce(nullif(trim(coalesce(p_reponse, '')), ''), 'refusée'), traite_par = auth.uid(), traite_le = now()
     where id = p_id and statut = 'accepte' and annul_demande is not null;
  end if;
  if not found then raise exception 'Cette demande d''annulation a déjà reçu une réponse'; end if;
end $$;

revoke all on function public.demander_annulation_conges(bigint, text) from public;
revoke all on function public.retirer_annulation_conges(bigint) from public;
revoke all on function public.repondre_annulation_conges(bigint, boolean, text) from public;
grant execute on function public.demander_annulation_conges(bigint, text) to authenticated;
grant execute on function public.retirer_annulation_conges(bigint) to authenticated;
grant execute on function public.repondre_annulation_conges(bigint, boolean, text) to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"024"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/025_semaines_types_datees.sql
-- =====================================================================
-- 025 · Semaine type avec date d'effet (versions)
--  1. Table equipe_trames : une version de semaine type par personne et par date de départ (un lundi).
--     La version en vigueur une semaine donnée est la dernière dont la date de départ est
--     avant ou égale à ce lundi. Les semaines d'avant gardent l'ancienne version.
--     equipe.trame reste la copie de la dernière version (compatibilité).
--     Avant la première version, c'est la première version qui s'applique.
--  2. Protection : on ne peut ni créer, ni modifier, ni supprimer une version si cela changerait
--     une semaine déjà clôturée (sauf la toute première version, copie de la semaine type actuelle).
-- Lecture : comptes actifs. Écriture : référente et responsable.
-- Rejouable : oui. Non destructive.
-- =====================================================================

create table if not exists public.equipe_trames (
  id bigint generated always as identity primary key,
  equipe_id bigint not null references public.equipe(id) on delete cascade,
  depuis date not null,
  trame jsonb not null default '{}'::jsonb,
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now(),
  unique (equipe_id, depuis)
);

alter table public.equipe_trames enable row level security;
drop policy if exists lecture on public.equipe_trames;
create policy lecture on public.equipe_trames for select to authenticated using (public.est_actif());
drop policy if exists ecriture on public.equipe_trames;
create policy ecriture on public.equipe_trames for all to authenticated using (public.est_gestion()) with check (public.est_gestion());
grant select, insert, update, delete on public.equipe_trames to authenticated;

-- Une version couvre les semaines de « depuis » jusqu'à la version suivante (exclue).
create or replace function public.proteger_trame_cloturee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_eq bigint; v_de date; v_suiv date;
begin
  if tg_op = 'DELETE' then v_eq := old.equipe_id; v_de := old.depuis;
  else v_eq := new.equipe_id; v_de := new.depuis; end if;
  if tg_op = 'UPDATE' and old.depuis < v_de then v_de := old.depuis; end if;
  -- Première version d'une personne, identique à sa semaine type actuelle : rien ne change, toujours permis
  if tg_op = 'INSERT' and not exists (select 1 from public.equipe_trames t where t.equipe_id = v_eq)
     and new.trame = coalesce((select e.trame from public.equipe e where e.id = v_eq), '{}'::jsonb) then return new; end if;
  select min(t.depuis) into v_suiv from public.equipe_trames t
   where t.equipe_id = v_eq and t.depuis > v_de and (tg_op = 'INSERT' or t.id <> coalesce(old.id, -1));
  if exists (select 1 from public.semaines_cloturees s where s.lundi >= v_de and (v_suiv is null or s.lundi < v_suiv)) then
    raise exception 'Une semaine clôturée serait modifiée : choisissez une date après la dernière semaine clôturée';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists proteger_trame_cloturee on public.equipe_trames;
create trigger proteger_trame_cloturee before insert or update or delete on public.equipe_trames
  for each row execute function public.proteger_trame_cloturee();

insert into public.parametres(cle, valeur) values ('schema_version', '"025"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();


-- >>>>> supabase/migrations/026_dentistes_dates.sql
-- =====================================================================
-- 026 · Dentistes : dates de présence au centre
--  present_du : le dentiste ne compte pas avant cette date (arrivée, retour).
--  present_au : le dentiste ne compte plus après cette date (départ prévu).
--  Vides = sans limite. Le planning, « Dentistes seuls » et les congés en tiennent compte.
-- Rejouable : oui. Non destructive.
-- =====================================================================
alter table public.dentistes add column if not exists present_du date;
alter table public.dentistes add column if not exists present_au date;

insert into public.parametres(cle, valeur) values ('schema_version', '"026"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();

