# Spacebot Project Hub — Déploiement local Docker

**Project Hub** est une instance Spacebot générique pour piloter des projets municipaux, universitaires, scientifiques, communautaires ou interorganisationnels. Elle transforme une demande en plan, tâches spécialisées, analyses, livrables, preuves classées et décision humaine finale. Aucun contenu, gabarit ou règle métier d’un projet particulier n’est inclus.

> L’autonomie porte sur la planification, l’exécution locale, la détection de lacunes et la préparation de propositions. Elle s’arrête avant toute décision, transmission, modification durable ou installation de capacité sensible.

| Service | Rôle | Persistance |
| --- | --- | --- |
| `spacebot-project-hub` | Interface Web, six profils, tâches, conversations, terminal sandboxé et Python local. | `instance/` |
| `project-memory-db` + `project-shared-memory` | Registre commun PostgreSQL + pgvector, recherche sémantique et audit. | `volumes/postgres/` |
| `project-gis` | KML/GeoJSON, inventaire et calculs d’emprises locaux lorsque pertinents. | Espace partagé |
| `project-document-studio` | DOCX/PDF locaux, aperçu et contrôle qualité. | Espace partagé |
| `project-optimizer` + `project-skillopt` | Évaluation de candidats d’instructions et de compétences sur cas dépersonnalisés. | `00_systeme/optimisation/` |
| `project-reference-miner` | Découverte, dépersonnalisation et partitionnement de cas de référence admissibles. | `00_systeme/optimisation/reference-miner/` |
| `project-failure-remediator` | Diagnostic anti-répétition de la dernière tentative durable en échec. | `00_systeme/optimisation/failure-remediator/` |
| `project-approval-bridge` | Création de tâches Web d’approbation et promotion uniquement après décision humaine. | `approved-skill-overlays/` et journaux d’audit |

## Profils

| Profil | Mandat |
| --- | --- |
| **Coordonnateur de projet** | Qualification, planification, délégation, consolidation et arbitrage. |
| **Analyste financier et administratif** | Budget, dépenses, contrats, approvisionnement, financement et écarts. |
| **Planificateur de projet** | Plan de travail, Gantt, jalons, dépendances, risques et capacité. |
| **Analyste de données et géomatique** | Données, méthodes, indicateurs, calculs reproductibles et SIG facultatif. |
| **Rédacteur et analyste de livrables** | Rapports, notes décisionnelles, synthèses, annexes et contrôle de preuves. |
| **Secrétaire et analyste de gouvernance** | Comités, ordres du jour, procès-verbaux, décisions, actions et relances. |

Chaque profil possède son **workspace privé** sous `instance/agents/<agent-id>/workspace/`. Il reçoit uniquement un accès sandboxé supplémentaire à `/data/shared-workspace` pour les sources et livrables communs. Cette séparation isole les compétences, essais et installations approuvées tout en préservant le travail collaboratif.

## Routage et sobriété

Le routage utilise OpenRouter uniquement; aucun modèle Claude n’est configuré. Les modèles sont séparés par responsabilité : conversation économique, raisonnement complexe, travail structuré, compaction et lecture visuelle ponctuelle. Les limites par défaut maintiennent une branche et un worker simultanés, trois tours de canal, six tours de branche, douze messages réhydratés et un budget Chronicle de 1 200 jetons.

| Usage | Modèle configuré |
| --- | --- |
| Conversation | `openrouter/deepseek/deepseek-v4-flash` |
| Raisonnement et développement | `openrouter/openai/gpt-oss-120b` |
| Extraction et traitement structuré | `openrouter/qwen/qwen3.7-flash` |
| Compaction et cortex | `openrouter/mistralai/mistral-nemo` |
| Documents visuels ponctuels | `openrouter/google/gemini-2.5-flash-lite` |
| Embeddings communs | `qwen/qwen3-embedding-0.6b` |

Les identifiants et les prix OpenRouter doivent être revérifiés avant toute mise en service, car le catalogue évolue. Les données sensibles ne doivent être envoyées à aucun fournisseur externe sans validation de l’organisation responsable.

## Démarrage local

La pile nécessite Docker Engine avec le plugin Compose. Dans le clone de la branche générique :

```bash
cd deploy/project-hub
cp .env.example .env
# Renseigner OPENROUTER_API_KEY, PROJECT_HUB_MEMORY_DB_PASSWORD et les jetons internes.
chmod 600 .env
./bootstrap_instance.sh
docker compose up -d --build
docker compose ps
```

