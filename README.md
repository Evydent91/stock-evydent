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

**Migration à appliquer : 028_pointage_wifi.sql (Wi-Fi du centre pour le pointage) — dev 028 à passer, prod avec la version qui l’embarque.** Dernière migration appliquée : dev 027, prod 027 (027_referent_profil.sql, à lancer sur la prod avec la version 2.4.1, 15/11/2026)** — avant : passage-prod-007-026.sql (14/11/2026)

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
