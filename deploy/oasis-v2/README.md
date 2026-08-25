# Spacebot OASIS-V2 — Déploiement local Docker

Cette configuration prépare une instance Spacebot destinée au suivi de la convention **COV_OASIS-V2** de la Ville de Val-d'Or. L’interface Web locale constitue le point d’entrée. Un coordonnateur délègue aux profils spécialisés; les faits, décisions, résultats, risques et références utiles sont enregistrés dans une mémoire commune fondée sur **PostgreSQL + pgvector**, accessible à tous les profils par un serveur MCP local.

> Le service partagé est nécessaire parce que Spacebot isole par défaut la mémoire de chaque agent. Les profils gardent donc une mémoire de conversation propre, tout en utilisant le registre PostgreSQL-vectoriel comme source interagent faisant autorité. [1]

| Élément | Rôle | Persistance |
| --- | --- | --- |
| `spacebot-oasis-v2` | Interface Web, topologie des agents, tâches, conversations, mémoire locale de chaque profil et outils de travail. | `instance/` |
| `oasis-memory-db` | Registre commun relationnel, historique d’audit, liens entre éléments et vecteurs pgvector. | `volumes/postgres/` |
| `oasis-shared-memory` | Serveur MCP interne : écritures contrôlées, recherche sémantique, lecture de dossiers et liens de traçabilité. | Sans état; s’appuie sur PostgreSQL |
| `oasis-gis` | Serveur MCP SIG local : inventaire KML, export GeoJSON et intersections par emprise P1/P2/P3. | `instance/shared-workspace/` |
| `oasis-document-studio` | Serveur MCP documentaire local : DOCX/PDF, aperçu PNG et contrôle qualité. | `instance/shared-workspace/` |
| OpenRouter | Routage des modèles de génération et création d’embeddings; les vecteurs générés sont mis en cache dans PostgreSQL. | Compte OpenRouter de la Ville |

## Profils et circulation du travail

| Profil | Mandat principal | Utilise systématiquement | Résultat transmis au coordonnateur |
| --- | --- | --- | --- |
| **Coordonnateur OASIS-V2** | Point d’entrée Web, clarification, planification, délégation et consolidation. | Registre partagé, tâches, liens hiérarchiques. | Plan de travail, synthèse, décisions à approuver. |
| **Analyste financier** | Budget, dépenses, salaires, contrats, appels d’offres, admissibilité et écarts. | Budget approuvé, registre des dépenses, pièces de preuve. | État financier et alertes de conformité. |
| **Planificateur** | Calendrier compressé, Gantt, dépendances et jalons. | Calendrier approuvé, décisions, risques et dates contractuelles. | Version de travail, écarts et actions correctives. |
| **Analyste PSE et SIG** | PSE, KML, superficies, indicateurs et méthode de vulnérabilité. | KML, rapport technique, gabarit PSE, méthode MELCCFP. | Matrice d’indicateurs, calculs et limites SIG. |
| **Rédacteur de reddition** | Rapports d’étape/final, annexes et contrôle de conformité. | PSE, budget, calendrier, résultats et preuves. | Brouillon, liste des annexes et informations manquantes. |
| **Secrétaire du comité** | Convocations, ordres du jour, PV, décisions et relances. | Registre des décisions et risques, calendrier. | PV à valider, plan d’action et suivi des responsables. |

Les liaisons sont préconfigurées dans `config.toml.example`. L’administration municipale encadre le coordonnateur. Celui-ci dirige les cinq profils spécialisés. Des liaisons entre pairs existent entre finances et reddition, PSE/SIG et reddition, ainsi qu’entre calendrier et gouvernance.

```mermaid
flowchart TD
    A[Administration Ville de Val-d'Or] --> C[Coordonnateur OASIS-V2]
    C --> F[Analyste financier]
    C --> P[Planificateur]
    C --> S[Analyste PSE et SIG]
    C --> R[Rédacteur de reddition]
    C --> G[Secrétaire du comité]
    F <--> R
    S <--> R
    P <--> G
    M[(PostgreSQL + pgvector\nMémoire commune)]
    F -. outils MCP .-> M
    P -. outils MCP .-> M
    S -. outils MCP .-> M
    R -. outils MCP .-> M
    G -. outils MCP .-> M
    C -. outils MCP .-> M
```

## Routage OpenRouter orienté coût

Le routage n’utilise aucun modèle Claude. Les modèles de génération sont sélectionnés dans le catalogue OpenRouter et restent séparés par niveau de responsabilité; le modèle visuel plus coûteux n’est utilisé qu’à la demande pour les documents scannés ou les plans. Les identifiants et prix doivent être revérifiés avant l’activation, puisqu’OpenRouter les fait évoluer. [2]

