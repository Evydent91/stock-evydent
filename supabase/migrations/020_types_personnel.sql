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
