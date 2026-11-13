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
