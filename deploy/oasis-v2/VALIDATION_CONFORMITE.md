# Validation de conformité — Spacebot OASIS‑V2

**Date de contrôle :** 24 août 2026  
**Portée :** configuration locale Docker, profils OASIS, modèles OpenRouter, liens, mémoire SQL‑vectorielle, MCP, OpenCode, SIG, production documentaire, compétences et optimisation supervisée.

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
| Optimisation | Conforme et bornée | Évaluation DSPy sur cas dépersonnalisés approuvés, propositions `pending_approval`, sans promotion automatique. |

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
| Optimiseur | 2 cas, 1 candidat, 8 appels | Rend les itérations DSPy contrôlables et peu coûteuses. |

## Tests exécutés

| Test | Résultat |
| --- | --- |
| `python3 validate_static.py` | Réussi : topologie, routage, compaction, MCP ciblés, OpenCode, services, taxonomie et compétences vérifiés. |
| `bash -n bootstrap_instance.sh` | Réussi. |
| Validation de syntaxe Node des services mémoire, SIG, documents et optimiseur | Réussie. |
| Compilation syntaxique Python de l’optimiseur | Réussie. |
| Test de cas de référence DSPy approuvé fictif | Réussi : validation et état sans appel de modèle. |
| Initialisation complète de l’instance avec environnement fictif | Réussie : compétences, espace d’optimisation et taxonomie créés puis nettoyés. |
| Compilation Rust complète | Non exécutée : le dépôt exige Rust Edition 2024, alors que l’environnement de validation fournit Cargo 1.75. Le code applicatif n’a pas été modifié; le blocage est uniquement lié à la version de l’outil local. |
| Construction et démarrage Docker | À exécuter sur la machine municipale : Docker n’est pas installé dans l’environnement de validation. |

## Contrôles obligatoires avant mise en production

La personne responsable doit fournir une clé OpenRouter et un mot de passe PostgreSQL fort dans `.env`, lancer `./bootstrap_instance.sh`, puis exécuter `docker compose up -d --build`. Elle doit ensuite vérifier les états de santé des cinq services locaux et l’accès à l’interface Web sur `127.0.0.1:19898`.

Avant d’utiliser la boucle DSPy, créer un jeu de référence dépersonnalisé, le faire approuver, puis conserver l’approbation dans `00_systeme/optimisation/reference_cases.approved.json`. Avant d’utiliser une superficie dans un PSE ou un rapport officiel, fournir ou tracer les emprises validées P1/P2/P3 et conserver la méthode SIG, le système de coordonnées et les sources.

## Références de conformité

1. `docs/content/docs/(core)/agents.mdx` — agents, liens et espaces de travail.
2. `docs/content/docs/(core)/routing.mdx` et `docs/content/docs/(configuration)/config.mdx` — routage et configuration.
3. `docs/content/docs/(core)/compaction.mdx` et `docs/content/docs/(core)/chronicles.mdx` — historique et budgets Chronicle.
4. `docs/design-docs/mcp.md` et `src/config/types.rs` — résolution des serveurs MCP communs et propres aux agents.
5. `docs/content/docs/(features)/opencode.mdx` et `src/opencode/types.rs` — intégration et permissions OpenCode.
6. `docs/content/docs/(features)/skills.mdx` et `src/tools/skill_manage.rs` — sources, gestion et rechargement des compétences.
7. DSPy, [Metrics and evaluation](https://dspy.ai/diving-deeper/metrics-and-evaluation/) et [Prompt Optimizing with GEPA](https://dspy.ai/getting-started/gepa-optimization/) — principes d’évaluation et de proposition utilisés par la boucle supervisée.
