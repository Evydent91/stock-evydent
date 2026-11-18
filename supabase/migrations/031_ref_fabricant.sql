-- 031 : référence fabricant d'un article (différente de la référence chez le fournisseur)
-- À lancer dans l'éditeur SQL de Supabase : d'abord sur Evydent-Dev, puis sur Evydent-Prod à la validation.
-- Rejouable sans risque.

alter table public.articles add column if not exists ref_fabricant text;

insert into public.parametres(cle, valeur) values ('schema_version', '"031"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
