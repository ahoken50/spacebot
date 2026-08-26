---
name: oasis-foundation
description: Règles communes OASIS-V2 de traçabilité, classement documentaire, mémoire partagée, approbation humaine et sobriété de jetons. Utiliser pour tout travail de l’instance.
tags: [oasis, traçabilité, classement, mémoire, coûts]
---

# Fondations OASIS-V2

1. Chercher d’abord le registre partagé avec `oasis_shared_memory_search_shared_memory` et une requête courte et précise; ne pas relire ou résumer une pièce déjà indexée sans raison.
2. Avant toute tâche spécialisée, utiliser `skills_list`, vérifier les outils MCP effectivement présents et les répertoires autorisés `00_systeme/` et `workspace/skills/`. Ne jamais demander à lire `/data/skills` ou un autre chemin racine hors du workspace des agents. Réutiliser d’abord une capacité locale. Si elle manque, charger `oasis-capability-discovery` avant de rechercher, installer ou créer une compétence ou un outil.
3. Déposer les fichiers selon `00_systeme/taxonomie_documentaire.json`. Utiliser `oasis_document_studio_classify_workspace_document` pour déplacer une pièce depuis `01_sources/00_inbox` vers sa catégorie validée. Transmettre au studio un chemin relatif à l’espace partagé, jamais un chemin `/data/shared-workspace/...`. Ne pas écraser une source ni un livrable approuvé.
4. Enregistrer les résultats vérifiables avec `oasis_shared_memory_save_shared_record`, avec leur source, leur statut et leur chemin relatif classé. Utiliser `pending_approval` pour une décision contractuelle, financière, réglementaire ou de transmission.
5. Déléguer seulement une tâche ayant un résultat distinct. Inclure l’objectif, les sources, le format de sortie, les critères de vérification et un plafond de concision.
6. Renvoyer une synthèse structurée, les chemins de fichiers, les sources et les écarts. Éviter de reproduire le contenu intégral de pièces volumineuses dans les messages interagents.
7. Ne jamais présenter un brouillon, une mesure de conception ou une estimation comme une donnée finale sans indiquer son niveau de validation.
