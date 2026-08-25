# Validation de conformité — Spacebot OASIS‑V2

**Date de contrôle :** 25 août 2026

**Portée :** configuration locale Docker, profils OASIS, modèles OpenRouter, liens, mémoire SQL‑vectorielle, MCP, OpenCode, SIG, production documentaire, compétences, optimisation DSPy, apprentissage SkillOpt et découverte autonome de candidats de référence.

## Résultat synthétique

La configuration est **cohérente avec les mécanismes présents dans le dépôt Spacebot** et les ressources OASIS versionnées. Elle ne configure aucun modèle Claude. Les fonctions métiers supplémentaires sont fournies par des services MCP locaux; elles restent internes au réseau Docker et ne publient pas de port hôte.

| Domaine vérifié | Résultat | Élément contrôlé |
| --- | --- | --- |
| Topologie | Conforme | Six agents, un agent par défaut, liens hiérarchiques et liens entre pairs valides. |
| Modèles | Conforme | Routage OpenRouter, surcharges par type de tâche et chaînes de repli sans Claude. |
| Contexte et coûts | Conforme | Chronicle, limites de tours, mémoire automatique désactivée, outils MCP ciblés et quotas d’optimisation. |
| Liens et MCP | Conforme | Mémoire commune par défaut; outils SIG, documentaires et d’optimisation attribués seulement aux profils qui en ont besoin. |
| OpenCode | Conforme par revue statique | Binaire ajouté à l’image; serveur unique, webfetch désactivé, mise à jour et LSP implicites désactivés. |
| Compétences | Conforme | Socle commun, compétences spécialisées par profil, découverte contrôlée et rechargement géré par Spacebot. |
| SIG | Conforme sous réserve SIG | Analyse KML, export GeoJSON et intersections locales; P1/P2/P3 validés restent nécessaires pour une superficie officielle. |
| Documents | Conforme | Génération DOCX/PDF locale, taxonomie, aperçu et contrôle qualité. |
| Optimisation DSPy | Conforme et bornée | Évaluation d’instructions sur cas dépersonnalisés approuvés, propositions `pending_approval`, sans promotion automatique. |
| Apprentissage SkillOpt | Conforme par revue statique et test sans LLM | Compétence `SKILL.md` autorisée, partitions train/validation/holdout séparées, score déterministe, cycle autonome quotidien plafonné et promotion bloquée. |
| Mineur de références | Conforme par revue statique | Lit seulement les enregistrements `approved`, `completed` et `learning_eligible`, dépersonnalise/dédoublonne localement, écrit des candidats séparés et bloque toute promotion. |

## Conformité aux mécanismes du moteur

La structure suit les mécanismes documentés et implémentés par Spacebot. Les agents héritent des paramètres d’instance; leurs MCP propres complètent, par nom, le MCP commun au lieu de remplacer la mémoire partagée. Les compétences d’instance et de workspace sont prises en charge, et les compétences créées dans un workspace peuvent être rechargées sans redémarrage. Les canaux utilisent Chronicle pour borner l’historique injecté; les seuils et budgets configurés restent dans les plages imposées par le chargeur de configuration.

> Les réglages de conversation individuels dans l’interface peuvent encore modifier les modes de mémoire, de délégation et de contexte des workers. Pour préserver les coûts, maintenir le mode de délégation standard et le contexte de worker minimal sauf besoin explicite d’un contexte plus riche.

| Réglage | Valeur OASIS | Effet attendu |
| --- | ---: | --- |
| Branches / workers concurrents | 1 / 1 | Évite les fan-outs coûteux. |
| Tours canal / branche | 3 / 6 | Borne la durée d’une résolution sans empêcher une tâche structurée. |
| Historique rechargé | 12 messages | Réduit la réinjection de conversations anciennes. |
| Budget Chronicle | 1 200 jetons | Préserve les décisions récentes et limite le contexte de session. |
| Persistance mémoire automatique | Désactivée | Évite des branches silencieuses; seuls les faits vérifiés sont enregistrés explicitement. |
| Cortex | Toutes les 900 secondes | Diminue les vérifications de fond. |
| Optimiseur DSPy | 2 cas, 1 candidat, 8 appels | Rend les itérations d’instructions contrôlables et peu coûteuses. |
| SkillOpt | 2/2/2 cas train/validation/holdout, 1 époque, 1 exécution/jour | Apprentissage autonome d’une procédure spécialisée, avec score séparé et sortie `pending_approval`. |
| Mineur de références | 3 candidats par cible, 1 exécution/jour | Découverte locale bornée, sans appel de modèle et sans écriture dans les packs actifs. |

## Tests exécutés

