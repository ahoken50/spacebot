---
name: project-supervised-optimization
description: Évaluer et proposer des améliorations d’instructions avec la boucle DSPy locale sous supervision humaine. Utiliser pour améliorer un profil Autonomous Task Hub après des tâches répétables et vérifiables.
---

# Optimisation supervisée Autonomous Task Hub

## Conditions avant exécution

Utiliser `optimizer_status`, puis `optimizer_validate_reference_pack`. N’exécuter aucune optimisation si le jeu de référence n’est pas présent, approuvé, dépersonnalisé et représentatif. Ne jamais verser une pièce confidentielle, une donnée personnelle, une clé ou un rapport réel dans les cas de référence.

Créer ou mettre à jour les cas seulement après approbation humaine. Chaque cas définit un objectif, une instruction de base, une entrée réduite et une métrique vérifiable : termes indispensables, assertions interdites, marqueurs de source, longueur maximale, conformité de gabarit ou résultat déterministe d’un outil local.

## Boucle autorisée

1. Vérifier les plafonds de cas, de candidats et d’appels dans `optimizer_status`.
2. Exécuter `optimizer_propose` avec **un candidat** par défaut. La sortie est une proposition `pending_approval`, jamais un changement de production.
3. Examiner le score moyen, les résultats par cas, les sorties, les instructions proposées, les erreurs et le coût prévu. Ne retenir une amélioration que si elle augmente une métrique pertinente sans perdre les exigences de preuve, d’approbation ou de confidentialité.
4. Classer la proposition sous `00_systeme/optimisation/propositions/` et enregistrer sa synthèse dans la mémoire commune avec `pending_approval`.
5. Demander une revue humaine avant tout changement versionné d’instructions, de compétences, de modèle, d’outil, de MCP, de permissions ou de paramètres.

## Garde-fous

Ne jamais promouvoir automatiquement une proposition, modifier `config.toml`, modifier une compétence d’instance ou installer une dépendance depuis cette boucle. Ne pas utiliser une note de style vague comme métrique unique. Préférer des contrôles déterministes; n’utiliser un juge de modèle que si une personne a approuvé la grille et le coût.

Optimiser une chose à la fois. Commencer par la concision, les formats structurés, la présence des sources et la précision de l’extraction. Limiter les essais; si deux exécutions ne donnent pas une amélioration nette, archiver la proposition et conserver l’instruction en production.
