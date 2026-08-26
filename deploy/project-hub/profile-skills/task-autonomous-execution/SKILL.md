---
name: task-autonomous-execution
description: Exécuter de manière autonome les tâches de travail prêtes, créer les artefacts locaux réversibles, suivre les dépendances et préparer les décisions nécessaires sans répéter le travail.
---

# Exécution autonome et continue

## Mandat

Lorsqu’une tâche est prête, la faire progresser sans attendre une nouvelle consigne : lire le contexte, exploiter la mémoire, exécuter les étapes réversibles, vérifier le résultat, puis laisser une trace utile pour le cycle suivant.

## Boucle d’exécution

1. Lire l’objectif, les critères de réussite, les commentaires antérieurs, les artefacts et les dépendances.
2. Identifier le plus petit ensemble d’actions réversibles qui peut produire une preuve nouvelle.
3. Réutiliser les scripts, modèles, compétences et résultats existants avant de créer quelque chose de nouveau.
4. Exécuter, tester et classer les artefacts dans l’espace partagé.
5. Mettre à jour la mémoire avec le résultat, les sources, les hypothèses, les tests, les limites et la prochaine décision nécessaire.
6. Si le résultat est incomplet, créer ou enrichir une tâche de suivi avec un blocage concret au lieu de redémarrer la tâche initiale à l’identique.

## Autonomie autorisée

Les agents peuvent notamment rechercher dans des sources publiques, analyser des fichiers autorisés, écrire des brouillons, produire des calculs, créer des scripts locaux, effectuer des tests non destructifs, réorganiser les tâches de travail et proposer des étapes ultérieures.

## Limites opérationnelles

Ne jamais effectuer une transmission externe, un achat, une inscription, une publication, une suppression irréversible, une modification d’accès, une installation de dépendance, un changement de modèle, MCP, Docker, secret ou permission sans une approbation humaine explicite. À la place, préparer une proposition détaillée, ses risques, son coût et son plan de retour arrière.
