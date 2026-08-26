# Project Hub municipal — Ville de Val-d’Or

**Project Hub** est une instance locale Spacebot conçue comme outil complémentaire du coordonnateur en environnement de la Ville de Val-d’Or. Elle peut soutenir la gestion, la recherche, l’analyse et la préparation de livrables pour tout projet municipal : environnement, territoire, infrastructures, climat, consultations, études, partenariats, subventions ou dossiers interservices.

> Project Hub prépare des recherches, matrices et **brouillons**. Il ne remplace ni le greffe, ni les affaires juridiques, ni une direction, ni le conseil. Il ne dépose, signe, envoie, publie ni adopte aucun document.

## Profils spécialisés

| Profil | Mandat principal | Production attendue |
| --- | --- | --- |
| Coordonnateur municipal de projets | Qualification, plan, délégation et consolidation | Plan de travail et dossier intégré |
| Finance et administration | Budget, dépenses, contrats et approvisionnement | Écarts sourcés et fiche financière |
| Planification | Échéancier, dépendances, risques et Gantt | Calendrier vérifiable |
| Analyse et géomatique | Données, indicateurs, méthodes et SIG | Analyse reproductible et limites |
| Rédaction et livrables | Rapports, notes et contrôle qualité | Brouillon clair et sourcé |
| Gouvernance | Réunions, ordres du jour, procès-verbaux et suivis | Registre d’actions et décisions |
| Subventions et partenariats | Appels, critères, calendrier et préparation | Fiche d’opportunité à valider |
| Veille réglementaire municipale | Sources, incidences possibles, règlements et politiques | Matrice de revue, jamais avis juridique |

Chaque profil a un workspace privé et un accès sandboxé au seul espace documentaire partagé. La coordination, les subventions et la veille réglementaire disposent d’une navigation contrôlée pour les sources publiques. Le routage est exclusivement OpenRouter; aucun modèle Claude n’est configuré.

## Veille municipale quotidienne

Le service `project-municipal-watch` relève à intervalle quotidien les seules URL déclarées dans une politique locale explicitement approuvée. Il compare une empreinte du contenu, conserve une fiche dépersonnalisée et crée une proposition lorsqu’un changement est détecté après la première référence. Il n’appelle aucun LLM.

Le pont d’approbation transforme cette proposition en tâche `pending_approval` dans Spacebot. **Approve** consigne seulement que la fiche a été examinée; il ne modifie aucun règlement, aucune politique, aucun permis, aucune subvention, aucun courriel ni aucune configuration. **Dismiss** conserve le dossier comme non retenu.

Les sources initiales proposées couvrent LégisQuébec pour la LQE, la Loi sur les compétences municipales et la LAU, la Ville de Val-d’Or, la MRC de La Vallée-de-l’Or, les concours FRQ et les portails fédéraux de financement. LégisQuébec est la source du texte officiel consolidé; le SAD de la MRCVO doit être traité comme document territorial versionné et limité à son périmètre.[1] [2] [3] [4]

### Activer la veille

Après le bootstrap, examinez la politique initiale :

```text
instance/shared-workspace/00_systeme/veille-municipale/
municipal_watch_policy.template.json
```

Puis créez la politique approuvée :

```bash
cd /srv/spacebot-project-hub/deploy/project-hub
cp instance/shared-workspace/00_systeme/veille-municipale/municipal_watch_policy.template.json \
   instance/shared-workspace/00_systeme/veille-municipale/municipal_watch_policy.approved.json
```

Dans ce fichier local, fixez `status` à `approved`, `allow_municipal_watch` à `true`, conservez tous les champs d’action automatique à `false`, puis activez seulement les sources correspondant au mandat. La première exécution crée une référence de base; les changements ultérieurs se trouvent dans `00_systeme/veille-municipale/proposals/` et deviennent des tâches d’examen Web.

## Subventions, réglementation et rédaction administrative

L’agent Subventions peut relever les appels institutionnels, comparer les critères publiés, établir un calendrier et préparer une fiche de décision. Une opportunité repérée ne confirme jamais l’admissibilité : le porteur, le territoire, les coûts, le cumul, les partenaires, les échéances et les règles du programme doivent être validés humainement. Les portails fédéraux identifient les IRSC, le CRSNG, le CRSH et la FCI; la page et les documents de chaque programme restent la référence.[5]

L’agent réglementaire distingue le texte officiel, la page administrative, le règlement municipal, le document de planification et l’analyse de travail. Il prépare des matrices d’incidences, des brouillons de règlement et des politiques environnementales. La LQE vise notamment la protection de l’environnement; la Loi sur les compétences municipales comporte des pouvoirs municipaux en environnement, mais un règlement municipal incompatible avec une norme supérieure est inopérant.[1] [2]

Les compétences de rédaction contiennent des gabarits pour les notes de réunion, ordres du jour, projets de procès-verbal, notes de service et fiches aux élus, brouillons de courriel, politiques environnementales et projets de règlement. Tout commence dans `07_livrables/01_brouillons/`. Un procès-verbal demeure un projet jusqu’à sa validation prévue; un courriel ne sera jamais envoyé par l’agent.

## Démarrage Docker local

```bash
cd /srv/spacebot-project-hub
git pull --ff-only origin feat/generic-project-hub

cd deploy/project-hub
cp .env.example .env
# Renseigner OPENROUTER_API_KEY, PROJECT_HUB_MEMORY_DB_PASSWORD,
# PROJECT_HUB_MEMORY_EXPORT_TOKEN, PROJECT_HUB_AUTONOMOUS_PIPELINE_TOKEN,
# PROJECT_HUB_APPROVAL_BRIDGE_TOKEN, PROJECT_HUB_FAILURE_REMEDIATOR_TOKEN
# et PROJECT_HUB_MUNICIPAL_WATCH_TOKEN avec des valeurs locales fortes.
chmod 600 .env

./bootstrap_instance.sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 project-municipal-watch project-approval-bridge
```

L’interface locale est disponible sur <http://127.0.0.1:19898>. Le port reste lié à `localhost`; une exposition réseau exige un proxy HTTPS authentifié. Sauvegarder ensemble `instance/` et `volumes/postgres/` selon les règles de conservation applicables.

## Références

[1] [LégisQuébec — Loi sur la qualité de l’environnement, Q-2](https://legisquebec.gouv.qc.ca/fr/showdoc/cs/q-2)

[2] [LégisQuébec — Loi sur les compétences municipales, C-47.1](https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-47.1)

[3] [LégisQuébec — Loi sur l’aménagement et l’urbanisme, A-19.1](https://www.legisquebec.gouv.qc.ca/fr/document/lc/A-19.1)

[4] [MRC de La Vallée-de-l’Or — Schéma d’aménagement et de développement](https://mrcvo.qc.ca/territoire/schema-damenagement-et-de-developpement/)

[5] [Science Canada — Financement interorganismes de la recherche](https://science.gc.ca/site/science/fr/financement-interorganismes-recherche)
