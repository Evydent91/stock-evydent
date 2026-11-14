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
