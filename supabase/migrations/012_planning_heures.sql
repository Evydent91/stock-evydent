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
