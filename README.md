# stock-evydent

Gestion du stock — Espace dentaire Val d'Yerres

## Environnements

| | Branche | Site | Base Supabase |
|---|---|---|---|
| Test | `dev` | https://evydent91.github.io/stock-evydent/ | Evydent-Dev |
| Production | `main` | Netlify (à brancher) | Evydent-Prod |

Règles : tout arrive d'abord sur `dev`. `main` ne reçoit `dev` qu'après le mot « validé ».
Aucun secret dans ce dépôt : seules les clés publiques Supabase y figurent.

## Base de données

Le schéma est maintenu uniquement par les fichiers numérotés de `supabase/migrations/`,
appliqués dans l'éditeur SQL de Supabase : d'abord sur Evydent-Dev, puis sur Evydent-Prod après validation.

**Version 2.4.7 mise en ligne le 17/11/2026. Migrations à lancer pour cette version :**
- sur Evydent-Prod : `supabase/prod/passage-prod-028-030.sql` (028 Wi-Fi du centre + 030 cabinets des dentistes ; la 029, module de test du pointage, ne concerne que le site de test) ;
- sur Evydent-Dev : `supabase/migrations/030_cabinets_dentistes.sql` (028 et 029 y ont été lancées pendant les essais).

**À lancer ensuite : `031_ref_fabricant.sql`** (case « Référence fabricant » de la fiche article) — sur Evydent-Dev pour tester, puis sur Evydent-Prod à la validation de la 2.4.9. Sans elle, la case n'apparaît pas.

**Et `032_cout_moyen_depuis_prix.sql`** (un article avec un prix fournisseur n'est plus valorisé 0 € dans la réserve) — Evydent-Dev, puis Evydent-Prod avec la 2.4.9.

**Et `033_instruments.sql`** (instruments rotatifs : fiches par numéro de série, envois en réparation, garanties) — Evydent-Dev, puis Evydent-Prod avec la 2.4.10.

**`034_codes_barres.sql`** (codes-barres et sortie par scan) — passée sur Evydent-Dev et Evydent-Prod le 21 novembre 2026. En prod : codes-barres allumés pour la référente et la responsable seulement (scan_actif = true, scan_qui = gestion, scan_sortie_equipe = false) ; aucun profil n’a la case « Scan », donc l’équipe ne voit aucun scan.

Tant que ce n'est pas fait, le site marche : la page Wi-Fi du centre affiche un message d'attente et « Occupation des cabinets » déduit le cabinet de celui de l'assistante.

Dernière migration notée comme appliquée sur la prod : 027 (027_referent_profil.sql, version 2.4.1, 15/11/2026) — avant : passage-prod-007-026.sql (14/11/2026).

## Fonctions Supabase (Edge Functions)

| Fonction | Rôle | Dev | Prod |
|---|---|---|---|
| `equipe` (`supabase/functions/equipe/index.ts`) | création des comptes, codes, identifiants, désactivation | déployée (Verify JWT désactivé) | déployée (Verify JWT désactivé) |

Déploiement : Supabase → Edge Functions → Deploy a new function → Via Editor, nom `equipe` saisi AVANT le déploiement (renommer ensuite ne change pas l’adresse), coller le fichier, puis désactiver « Verify JWT » (la fonction vérifie elle-même le rôle de l'appelant).

## Mise en production

`supabase/prod/installation-001-006.sql` assemble les migrations 001 à 006 pour installer une base neuve en une fois
(à régénérer si une migration 007+ est ajoutée avant la bascule). Les données réelles (fiches, fournisseurs, comptes)
ne sont jamais mises dans ce dépôt.

Idées et évolutions envisagées : voir [IDEES.md](IDEES.md).
