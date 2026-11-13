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
