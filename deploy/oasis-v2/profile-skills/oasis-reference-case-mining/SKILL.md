---
name: oasis-reference-case-mining
description: Découvrir localement des candidats dépersonnalisés de cas de référence et orchestrer leur évaluation DSPy ou SkillOpt. Utiliser pour apprendre automatiquement à partir de tâches OASIS explicitement admissibles, jusqu’à une proposition finale soumise à l’approbation de l’utilisateur.
---

# Découverte de cas de référence OASIS

## Objectif

Créer des **candidats** de cas de référence réutilisables à partir d’enregistrements OASIS terminés, approuvés et autorisés. Lorsque la politique active `autonomous_pipeline=true`, préparer automatiquement les packs temporaires, exécuter les évaluations DSPy et SkillOpt autorisées, puis produire les propositions finales à soumettre à l’utilisateur.

## Procédure

1. Consulter `reference_miner_status`, puis valider la politique avec `reference_miner_validate_policy`.
2. Vérifier que la politique est approuvée, exige la dépersonnalisation et limite les types d’enregistrements.
3. Lancer `reference_miner_discover_candidates` pour un essai. Après vérification, activer `autonomous_mining=true` et `autonomous_pipeline=true` dans la politique afin que `reference_miner_autonomous_cycle` applique le plafond périodique autorisé.
4. Le pipeline produit `dspy_candidates.json`, `skillopt_candidates.json` et des packs temporaires `system_validated` dans `00_systeme/optimisation/reference-miner/autonomous-packs/`.
5. Il déclenche ensuite les évaluations DSPy et SkillOpt sur ces packs temporaires, en respectant leurs quotas existants et en enregistrant une proposition `pending_approval`.
6. Examiner seulement la proposition finale, son diff, les scores, les références et les contrôles holdout avant de prendre la décision d’approbation ou de rejet.

## Admissibilité minimale

Utiliser uniquement les enregistrements qui remplissent **toutes** les conditions : statut `approved`, `payload.completed=true`, `payload.learning_eligible=true`, références de source présentes, critères `payload.reference_expected` structurés et type autorisé par la politique.

## Interdictions

Ne jamais :

- lancer le mineur sur des sources brutes, des contrats confidentiels, des renseignements personnels ou des secrets;
- désactiver la dépersonnalisation ou les contrôles de déduplication;
- modifier `reference_cases.approved.json`, `skillopt_reference_pack.approved.json`, la configuration, les modèles, les permissions ou les services de production;
- définir `auto_promote=true`;
- promouvoir un candidat sans vérifier sa réponse attendue, ses sources et sa séparation de partitions.

> L’autonomie couvre la découverte, le partitionnement, l’évaluation et la proposition. Elle s’arrête à l’approbation finale de l’utilisateur, qui est la seule étape capable de promouvoir une instruction ou une compétence.
