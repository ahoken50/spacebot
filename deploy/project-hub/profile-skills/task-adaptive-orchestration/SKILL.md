---
name: task-adaptive-orchestration
description: Qualifier une demande, sélectionner les expertises utiles, découper le travail, ajuster le plan selon les preuves et coordonner une exécution multiagent sans duplication.
---

# Orchestration adaptative des tâches

## But

Transformer toute demande en un plan de travail vérifiable, proportionné et évolutif. Les rôles constituent des **capacités disponibles**, non une chaîne figée : l’orchestrateur mobilise uniquement les profils utiles et réattribue le travail lorsqu’une nouvelle preuve ou un blocage le justifie.

## Cycle autonome

1. Reformuler l’objectif, le résultat attendu, l’échéance, le public, les données disponibles et les limites connues.
2. Classer le besoin dominant : recherche, planification, analyse, automatisation, rédaction, révision, ou apprentissage.
3. Créer des sous-tâches atomiques avec un responsable, des sources, un critère de réussite, une dépendance et un prochain pas mesurable.
4. Déléguer en parallèle seulement les travaux indépendants; conserver une seule source de vérité dans la mémoire partagée.
5. Après chaque résultat, comparer la preuve aux critères, puis conserver le plan, le corriger, changer le responsable ou ouvrir une tâche de suivi.
6. Faire relire les résultats qui influencent une conclusion, un calcul, un script ou un livrable important avant de les déclarer prêts.

## Routage indicatif

| Besoin observé | Profil prioritaire | Appui fréquent |
| --- | --- | --- |
| Faits externes, comparaison d’options, sources | `task-research` | `task-review` |
| Dépendances, échéances, risques, étapes | `task-planning` | `task-orchestrator` |
| Calcul, méthode, transformation de données | `task-analysis` | `task-review` |
| Script, outil local, test ou reproductibilité | `task-automation` | `task-analysis` |
| Note, rapport, synthèse, procédure ou message | `task-writing` | `task-review` |
| Validation contradictoire et critères | `task-review` | profil auteur |
| Leçons, référence, DSPy ou SkillOpt | `task-learning` | `task-orchestrator` |

## Règles de correction

- Ne pas relancer une tentative identique. Décrire la différence attendue : nouvelle source, découpage plus petit, test ajouté, autre méthode ou autre profil.
- Lorsqu’un rôle manque, préparer une proposition de compétence ou un script local testable; ne pas modifier l’environnement ou installer une capacité externe sans approbation.
- Clore une sous-tâche seulement avec un résultat, les sources utilisées, les limites, les preuves de test et la prochaine action éventuelle.
- Toute action externe, changement durable ou promotion d’apprentissage reste en attente d’approbation humaine.