| Test | Résultat |
| --- | --- |
| `python3 validate_static.py` | Réussi : topologie, routage, compaction, MCP ciblés, OpenCode, services, taxonomie et compétences vérifiés. |
| `bash -n bootstrap_instance.sh` | Réussi. |
| Validation de syntaxe Node des services mémoire, SIG, documents, DSPy, SkillOpt et mineur de références | Réussie. |
| Compilation syntaxique Python de l’optimiseur DSPy, du pilote SkillOpt et de l’adaptateur OASIS | Réussie. |
| Test de cas de référence DSPy approuvé fictif | Réussi : validation et état sans appel de modèle. |
| Test SkillOpt de pack approuvé fictif | Réussi : validation de six cas séparés et arrêt autonome sans appel de modèle lorsque `autonomous_learning=false`. |
| Test du correctif d’enregistrement SkillOpt | Réussi : l’adaptateur OASIS est injecté dans les commandes d’entraînement et d’évaluation de la révision upstream figée. |
| Initialisation complète de l’instance avec environnement fictif | Réussie : compétences, espace DSPy/SkillOpt/mineur, gabarits et taxonomie créés puis nettoyés. |
| Compilation Rust complète | Non exécutée : le dépôt exige Rust Edition 2024, alors que l’environnement de validation fournit Cargo 1.75. Le code applicatif n’a pas été modifié; le blocage est uniquement lié à la version de l’outil local. |
| Construction et démarrage Docker | À exécuter sur la machine municipale : Docker n’est pas installé dans l’environnement de validation. |

## Contrôles obligatoires avant mise en production

La personne responsable doit fournir une clé OpenRouter, un mot de passe PostgreSQL fort et un jeton aléatoire `OASIS_MEMORY_EXPORT_TOKEN` dans `.env`, lancer `./bootstrap_instance.sh`, puis exécuter `docker compose up -d --build`. Elle doit ensuite vérifier les états de santé de `oasis-memory-db`, `oasis-shared-memory`, `oasis-gis`, `oasis-document-studio`, `oasis-optimizer`, `oasis-skillopt`, `oasis-reference-miner` et l’accès à l’interface Web sur `127.0.0.1:19898`.

Avant d’utiliser le mineur, copier sa politique de référence, la faire approuver, puis conserver `reference_mining_policy.approved.json` dans `00_systeme/optimisation/reference-miner/`; la politique doit conserver `auto_promote=false`. Marquer une tâche source comme admissible seulement après sa clôture et son approbation, avec `completed=true`, `learning_eligible=true`, références de source et critères `reference_expected`. Avant d’utiliser la boucle DSPy, créer un jeu de référence dépersonnalisé, le faire approuver, puis conserver l’approbation dans `00_systeme/optimisation/reference_cases.approved.json`. Avant d’activer l’apprentissage SkillOpt, créer un pack distinct, dépersonnalisé et approuvé dans `00_systeme/optimisation/skillopt/skillopt_reference_pack.approved.json`, vérifier ses partitions train/validation/holdout et ses critères déterministes, exécuter un premier essai manuel, puis seulement régler `autonomous_learning` à `true`. Avant d’utiliser une superficie dans un PSE ou un rapport officiel, fournir ou tracer les emprises validées P1/P2/P3 et conserver la méthode SIG, le système de coordonnées et les sources.

## Références de conformité

1. `docs/content/docs/(core)/agents.mdx` — agents, liens et espaces de travail.
2. `docs/content/docs/(core)/routing.mdx` et `docs/content/docs/(configuration)/config.mdx` — routage et configuration.
3. `docs/content/docs/(core)/compaction.mdx` et `docs/content/docs/(core)/chronicles.mdx` — historique et budgets Chronicle.
4. `docs/design-docs/mcp.md` et `src/config/types.rs` — résolution des serveurs MCP communs et propres aux agents.
5. `docs/content/docs/(features)/opencode.mdx` et `src/opencode/types.rs` — intégration et permissions OpenCode.
6. `docs/content/docs/(features)/skills.mdx` et `src/tools/skill_manage.rs` — sources, gestion et rechargement des compétences.
7. DSPy, [Metrics and evaluation](https://dspy.ai/diving-deeper/metrics-and-evaluation/) et [Prompt Optimizing with GEPA](https://dspy.ai/getting-started/gepa-optimization/) — principes d’évaluation et de proposition utilisés par la boucle supervisée.
8. [Microsoft SkillOpt](https://github.com/microsoft/skillopt) et son [guide d’ajout d’un benchmark](https://github.com/microsoft/skillopt/blob/main/docs/guide/new-benchmark.md) — apprentissage de compétences textuelles, partitions séparées et validation par garde.