L’interface est disponible sur <http://127.0.0.1:19898>. Le port est lié à `localhost`; une exposition réseau exige un proxy HTTPS avec authentification et contrôle d’accès.

## Classement générique

```text
instance/shared-workspace/
├── 01_sources/                 # Cadre, données, documents administratifs, données spatiales
├── 02_finances/                # Budget, engagements, dépenses, contrats, écarts
├── 03_planification/           # Plan de travail, Gantt, jalons et risques
├── 04_analyse/                 # Méthodes, données, géomatique, indicateurs, calculs
├── 05_gouvernance/             # Parties prenantes, rencontres, décisions et actions
├── 06_rapports_et_syntheses/   # Notes, rapports et preuves
├── 07_livrables/               # Brouillons, revue, approuvés et transmis
└── 08_archives/                # Versions remplacées et exports
```

Déposer toute nouvelle pièce dans `01_sources/00_inbox/`, puis utiliser `classify_workspace_document` pour la classer selon `00_systeme/taxonomie_documentaire.json`. Les sources, hypothèses, calculs et niveaux de validation doivent être inscrits dans le registre commun.

## Scripts Python et compétences externes

Les six profils disposent de Python 3, `venv` et `pip` dans l’image; ils peuvent créer des scripts locaux sous `00_systeme/scripts/<agent-id>/`. Chaque script doit avoir un README, passer `python3 -m py_compile` et être essayé sur une entrée non destructive. Les dépendances externes restent bloquées jusqu’à une proposition et une approbation explicites.

Avant toute acquisition, l’agent vérifie les compétences, gabarits, scripts, binaires et MCP déjà disponibles. Une compétence externe trouvée avec `skills_search` devient une proposition `capability_skill_acquisition` dans `00_systeme/propositions_capacites/`. Le pont la convertit en tâche `pending_approval`. Après **Approve**, il écrit une autorisation sous `instance/skill-install-authorizations/`, hors du workspace de l’agent; le moteur n’autorise alors que la source exacte et le profil exact approuvés. Le pont ne télécharge jamais de code et n’autorise pas un MCP, un modèle, Docker, un secret ou une permission.

## Apprentissage et remédiation

Le mineur de références ne lit que des enregistrements explicitement `approved`, `completed=true`, `learning_eligible=true`, sourcés et dotés de critères `reference_expected`. Il dépersonnalise les candidats, les partitionne et peut déclencher DSPy ou SkillOpt dans les limites fixées. Chaque proposition reste `pending_approval`; `auto_promote` doit rester `false`.

Lorsqu’une tâche se termine avec `failed`, `blocked` ou `timed_out`, le remédiateur lit uniquement la dernière tentative, masque les éléments sensibles, classe la cause et déduplique une signature. Il peut proposer une leçon d’instruction, mais ne relance jamais automatiquement la tâche source, n’installe aucune capacité et ne modifie jamais la configuration.

## Approbation finale dans l’interface

Le pont convertit toute proposition DSPy, SkillOpt, leçon d’échec ou demande de compétence externe en tâche `pending_approval`. **Approve** fait passer la tâche à `ready`, puis applique uniquement le changement déjà borné, consigne l’audit et clôt la tâche. **Dismiss** replace la tâche dans `backlog`, marque la proposition rejetée et interdit sa promotion.

Les changements suivants exigent toujours une décision humaine : publication externe, engagement financier, modification de plan ou de calendrier officiel, décision réglementaire, configuration Spacebot, modèles, MCP, Docker, dépendances, permissions, secrets et résultats SIG officiels.

## Sauvegarde

Arrêter proprement les conteneurs avant une restauration complète. Sauvegarder ensemble `instance/` et `volumes/postgres/`; ne jamais versionner ni partager `.env`.

```bash
tar -czf project-hub-$(date +%F).tar.gz instance volumes
```

## Références

[1] [Spacebot — agents et workspaces](../../docs/content/docs/(core)/agents.mdx)

[2] [OpenRouter — catalogue des modèles](https://openrouter.ai/models?output_modalities=text)

[3] [OpenRouter — API embeddings](https://openrouter.ai/docs/api-reference/embeddings)

[4] [DSPy — métriques et évaluation](https://dspy.ai/diving-deeper/metrics-and-evaluation/)

[5] [Microsoft SkillOpt](https://github.com/microsoft/skillopt)
