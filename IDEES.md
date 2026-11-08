# Idées pour les prochaines mises à jour

Liste tenue à jour par Claude au fil des échanges avec Gwen (référente).
Rien ici n'est fait tant que ce n'est pas passé dans le journal des versions (onglet Plus).
Une idée est développée sur le site de test, validée par Gwen, puis mise en ligne.

Légende : 🟢 prête à faire · 🟡 à préciser avec Gwen · ⚪ à l’étude · 🧪 en test sur le site de test

## Stock et mouvements
- ⚪ **Transfert d'un cabinet à un autre** : écarté pour l'instant (seul le retour vers la réserve existe), à reprendre si les remplacements le demandent.
- ⚪ **Retour fournisseur** : sortir de la réserve un article défectueux ou une erreur de livraison, avec un motif ; écarté pour l'instant.
- 🟡 **Inventaire par Excel des cabinets** : aujourd'hui, le fichier de comptage n'existe que pour la réserve.

## Commandes et factures
- 🟢 **Import de factures d'autres fournisseurs** : GACD et Megadental sont reconnus ; envoyer à Claude une facture PDF d'Ali Express, 3M, Septodont, Promodentaire, Embout.fr… pour l'ajouter.
- ⚪ **Envoi de la commande au fournisseur** (email préparé ou lien vers son site) depuis l'écran Commandes.

## Comptes et sécurité
- 🟡 **Refuser les codes trop simples** (123456, 000000, suites, chiffres identiques) pour les assistantes.
- ⚪ **Message d'erreur plus précis** quand le service des comptes ne répond pas (afficher la cause technique).

## Sauvegarde
- 🟡 **Importer une sauvegarde** : recharger dans l'appli un fichier Excel de sauvegarde (onglet Plus), pour restaurer les données après un problème. À préciser : tout remplacer ou seulement une partie (fiches, stock, fournisseurs), et qui a le droit de le faire.

## Ergonomie
- 🧪 **Meilleure ergonomie sur téléphone (type iPhone)** — en test sur le site de test (version 2.1) : écrans plus adaptés au petit écran et au pouce (onglets, boutons, listes, barre du bas), affichage sur l'écran d'accueil comme une application. À préciser avec Gwen à partir de captures des écrans gênants.

## Suivi et pilotage
- ⚪ **Statistiques de consommation** par article et par cabinet (mois par mois), pour ajuster les seuils.
- ⚪ **Rappel automatique de sauvegarde** par email ou notification, en plus du bandeau sur l'accueil.

## Notes techniques (pour Claude)
- Fonction Supabase `equipe` : la créer directement sous le nom `equipe` (renommer une fonction ne change pas son adresse), et désactiver « Verify JWT ».
- Toute évolution de la base = nouvelle migration numérotée (007, 008…), appliquée sur Dev puis sur Prod avant la fusion dev → main.
