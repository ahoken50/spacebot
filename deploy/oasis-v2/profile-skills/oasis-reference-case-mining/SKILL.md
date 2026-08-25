---
name: oasis-reference-case-mining
description: Découvrir localement des candidats dépersonnalisés de cas de référence pour DSPy et SkillOpt. Utiliser pour analyser les tâches OASIS terminées, validées et explicitement marquées learning_eligible, sans promouvoir automatiquement les candidats vers un pack actif.
---

# Découverte de cas de référence OASIS

## Objectif

Créer des **candidats** de cas de référence réutilisables à partir d’enregistrements OASIS terminés, approuvés et autorisés. Ne jamais traiter un candidat comme un cas actif DSPy ou SkillOpt.

## Procédure

1. Consulter `reference_miner_status`, puis valider la politique avec `reference_miner_validate_policy`.
2. Vérifier que la politique est approuvée, exige la dépersonnalisation et limite les types d’enregistrements.
3. Lancer `reference_miner_discover_candidates` pour un essai ou laisser `reference_miner_autonomous_cycle` appliquer le plafond périodique autorisé.
4. Lire les fichiers `dspy_candidates.json` et `skillopt_candidates.json` produits dans `00_systeme/optimisation/reference-miner/`.
5. Examiner la provenance, les références de source, le texte dépersonnalisé, les critères attendus et les doublons éliminés.
6. Copier seulement les candidats retenus dans un pack DSPy ou SkillOpt distinct. Garder leurs identifiants séparés entre apprentissage, validation et contrôle final.

## Admissibilité minimale

Utiliser uniquement les enregistrements qui remplissent **toutes** les conditions : statut `approved`, `payload.completed=true`, `payload.learning_eligible=true`, références de source présentes, critères `payload.reference_expected` structurés et type autorisé par la politique.

## Interdictions

Ne jamais :

- lancer le mineur sur des sources brutes, des contrats confidentiels, des renseignements personnels ou des secrets;
- désactiver la dépersonnalisation ou les contrôles de déduplication;
- modifier `reference_cases.approved.json` ou `skillopt_reference_pack.approved.json` directement;
- définir `auto_promote=true`;
- promouvoir un candidat sans vérifier sa réponse attendue, ses sources et sa séparation de partitions.

> L’autonomie produit des candidats et des preuves de sélection. L’activation dans un jeu de référence demeure une décision contrôlée et traçable.
