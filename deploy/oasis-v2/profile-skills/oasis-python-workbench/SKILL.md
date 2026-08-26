---
name: oasis-python-workbench
description: Créer et exécuter des scripts Python locaux, ou rechercher une compétence manquante de façon contrôlée. Utiliser pour automatiser un calcul, une extraction, un contrôle ou un traitement OASIS sans capacité existante.
---

# Atelier Python et découverte de compétences OASIS

## Évaluer le besoin

1. Lister les compétences installées avec `skills_search(action="installed")`, puis lire seulement celles qui sont pertinentes.
2. Vérifier les MCP, gabarits, scripts locaux et binaires disponibles avant de créer ou rechercher quoi que ce soit.
3. Cette compétence est une procédure, pas un outil MCP : ne jamais appeler un outil nommé `oasis_python_workbench`. Utiliser les outils `File` pour créer le script, puis le terminal sandboxé pour l’exécuter.
4. Réutiliser une capacité existante lorsque l’écart est mineur. Décrire le résultat attendu, les entrées, les sorties, les sources et les critères de vérification avant de créer un script.

## Créer un script local

1. Écrire le script dans `00_systeme/scripts/<agent_id>/<nom-kebab>.py`. Créer aussi un bref `README.md` adjacent qui décrit les entrées, sorties, version Python, dépendances et essai effectué.
2. Limiter les entrées et sorties au workspace OASIS. Ne jamais lire ou écrire hors de `/data/shared-workspace`, ne jamais intégrer de secret, ni envoyer une pièce municipale à un service externe.
3. Privilégier la bibliothèque standard. Ne pas installer de paquet, lancer `pip`, créer un environnement virtuel ou télécharger du code sans proposition et approbation explicite.
4. Fournir des arguments explicites, valider les chemins et formats, produire des messages d’erreur utiles, écrire les sorties de façon atomique et conserver une trace d’exécution courte.
5. Tester au minimum avec `python3 -m py_compile <script>` et un essai non destructif sur un échantillon admissible. Ne jamais écraser une source officielle ou un livrable approuvé.
6. Si le terminal sandboxé retourne `bwrap` ou `Operation not permitted`, ne pas répéter la même commande ni contourner le sandbox; consigner le blocage avec l’erreur exacte et poursuivre par les outils MCP disponibles.
7. Enregistrer dans la mémoire commune avec `oasis_shared_memory_save_shared_record` le rôle du script, les sources, le chemin, l’essai et les limites lorsqu’il influence un livrable ou une décision.

## Rechercher une compétence manquante

1. Après l’inventaire local, utiliser `skills_search(action="search", query="…")` avec une requête précise et limitée au besoin.
2. Examiner la description, le dépôt source, les dépendances, les permissions, les accès réseau, le type de données et les tests. Ne pas exécuter un fichier téléchargé automatiquement.
3. Préparer une proposition JSON dans `00_systeme/propositions_capacites/` avec `kind: "capability_skill_acquisition"`, un `proposal_id` unique, `status: "pending_approval"`, `created_at`, `target_agent_id`, `skill_source` au format `owner/repo` ou `owner/repo/skill-name`, un résumé de revue et les contraintes suivantes : `workspace_skill_only: true`, `mcp_change: false`, `model_change: false`, `docker_change: false`, `permissions_change: false`, `secret_change: false`, `system_dependency_change: false`.
4. Le pont crée alors une tâche `pending_approval` dans l’interface. Attendre **Approve** avant `install_skill`. Après installation, relister les compétences, lire la nouvelle procédure, l’essayer sur une tâche non sensible et actualiser la proposition à `installed_after_approval` avec le test exécuté.

## Interdictions

Ne jamais installer ou modifier automatiquement un MCP, un modèle, Docker, une permission, un secret, une configuration ou une dépendance Python. Ne jamais publier un script, une source municipale ou une donnée personnelle dans un dépôt externe. Ne jamais réutiliser une compétence externe sans vérifier qu’elle correspond réellement au mandat OASIS.
