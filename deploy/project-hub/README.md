# Autonomous Task Hub

**Autonomous Task Hub** est une instance locale Docker de Spacebot pour comprendre une demande, la découper, mobiliser les expertises utiles, produire des artefacts de travail et améliorer continuellement ses capacités locales. Elle s’adresse à tout type de tâche : recherche, analyse, planification, traitement de données, automatisation, programmation, rédaction et contrôle qualité.

Le système conserve ses conversations et sa mémoire commune dans PostgreSQL + pgvector. Le routage passe exclusivement par OpenRouter; aucun modèle Claude n’est configuré. Les données et documents restent dans le répertoire local `instance/`, monté dans les conteneurs.

## Équipe adaptative

Les rôles sont des capacités disponibles et non un parcours rigide. L’orchestrateur choisit les profils utiles selon la demande, réattribue les sous-tâches lorsque les preuves changent et limite le nombre de branches au travail réellement indépendant.

| Profil | Mission principale | Production attendue |
| --- | --- | --- |
| Orchestrateur adaptatif | Qualification, plan, délégation, consolidation et prochaine action | Plan de travail vérifiable |
| Chercheur et analyste de sources | Recherche, faits, options et incertitudes | Dossier de preuves sourcé |
| Planificateur et gestionnaire d’exécution | Dépendances, jalons, risques et reprise | Séquence de travail exploitable |
| Analyste de données et de raisonnement | Méthodes, calculs et cohérence | Analyse reproductible |
| Ingénieur d’automatisation | Scripts, outils locaux et tests | Automatisation documentée |
| Rédacteur de livrables | Documents, synthèses et brouillons | Livrable structuré |
| Réviseur critique | Contradictions, omissions, critères et limites | Revue de qualité |
| Analyste d’apprentissage et de qualité | Cas de référence, DSPy, SkillOpt et leçons | Proposition ou amélioration mesurée |

## Autonomie réelle

Le niveau `act` de Spacebot est activé. Toutes les quinze minutes, l’orchestrateur examine les objectifs, la mémoire, les tâches, les blocages et les résultats précédents. Il peut enrichir les tâches non encore exécutables, créer des suivis, lancer les tâches prêtes, réorganiser le plan et déléguer des analyses indépendantes. Les cycles autonomes conservent un résumé durable, de sorte que la suite de travail ne recommence pas au même point.

La boucle de remédiation dépersonnalise et déduplique les échecs persistants. Elle crée une leçon ou une demande de capacité, puis empêche la répétition d’une tentative sans différence explicite de plan. Le mineur de références extrait uniquement des tâches terminées, approuvées et marquées `learning_eligible=true`; DSPy et SkillOpt évaluent des candidates dans des partitions séparées, avec des plafonds de coût OpenRouter.

## Auto-évolution locale

Les agents peuvent améliorer automatiquement les scripts placés dans `05_automatisation/01_scripts/`. Une correction locale doit comporter une empreinte de la version de départ, le contenu complet candidat, sa justification et ses contraintes. Le service `project-local-code-improver` vérifie le type de fichier, limite le chemin au workspace, valide la syntaxe, sauvegarde la version précédente, applique la correction de manière atomique et écrit un audit. Une candidate invalide ou fondée sur une version dépassée est conservée sans écraser le fichier en place.

Le même protocole d’évolution sert de cadre aux compétences, aux dépendances déclarées, aux fichiers Docker et aux MCP : provenance identifiée, changement local explicitement décrit, validation automatisée, journal et retour arrière. Les actions externes et irréversibles demeurent exclues du flux automatique.

> Les agents peuvent travailler et améliorer l’environnement local de façon autonome. Ils ne transmettent toutefois pas de contenu, ne publient pas, n’achètent pas, n’exposent pas de secret, ne modifient pas les permissions et n’accèdent pas à une ressource externe non fournie sans décision explicite du responsable.

## Installation locale

```bash
git clone --branch feat/autonomous-task-hub https://github.com/ahoken50/spacebot.git /srv/autonomous-task-hub
cd /srv/autonomous-task-hub/deploy/project-hub
cp .env.example .env
chmod 600 .env
```

Renseignez dans `.env` votre clé OpenRouter, le mot de passe PostgreSQL et les jetons internes. Générez les jetons localement, par exemple avec `openssl rand -hex 32`, puis initialisez et démarrez l’instance.

```bash
./bootstrap_instance.sh
docker compose up -d --build
docker compose ps
```

L’interface Web est disponible uniquement sur `http://127.0.0.1:19898`. Pour consulter les services autonomes :

```bash
docker compose logs --tail=100 \
  spacebot-project-hub \
  project-failure-remediator \
  project-reference-miner \
  project-local-code-improver
```

## Arborescence de travail

```text
instance/shared-workspace/
├── 01_sources/                 # Pièces d’entrée, références et données
├── 02_recherche/               # Questions, preuves et options
├── 03_planification/           # Objectifs, plan et risques
├── 04_analyse/                 # Méthodes, données et calculs
├── 05_automatisation/          # Scripts, tests et résultats locaux
├── 06_communications/          # Notes, brouillons et révisions
├── 07_livrables/               # Brouillons, QA, approuvés et transmis
├── 08_archives/                # Versions remplacées et journaux
└── 00_systeme/optimisation/    # DSPy, SkillOpt, remédiation et auto-évolution
```

Déposez les nouvelles pièces dans `01_sources/00_inbox/`. Les agents classent ensuite les fichiers avec la taxonomie locale, enregistrent leurs sources et créent des artefacts reproductibles.

## Contrôles et coûts

Les modèles les moins coûteux assurent la coordination, les workers et les extractions structurées; le modèle de raisonnement est réservé aux tâches complexes. Les boucles DSPy et SkillOpt ont des plafonds de cas, d’appels, de jetons, de temps et d’exécutions quotidiennes, modifiables dans `.env`.

Les tests intégrés vérifient la configuration, le bootstrap, la syntaxe des services, la déduplication des échecs, les packs d’apprentissage et l’application atomique d’une amélioration de code locale. La validation Docker complète doit être effectuée sur l’hôte Linux qui exécutera l’instance.
