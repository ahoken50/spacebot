# Audit fonctionnel et factuel — Spacebot OASIS-V2

**Date de revue :** 25 août 2026

**Révision auditée :** `1e9d140b`, puis corrections d’audit locales à versionner
**Périmètre :** moteur Spacebot, configuration OASIS, services Docker, six profils, modèles, mémoire PostgreSQL + pgvector, SIG, documents, DSPy, SkillOpt, mineur de références, remédiation après échec, scripts Python, compétences et approbation Web.

## Conclusion

La conception est désormais **cohérente, structurée et prête pour une validation d’intégration Docker sur le serveur local**. Les flux essentiels sont logiquement reliés : les agents travaillent avec des compétences de profil réellement chargées, utilisent le registre commun pour les faits vérifiables, produisent des propositions d’apprentissage ou de capacité, puis s’arrêtent avant tout changement durable jusqu’à la décision dans l’interface Spacebot.

L’audit a trouvé et corrigé deux écarts fonctionnels importants : les six profils partageaient par erreur le même workspace déclaré, ce qui rendait inactifs les profils de compétences créés par le bootstrap; et l’autorisation d’installer une compétence externe n’était jusque-là appliquée que par consigne, sans verrou dans l’outil natif. Le modèle de sécurité Docker a aussi été resserré pour ne plus distribuer tout le fichier `.env` à plusieurs services. Aucun écart avéré n’a été trouvé dans le cycle natif Spacebot `pending_approval → ready`, utilisé par le pont OASIS. [1] [2]

> **Verdict :** les contrôles de code, de syntaxe, de bootstrap et les simulations HTTP sont satisfaisants. Le verdict ne vaut pas encore preuve de démarrage réel, de compilation Rust ou d’appel OpenRouter avec la clé de la Ville : ces trois contrôles doivent être réalisés sur le serveur Docker cible.

## Méthode et niveau de preuve

| Niveau | Signification | Éléments concernés |
| --- | --- | --- |
| **Prouvé par code et test local** | Le comportement a été lu dans le code, puis contrôlé par un test ou validateur disponible. | Bootstrap, profils, pont, remédiateur, pack autonome, validations statiques. |
| **Prouvé par revue de code** | Le comportement est directement implémenté, mais l’environnement ne permet pas de l’exécuter ici. | Verrou Rust `install_skill`, construction Docker, appels réseau réels. |
| **À valider sur serveur** | Le comportement dépend des conteneurs, de la clé OpenRouter ou de données municipales locales. | Santé Docker, modèle d’embedding, MCP, SIG réel, génération documentaire réelle. |

## Vérification des faits techniques

Spacebot documente la configuration OpenRouter, les agents, les MCP HTTP, les compétences aux niveaux instance et workspace, ainsi que la possibilité d’installer et de recharger des compétences. Le code local confirme que le chemin de workspace résolu est celui qui alimente le runtime, les outils et le sandbox; ce point a fondé la correction de l’isolation des profils. [1] [2]

Le contrat local de l’API de tâches confirme qu’une création passe en `pending_approval` et que `POST /tasks/{number}/approve` fait passer la tâche à `ready`, en conserve l’approbateur et émet la révision correspondante. Le pont OASIS n’applique donc une candidate qu’après l’action native de l’interface, puis clôt sa tâche de contrôle par `ready → in_progress → done`. [3]

La documentation OpenRouter confirme l’endpoint `/api/v1/embeddings`, la vérification nécessaire de la dimension du vecteur et l’existence d’un catalogue spécifique aux modèles d’embeddings. Les cinq identifiants conversationnels configurés ont été retrouvés dans le catalogue consulté; la documentation actuelle cite aussi `qwen/qwen3-embedding-0.6b` parmi les petits modèles d’embeddings. Le service mémoire appelle bien l’endpoint embeddings, impose `1024` dimensions et refuse les replis de fournisseur. [4] [5]