| Processus | Modèle configuré | Fonction | Justification de coût |
| --- | --- | --- | --- |
| Conversation de l’interface | `openrouter/deepseek/deepseek-v4-flash` | Échanges, suivi de contexte et délégation. | Niveau économique pour les interactions courantes. |
| Analyse / arbitrage | `openrouter/openai/gpt-oss-120b` | Plans complexes, consolidation, rapports sensibles. | Déclenché sur les tâches nécessitant plus de raisonnement. |
| Travailleurs spécialisés | `openrouter/qwen/qwen3.7-flash` | Extraction structurée, tableurs, KML, contrôles et brouillons. | Faible coût pour les tâches fréquentes et répétables. |
| Compaction et cortex | `openrouter/mistralai/mistral-nemo` | Résumés, mémoires et signaux de gestion. | Modèle très économique; aucune décision contractuelle. |
| Documents visuels | `openrouter/google/gemini-2.5-flash-lite` | Lecture ponctuelle de plans, scans et PDF difficiles. | Usage exceptionnel et ciblé. |
| Embeddings communs | `qwen/qwen3-embedding-0.6b` | Recherche vectorielle multilingue dans PostgreSQL. | Généré une seule fois par contenu nouveau ou modifié, puis conservé. |

> Les données envoyées à un modèle OpenRouter restent soumises aux politiques du fournisseur retenu. Le serveur d’embeddings demande explicitement `data_collection: "deny"`; l’équipe TI doit néanmoins valider le traitement externe de documents municipaux avant de déposer des pièces confidentielles. [3]

## Sobriété de jetons et réglages fins

La configuration réduit d’abord le **contexte répété** : une seule branche et un seul worker peuvent être actifs, le canal est limité à trois tours, une branche à six tours et seulement douze messages sont réhydratés lorsqu’un canal est rouvert. La fenêtre de contexte est fixée à 96 000 jetons; elle suffit aux livrables complexes tout en forçant l’évacuation contrôlée du contexte non essentiel. Les tâches autonomes se limitent à une proposition toutes les quatre heures, avec un seul travail proposé et au plus quatre tours.

La compression **Chronicle** est activée tôt — à 72 % de la fenêtre — et ne rend que quatre checkpoints récents et six anciens dans un budget de **1 200 jetons**. Les checkpoint sont plus courts et plus fréquents, ce qui évite qu’une longue conversation soit renvoyée intégralement à chaque échange. La persistance automatique de mémoire et la réflexion automatique sur les compétences sont désactivées : seules les données factuelles, décisions, risques et livrables vérifiables sont explicitement enregistrés dans le registre commun. Cette stratégie préserve la traçabilité sans ouvrir des branches silencieuses de synthèse. [4] [5]

Les outils coûteux en contexte sont ciblés. La mémoire commune est disponible à tous les profils; l’atelier documentaire est chargé uniquement par les profils qui produisent des livrables, le SIG uniquement par PSE/SIG, et le navigateur uniquement par le coordonnateur. Les recherches vectorielles retournent cinq extraits courts par défaut; le détail d’une fiche est chargé seulement lorsque nécessaire. Les requêtes identiques sont temporairement mises en cache et une mise à jour d’enregistrement strictement inchangée ne déclenche ni nouvel embedding ni écriture d’audit.

OpenCode est activé pour les **tâches de développement multi-fichiers** seulement; le modèle `openrouter/openai/gpt-oss-120b` est alors sélectionné par la surcharge `coding`. L’image contient le binaire OpenCode officiel versionné; un seul serveur persistant peut être créé, avec un démarrage limité à 45 secondes et deux redémarrages. Les workers intégrés de Spacebot demeurent la voie par défaut pour les calculs SIG, la production documentaire, les commandes ponctuelles et les analyses non liées au code. Les permissions d’édition et de terminal sont nécessaires au développement local, tandis que `webfetch` est désactivé; les mises à jour et téléchargements LSP automatiques sont aussi désactivés.

## Démarrage local

La pile nécessite Docker Engine avec le plugin Compose. Sur la machine locale, clonez le dépôt, rendez-vous dans ce répertoire, puis exécutez les étapes ci-dessous.

```bash
cp .env.example .env
# Éditez .env : OPENROUTER_API_KEY et OASIS_MEMORY_DB_PASSWORD.
chmod 600 .env

./bootstrap_instance.sh

docker compose up -d --build
docker compose ps
```

