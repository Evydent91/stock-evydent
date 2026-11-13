-- =====================================================================
-- 016_pointage.sql — Pointage journalier par QR code
-- Suppose : 001 à 015 déjà appliquées.
-- Ce que fait cette migration :
--  1. equipe.pointage : la personne est soumise (ou non) au pointage journalier (fiche › case à cocher).
--  2. Table pointages : une ligne par personne et par jour (arrivée, sortie, note, correction).
--  3. Table pointage_cle : le jeton secret contenu dans le QR code du centre (lisible et
--     régénérable seulement par la référente / responsable).
--  4. pointer(jeton) : appelée quand une assistante scanne le QR code avec son compte.
--       1er scan du jour = arrivée ; scan suivant = sortie (un nouveau scan plus tard remplace la sortie) ;
--       un scan dans la minute qui suit le précédent est ignoré (double scan).
--     regenerer_qr() : crée un nouveau jeton (l'ancien QR code ne fonctionne plus).
--  Heure et jour : heure de Paris.
-- Rejouable : oui. Non destructive.
-- =====================================================================

alter table public.equipe add column if not exists pointage boolean not null default false;

create table if not exists public.pointages (
  id          bigserial primary key,
  equipe_id   bigint not null references public.equipe(id) on delete cascade,
  jour        date not null,
  arrivee     timestamptz,
  sortie      timestamptz,
  note        text,
  corrige_par uuid references public.profils(id) on delete set null,
  corrige_le  timestamptz,
  cree_le     timestamptz not null default now(),
  unique (equipe_id, jour)
);
alter table public.pointages enable row level security;

drop policy if exists lecture on public.pointages;
create policy lecture on public.pointages for select to authenticated
  using (public.est_gestion() or equipe_id in (select e.id from public.equipe e where e.profil_id = auth.uid()));
drop policy if exists ecriture on public.pointages;
create policy ecriture on public.pointages for all to authenticated
  using (public.est_gestion()) with check (public.est_gestion());

create table if not exists public.pointage_cle (
  id        int primary key default 1 check (id = 1),
  jeton     text not null,
  cree_le   timestamptz not null default now()
);
alter table public.pointage_cle enable row level security;
drop policy if exists lecture on public.pointage_cle;
create policy lecture on public.pointage_cle for select to authenticated using (public.est_gestion());

insert into public.pointage_cle(id, jeton) values (1, replace(gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;

create or replace function public.regenerer_qr() returns text
language plpgsql security definer set search_path = public as $$
declare j text;
begin
  if not public.est_gestion() then raise exception 'Réservé à la référente ou à la responsable'; end if;
  j := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.pointage_cle(id, jeton, cree_le) values (1, j, now())
    on conflict (id) do update set jeton = excluded.jeton, cree_le = now();
  return j;
end $$;

create or replace function public.pointer(p_jeton text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record; p record; maintenant timestamptz := now();
  jour_p date := (now() at time zone 'Europe/Paris')::date;
begin
  if auth.uid() is null then return jsonb_build_object('etat', 'non_connecte'); end if;
  if not exists (select 1 from public.pointage_cle k where k.id = 1 and k.jeton = p_jeton) then
    return jsonb_build_object('etat', 'qr_perime');
  end if;
  select q.id, q.prenom, q.pointage into e from public.equipe q where q.profil_id = auth.uid() and q.actif limit 1;
  if e.id is null then return jsonb_build_object('etat', 'sans_fiche'); end if;
  if not e.pointage then return jsonb_build_object('etat', 'non_soumis', 'prenom', e.prenom); end if;

  select * into p from public.pointages where equipe_id = e.id and jour = jour_p for update;
  if p.id is null then
    insert into public.pointages(equipe_id, jour, arrivee) values (e.id, jour_p, maintenant);
    return jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
  end if;
  if maintenant - coalesce(p.sortie, p.arrivee, maintenant - interval '1 hour') < interval '1 minute' then
    return jsonb_build_object('etat', 'doublon', 'prenom', e.prenom, 'arrivee', p.arrivee, 'sortie', p.sortie);
  end if;
  if p.arrivee is null then
    update public.pointages set arrivee = maintenant where id = p.id;
    return jsonb_build_object('etat', 'arrivee', 'prenom', e.prenom, 'heure', maintenant);
  end if;
  update public.pointages set sortie = maintenant where id = p.id;
  return jsonb_build_object('etat', 'sortie', 'prenom', e.prenom, 'heure', maintenant, 'arrivee', p.arrivee);
end $$;

revoke all on function public.pointer(text) from public, anon;
grant execute on function public.pointer(text) to authenticated;
revoke all on function public.regenerer_qr() from public, anon;
grant execute on function public.regenerer_qr() to authenticated;

insert into public.parametres(cle, valeur) values ('schema_version', '"016"')
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