| Élément factuel | Résultat | Observation |
| --- | --- | --- |
| Routage sans Claude | **Confirmé** | Tous les routes et replis utilisent le préfixe `openrouter/` sans identifiant Claude. |
| Compétences Spacebot | **Confirmé** | Le mécanisme officiel donne priorité aux compétences workspace; la correction rétablit cette priorité par profil. [1] |
| Approbation UI | **Confirmé** | Le contrat API local correspond au comportement attendu par le pont. [3] |
| Embeddings pgvector | **Confirmé par code** | Endpoint OpenRouter correct, dimensions contrôlées, index HNSW et vecteurs persistés dans PostgreSQL. [4] |
| Modèles conversationnels | **Confirmé au moment de l’audit** | Les cinq identifiants ont été relevés dans le catalogue OpenRouter du 25 août 2026. [5] |
| Santé des conteneurs | **Non démontrée ici** | Docker est absent de l’environnement d’audit. |

## Corrections apportées par l’audit

| Gravité initiale | Écart trouvé | Correction | Effet obtenu |
| --- | --- | --- | --- |
| Élevée | Chaque agent déclarait `/data/shared-workspace` comme workspace, mais le bootstrap écrivait les compétences dans `instance/agents/<id>/workspace/skills/`. | Suppression du workspace partagé explicite; retour au workspace privé par défaut et ajout du seul chemin partagé dans `sandbox.writable_paths`. | Les compétences spécialisées, leçons approuvées et installations ciblées sont réellement propres au profil; les sources et livrables restent accessibles collectivement. |
| Élevée | Après une approbation UI, l’installation d’une compétence externe reposait seulement sur une instruction au modèle. | Le pont écrit une autorisation dédiée hors des workspaces agents; `install_skill` compare la source, l’agent, le statut `approved_for_agent_install` et la restriction workspace avant téléchargement. | Le moteur refuse une installation non approuvée, provenant d’une autre source, destinée à un autre profil ou forgeable depuis le répertoire partagé. |
| Moyenne | Plusieurs services recevaient tout `.env`, donc des jetons inutiles. | Retrait de tous les `env_file`; déclaration explicite des seules variables requises. | Réduction de l’exposition de secrets inter-services. |
| Moyenne | Trois services MCP locaux n’avaient pas le même retrait de capacités que les services plus récents. | Ajout de `no-new-privileges` et `cap_drop: ALL` à mémoire partagée, SIG et studio documentaire. | Durcissement cohérent sans élargissement des capacités. |
| Faible | Le guide indiquait qu’un échec créait directement une demande de capacité. | Documentation corrigée : l’échec crée une leçon; la recherche et la proposition de capacité nécessitent ensuite une source et une analyse vérifiables. | La documentation correspond à l’implémentation réelle. |

## Chaîne fonctionnelle validée

Les six agents disposent maintenant d’un espace privé pour leurs compétences et essais, avec accès au répertoire de sources et livrables commun seulement par une règle sandbox explicite. La mémoire partagée PostgreSQL + pgvector reste le registre commun de faits, décisions, références et résultats vérifiables; elle n’est pas confondue avec la mémoire conversationnelle propre aux profils.

Le flux d’apprentissage est cohérent : une tâche source rendue admissible est d’abord enregistrée comme `approved`, terminée, sourcée et marquée `learning_eligible`; le mineur retire les données sensibles, dédouble et sépare les candidats; DSPy ou SkillOpt produisent une proposition; le pont crée une tâche visible dans la file d’approbation; l’utilisateur approuve ou rejette dans l’interface. Les installations et promotions sont auditées et les compétences approuvées persistent dans un recouvrement restauré par le bootstrap.

La remédiation après échec utilise seulement la dernière tentative durable `failed`, `blocked` ou `timed_out`. Elle dépersonnalise le résumé, limite le nombre de candidates, marque les répétitions comme `repeat_suppressed` et n’exécute aucune relance automatique. Une approbation n’installe qu’une leçon d’instructions; elle ne peut jamais modifier un MCP, Docker, un modèle, une permission, une dépendance ou des données sources.