Ouvrez ensuite <http://127.0.0.1:19898>. L’interface est liée à `localhost` pour ne pas être exposée directement au réseau. Une exposition réseau exige un proxy inverse avec HTTPS, authentification et contrôle d’accès; elle ne doit pas être activée par défaut.

## Ingestion documentaire et livrables

Après le démarrage, copiez les documents originaux dans `instance/shared-workspace/01_sources/00_inbox/`. Demandez ensuite à l’interface Web de les classer avec l’outil `classify_workspace_document`, qui ne peut déplacer un fichier que vers un dossier autorisé par `00_systeme/taxonomie_documentaire.json`. Les versions préparées par les agents sont séparées entre brouillons, revue qualité, documents approuvés et transmissions.

| Dossier local | Usage | Versionné dans Git |
| --- | --- | --- |
| `01_sources/00_inbox/` | Point d’entrée de toute pièce nouvelle. | Non |
| `01_sources/01_convention` à `01_sources/06_pieces_financieres` | Sources officielles classées. | Non |
| `02_finances` à `06_reddition` | Dossiers de travail par fonction et par obligation. | Non |
| `07_livrables/01_brouillons` à `07_livrables/04_transmis` | Cycle de vie distinct des livrables. | Non |
| `08_archives/` | Versions remplacées, pièces non admissibles et exports. | Non |
| `instance/agents/*/data/` | Données internes par profil (SQLite, LanceDB, réglages). | Non |
| `volumes/postgres/` | Mémoire relationnelle et vectorielle interagent. | Non |

## Chaîne SIG et documentaire

Le service `oasis-gis` traite localement le KML et les GeoJSON déposés dans l’espace de travail : `inspect_kml` inventorie les objets et leurs mesures géodésiques, `export_kml_geojson` produit un GeoJSON de travail et `project_surface_analysis` calcule les intersections avec des emprises de projet. Le calcul final reste conditionnel à la création ou l’import de trois emprises polygonales validées, `P1`, `P2` et `P3`, car le KML brut contient aussi des objets techniques et des hachures. Les données SIG ne sont pas envoyées à OpenRouter par ces outils.

Le service `oasis-document-studio` donne aux agents les outils `get_document_taxonomy`, `classify_workspace_document`, `create_document_brief`, `render_markdown_document`, `check_document_quality` et `render_document_preview`. Ils produisent localement des livrables DOCX/PDF à partir d’un Markdown structuré, utilisent une charte OASIS, créent un aperçu PNG de la première page et vérifient pages, texte extractible et polices. La procédure `oasis-document-studio` impose une revue visuelle des pages sensibles et une approbation humaine avant diffusion officielle.

## Compétences préchargées par profil

Chaque agent charge systématiquement la compétence commune `oasis-foundation`, qui impose la traçabilité, le classement, la mémoire partagée, l’approbation humaine et la sobriété des échanges. Les autres compétences sont copiées dans le workspace du profil lors de l’initialisation : le coordonnateur reçoit la coordination, les procédures financières, calendaires, PSE, de reddition, documentaires et d’optimisation supervisée; l’analyste financier reçoit finance, reddition et documents; le planificateur reçoit calendrier, reddition et documents; l’analyste PSE/SIG reçoit SIG et documents; le rédacteur reçoit reddition, documents, finances et PSE; et le secrétaire reçoit gouvernance, calendrier et documents.

Cette répartition évite de charger à tous les agents des instructions inutiles tout en laissant les procédures communes disponibles. Les compétences sont uniquement des directives opératoires; les données factuelles demeurent dans le registre commun et les dossiers classés.

## Boucle d’amélioration supervisée inspirée de DSPy

Le coordonnateur dispose seul du service `oasis-supervised-optimizer` et de la compétence correspondante. Cette boucle reprend le principe DSPy : exécuter des exemples de référence, appliquer des métriques, produire des variantes d’instructions et comparer les scores. Elle est limitée à des cas **dépersonnalisés et explicitement approuvés**; aucun rapport réel, document confidentiel, secret ou changement de production ne peut y être introduit. [6] [7]

