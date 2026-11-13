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
