-- =====================================================================
-- 032_cout_moyen_depuis_prix.sql — Un article avec un prix fournisseur n'est plus « sans prix »
-- Suppose : 001 à 031 déjà appliquées.
-- Problème : le coût moyen ne se remplit qu'aux réceptions de commande. Un article saisi à la main
-- (stock de départ, inventaire) avec un prix fournisseur gardait un coût moyen à 0 : valeur 0 € dans
-- la réserve, l'inventaire de fin d'année et les analyses, et la première réception calculait une
-- moyenne faussée (le stock déjà là comptait pour 0 €).
-- Ce que fait cette migration :
--  1. articles dont le coût moyen est vide ou à 0 et qui ont un prix : coût moyen = prix (une fois) ;
--  2. déclencheur : même règle à chaque création ou modification d'article.
-- Les articles offerts (prix 0) ne changent pas. Rejouable : oui. Non destructive.
-- =====================================================================

update public.articles set cout_moyen = prix
  where coalesce(cout_moyen, 0) = 0 and coalesce(prix, 0) > 0;

create or replace function public.cout_moyen_depuis_prix() returns trigger
language plpgsql as $$
begin
  if coalesce(new.cout_moyen, 0) = 0 and coalesce(new.prix, 0) > 0 then new.cout_moyen := new.prix; end if;
  return new;
end $$;

drop trigger if exists articles_cout_moyen_depuis_prix on public.articles;
create trigger articles_cout_moyen_depuis_prix before insert or update of prix, cout_moyen on public.articles
  for each row execute function public.cout_moyen_depuis_prix();

insert into public.parametres(cle, valeur) values ('schema_version', '"032"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
