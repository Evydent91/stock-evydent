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

**Dernière migration appliquée : dev 006, prod — aucune**

## Fonctions Supabase (Edge Functions)

| Fonction | Rôle | Dev | Prod |
|---|---|---|---|
| `equipe` (`supabase/functions/equipe/index.ts`) | création des comptes, codes, identifiants, désactivation | déployée (Verify JWT désactivé) | à déployer avant la mise en ligne |

Déploiement : Supabase → Edge Functions → Deploy a new function → Via Editor, nom `equipe`, coller le fichier, puis désactiver « Verify JWT » (la fonction vérifie elle-même le rôle de l'appelant).
