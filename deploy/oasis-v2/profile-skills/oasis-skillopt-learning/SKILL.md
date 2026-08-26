---
name: oasis-skillopt-learning
description: Apprendre et améliorer de façon autonome une compétence OASIS SKILL.md à partir de cas dépersonnalisés, approuvés et évaluables. Utiliser pour améliorer une procédure répétable sans modifier les agents, modèles, outils, données, permissions ni configuration de production.
---

# Apprentissage SkillOpt OASIS

## Distinguer les boucles

Utiliser **DSPy** pour améliorer une instruction ou un comportement court sur des cas de référence. Utiliser **SkillOpt** pour améliorer une seule procédure `SKILL.md` versionnée. Ne pas lancer les deux boucles sur le même artefact pendant la même période d’apprentissage.

## Préparer un pack utilisable

1. Consulter `oasis_skillopt_skillopt_status`, puis `oasis_skillopt_skillopt_validate_reference_pack`.
2. Utiliser seulement `00_systeme/optimisation/skillopt/skillopt_reference_pack.approved.json` lorsque son statut est `approved`, son attribut `redacted` vaut `true` et son scope est `skill_text_only`.
3. Maintenir des identifiants distincts dans `training_cases`, `validation_cases` et `holdout_cases`. Réserver la partition holdout au contrôle final.
4. Inclure des critères objectifs : termes requis ou interdits, références de source, longueur maximale, structure attendue ou résultat d’un outil local. Ne pas utiliser une impression générale comme unique métrique.
5. Ne jamais inclure de document municipal, donnée personnelle, secret, facture, pièce contractuelle ou conversation réelle dans le pack.

## Boucle autonome

Le service peut exécuter une tentative périodique lorsque `autonomous_learning` vaut `true` dans un pack déjà approuvé. Il est limité à une compétence autorisée, à une exécution à la fois et au plafond quotidien configuré. Il s’arrête sans appel de modèle si le pack est invalide, absent, non approuvé ou hors budget.

Chaque tentative conserve la compétence de référence, prépare les partitions locales, applique SkillOpt avec édition bornée et garde de validation, puis écrit seulement une proposition sous `00_systeme/optimisation/skillopt/propositions/` avec les journaux sous `runs/`.

## Examiner une proposition

1. Vérifier `candidate_changed`, le diff entre `baseline_SKILL.md` et `candidate_SKILL.md`, et la partition holdout.
2. Vérifier que la proposition ne change qu’une procédure spécialisée et ne transforme pas les règles contractuelles, financières, SIG ou de sécurité.
3. Consigner une synthèse vérifiable dans la mémoire commune avec le statut `pending_approval`.
4. Promouvoir uniquement par une révision humaine, un commit distinct et les contrôles statiques OASIS.

## Interdictions permanentes

Ne jamais utiliser cette boucle pour modifier `config.toml`, Docker, les modèles, les MCP, les permissions, OpenCode, les secrets, les dossiers de sources, les documents de reddition ou les règles d’approbation. Ne jamais activer l’adoption automatique d’une compétence dans l’instance. Si le signal de qualité est incertain, archiver la proposition et conserver la compétence existante.
