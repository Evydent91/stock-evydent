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

**Dernière migration appliquée : dev 002, prod — aucune**