Le conteneur et l’outil DSPy sont **actifs par défaut** au démarrage de la pile (`OASIS_OPTIMIZER_ENABLED=true`). Cette activation ne planifie ni n’exécute aucun appel de modèle : elle rend disponibles le statut, la validation du jeu de référence et, au coordonnateur seulement, l’action manuelle de proposition. Pour effectuer une optimisation, copier `00_systeme/optimisation/reference_cases.template.json` en `reference_cases.approved.json`, remplacer les exemples fictifs par un ou deux cas représentatifs puis obtenir l’approbation humaine en inscrivant le statut `approved`, le réviseur et la date. Le coordonnateur valide ensuite le jeu de référence et lance explicitement une proposition avec un seul candidat. Les métriques déterministes évaluent les termes essentiels, les assertions interdites, les marqueurs de source et la concision. Les propositions sont écrites sous `00_systeme/optimisation/propositions/` avec le statut `pending_approval`. Pour désactiver l’action de proposition tout en gardant le service de statut et de validation, définir `OASIS_OPTIMIZER_ENABLED=false` dans `.env` puis redémarrer la pile.

Les limites par défaut sont de deux cas, un candidat et huit appels de modèle. L’optimiseur ne peut ni modifier `config.toml`, ni changer un modèle, une compétence, un outil, une dépendance ou une permission. Une amélioration ne devient active qu’après une revue humaine et un changement versionné distinct. Cette séparation permet de bénéficier d’un processus de type DSPy tout en évitant l’auto-modification libre et les coûts incontrôlés.

## Découverte et évolution contrôlée des capacités

La compétence commune `oasis-capability-discovery` impose une vérification avant toute recherche externe : l’agent commence par inventorier les compétences chargées, les gabarits de `00_systeme/`, les scripts, les binaires persistants et les outils MCP disponibles. Une capacité existante est réutilisée plutôt que dupliquée. Lorsqu’elle est absente, l’agent peut rechercher une compétence reconnue ou créer une compétence réutilisable dans son propre workspace; Spacebot la recharge immédiatement sans redémarrage. [8]

Les changements durables — ajout de conteneur, MCP, dépendance, modèle, secret, droit réseau ou permission — ne sont pas auto-activés. L’agent prépare alors une proposition classée dans `00_systeme/propositions_capacites/`, avec son origine, ses dépendances, ses coûts, ses tests et son plan de retrait. Elle est enregistrée dans le registre commun avec le statut `pending_approval` et requiert une approbation humaine. Une compétence installée, épinglée ou fournie par l’instance ne peut pas être modifiée automatiquement.

## Mémoire partagée : règles d’utilisation

Le serveur `oasis-shared-memory` fournit à chaque travailleur quatre opérations : enregistrer un élément, rechercher sémantiquement, lire un élément et lier deux éléments. Les enregistrements structurés couvrent notamment les décisions, dépenses, contrats, appels d’offres, jalons, indicateurs, projets, livrables, réunions, risques et documents. Chaque écriture conserve l’auteur, les références de source, le statut, l’horodatage et une trace d’audit. Le contenu indexé est plafonné à 6 000 caractères et les recherches retournent des extraits de 1 200 caractères au plus, afin de ne pas injecter inutilement des documents complets dans le contexte.

Les éléments susceptibles d’avoir une incidence contractuelle, financière ou réglementaire doivent être enregistrés avec le statut `pending_approval`. Seule une validation humaine peut les faire passer à `approved`. Le serveur ne fournit volontairement aucune opération de suppression physique; une correction doit créer une version remplacée ou un statut `superseded`, de façon à préserver l’audit.

## Sauvegarde et restauration

Arrêtez proprement les conteneurs avant une restauration complète. Sauvegardez ensemble le répertoire `instance/` et le répertoire `volumes/postgres/`; ces deux éléments forment l’état durable du système. Ne copiez jamais `.env` dans un partage non sécurisé ou dans Git.

```bash
# Sauvegarde locale indicative, à adapter aux règles TI municipales.
tar -czf oasis-v2-spacebot-$(date +%F).tar.gz instance volumes
```

## Références

[1] [Spacebot — Agents : isolation des mémoires et liens interagents](../../docs/content/docs/(core)/agents.mdx)

[2] [OpenRouter — Catalogue des modèles texte](https://openrouter.ai/models?output_modalities=text)

[3] [OpenRouter — API Embeddings et contrôle de routage fournisseur](https://openrouter.ai/docs/api-reference/embeddings)

[4] [Spacebot — Compaction et Chronicle](../../docs/content/docs/(core)/compaction.mdx)

[5] [Spacebot — Stabilité des prompts et réutilisation du cache](../../docs/design-docs/prompt-stability.md)

[6] [DSPy — Métriques et évaluation](https://dspy.ai/diving-deeper/metrics-and-evaluation/)

[7] [DSPy — Optimisation d’instructions avec GEPA](https://dspy.ai/getting-started/gepa-optimization/)

[8] [Spacebot — Compétences : chargement, installation et rechargement à chaud](../../docs/content/docs/(features)/skills.mdx)
