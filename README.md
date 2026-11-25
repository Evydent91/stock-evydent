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

**`035_formations.sql`** (formations et diplômes des dentistes, rappels par mail) — passée sur Evydent-Dev le 24 novembre 2026, pas encore sur la prod. Crée les tables formations, formation_envois, formation_rappels (gestion seulement), le dossier privé « justificatifs » (Storage), les extensions pg_net et pg_cron, et un envoi chaque matin à 6 h UTC (`rappels-formations`). Les mails partent par l’API Brevo : la clé se colle dans l’appli (Réglages › Formations › Rappels par mail) et reste dans le coffre (Vault) de Supabase, jamais dans le code. Rappels éteints par défaut.

**`036_compta.sql`** (comptabilité du cabinet, site séparé `/compta`) — passée sur Evydent-Dev le 25 novembre 2026, **pas sur la prod** (à faire seulement avec l'accord de la directrice). Crée les tables `compta_*` (lisibles seulement quand la comptabilité est ouverte avec son code à 6 chiffres, modifiables seulement par la directrice), le dossier privé « compta » (Storage) et les fonctions du code d'accès et du lien avec le stock. Après la migration, donner l'accès au compte de la directrice (requête en tête du fichier 036, avec l'identifiant réel, jamais écrit dans ce dépôt).

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

## Comptabilité (`compta/`)

Site à part, même look et même base qu'Evydent : `compta/index.html` + `compta/compta.js`, styles `.kt-…` à la fin de `css/app.css`.
`compta.js` est découpé pour rejoindre Evydent sans rien réécrire :
1. **SOCLE** : copies exactes des outils de `js/app.js` (fenetre, toast, hdA, bandeDate, tl…) → à supprimer à l'intégration ;
2. **MODULE** (préfixe `kt` : `S.kt`, `vKt…()`, `ktAction(d)`, `data-kt…`, `.kt-…`) → à recopier tel quel dans une section de `js/app.js` ;
   puis ajouter les écrans `kt…` à `HUB` et à la table des écrans, une entrée « Comptabilité » au menu de gauche et à Plus sur téléphone,
   et brancher `ktAction`, `ktChange`, `ktSaisie`, `ktClavier`, `ktDepot`, `setInterval(ktVeille, 30000)` dans les gestionnaires d'Evydent ;
3. **DÉMARRAGE** (connexion, menu, barre du bas, rendu du site séparé) → à supprimer à l'intégration.

Bibliothèques chargées à la demande (versions figées) : pdf.js 4.10.38 (lit les scans JBIG2), Tesseract.js 5.1.1 (lecture des pages dans le navigateur, pour découper les PDF), JSZip (`js/vendor`).

Idées et évolutions envisagées : voir [IDEES.md](IDEES.md).
