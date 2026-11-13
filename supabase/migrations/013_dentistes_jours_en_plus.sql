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