| Flux | Déclencheur | Produit | Barrière finale |
| --- | --- | --- | --- |
| Document / finance / SIG | Tâche agent | Brouillon, calcul, registre commun | Validation métier ou SIG humaine. |
| DSPy | Cas anonymisés admissibles | Proposition d’instruction | Tâche Spacebot approuvée. |
| SkillOpt | Pack partitionné admissible | Candidate `SKILL.md` | Tâche Spacebot approuvée. |
| Échec de tâche | Dernière tentative durable en échec | Leçon dépersonnalisée | Tâche Spacebot approuvée. |
| Compétence manquante | Recherche `skills_search` | Demande de compétence externe | Tâche Spacebot approuvée, autorisation réservée hors workspace et verrou moteur sur source/profil. |

## Validations exécutées pendant l’audit

| Contrôle | Résultat |
| --- | --- |
| `python3 deploy/oasis-v2/validate_static.py` | Réussi après corrections; vérifie six profils, workspaces privés, sandbox partagé, MCP, modèles OpenRouter, services, secrets explicites, pont, apprentissage et garde d’installation. |
| `bash -n deploy/oasis-v2/bootstrap_instance.sh` | Réussi. |
| Syntaxe Node des services OASIS | Réussie pour pont, remédiateur, mineur, optimizer et SkillOpt. |
| Compilation syntaxique Python | Réussie pour DSPy et SkillOpt. |
| Bootstrap avec environnement fictif | Réussi; six profils, compétence Python, dossier partagé et recouvrement approuvé restauré puis nettoyé. |
| Pont de remédiation | Réussi avec API Spacebot simulée : proposition → tâche UI → approbation → leçon persistante → clôture. |
| Pont de compétence externe | Réussi avec API Spacebot simulée : proposition → tâche UI → autorisation auditée, sans installation par le pont. |
| Remédiateur d’échec | Réussi avec API simulée : dépersonnalisation, première proposition et suppression de répétition. |
| Packs autonomes | Réussi sans LLM : DSPy et SkillOpt refusent les packs temporaires non autorisés ou non dépersonnalisés. |
| Diff Git | À refaire juste avant commit; aucun artefact de tests (`.env`, volumes, `node_modules`) ne doit rester. |

## Limites et contrôles de mise en service

Le sandbox fournit Cargo/Rust 1.75, alors que le dépôt exige l’édition Rust 2024. La compilation directe du moteur et le contrôle `cargo fmt` ne sont donc pas disponibles ici. L’image Docker utilise toutefois `rust:bookworm` pour sa phase de construction; elle doit constituer la première preuve de compilation de la correction du verrou `install_skill`.

Docker n’est pas installé dans l’environnement d’audit. Il est donc indispensable d’exécuter une construction complète, d’inspecter les états `healthy`, puis de faire trois scénarios sur le serveur : une proposition SkillOpt/DSPy, un échec de tâche transformé en leçon, et une demande de compétence externe approuvée puis refusée lorsqu’une source différente est tentée.

> Les calculs de superficies, le PSE et les livrables transmis au Ministère restent des résultats à valider humainement. Le SIG doit notamment recevoir des emprises P1/P2/P3 validées avant toute superficie officielle.

## Références

[1]: https://docs.spacebot.sh/skills "Spacebot — Skills"
[2]: https://github.com/spacedriveapp/spacebot/blob/main/docs/content/docs/(configuration)/config.mdx "Spacebot — Configuration"
[3]: https://github.com/spacedriveapp/spacebot/blob/main/src/api/tasks.rs "Spacebot — API des tâches"
[4]: https://openrouter.ai/docs/api_reference/embeddings "OpenRouter — Embeddings API"
[5]: https://openrouter.ai/api/v1/models "OpenRouter — Models API"
