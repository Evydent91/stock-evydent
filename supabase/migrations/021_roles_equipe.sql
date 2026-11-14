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
